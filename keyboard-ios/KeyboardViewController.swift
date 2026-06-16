// KeyboardViewController.swift
// VAC AI Keyboard — contextual reply suggestions with one-tap send.
//
// Features:
//  • 4 suggestion chips — Natural / Thoughtful / Smart / Warm
//  • Tap chip text  → inserts suggestion (you review, then tap app's Send)
//  • Tap ↑ button   → inserts suggestion AND sends immediately
//  • WhatsApp       → sends via WhatsApp bridge on Mac server (truly sends in background)
//  • Other apps     → inserts text then presses Return key (sends in iMessage, Telegram, etc.)
//  • Self-learning  → remembers your tone preference per contact
//  • Offline-safe   → context-aware fallback suggestions when server unreachable

import UIKit

// MARK: - Models

struct VACSuggestion {
    let tone: String
    let text: String
    let why:  String
}

// MARK: - KeyboardViewController

final class KeyboardViewController: UIInputViewController {

    // MARK: UI
    private let bar           = UIView()
    private let vacBadge      = UILabel()
    private let statusLabel   = UILabel()
    private let scrollView    = UIScrollView()
    private let chipStack     = UIStackView()
    private let loadingView   = VACLoadingView()
    private let nextKbdButton = UIButton(type: .system)
    private let divider       = UIView()

    // MARK: State
    private var debounceTimer: Timer?
    private var lastContext   = ""
    private var suggestions:  [VACSuggestion] = []

    // MARK: Derived config
    private var serverURL:    String { VACConfig.shared.serverURL }
    private var contactName:  String { VACConfig.shared.contactName }

    /// Is the host app WhatsApp? Used to decide send strategy.
    private var isWhatsApp: Bool {
        textInputContextIdentifier?.contains("WhatsApp") == true ||
        textInputContextIdentifier?.contains("net.whatsapp") == true
    }

