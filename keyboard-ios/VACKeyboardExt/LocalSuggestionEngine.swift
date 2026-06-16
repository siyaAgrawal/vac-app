// LocalSuggestionEngine.swift
// Instant heuristic suggestion engine — no network, runs in 0ms.
// Mirrors the server-side JS heuristic engine in Swift.
// Used as Tier-1 (always shown immediately). Server enriches with WA history as Tier-2.

import Foundation

// MARK: - Result types

struct LocalTone {
    let label: String
    let emoji: String
    let score: Int   // -2 aggressive, -1 negative/urgent, 0 neutral, +1 playful, +2 positive

    var displayString: String { "\(emoji) \(label)" }
}

struct LocalRash {
    let isRash: Bool
    let reason: String?
}

struct LocalTiming {
    let label: String
    let emoji: String
    let delayMinutes: Int

    var displayString: String { "\(emoji) \(label)" }
}

// MARK: - Engine

final class LocalSuggestionEngine {

    // MARK: Tone analysis

    static func analyzeTone(_ text: String) -> LocalTone {
        guard !text.isEmpty else { return .neutral }
        let t = text.lowercased()

        let hasAllCaps    = text.range(of: "[A-Z]{4,}", options: .regularExpression) != nil
        let hasTripleBang = text.range(of: "[!]{3,}", options: .regularExpression) != nil
        let hasAngryWords = t.containsAny(["wtf","angry","hate","stupid","idiot","damn",
                                           "consequences","fire you","in trouble","shut up"])
        if hasAllCaps || hasTripleBang || hasAngryWords {
            return LocalTone(label: "Aggressive", emoji: "😤", score: -2)
        }

        if t.matchesRegex("\\b(urgent|asap|now!|immediately|emergency|right now|call me|hurry)\\b") {
            return LocalTone(label: "Urgent", emoji: "⚡", score: -1)
        }
        if t.matchesRegex("\\b(sorry|can't|cant|won't|wont|busy|not sure|maybe|idk|not possible)\\b") {
            return LocalTone(label: "Negative", emoji: "😕", score: -1)
        }
        if t.matchesRegex("\\b(lol|haha|lmao|funny|joke|hilarious)\\b") ||
           text.contains("😂") || text.contains("🤣") || text.contains("😆") {
            return LocalTone(label: "Playful", emoji: "😄", score: 1)
        }
        if t.matchesRegex("\\b(great|love|thanks|thank|amazing|awesome|perfect|happy|glad|excited|proud|well done)\\b") ||
           text.contains("❤") || text.contains("🙏") {
            return LocalTone(label: "Positive", emoji: "😊", score: 2)
        }
        return .neutral
    }

    // MARK: Rash detection (on user's own draft)

    static func detectRash(_ draft: String) -> LocalRash {
        let t = draft.trimmingCharacters(in: .whitespaces)
        guard t.count > 3 else { return LocalRash(isRash: false, reason: nil) }

        if t.range(of: "[A-Z]{5,}", options: .regularExpression) != nil {
            return LocalRash(isRash: true, reason: "Typing in all caps")
        }
        if t.range(of: "[!]{3,}", options: .regularExpression) != nil {
            return LocalRash(isRash: true, reason: "Too many exclamation marks")
        }
        let low = t.lowercased()
        let aggressiveWords = ["idiot","stupid","hate you","screw","wtf","shut up",
                               "whatever","forget it","done with","i'm done"]
        if aggressiveWords.contains(where: { low.contains($0) }) {
            return LocalRash(isRash: true, reason: "Aggressive language detected")
        }
        let escalating = ["you always","you never","every time","i can't believe"]
        if escalating.contains(where: { low.contains($0) }) {
            return LocalRash(isRash: true, reason: "Escalating — might start a fight")
        }
        return LocalRash(isRash: false, reason: nil)
    }

    // MARK: Reply timing

    static func replyTiming(toneScore: Int) -> LocalTiming {
        switch toneScore {
        case ...(-2): return LocalTiming(label: "Take a breath (5 min)", emoji: "🧘", delayMinutes: 5)
        case -1:      return LocalTiming(label: "Reply thoughtfully",     emoji: "💭", delayMinutes: 2)
        default:      return LocalTiming(label: "Good time to reply",     emoji: "✅", delayMinutes: 0)
        }
    }

    // MARK: Suggestion generation

