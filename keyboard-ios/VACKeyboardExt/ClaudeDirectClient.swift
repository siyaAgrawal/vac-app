// ClaudeDirectClient.swift
// Direct Claude API caller — no SDK, just URLSession.
// No key? Falls back to goal-aware heuristic suggestions instantly.

import Foundation

enum ClaudeDirectClient {

    // MARK: - API suggest

    static func suggest(
        draft:         String,
        contextBefore: String,
        contextAfter:  String,
        appContext:    String,
        senderName:    String?,
        preferredTone: String?,
        goalMode:      VACGoalMode = .auto,
        apiKey:        String,
        completion:    @escaping ([VACSuggestion]) -> Void
    ) {
        let prompt = buildPrompt(draft: draft, contextBefore: contextBefore,
                                 contextAfter: contextAfter, appContext: appContext,
                                 senderName: senderName, preferredTone: preferredTone,
                                 goalMode: goalMode)

        guard let url = URL(string: "https://api.anthropic.com/v1/messages") else {
            completion(fallback(draft: draft, context: contextBefore, mode: goalMode)); return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 10
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey,             forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01",       forHTTPHeaderField: "anthropic-version")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 600,
            "messages": [["role": "user", "content": prompt]],
        ] as [String: Any])

        guard req.httpBody != nil else {
            completion(fallback(draft: draft, context: contextBefore, mode: goalMode)); return
        }