    // MARK: Heights
    private let barHeight: CGFloat = 66

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        let mode = VACConfig.shared.claudeAPIKey != nil ? "Claude AI" : "VAC"
        setStatus("\(mode) ready")
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        scheduleDebounce(context: textDocumentProxy.documentContextBeforeInput ?? "")
    }

    override func textDidChange(_ textInput: UITextInput?) {
        let context = textDocumentProxy.documentContextBeforeInput ?? ""
        guard context != lastContext else { return }
        lastContext = context
        scheduleDebounce(context: context)
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = UIColor(red: 0.96, green: 0.96, blue: 0.98, alpha: 1)
        view.frame.size.height = barHeight

        divider.backgroundColor = UIColor.separator
        divider.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(divider)

        // Next keyboard (🌐) button
        nextKbdButton.setTitle("🌐", for: .normal)
        nextKbdButton.titleLabel?.font = .systemFont(ofSize: 17)
        nextKbdButton.addTarget(self, action: #selector(advanceToNextInputMode), for: .touchUpInside)
        nextKbdButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(nextKbdButton)

        // VAC badge
        vacBadge.text      = "VAC"
        vacBadge.font      = .systemFont(ofSize: 10, weight: .black)
        vacBadge.textColor = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 1)
        vacBadge.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(vacBadge)

        // Status label
        statusLabel.font      = .systemFont(ofSize: 10, weight: .regular)
        statusLabel.textColor = .tertiaryLabel
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)

        // Scroll + chip stack
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.alwaysBounceHorizontal = true
        scrollView.contentInset = UIEdgeInsets(top: 0, left: 8, bottom: 0, right: 8)
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)

        chipStack.axis      = .horizontal
        chipStack.spacing   = 8
        chipStack.alignment = .center
        chipStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(chipStack)

        loadingView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(loadingView)

        NSLayoutConstraint.activate([
            // Divider
            divider.topAnchor.constraint(equalTo: view.topAnchor),
            divider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            divider.heightAnchor.constraint(equalToConstant: 0.5),

            // 🌐 button — left edge
            nextKbdButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 2),
            nextKbdButton.topAnchor.constraint(equalTo: divider.bottomAnchor),
            nextKbdButton.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            nextKbdButton.widthAnchor.constraint(equalToConstant: 36),

            // VAC badge — top-left above chips
            vacBadge.leadingAnchor.constraint(equalTo: nextKbdButton.trailingAnchor, constant: 4),
            vacBadge.topAnchor.constraint(equalTo: divider.bottomAnchor, constant: 6),

            // Status — right of badge
            statusLabel.leadingAnchor.constraint(equalTo: vacBadge.trailingAnchor, constant: 4),
            statusLabel.centerYAnchor.constraint(equalTo: vacBadge.centerYAnchor),

            // Scroll view — fills rest
            scrollView.leadingAnchor.constraint(equalTo: nextKbdButton.trailingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: vacBadge.bottomAnchor, constant: 4),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),

            chipStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            chipStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            chipStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            chipStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            chipStack.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor),

            loadingView.centerXAnchor.constraint(equalTo: scrollView.centerXAnchor),
            loadingView.centerYAnchor.constraint(equalTo: scrollView.centerYAnchor),
        ])
    }

    // MARK: - Fetch

    private func scheduleDebounce(context: String) {
        debounceTimer?.invalidate()
        debounceTimer = Timer.scheduledTimer(withTimeInterval: 0.55, repeats: false) { [weak self] _ in
            self?.fetchSuggestions(context: context)
        }
    }

    private func fetchSuggestions(context: String) {
        let fullBefore = textDocumentProxy.documentContextBeforeInput ?? ""
        let after      = textDocumentProxy.documentContextAfterInput  ?? ""

        // draft = just the sentence being typed (after last newline)
        let lines  = fullBefore.components(separatedBy: "\n")
        let draft  = lines.last ?? fullBefore
        let ctxBefore = lines.count > 1 ? lines.dropLast().joined(separator: "\n") : ""

        let contact = contactName

        setStatus("Thinking…")
        loadingView.startAnimating()
        clearChips()

        VACClient.shared.suggest(
            draft:         draft,
            contextBefore: ctxBefore,
            contextAfter:  after,
            appContext:    hostAppName(),
            senderName:    contact.isEmpty ? nil : contact,
            serverURL:     serverURL
        ) { [weak self] result in
            DispatchQueue.main.async {
                self?.loadingView.stopAnimating()
                switch result {
                case .success(let items):
                    self?.suggestions = items
                    self?.renderChips(items)
                    self?.setStatus(items.isEmpty ? "No suggestions" : "")
                case .failure:
                    let fb = ClaudeDirectClient.fallback(draft: draft, context: ctxBefore)
                    self?.suggestions = fb
                    self?.renderChips(fb)
                    self?.setStatus("Offline")
                }
            }
        }
    }

    // MARK: - Chip rendering

    private func clearChips() {
        chipStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    }

    private func renderChips(_ items: [VACSuggestion]) {
        clearChips()
        for item in items {
            let chip = VACChip(suggestion: item)
            chip.onInsert = { [weak self] in self?.insertSuggestion(item, andSend: false) }
            chip.onSend   = { [weak self] in self?.insertSuggestion(item, andSend: true) }
            chipStack.addArrangedSubview(chip)
        }
        scrollView.setContentOffset(CGPoint(x: -8, y: 0), animated: false)
    }

    // MARK: - Insert & send

    private func insertSuggestion(_ suggestion: VACSuggestion, andSend: Bool) {
        let gen = UIImpactFeedbackGenerator(style: andSend ? .medium : .light)
        gen.impactOccurred()

        // Delete only the current draft (text after last newline)
        let fullBefore    = textDocumentProxy.documentContextBeforeInput ?? ""
        let draftToDelete = fullBefore.components(separatedBy: "\n").last ?? fullBefore
        for _ in draftToDelete { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(suggestion.text)

        if andSend {
            sendMessage(text: suggestion.text)
        }

        // Learning
        let key = contactName.isEmpty ? "ios-global" : contactName
        VACConfig.shared.recordUsage(tone: suggestion.tone)
        VACClient.shared.learn(
            profileKey: key,
            tone:       suggestion.tone,
            text:       suggestion.text,
            platform:   "ios",
            serverURL:  serverURL
        )
    }

    /// Send strategy:
    ///  WhatsApp  → server bridge (actually sends via WhatsApp in background, clears field)
    ///  All else  → Return key (sends in iMessage, Telegram, Signal, etc.)
    private func sendMessage(text: String) {
        let contact = contactName

        if isWhatsApp && !contact.isEmpty {
            // Send via WhatsApp bridge — server looks up chatId by contact name
            VACClient.shared.sendViaWhatsApp(
                text:       text,
                senderName: contact,
                chatId:     nil,
                serverURL:  serverURL
            ) { [weak self] sent in
                if sent {
                    DispatchQueue.main.async {
                        // Clear the text field — message was sent via bridge
                        let before = self?.textDocumentProxy.documentContextBeforeInput ?? ""
                        for _ in before { self?.textDocumentProxy.deleteBackward() }
                        self?.setStatus("Sent ✓")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            self?.setStatus("")
                        }
                    }
                } else {
                    // Bridge unavailable — fall back to Return key
                    DispatchQueue.main.async {
                        self?.textDocumentProxy.insertText("\n")
                    }
                }
            }
        } else {
            // Return key sends in iMessage, Telegram, Signal, Messenger, etc.
            textDocumentProxy.insertText("\n")
        }
    }

    // MARK: - Helpers

    private func hostAppName() -> String {
        guard let id = textInputContextIdentifier else { return "" }
        if id.contains("whatsapp")   { return "WhatsApp" }
        if id.contains("imessage") || id.contains("sms") { return "iMessage" }
        if id.contains("instagram")  { return "Instagram" }
        if id.contains("telegram")   { return "Telegram" }
        if id.contains("gmail")      { return "Gmail" }
        if id.contains("slack")      { return "Slack" }
        return ""
    }

    private func setStatus(_ text: String) {
        statusLabel.text     = text
        statusLabel.isHidden = text.isEmpty
    }

    @objc private func advanceToNextInputMode() {
        super.advanceToNextInputMode()
    }
}