    static func suggest(draft: String, contextBefore: String,
                        goalMode: VACGoalMode = .auto) -> [VACSuggestion] {
        let rawMsg = contextBefore.trimmingCharacters(in: .whitespacesAndNewlines)
        let t      = rawMsg.lowercased()
        let d      = draft.trimmingCharacters(in: .whitespaces)

        // ── Pattern detection ──────────────────────────────────────────────
        let isUrgent     = rawMsg.matchesRegexI("asap|urgent|immediately|now!|hurry|deadline|everyone is waiting|[!]{3,}")
        let isAggressive = rawMsg.range(of: "[A-Z]{4,}", options: .regularExpression) != nil ||
                           rawMsg.range(of: "[!]{3,}", options: .regularExpression) != nil ||
                           t.containsAny(["wtf","angry","hate","stupid","idiot","consequences","fire you","in trouble"])
        let isPressure   = t.matchesRegexI("\\b(report|project|task|finish|done|complete|deadline|deliver|submit|need it|by end|by tomorrow|by tonight)\\b")
        let isQuestion   = rawMsg.contains("?") || rawMsg.matchesRegexI("^(what|when|where|who|why|how|is|are|can|do|did|will|would|should|have|has|could|bata|btao)\\b")
        let isTimeRel    = t.matchesRegexI("\\b(tonight|today|tomorrow|later|now|soon|free|available|busy|weekend|when|meet|dinner|lunch|morning|evening|7pm|8pm|9pm)\\b")
        let isPositive   = t.matchesRegexI("\\b(good|great|nice|love|happy|excited|glad|thanks|thank|awesome|congrats|perfect|amazing|proud|well done)\\b")
        let isNegative   = t.matchesRegexI("\\b(bad|sad|sorry|unfortunate|can't|cannot|won't|not sure|busy|miss|won't work|not possible)\\b")
        let isChecking   = t.matchesRegexI("\\b(how are|how's|you ok|you good|what's up|wassup|everything ok|you alright|kaisa|kaise|kya hal)\\b")
        let isPlanning   = t.matchesRegexI("\\b(plan|let's|lets|wanna|want to|going to|should we|how about|chale|milenge|kab aao|kab mile)\\b")
        let isThanks     = t.matchesRegexI("\\b(thank|thanks|appreciate|grateful|shukriya|dhanyawad)\\b")
        let isApology    = t.matchesRegexI("\\b(sorry|apologize|my bad|forgive|maafi)\\b")
        let isMissing    = t.containsAny(["miss you","miss u","thinking of you","been a while","long time no see"])
        let isConflict   = t.matchesRegexI("\\b(why did|you said|you told|that's not|that's wrong|you lied|you promised|you never|you always)\\b")
        let isHelp       = t.matchesRegexI("\\b(help|can you|could you|would you|please|help me|need your)\\b")
        let isHinglish   = t.matchesRegexI("\\b(yaar|bhai|bro|kya|hai|nahi|haan|theek|kal|aaj|mujhe|toh|matlab)\\b")
        let isInfo       = !isQuestion && rawMsg.count > 10

        // ── Goal mode overrides ────────────────────────────────────────────
        switch goalMode {
        case .persuade: return persuadeMode(d, rawMsg)
        case .firm:     return firmMode(d, rawMsg)
        case .funny:    return funnyMode(d, rawMsg)
        case .reconnect:return reconnectMode(d, rawMsg)
        default: break
        }

        // ── Draft variations ───────────────────────────────────────────────
        if !d.isEmpty {
            let base = d.replacingOccurrences(of: "[.!?]+$", with: "", options: .regularExpression)
            if isUrgent || isPressure {
                return s(base + " — on it now",
                         base + ", give me 20 mins",
                         base + " — almost done, just finalizing",
                         base + "! sending it shortly 🙏")
            }
            if isTimeRel {
                return s(base + "!",
                         base + " — what time works for you?",
                         base + ", what did you have in mind?",
                         base + "! sounds great 😊")
            }
            if isPositive {
                return s(base + " 😄", base + ", honestly same",
                         base + " — really glad to hear that", base + "! that means a lot")
            }
            if isQuestion {
                return s(base, base + " — let me think",
                         base + ", what made you ask?", base + ", what about you?")
            }
            return s(base, base + ", honestly", base + " — for real", base + " 😊")
        }

        // ── No draft — generate from incoming message context ──────────────

        if (isUrgent || isPressure) && isAggressive {
            return s("on it — finishing now",
                     "understood, sending it within the hour",
                     "already working on it — will have it done shortly",
                     "got it, i'll push everything else and finish this first 🙏")
        }
        if isUrgent && isPressure {
            return s("on it!", "finishing up now, sending shortly",
                     "almost done — will send in 20 mins", "yes! prioritizing this right now 🙏")
        }
        if isUrgent {
            return s("on it!", "yes, dealing with it right now",
                     "handling it — will update you shortly", "right away, on top of it 🙏")
        }
        if isAggressive && isConflict {
            return s("let's talk about this properly",
                     "i hear you — can we sort this out calmly?",
                     "i understand you're frustrated. let me explain",
                     "i get it, i'm sorry — let's fix this together")
        }
        if isAggressive {
            return s("okay, got it", "understood — i'll handle it",
                     "heard you loud and clear — i'll take care of it",
                     "i understand, i'm on it 🙏")
        }
        if isApology {
            return s("no worries at all!", "it's all good, don't stress",
                     "totally fine — these things happen", "honestly don't even worry ❤️")
        }
        if isThanks {
            return s("of course!", "happy to help anytime",
                     "anytime — let me know if you need more", "always here for you ❤️")
        }
        if isChecking {
            return s("i'm good! you?", "doing well, thanks for asking. you?",
                     "all good on my end — what's up with you?",
                     "i'm good! been thinking about you tbh")
        }
        if isPlanning {
            return s("yeah let's do it!", "sounds like a plan, count me in",
                     "i like that — when were you thinking?",
                     "yes!! i've been wanting to do that")
        }
        if isTimeRel && isQuestion {
            return s("yeah i can make it", "let me check and get back to you",
                     "i'm free — what did you have in mind?",
                     "yeah i'd love that, what's the plan?")
        }
        if isMissing {
            return s("miss you too!!", "yes!! we need to catch up properly",
                     "same honestly — let's actually plan something",
                     "ugh yes, been too long 😭❤️")
        }
        if isHelp {
            return s("yeah sure!", "of course — what do you need?",
                     "absolutely, what can i help with?", "yes! happy to help ❤️")
        }
        if isConflict {
            return s("that's not what i said",
                     "let me clarify — i think there's a misunderstanding",
                     "i hear you, but here's my side of it",
                     "i'm sorry you feel that way — can we talk about it?")
        }
        if isPositive {
            return s("haha yes!!", "right?? i'm so glad",
                     "exactly what i was thinking", "that honestly made my day ❤️")
        }
        if isNegative {
            return s("aw no worries", "i get it, no stress",
                     "totally fine — let's figure something out",
                     "don't even worry about it, seriously ❤️")
        }
        if isInfo && !isQuestion {
            return s("wait seriously?", "haha that makes sense actually",
                     "oh interesting — tell me more", "omg i had no idea 😭")
        }
        if isQuestion {
            return s("yeah for sure", "honestly i've been thinking about that too",
                     "good question — i'd say yes", "of course! always 😊")
        }
        if isHinglish {
            return s("haan yaar!", "theek hai, bata",
                     "sahi bol raha hai", "haha bilkul ❤️")
        }
        return s("got it!", "makes sense, thanks for letting me know",
                 "noted — i appreciate you telling me", "understood ❤️")
    }

