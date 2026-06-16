// VACConfig.swift
// Shared config between the VAC containing app and the keyboard extension.
// App Groups lets both targets read/write the same UserDefaults bucket.

import Foundation

final class VACConfig {

    static let shared  = VACConfig()
    private init() {}

    static let appGroupID = "group.com.siyaagrawal.vackeyboard"
    private let suiteName = VACConfig.appGroupID

    private var defaults: UserDefaults {
        UserDefaults(suiteName: suiteName) ?? .standard
    }

    // MARK: - Claude API key (set once in the VAC app → shared to keyboard)

    /// Anthropic API key. Set via the VAC app Settings screen, shared via App Groups.
    var claudeAPIKey: String? {
        get {
            let k = defaults.string(forKey: "vacClaudeAPIKey") ?? ""
            return k.isEmpty ? nil : k
        }
        set { defaults.set(newValue ?? "", forKey: "vacClaudeAPIKey") }
    }

    // MARK: - Mac server URL

    /// Candidate server URLs probed in order — first to respond wins.
    /// Bonjour .local hostname works over USB cable AND same-WiFi.
    /// IP addresses are fallbacks in case mDNS is slow.
    static let serverCandidates: [String] = [
        "http://Siyas-MacbBook-Pro.local:8787",   // Bonjour mDNS — works USB + WiFi
        "http://192.0.0.2:8787",                   // USB Personal Hotspot (Mac is client)
        "http://192.168.1.153:8787",               // Home WiFi static IP
        "http://192.168.0.2:8787",                 // Alternate subnet
        "http://169.254.84.57:8787",               // USB direct link-local
    ]

    var serverURL: String {
        get {
            let stored = defaults.string(forKey: "vacServerURL") ?? ""
            // If nothing stored yet, return first candidate (Bonjour hostname)
            if stored.isEmpty { return VACConfig.serverCandidates[0] }
            return stored
        }
        set { defaults.set(newValue, forKey: "vacServerURL") }
    }

    // MARK: - Contact name (enables per-contact learning + WhatsApp send)

    /// Set by the hosting app when a conversation is opened. Shared to keyboard via App Groups.
    var contactName: String {
        get { defaults.string(forKey: "vac_contact_name") ?? "" }
        set { defaults.set(newValue, forKey: "vac_contact_name") }
    }

    // MARK: - Learned preferences

    var preferredTone: String? {
        get { defaults.string(forKey: "vacPreferredTone") }
        set { defaults.set(newValue, forKey: "vacPreferredTone") }
    }

    var totalSuggestionsUsed: Int {
        get { defaults.integer(forKey: "vacTotalUsed") }
        set { defaults.set(newValue, forKey: "vacTotalUsed") }
    }

    func recordUsage(tone: String) {
        let key   = "vacTone_\(tone)"
        let count = defaults.integer(forKey: key) + 1
        defaults.set(count, forKey: key)
        totalSuggestionsUsed += 1

        let tones = ["Natural", "Thoughtful", "Smart", "Warm"]
        let total = totalSuggestionsUsed
        guard total >= 5 else { return }
        for t in tones {
            let c = defaults.integer(forKey: "vacTone_\(t)")
            if Double(c) / Double(total) >= 0.45 { preferredTone = t; return }
        }
        preferredTone = nil
    }
}
