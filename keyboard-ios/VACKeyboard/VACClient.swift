// VACClient.swift
// Network layer for the VAC keyboard extension.
//
// Priority order for suggestions:
//   1. Direct Claude API (when API key is set in the VAC app)  — best quality, works anywhere
//   2. Mac server relay (Ollama-powered, same Wi-Fi)           — good quality, no key needed
//   3. Heuristic fallback                                       — instant, works offline
//
// For sending messages:
//   1. WhatsApp bridge via Mac server (/api/keyboard/send)     — sends for real in the background
//   2. Insert text + Return key                                 — works in iMessage, Telegram, etc.

import Foundation

// MARK: - Error type

enum VACError: Error {
    case badURL
    case decodeError
    case network(Error)

    var isOffline: Bool {
        if case .network(let e) = self {
            let code = (e as NSError).code
            return code == NSURLErrorCannotConnectToHost ||
                   code == NSURLErrorNetworkConnectionLost ||
                   code == NSURLErrorNotConnectedToInternet ||
                   code == NSURLErrorTimedOut
        }
        return false
    }
}

// MARK: - VACClient

final class VACClient {

    static let shared = VACClient()
    private init() {}

    // Last-response context fields — populated after each successful suggest() call
    var lastTone:           String  = ""
    var lastBestTime:       String  = ""
    var lastRashReason:     String? = nil
    var lastSendingContext: String  = ""

