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

    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest  = 9
        cfg.timeoutIntervalForResource = 12
        return URLSession(configuration: cfg)
    }()

    // MARK: - Suggest

    func suggest(
        draft:         String,
        contextBefore: String,
        contextAfter:  String,
        appContext:    String,
        senderName:    String? = nil,
        serverURL:     String,
        completion:    @escaping (Result<[VACSuggestion], VACError>) -> Void
    ) {
        // ── Route 1: Direct Claude API ─────────────────────────────────────────
        if let key = VACConfig.shared.claudeAPIKey {
            ClaudeDirectClient.suggest(
                draft:         draft,
                contextBefore: contextBefore,
                contextAfter:  contextAfter,
                appContext:    appContext,
                senderName:    senderName,
                preferredTone: VACConfig.shared.preferredTone,
                apiKey:        key
            ) { suggestions in
                completion(.success(suggestions))
            }
            return
        }

        // ── Route 2: Mac server (Ollama-powered) ───────────────────────────────
        guard let url = URL(string: "\(serverURL)/api/keyboard/suggest") else {
            completion(.success(ClaudeDirectClient.fallback(draft: draft, context: contextBefore)))
            return
        }

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
        ]
        if let name = senderName, !name.isEmpty { body["senderName"] = name }

        guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else {
            completion(.failure(.decodeError)); return
        }
        req.httpBody = httpBody

        session.dataTask(with: req) { data, _, error in
            if let error = error {
                completion(.success(ClaudeDirectClient.fallback(draft: draft, context: contextBefore)))
                _ = error  // suppress unused-warning; we silently fall back
                return
            }
            guard
                let data     = data,
                let json     = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let variants = json["suggestions"] as? [[String: Any]]
            else {
                completion(.success(ClaudeDirectClient.fallback(draft: draft, context: contextBefore)))
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
            completion(.success(suggestions.isEmpty
                ? ClaudeDirectClient.fallback(draft: draft, context: contextBefore)
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