// MARK: - VACChip (with send button)

final class VACChip: UIView {

    var onInsert: (() -> Void)?
    var onSend:   (() -> Void)?

    private let toneLabel    = UILabel()
    private let textLabel    = UILabel()
    private let sendButton   = UIButton(type: .system)
    private let separator    = UIView()

    init(suggestion: VACSuggestion) {
        super.init(frame: .zero)
        setup(with: suggestion)
    }
    required init?(coder: NSCoder) { fatalError() }

    private func setup(with s: VACSuggestion) {
        backgroundColor    = .systemBackground
        layer.cornerRadius = 14
        layer.borderWidth  = 1
        layer.borderColor  = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 0.15).cgColor
        layer.shadowColor  = UIColor.black.cgColor
        layer.shadowOpacity = 0.05
        layer.shadowOffset = CGSize(width: 0, height: 1)
        layer.shadowRadius = 4
        clipsToBounds      = false

        // Tone label
        toneLabel.text      = s.tone.uppercased()
        toneLabel.font      = .systemFont(ofSize: 8.5, weight: .bold)
        toneLabel.textColor = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 0.7)
        toneLabel.translatesAutoresizingMaskIntoConstraints = false

        // Suggestion text
        textLabel.text          = s.text
        textLabel.font          = .systemFont(ofSize: 13.5, weight: .regular)
        textLabel.textColor     = .label
        textLabel.numberOfLines = 2
        textLabel.translatesAutoresizingMaskIntoConstraints = false

        // Text content stack (tone + text)
        let textStack       = UIStackView(arrangedSubviews: [toneLabel, textLabel])
        textStack.axis      = .vertical
        textStack.spacing   = 1.5
        textStack.translatesAutoresizingMaskIntoConstraints = false

        // Separator
        separator.backgroundColor = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 0.12)
        separator.translatesAutoresizingMaskIntoConstraints = false

        // Send button (↑)
        sendButton.setTitle("↑", for: .normal)
        sendButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        sendButton.tintColor        = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 1)
        sendButton.backgroundColor  = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 0.08)
        sendButton.layer.cornerRadius = 10
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)

        addSubview(textStack)
        addSubview(separator)
        addSubview(sendButton)

        NSLayoutConstraint.activate([
            // Text content
            textStack.topAnchor.constraint(equalTo: topAnchor, constant: 7),
            textStack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            textStack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -7),

            // Separator
            separator.leadingAnchor.constraint(equalTo: textStack.trailingAnchor, constant: 8),
            separator.widthAnchor.constraint(equalToConstant: 0.5),
            separator.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            separator.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),

            // Send button
            sendButton.leadingAnchor.constraint(equalTo: separator.trailingAnchor, constant: 6),
            sendButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            sendButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 30),
            sendButton.heightAnchor.constraint(equalToConstant: 30),

            // Width constraints
            widthAnchor.constraint(greaterThanOrEqualToConstant: 110),
            widthAnchor.constraint(lessThanOrEqualToConstant: 200),
        ])

        // Tap on the text area inserts without sending
        let tap = UITapGestureRecognizer(target: self, action: #selector(insertTapped))
        textStack.isUserInteractionEnabled = true
        textStack.addGestureRecognizer(tap)

        // Also make the chip background area tappable for insert
        let bgTap = UITapGestureRecognizer(target: self, action: #selector(insertTapped))
        self.addGestureRecognizer(bgTap)
    }

    @objc private func insertTapped() {
        animatePress()
        onInsert?()
    }

    @objc private func sendTapped() {
        // Animate the send button
        UIView.animate(withDuration: 0.08, animations: {
            self.sendButton.transform = CGAffineTransform(scaleX: 0.88, y: 0.88)
            self.sendButton.backgroundColor = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 0.22)
        }) { _ in
            UIView.animate(withDuration: 0.12) {
                self.sendButton.transform       = .identity
                self.sendButton.backgroundColor = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 0.08)
            }
        }
        onSend?()
    }

    private func animatePress() {
        UIView.animate(withDuration: 0.08) {
            self.transform       = CGAffineTransform(scaleX: 0.96, y: 0.96)
            self.backgroundColor = UIColor(red: 0.93, green: 0.96, blue: 1.0, alpha: 1)
        } completion: { _ in
            UIView.animate(withDuration: 0.12) {
                self.transform       = .identity
                self.backgroundColor = .systemBackground
            }
        }
    }
}

// MARK: - VACLoadingView (three pulsing dots)

final class VACLoadingView: UIView {

    private var dots:  [UIView] = []
    private var timer: Timer?

    override var intrinsicContentSize: CGSize { CGSize(width: 40, height: 20) }

    override init(frame: CGRect) {
        super.init(frame: frame)
        for i in 0..<3 {
            let d = UIView()
            d.backgroundColor    = UIColor(red: 0.0, green: 0.44, blue: 0.87, alpha: 0.6)
            d.layer.cornerRadius = 3
            d.frame = CGRect(x: i * 12, y: 4, width: 7, height: 7)
            addSubview(d)
            dots.append(d)
        }
        isHidden = true
    }
    required init?(coder: NSCoder) { super.init(coder: coder) }

    func startAnimating() {
        isHidden = false
        var i = 0
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.22, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            UIView.animate(withDuration: 0.18) {
                self.dots.enumerated().forEach { idx, d in d.alpha = idx == i % 3 ? 1.0 : 0.2 }
            }
            i += 1
        }
    }

    func stopAnimating() {
        timer?.invalidate(); timer = nil
        isHidden = true
        dots.forEach { $0.alpha = 1 }
    }
}