    /// The URL that last successfully responded — cached to avoid re-probing every time
    private var resolvedServerURL: String? = nil

    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest  = 8
        cfg.timeoutIntervalForResource = 10
        return URLSession(configuration: cfg)
    }()

    private let probeSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest  = 3
        cfg.timeoutIntervalForResource = 4
        return URLSession(configuration: cfg)
    }()

    // MARK: - Server auto-discovery

    /// Tries each candidate URL in parallel; calls back with first that succeeds.
    /// Caches the result in resolvedServerURL for subsequent calls.
    func resolveServerURL(completion: @escaping (String?) -> Void) {
        if let resolved = resolvedServerURL {
            // Quick health-check on cached URL
            quickCheck(resolved) { [weak self] ok in
                if ok { completion(resolved) }
                else  { self?.resolvedServerURL = nil; self?.probeAll(completion: completion) }
            }
            return
        }
        probeAll(completion: completion)
    }

    private func probeAll(completion: @escaping (String?) -> Void) {
        let candidates = VACConfig.serverCandidates
        var found = false
        let group = DispatchGroup()
        var firstURL: String? = nil
        let lock = NSLock()

        for url in candidates {
            group.enter()
            quickCheck(url) { ok in
                lock.lock()
                if ok && !found { found = true; firstURL = url }
                lock.unlock()
                group.leave()
            }
        }
        group.notify(queue: .global()) { [weak self] in
            self?.resolvedServerURL = firstURL
            completion(firstURL)
        }
    }

    func clearResolvedURL() { resolvedServerURL = nil }

    private func quickCheck(_ base: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "\(base)/api/health") else { completion(false); return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 4.0   // mDNS .local resolution can take up to 2s
        req.cachePolicy    = .reloadIgnoringLocalCacheData
        probeSession.dataTask(with: req) { _, resp, _ in
            completion((resp as? HTTPURLResponse)?.statusCode == 200)
        }.resume()
    }

    // MARK: - Suggest

    func suggest(
        draft:         String,
        contextBefore: String,
        contextAfter:  String,
        appContext:    String,
        senderName:    String? = nil,
        goalMode:      VACGoalMode = .auto,
        serverURL:     String,          // kept for API compat, auto-discovery overrides
        completion:    @escaping (Result<[VACSuggestion], VACError>) -> Void
    ) {
        // ── Route 1: Mac server via auto-discovery ─────────────────────────────
        resolveServerURL { [weak self] resolved in
            guard let self = self else { return }
            let baseURL = resolved ?? serverURL   // fallback to passed-in if discovery fails

            guard let url = URL(string: "\(baseURL)/api/keyboard/suggest") else {
                completion(.success(ClaudeDirectClient.fallback(draft: draft, context: contextBefore, mode: goalMode)))
                return
            }
            self._callSuggestEndpoint(url: url, baseURL: baseURL, draft: draft,
                                      contextBefore: contextBefore, contextAfter: contextAfter,
                                      appContext: appContext, senderName: senderName,
                                      goalMode: goalMode, completion: completion)
        }
    }

    private func _callSuggestEndpoint(
        url: URL, baseURL: String,
        draft: String, contextBefore: String, contextAfter: String,
        appContext: String, senderName: String?,
        goalMode: VACGoalMode,
        completion: @escaping (Result<[VACSuggestion], VACError>) -> Void
    ) {
        // use `url` directly from here
        let _ = baseURL

        var req        = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "draft":         draft,
            "contextBefore": contextBefore,
            "contextAfter":  contextAfter,
            "appContext":    appContext,
            "profileKey":   senderName ?? "ios-global",
            "platform":     "ios",
            "goalMode":     goalMode.rawValue,
        ]
        if let name = senderName, !name.isEmpty { body["senderName"] = name }

        guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else {
            completion(.failure(.decodeError)); return
        }
        req.httpBody = httpBody

        session.dataTask(with: req) { data, _, error in
            if let error = error {
                completion(.success(ClaudeDirectClient.fallback(draft: draft, context: contextBefore, mode: goalMode)))
                _ = error
                return
            }
            guard
                let data     = data,
                let json     = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let variants = json["suggestions"] as? [[String: Any]]
            else {
                completion(.success(ClaudeDirectClient.fallback(draft: draft, context: contextBefore, mode: goalMode)))
                return
            }
            let suggestions = variants.compactMap { v -> VACSuggestion? in
                guard let text = v["text"] as? String, !text.isEmpty else { return nil }
                return VACSuggestion(
                    tone: v["tone"] as? String ?? "Natural",
                    text: text,
                    why:  v["why"]  as? String ?? ""
                )
            }

            // Parse rich context fields and store on shared instance
            let toneLabel = (json["toneOfIncoming"] as? [String: Any]).flatMap { d -> String? in
                guard let emoji = d["emoji"] as? String, let label = d["label"] as? String else { return nil }
                return "\(emoji) \(label)"
            } ?? ""
            let bestTime = (json["bestReplyWindow"] as? [String: Any]).flatMap { d -> String? in
                guard let emoji = d["emoji"] as? String, let label = d["label"] as? String else { return nil }
                return "\(emoji) \(label)"
            } ?? ""
            let rashWarning = json["rashWarning"] as? Bool ?? false
            let rashReason  = json["rashReason"] as? String
            let sendCtx     = json["sendingContext"] as? String ?? ""

            VACClient.shared.lastTone           = toneLabel
            VACClient.shared.lastBestTime       = bestTime
            VACClient.shared.lastRashReason     = rashWarning ? rashReason : nil
            VACClient.shared.lastSendingContext = sendCtx

            completion(.success(suggestions.isEmpty
                ? ClaudeDirectClient.fallback(draft: draft, context: contextBefore, mode: goalMode)
                : suggestions))
        }.resume()
    }

    // MARK: - Send via WhatsApp bridge

    /// Send a message via the WhatsApp bridge on the Mac server.
    /// The server resolves the contact by senderName → chatId automatically.
    /// Returns true if the server accepted the send, false if bridge unavailable.
    func sendViaWhatsApp(
        text:       String,
        senderName: String?,
        chatId:     String?,
        serverURL:  String,
        completion: @escaping (Bool) -> Void
    ) {
        guard let url = URL(string: "\(serverURL)/api/keyboard/send") else {
            completion(false); return
        }

        var req        = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 6

        var body: [String: Any] = ["text": text]
        if let id   = chatId,     !id.isEmpty   { body["chatId"]     = id }
        if let name = senderName, !name.isEmpty  { body["senderName"] = name }

        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        session.dataTask(with: req) { data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            completion(ok)
        }.resume()
    }

    // MARK: - Learn

    func learn(
        profileKey: String,
        tone:       String,
        text:       String,
        platform:   String,
        serverURL:  String
    ) {
        guard let url = URL(string: "\(serverURL)/api/keyboard/learn") else { return }
        var req        = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody   = try? JSONSerialization.data(withJSONObject: [
            "profileKey": profileKey, "tone": tone, "text": text, "platform": platform
        ])
        session.dataTask(with: req) { _, _, _ in }.resume()
    }

    // MARK: - Health

    func checkConnection(serverURL: String, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "\(serverURL)/api/health") else { completion(false); return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3
        session.dataTask(with: req) { _, response, _ in
            completion((response as? HTTPURLResponse)?.statusCode == 200)
        }.resume()
    }
}