    // MARK: Goal mode variants

    private static func persuadeMode(_ d: String, _ ctx: String) -> [VACSuggestion] {
        let b = d.isEmpty ? "" : d.replacingOccurrences(of: "[.!?]+$", with: "", options: .regularExpression)
        if !b.isEmpty {
            return s("\(b) — it really makes sense if you think about it",
                     "\(b) — and here's why this matters",
                     "honestly, \(b) — it's the right move",
                     "\(b). trust me on this one 🙏")
        }
        return s("i really think this is worth considering",
                 "hear me out — this makes a lot of sense",
                 "the evidence backs this up completely",
                 "i'd really appreciate you thinking this through 🙏")
    }

    private static func firmMode(_ d: String, _ ctx: String) -> [VACSuggestion] {
        let b = d.isEmpty ? "" : d.replacingOccurrences(of: "[.!?]+$", with: "", options: .regularExpression)
        if !b.isEmpty {
            return s("\(b).", "\(b) — that's my final answer",
                     "\(b) and i stand by that", "\(b). let me be clear about this")
        }
        return s("that doesn't work for me", "i've made my position clear",
                 "this is where i stand — non-negotiable",
                 "i hear you, but my answer is no")
    }

    private static func funnyMode(_ d: String, _ ctx: String) -> [VACSuggestion] {
        let b = d.isEmpty ? "" : d.replacingOccurrences(of: "[.!?]+$", with: "", options: .regularExpression)
        if !b.isEmpty {
            return s("\(b) lmao", "\(b) ngl 😂",
                     "\(b) — not gonna lie tho", "\(b) 💀")
        }
        return s("okay but why 😂", "that's sending me 💀",
                 "i can't with this honestly", "bro what 😭😭")
    }

    private static func reconnectMode(_ d: String, _ ctx: String) -> [VACSuggestion] {
        let b = d.isEmpty ? "" : d.replacingOccurrences(of: "[.!?]+$", with: "", options: .regularExpression)
        if !b.isEmpty {
            return s("\(b) ❤️", "\(b) — i really miss you",
                     "\(b), and i've been thinking about you",
                     "\(b)!! we need to catch up properly")
        }
        return s("hey, been thinking about you",
                 "miss you! how have you been?",
                 "it's been way too long — let's catch up",
                 "i really want to reconnect ❤️")
    }

    // MARK: Make helpers

    private static func s(_ natural: String, _ diplomatic: String,
                           _ persuasive: String, _ warm: String) -> [VACSuggestion] {
        [
            VACSuggestion(tone: "Natural",    text: natural,    why: "gut reaction"),
            VACSuggestion(tone: "Diplomatic", text: diplomatic, why: "builds goodwill"),
            VACSuggestion(tone: "Persuasive", text: persuasive, why: "advances your agenda"),
            VACSuggestion(tone: "Warm",       text: warm,       why: "deepens connection"),
        ]
    }
}

// MARK: - Static constants

private extension LocalTone {
    static let neutral = LocalTone(label: "Neutral", emoji: "😐", score: 0)
}

// MARK: - String helpers

private extension String {
    func matchesRegex(_ pattern: String) -> Bool {
        range(of: pattern, options: .regularExpression) != nil
    }
    func matchesRegexI(_ pattern: String) -> Bool {
        range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
    func containsAny(_ words: [String]) -> Bool {
        words.contains(where: { contains($0) })
    }
}
