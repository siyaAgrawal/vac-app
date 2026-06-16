// Models.swift — shared between app target and keyboard extension target

struct VACSuggestion {
    let tone: String
    let text: String
    let why:  String
}

// MARK: - Goal Mode (shared)

enum VACGoalMode: String, CaseIterable {
    case auto      = "Auto"
    case persuade  = "Persuade"
    case reconnect = "Reconnect"
    case impress   = "Impress"
    case firm      = "Firm"
    case funny     = "Funny"

    var emoji: String {
        switch self {
        case .auto:      return "✦"
        case .persuade:  return "🎯"
        case .reconnect: return "💙"
        case .impress:   return "⚡"
        case .firm:      return "🔒"
        case .funny:     return "😄"
        }
    }

    var goalPrompt: String {
        switch self {
        case .auto:      return "Pick the most effective reply for the situation."
        case .persuade:  return "Craft replies that persuade and convince. Compelling but not pushy."
        case .reconnect: return "Help repair or strengthen the relationship. Warm, genuine, empathetic."
        case .impress:   return "Replies that make the sender look sharp, confident, and impressive."
        case .firm:      return "Assertive, clear replies that hold boundaries respectfully."
        case .funny:     return "Clever, witty, fun replies that make the conversation enjoyable."
        }
    }
}