        URLSession.shared.dataTask(with: req) { data, _, error in
            guard error == nil,
                  let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let content = json["content"] as? [[String: Any]],
                  let raw = content.first(where: { $0["type"] as? String == "text" })?["text"] as? String
            else {
                completion(fallback(draft: draft, context: contextBefore, mode: goalMode)); return
            }
            let parsed = parseJSON(raw)
            completion(parsed.isEmpty ? fallback(draft: draft, context: contextBefore, mode: goalMode) : parsed)
        }.resume()
    }

    // MARK: - Prompt builder

    private static func buildPrompt(
        draft: String, contextBefore: String, contextAfter: String,
        appContext: String, senderName: String?, preferredTone: String?,
        goalMode: VACGoalMode
    ) -> String {
        let hasDraft = !draft.trimmingCharacters(in: .whitespaces).isEmpty
        let ctx      = contextBefore.isEmpty ? "" : "Conversation:\n\(contextBefore.suffix(600))\n\n"
        let pref     = preferredTone.map { " Prefer '\($0)' style." } ?? ""
        let app      = appContext.isEmpty ? "" : " Platform: \(appContext)."
        let name     = senderName.map { " Texting: \($0)." } ?? ""
        let goal     = goalMode == .auto ? "" : "\nGoal: \(goalMode.goalPrompt)"
        let draftStr = hasDraft ? "Draft: \"\(draft)\"" : "(nothing typed yet)"

        return """
        You are VAC — a discreet AI that helps people text better.\(app)\(name)\(pref)\(goal)

        \(ctx)\(draftStr)

        Write exactly 4 reply suggestions. Rules:
        - Sound like the user wrote it — human, casual, real. Never AI-sounding.
        - Immediately sendable, no editing required.
        - Match the energy and relationship of the conversation.
        - Never open with: "Of course", "Absolutely", "Certainly", "Great question".

        Cover: Natural (gut reaction), Thoughtful (shows they listened), Smart (positions them well), Warm (emotionally present).

        Reply ONLY with JSON, no markdown:
        {"suggestions":[{"tone":"Natural","text":"...","why":"..."},{"tone":"Thoughtful","text":"...","why":"..."},{"tone":"Smart","text":"...","why":"..."},{"tone":"Warm","text":"...","why":"..."}]}
        """
    }

    // MARK: - JSON parser

    private static func parseJSON(_ raw: String) -> [VACSuggestion] {
        guard let start = raw.range(of: "{"),
              let end   = raw.range(of: "}", options: .backwards),
              start.lowerBound <= end.lowerBound else { return [] }
        let slice = String(raw[start.lowerBound...end.upperBound])
        guard let data    = slice.data(using: .utf8),
              let obj     = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let variants = obj["suggestions"] as? [[String: Any]] else { return [] }
        return variants.compactMap { v -> VACSuggestion? in
            guard let text = v["text"] as? String, !text.isEmpty else { return nil }
            return VACSuggestion(tone: v["tone"] as? String ?? "Natural",
                                 text: text, why: v["why"] as? String ?? "")
        }
    }

    // MARK: - Goal-aware heuristic fallback (instant, zero network)

    static func fallback(draft: String, context: String, mode: VACGoalMode = .auto) -> [VACSuggestion] {
        let combined = (context + " " + draft).lowercased()
        let isThanks   = combined.range(of: #"\bthank"#, options: .regularExpression) != nil
        let isChecking = combined.range(of: #"\b(how are|how's|you ok|what's up)\b"#, options: .regularExpression) != nil
        let isSchedule = combined.range(of: #"\b(tomorrow|tonight|today|later|free|available|when)\b"#, options: .regularExpression) != nil
        let isQuestion = combined.contains("?")
        let isPositive = combined.range(of: #"\b(good|great|love|happy|thanks|awesome)\b"#, options: .regularExpression) != nil
        let isNegative = combined.range(of: #"\b(bad|sad|sorry|can't|won't|busy)\b"#, options: .regularExpression) != nil
        let isConflict = combined.range(of: #"\b(upset|angry|hurt|wrong|unfair|hate)\b"#, options: .regularExpression) != nil

        switch mode {
        case .persuade:
            if isQuestion { return make("yeah, and here's why:", "honestly it makes sense when you think about it", "let me break it down", "trust me, you'll see once you try") }
            return make("here's the thing though:", "actually, consider this:", "think about it differently:", "you'll understand once we talk")

        case .reconnect:
            if isConflict { return make("i hear you, i really do", "i'm sorry — i didn't mean it that way", "can we talk? i miss how we were", "i care about you and want to fix this") }
            if isNegative { return make("i'm really sorry", "i'm here if you need anything", "that sounds hard — thinking of you", "what can i do?") }
            return make("i've been thinking about you", "i miss you, honestly", "can we catch up soon?", "just wanted to check in ❤️")

        case .impress:
            if isSchedule { return make("i'm free — just say when", "let's make it happen", "i'll make time", "already looking forward to it") }
            return make("yeah, figured as much", "exactly what i was thinking", "already on it", "couldn't agree more")

        case .firm:
            if isConflict { return make("i understand, but no", "i've made my decision", "my answer stays the same", "i respect that — but i'm firm here") }
            return make("noted", "understood. my position hasn't changed", "i need more than that", "let's be clear about what i agreed to")

        case .funny:
            if isThanks { return make("obviously 😂", "i know, you're welcome", "anytime — payment in snacks", "took me 3 seconds lol") }
            if isChecking { return make("thriving, barely 😂", "honestly? surviving", "better now that you asked lol", "mentally elsewhere 😭") }
            return make("lmaooo", "i cannot 😭", "why are you like this", "okay but same though 💀")

        case .auto:
            break
        }

        if isThanks   { return make("of course!", "happy to help anytime", "anytime — lmk if you need more", "always here for you ❤️") }
        if isChecking { return make("i'm good! you?", "doing well, thanks. you?", "all good — what's up?", "i'm good! been thinking about you") }
        if isSchedule && isQuestion { return make("yeah i can make it", "let me check and get back", "i'm free — what did you have in mind?", "yeah i'd love that, what's the plan?") }
        if isPositive { return make("haha yes", "right?? same", "exactly what i was thinking", "that made my day") }
        if isNegative { return make("aw no worries", "i get it, no stress", "totally fine — let's figure it out", "don't even worry about it") }
        if isQuestion { return make("yeah definitely", "honestly i've been thinking about that too", "good question — i'd say yes", "of course, always") }
        return make("haha yeah", "that actually makes a lot of sense", "i was just thinking the same thing", "i really appreciate that")
    }

    private static func make(_ n: String, _ t: String, _ s: String, _ w: String) -> [VACSuggestion] {
        [VACSuggestion(tone: "Natural",    text: n, why: "instinctive reply"),
         VACSuggestion(tone: "Thoughtful", text: t, why: "shows you were listening"),
         VACSuggestion(tone: "Smart",      text: s, why: "advances the conversation"),
         VACSuggestion(tone: "Warm",       text: w, why: "emotionally present")]
    }
}
