// ClaudeDirectClient.swift
// Calls the Anthropic Claude API directly from the iPhone keyboard extension.
// Uses URLSession — no third-party SDK required on the keyboard target.
// Falls back to rich heuristic suggestions when offline or key not set.

import Foundation

// MARK: - Direct Claude caller

enum ClaudeDirectClient {

    // MARK: - Suggest via Claude API

    /// Call Claude API directly. Completion is always called — never fails silently.
    static func suggest(
        draft:         String,
        contextBefore: String,
        contextAfter:  String,
        appContext:    String,
        senderName:    String?,
        preferredTone: String?,
        apiKey:        String,
        completion:    @escaping ([VACSuggestion]) -> Void
    ) {
        let prompt = buildPrompt(
            draft:         draft,
            contextBefore: contextBefore,
            contextAfter:  contextAfter,
            appContext:    appContext,
            senderName:    senderName,
            preferredTone: preferredTone
        )

        guard let url = URL(string: "https://api.anthropic.com/v1/messages") else {
            completion(fallback(draft: draft, context: contextBefore)); return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 10
        req.setValue("application/json",        forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey,                    forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01",              forHTTPHeaderField: "anthropic-version")

        let body: [String: Any] = [
            "model":      "claude-haiku-4-5-20251001",
            "max_tokens": 600,
            "messages":   [["role": "user", "content": prompt]],
        ]
        guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else {
            completion(fallback(draft: draft, context: contextBefore)); return
        }
        req.httpBody = httpBody

        URLSession.shared.dataTask(with: req) { data, _, error in
            guard error == nil,
                  let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let content = json["content"] as? [[String: Any]],
                  let raw = content.first(where: { $0["type"] as? String == "text" })?["text"] as? String
            else {
                completion(fallback(draft: draft, context: contextBefore)); return
            }
            let suggestions = parseJSON(raw)
            completion(suggestions.isEmpty ? fallback(draft: draft, context: contextBefore) : suggestions)
        }.resume()
    }

    // MARK: - Prompt builder

    private static func buildPrompt(
        draft:         String,
        contextBefore: String,
        contextAfter:  String,
        appContext:    String,
        senderName:    String?,
        preferredTone: String?
    ) -> String {
        let hasDraft   = !draft.trimmingCharacters(in: .whitespaces).isEmpty
        let ctxLines   = contextBefore.isEmpty ? "" : "Conversation so far:\n\(contextBefore.suffix(800))\n\n"
        let afterHint  = contextAfter.isEmpty   ? "" : "\n[Text after cursor: \"\(contextAfter.prefix(100))\"]"
        let prefHint   = preferredTone.map { " The user has a strong preference for \"\($0)\" style." } ?? ""
        let appHint    = appContext.isEmpty      ? "" : " App: \(appContext)."
        let nameHint   = senderName.map { " You are messaging \($0)." } ?? ""

        return """
        You are VAC — a discreet AI that helps people write better text messages.\(appHint)\(nameHint)\(prefHint)

        \(ctxLines)User's current draft: \(hasDraft ? "\"\(draft)\"" : "(nothing typed yet)")
        \(afterHint)

        Generate exactly 4 reply suggestions. Each must:
        - Sound like a real human text, NOT an AI assistant
        - Be natural, brief, and conversational
        - Avoid "Of course!", "Absolutely!", "Certainly!", generic openers
        - Fit the relationship tone of the conversation
        - Be immediately sendable as-is

        Tones to cover:
        • Natural — the instinctive first reply, how they'd actually text
        • Thoughtful — shows they actually read and understood the message
        • Smart — subtly positions them well, advances things forward
        • Warm — emotionally present, makes the other person feel good

        Reply ONLY with this JSON — no markdown, no explanation:
        {"suggestions":[{"tone":"Natural","text":"...","why":"..."},{"tone":"Thoughtful","text":"...","why":"..."},{"tone":"Smart","text":"...","why":"..."},{"tone":"Warm","text":"...","why":"..."}]}
        """
    }

    // MARK: - JSON parser

    private static func parseJSON(_ raw: String) -> [VACSuggestion] {
        guard let start = raw.range(of: "{"),
              let end   = raw.range(of: "}", options: .backwards),
              start.lowerBound <= end.lowerBound
        else { return [] }

        let slice = String(raw[start.lowerBound...end.upperBound])
        guard let data    = slice.data(using: .utf8),
              let obj     = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let variants = obj["suggestions"] as? [[String: Any]]
        else { return [] }

        return variants.compactMap { v -> VACSuggestion? in
            guard let text = v["text"] as? String, !text.isEmpty else { return nil }
            return VACSuggestion(
                tone: v["tone"] as? String ?? "Natural",
                text: text,
                why:  v["why"]  as? String ?? ""
            )
        }
    }

    // MARK: - Context-aware fallback (offline / no key)

    static func fallback(draft: String, context: String) -> [VACSuggestion] {
        let combined = (context + " " + draft).lowercased()

        let isThanks   = combined.range(of: #"\bthank"#,                                                               options: .regularExpression) != nil
        let isChecking = combined.range(of: #"\b(how are|how's|you ok|you good|what's up|wassup|sup)\b"#,             options: .regularExpression) != nil
        let isSchedule = combined.range(of: #"\b(tomorrow|tonight|today|later|free|available|weekend|time|when)\b"#,  options: .regularExpression) != nil
        let isQuestion = combined.contains("?") || combined.range(of: #"\b(what|when|where|who|why|how|can|do|will|would|should)\b"#, options: .regularExpression) != nil
        let isPositive = combined.range(of: #"\b(good|great|love|happy|excited|congrat|thanks|awesome|nice)\b"#,      options: .regularExpression) != nil
        let isNegative = combined.range(of: #"\b(bad|sad|sorry|can't|cannot|won't|not sure|busy)\b"#,                 options: .regularExpression) != nil

        if isThanks   { return make("of course!", "happy to help anytime", "anytime — let me know if you need more", "always here for you ❤️") }
        if isChecking { return make("i'm good! you?", "doing well, thanks for asking. you?", "all good — what's up with you?", "i'm good! been thinking about you tbh") }
        if isSchedule && isQuestion { return make("yeah i can make it", "let me check and get back to you", "i'm free — what did you have in mind?", "yeah i'd love that, what's the plan?") }
        if isPositive { return make("haha yes", "right?? glad you feel the same", "exactly what i was thinking", "that honestly made my day") }
        if isNegative { return make("aw no worries", "i get it, no stress", "totally fine — let's figure out another time", "don't even worry about it, seriously") }
        if isQuestion { return make("yeah definitely", "honestly i've been thinking about that too", "good question — i'd say yes", "of course! always") }

        return make("haha yeah", "that actually makes a lot of sense", "i was just thinking the same thing", "i really appreciate that")
    }

    private static func make(_ natural: String, _ thoughtful: String, _ smart: String, _ warm: String) -> [VACSuggestion] {
        [
            VACSuggestion(tone: "Natural",    text: natural,    why: "instinctive reply"),
            VACSuggestion(tone: "Thoughtful", text: thoughtful, why: "shows you were listening"),
            VACSuggestion(tone: "Smart",      text: smart,      why: "advances the conversation"),
            VACSuggestion(tone: "Warm",       text: warm,       why: "emotionally present"),
        ]
    }
}
