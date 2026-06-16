// KeyboardViewController.swift
// VAC AI Keyboard — full QWERTY + contextual AI + tone guard + goal modes
//
// Layout (top → bottom):
//  ┌─ ChipBar  (52pt) ── AI reply chips, scrollable ──────────────────────┐
//  ├─ ModeBar  (34pt) ── Goal mode pills ─────────────────────────────────┤
//  ├─ ToneWarn (float) ─ Anger/risk overlay (hidden by default) ──────────┤
//  └─ QWERTY   (220pt) ─ Full typing keyboard ─────────────────────────────┘

import UIKit

// VACGoalMode is defined in Models.swift (shared with both targets)

// MARK: - KeyboardViewController

final class KeyboardViewController: UIInputViewController {

    // ── Layout constants ───────────────────────────────────────────────
    private let kChipBarH:    CGFloat = 88
    private let kModeBarH:    CGFloat = 34
    private let kKeyboardH:   CGFloat = 220
    private var totalH: CGFloat { kChipBarH + kModeBarH + kKeyboardH }

    // ── State ──────────────────────────────────────────────────────────
    private var suggestions:         [VACSuggestion] = []
    private var isServerFetching     = false   // server request in flight
    private var currentMode:         VACGoalMode  = .auto
    private var shiftState:          ShiftState   = .lower
    private var isNumberMode         = false
    private var lastContext          = ""
    private var serverFetchTimer:    Timer?
    private var backspaceTimer:      Timer?

    // ── Rich context state ─────────────────────────────────────────────
    private var toneOfIncoming:  String  = ""
    private var bestReplyWindow: String  = ""
    private var rashReason:      String? = nil
    private var sendingContext:  String  = ""
    private var contextInfoBar   = UIView()
    private var toneChip         = UILabel()
    private var timingChip       = UILabel()
    private var contextLabel     = UILabel()

    // ── Expand overlay (long message preview) ─────────────────────────
    private var expandOverlay:   VACExpandOverlay?

    enum ShiftState { case lower, upper, locked }

    // ── Views ──────────────────────────────────────────────────────────
    private let chipScrollView  = UIScrollView()
    private let chipStack       = UIStackView()
    private let loadingDots     = VACLoadingView()
    private let modeScrollView  = UIScrollView()
    private let modeStack       = UIStackView()
    private let toneView        = UIView()
    private let toneLabel       = UILabel()
    private let keyboardContainer = UIView()
    private var keyButtons:     [String: UIButton] = [:]
    private var heightConstraint: NSLayoutConstraint?

    // ── Colors ─────────────────────────────────────────────────────────
    private let clrBg         = UIColor(red: 0.17, green: 0.17, blue: 0.19, alpha: 1)
    private let clrChipBg     = UIColor(red: 0.11, green: 0.11, blue: 0.13, alpha: 1)
    private let clrModeBg     = UIColor(red: 0.14, green: 0.14, blue: 0.16, alpha: 1)
    private let clrKeyNormal  = UIColor(red: 0.50, green: 0.50, blue: 0.54, alpha: 1)
    private let clrKeySpecial = UIColor(red: 0.30, green: 0.30, blue: 0.33, alpha: 1)
    private let clrAccent     = UIColor(red: 0.20, green: 0.60, blue: 1.00, alpha: 1)
    private let clrInfoBg     = UIColor(red: 0.20, green: 0.20, blue: 0.24, alpha: 1)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupLayout()
        refreshAll()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let ctx = textDocumentProxy.documentContextBeforeInput ?? ""
        if ctx != lastContext { lastContext = ctx; refreshAll() }
    }

    override func textDidChange(_ textInput: UITextInput?) {
        let ctx = textDocumentProxy.documentContextBeforeInput ?? ""
        guard ctx != lastContext else { return }
        lastContext = ctx
        // Tier 1: instant local suggestions & tone (0ms, no network)
        applyLocalSuggestions()
        // Tier 2: server enrichment with WA bridge context (debounced)
        scheduleServerFetch()
    }

    // Called on first load and any significant context shift
    private func refreshAll() {
        applyLocalSuggestions()
        scheduleServerFetch()
    }

    // MARK: - Layout

    private func setupLayout() {
        view.backgroundColor = clrBg

        // Height
        let hc = view.heightAnchor.constraint(equalToConstant: totalH)
        hc.priority = UILayoutPriority(999)
        hc.isActive = true
        heightConstraint = hc

        setupChipBar()
        setupModeBar()
        setupToneWarning()
        setupKeyboard()
    }

    // MARK: Chip Bar

    private func setupChipBar() {
        let bg = UIView()
        bg.backgroundColor = clrChipBg
        bg.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bg)
        NSLayoutConstraint.activate([
            bg.topAnchor.constraint(equalTo: view.topAnchor),
            bg.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bg.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bg.heightAnchor.constraint(equalToConstant: kChipBarH),
        ])

        // VAC label
        let label = UILabel()
        label.text = "VAC ✦"
        label.font = .systemFont(ofSize: 10, weight: .black)
        label.textColor = clrAccent.withAlphaComponent(0.8)
        label.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(label)

        // Next keyboard button
        let globeBtn = UIButton(type: .system)
        globeBtn.setTitle("🌐", for: .normal)
        globeBtn.titleLabel?.font = .systemFont(ofSize: 17)
        globeBtn.addTarget(self, action: #selector(globeTapped), for: .touchUpInside)
        globeBtn.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(globeBtn)

        // Loading dots
        loadingDots.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(loadingDots)

        // Chip scroll
        chipScrollView.showsHorizontalScrollIndicator = false
        chipScrollView.alwaysBounceHorizontal = true
        chipScrollView.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(chipScrollView)

        chipStack.axis = .horizontal
        chipStack.spacing = 7
        chipStack.alignment = .center
        chipStack.translatesAutoresizingMaskIntoConstraints = false
        chipScrollView.addSubview(chipStack)

        // Info row (Row 2 — bottom of chip bar): tone chip, timing chip, context label
        contextInfoBar.backgroundColor = clrInfoBg
        contextInfoBar.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(contextInfoBar)

        func makeInfoChip(_ lbl: UILabel) {
            lbl.font = .systemFont(ofSize: 10, weight: .medium)
            lbl.textColor = UIColor.white.withAlphaComponent(0.85)
            lbl.backgroundColor = UIColor.white.withAlphaComponent(0.10)
            lbl.layer.cornerRadius = 8
            lbl.clipsToBounds = true
            lbl.textAlignment = .center
            lbl.isHidden = true
            lbl.translatesAutoresizingMaskIntoConstraints = false
        }

        makeInfoChip(toneChip)
        makeInfoChip(timingChip)
        contextInfoBar.addSubview(toneChip)
        contextInfoBar.addSubview(timingChip)

        contextLabel.font = .systemFont(ofSize: 10)
        contextLabel.textColor = UIColor.white.withAlphaComponent(0.45)
        contextLabel.translatesAutoresizingMaskIntoConstraints = false
        contextInfoBar.addSubview(contextLabel)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: bg.leadingAnchor, constant: 10),
            label.topAnchor.constraint(equalTo: bg.topAnchor, constant: 8),

            globeBtn.trailingAnchor.constraint(equalTo: bg.trailingAnchor, constant: -4),
            globeBtn.topAnchor.constraint(equalTo: bg.topAnchor, constant: 4),
            globeBtn.widthAnchor.constraint(equalToConstant: 36),

            loadingDots.trailingAnchor.constraint(equalTo: globeBtn.leadingAnchor, constant: -4),
            loadingDots.centerYAnchor.constraint(equalTo: globeBtn.centerYAnchor),

            chipScrollView.leadingAnchor.constraint(equalTo: bg.leadingAnchor, constant: 8),
            chipScrollView.trailingAnchor.constraint(equalTo: globeBtn.leadingAnchor, constant: -2),
            chipScrollView.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 4),
            chipScrollView.bottomAnchor.constraint(equalTo: contextInfoBar.topAnchor, constant: -2),

            chipStack.topAnchor.constraint(equalTo: chipScrollView.contentLayoutGuide.topAnchor),
            chipStack.bottomAnchor.constraint(equalTo: chipScrollView.contentLayoutGuide.bottomAnchor),
            chipStack.leadingAnchor.constraint(equalTo: chipScrollView.contentLayoutGuide.leadingAnchor),
            chipStack.trailingAnchor.constraint(equalTo: chipScrollView.contentLayoutGuide.trailingAnchor),
            chipStack.heightAnchor.constraint(equalTo: chipScrollView.frameLayoutGuide.heightAnchor),

            contextInfoBar.leadingAnchor.constraint(equalTo: bg.leadingAnchor),
            contextInfoBar.trailingAnchor.constraint(equalTo: bg.trailingAnchor),
            contextInfoBar.bottomAnchor.constraint(equalTo: bg.bottomAnchor),
            contextInfoBar.heightAnchor.constraint(equalToConstant: 24),

            toneChip.leadingAnchor.constraint(equalTo: contextInfoBar.leadingAnchor, constant: 8),
            toneChip.centerYAnchor.constraint(equalTo: contextInfoBar.centerYAnchor),
            toneChip.heightAnchor.constraint(equalToConstant: 18),

            timingChip.leadingAnchor.constraint(equalTo: toneChip.trailingAnchor, constant: 6),
            timingChip.centerYAnchor.constraint(equalTo: contextInfoBar.centerYAnchor),
            timingChip.heightAnchor.constraint(equalToConstant: 18),

            contextLabel.leadingAnchor.constraint(equalTo: timingChip.trailingAnchor, constant: 8),
            contextLabel.centerYAnchor.constraint(equalTo: contextInfoBar.centerYAnchor),
            contextLabel.trailingAnchor.constraint(lessThanOrEqualTo: contextInfoBar.trailingAnchor, constant: -8),
        ])

        showPlaceholderChip()
    }

    // MARK: Mode Bar

    private func setupModeBar() {
        let bg = UIView()
        bg.backgroundColor = clrModeBg
        bg.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bg)
        NSLayoutConstraint.activate([
            bg.topAnchor.constraint(equalTo: view.topAnchor, constant: kChipBarH),
            bg.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bg.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bg.heightAnchor.constraint(equalToConstant: kModeBarH),
        ])

        modeScrollView.showsHorizontalScrollIndicator = false
        modeScrollView.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(modeScrollView)

        modeStack.axis = .horizontal
        modeStack.spacing = 6
        modeStack.alignment = .center
        modeStack.translatesAutoresizingMaskIntoConstraints = false
        modeScrollView.addSubview(modeStack)

        NSLayoutConstraint.activate([
            modeScrollView.topAnchor.constraint(equalTo: bg.topAnchor, constant: 4),
            modeScrollView.bottomAnchor.constraint(equalTo: bg.bottomAnchor, constant: -4),
            modeScrollView.leadingAnchor.constraint(equalTo: bg.leadingAnchor, constant: 8),
            modeScrollView.trailingAnchor.constraint(equalTo: bg.trailingAnchor, constant: -8),

            modeStack.topAnchor.constraint(equalTo: modeScrollView.contentLayoutGuide.topAnchor),
            modeStack.bottomAnchor.constraint(equalTo: modeScrollView.contentLayoutGuide.bottomAnchor),
            modeStack.leadingAnchor.constraint(equalTo: modeScrollView.contentLayoutGuide.leadingAnchor),
            modeStack.trailingAnchor.constraint(equalTo: modeScrollView.contentLayoutGuide.trailingAnchor),
            modeStack.heightAnchor.constraint(equalTo: modeScrollView.frameLayoutGuide.heightAnchor),
        ])

        rebuildModeButtons()
    }

    private func rebuildModeButtons() {
        modeStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for mode in VACGoalMode.allCases {
            let btn = makeModeButton(mode)
            modeStack.addArrangedSubview(btn)
        }
    }

    private func makeModeButton(_ mode: VACGoalMode) -> UIButton {
        let isActive = mode == currentMode
        let btn = UIButton(type: .system)
        btn.setTitle("\(mode.emoji) \(mode.rawValue)", for: .normal)
        btn.titleLabel?.font = .systemFont(ofSize: 11, weight: isActive ? .bold : .regular)
        btn.setTitleColor(isActive ? .black : UIColor.white.withAlphaComponent(0.7), for: .normal)
        btn.backgroundColor = isActive ? .white : UIColor.white.withAlphaComponent(0.12)
        btn.layer.cornerRadius = 10
        btn.contentEdgeInsets = UIEdgeInsets(top: 3, left: 9, bottom: 3, right: 9)
        btn.accessibilityLabel = mode.rawValue
        btn.addTarget(self, action: #selector(modeTapped(_:)), for: .touchUpInside)
        return btn
    }

    // MARK: Tone Warning

    private func setupToneWarning() {
        toneView.backgroundColor = UIColor(red: 0.85, green: 0.25, blue: 0.15, alpha: 0.96)
        toneView.layer.cornerRadius = 8
        toneView.isHidden = true
        toneView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toneView)

        toneLabel.font = .systemFont(ofSize: 11.5, weight: .medium)
        toneLabel.textColor = .white
        toneLabel.numberOfLines = 2
        toneLabel.translatesAutoresizingMaskIntoConstraints = false
        toneView.addSubview(toneLabel)

        let dismissBtn = UIButton(type: .system)
        dismissBtn.setTitle("✕", for: .normal)
        dismissBtn.setTitleColor(UIColor.white.withAlphaComponent(0.8), for: .normal)
        dismissBtn.titleLabel?.font = .systemFont(ofSize: 13)
        dismissBtn.addTarget(self, action: #selector(dismissTone), for: .touchUpInside)
        dismissBtn.translatesAutoresizingMaskIntoConstraints = false
        toneView.addSubview(dismissBtn)

        NSLayoutConstraint.activate([
            toneView.topAnchor.constraint(equalTo: view.topAnchor, constant: kChipBarH + kModeBarH + 6),
            toneView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            toneView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),

            toneLabel.leadingAnchor.constraint(equalTo: toneView.leadingAnchor, constant: 10),
            toneLabel.trailingAnchor.constraint(equalTo: dismissBtn.leadingAnchor, constant: -6),
            toneLabel.topAnchor.constraint(equalTo: toneView.topAnchor, constant: 7),
            toneLabel.bottomAnchor.constraint(equalTo: toneView.bottomAnchor, constant: -7),

            dismissBtn.trailingAnchor.constraint(equalTo: toneView.trailingAnchor, constant: -8),
            dismissBtn.centerYAnchor.constraint(equalTo: toneView.centerYAnchor),
            dismissBtn.widthAnchor.constraint(equalToConstant: 24),
        ])
    }

    // MARK: QWERTY Keyboard

    private func setupKeyboard() {
        keyboardContainer.backgroundColor = clrBg
        keyboardContainer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(keyboardContainer)
        NSLayoutConstraint.activate([
            keyboardContainer.topAnchor.constraint(equalTo: view.topAnchor, constant: kChipBarH + kModeBarH),
            keyboardContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            keyboardContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            keyboardContainer.heightAnchor.constraint(equalToConstant: kKeyboardH),
        ])
        buildKeys()
    }

    private let alphaRows: [[String]] = [
        ["q","w","e","r","t","y","u","i","o","p"],
        ["a","s","d","f","g","h","j","k","l"],
        ["⇧","z","x","c","v","b","n","m","⌫"],
        ["123","🌐","space","return"],
    ]

    private let numRows: [[String]] = [
        ["1","2","3","4","5","6","7","8","9","0"],
        ["-","/",":",";","(",")","$","&","@","\""],
        ["#+=",".",",","?","!","'","⌫"],
        ["ABC","🌐","space","return"],
    ]

    private func buildKeys() {
        keyboardContainer.subviews.forEach { $0.removeFromSuperview() }
        keyButtons.removeAll()

        let rows = isNumberMode ? numRows : alphaRows
        let rowCount = CGFloat(rows.count)
        let rowH = (kKeyboardH - 8) / rowCount

        for (ri, row) in rows.enumerated() {
            let rowY = 4 + CGFloat(ri) * rowH
            buildRow(keys: row, y: rowY, height: rowH - 5)
        }
    }

    private func buildRow(keys: [String], y: CGFloat, height: CGFloat) {
        let pad: CGFloat = 4
        let gap: CGFloat = 5
        let totalW = view.bounds.width > 0 ? view.bounds.width : UIScreen.main.bounds.width
        let usable = totalW - pad * 2

        // Compute widths
        var widths: [CGFloat] = []
        var flexCount = 0
        var fixedSum: CGFloat = 0

        for key in keys {
            let w = fixedKeyWidth(key, totalW: usable)
            if w < 0 {
                flexCount += 1
                widths.append(-1)
            } else {
                fixedSum += w + gap
                widths.append(w)
            }
        }

        let flexW = flexCount > 0
            ? (usable - fixedSum - CGFloat(flexCount - 1) * gap) / CGFloat(flexCount)
            : 0

        var x = pad
        for (i, key) in keys.enumerated() {
            let w = widths[i] < 0 ? flexW : widths[i]
            let btn = makeKeyButton(key)
            btn.frame = CGRect(x: x, y: y, width: w, height: height)
            keyboardContainer.addSubview(btn)
            keyButtons[key] = btn
            x += w + gap
        }
    }

    /// Returns fixed width or -1 for flexible (equal split of remaining space)
    private func fixedKeyWidth(_ key: String, totalW: CGFloat) -> CGFloat {
        switch key {
        case "space":         return -1        // flexible
        case "⇧", "⌫":       return totalW * 0.13
        case "123", "ABC":    return totalW * 0.13
        case "#+=":           return totalW * 0.13
        case "🌐":            return totalW * 0.10
        case "return":        return totalW * 0.20
        default:              return -1
        }
    }

    private func makeKeyButton(_ key: String) -> UIButton {
        let btn = UIButton(type: .system)
        btn.layer.cornerRadius = 5
        btn.clipsToBounds = true

        let isSpecial = ["⇧","⌫","123","ABC","#+=","🌐","space","return"].contains(key)
        btn.backgroundColor = isSpecial ? clrKeySpecial : clrKeyNormal

        switch key {
        case "space":
            btn.setTitle("space", for: .normal)
            btn.titleLabel?.font = .systemFont(ofSize: 15)
            btn.setTitleColor(.white, for: .normal)
        case "return":
            btn.setTitle("return", for: .normal)
            btn.titleLabel?.font = .systemFont(ofSize: 14)
            btn.setTitleColor(.white, for: .normal)
        case "⌫":
            btn.setImage(UIImage(systemName: "delete.left"), for: .normal)
            btn.tintColor = .white
        case "⇧":
            btn.setImage(UIImage(systemName: "shift"), for: .normal)
            btn.tintColor = .white
        default:
            let display = shiftState == .lower ? key.lowercased() : key.uppercased()
            btn.setTitle(display, for: .normal)
            btn.titleLabel?.font = .systemFont(ofSize: 17)
            btn.setTitleColor(.white, for: .normal)
        }

        btn.addTarget(self, action: #selector(keyDown(_:)), for: .touchDown)
        btn.addTarget(self, action: #selector(keyUp(_:)), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        btn.addTarget(self, action: #selector(keyTapped(_:)), for: .touchUpInside)

        if key == "⌫" {
            let lp = UILongPressGestureRecognizer(target: self, action: #selector(backspaceLong(_:)))
            lp.minimumPressDuration = 0.35
            btn.addGestureRecognizer(lp)
        }
        return btn
    }

    // MARK: - Key Actions

    @objc private func keyTapped(_ sender: UIButton) {
        let key: String
        if let title = sender.title(for: .normal), !title.isEmpty {
            key = title
        } else if sender.image(for: .normal) != nil {
            // identify icon buttons by tag or stored reference
            if sender === keyButtons["⌫"] { key = "⌫" }
            else if sender === keyButtons["⇧"] { key = "⇧" }
            else { return }
        } else { return }

        handleKey(key)
    }

    @objc private func keyDown(_ sender: UIButton) {
        UIView.animate(withDuration: 0.05) { sender.alpha = 0.55 }
    }

    @objc private func keyUp(_ sender: UIButton) {
        UIView.animate(withDuration: 0.1) { sender.alpha = 1 }
    }

    private func handleKey(_ raw: String) {
        let key = raw.trimmingCharacters(in: .whitespaces)
        switch key {
        case "⌫", "delete":
            textDocumentProxy.deleteBackward()
        case "space":
            textDocumentProxy.insertText(" ")
        case "return":
            textDocumentProxy.insertText("\n")
        case "🌐":
            advanceToNextInputMode()
        case "⇧", "shift":
            cycleShift()
        case "123":
            isNumberMode = true
            buildKeys()
        case "ABC":
            isNumberMode = false
            buildKeys()
        case "#+=":
            break // TODO: symbol layer
        default:
            let char = shiftState == .lower ? key.lowercased() : key.uppercased()
            textDocumentProxy.insertText(char)
            if shiftState == .upper { shiftState = .lower; updateShiftAppearance() }
        }
    }

    @objc private func backspaceLong(_ gr: UILongPressGestureRecognizer) {
        switch gr.state {
        case .began:
            backspaceTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                self?.textDocumentProxy.deleteBackward()
            }
        case .ended, .cancelled:
            backspaceTimer?.invalidate()
            backspaceTimer = nil
        default: break
        }
    }

    private func cycleShift() {
        switch shiftState {
        case .lower:  shiftState = .upper
        case .upper:  shiftState = .locked
        case .locked: shiftState = .lower
        }
        updateShiftAppearance()
    }

    private func updateShiftAppearance() {
        // Update shift key icon
        if let shiftBtn = keyButtons["⇧"] {
            switch shiftState {
            case .lower:
                shiftBtn.backgroundColor = clrKeySpecial
                shiftBtn.setImage(UIImage(systemName: "shift"), for: .normal)
                shiftBtn.tintColor = .white
            case .upper:
                shiftBtn.backgroundColor = UIColor.white.withAlphaComponent(0.5)
                shiftBtn.setImage(UIImage(systemName: "shift.fill"), for: .normal)
                shiftBtn.tintColor = .black
            case .locked:
                shiftBtn.backgroundColor = .white
                shiftBtn.setImage(UIImage(systemName: "capslock.fill"), for: .normal)
                shiftBtn.tintColor = .black
            }
        }
        // Update letter casing
        for (key, btn) in keyButtons where key.count == 1 && key.first?.isLetter == true {
            let display = shiftState == .lower ? key.lowercased() : key.uppercased()
            btn.setTitle(display, for: .normal)
        }
    }

    @objc private func globeTapped() { advanceToNextInputMode() }

    // MARK: - Mode

    @objc private func modeTapped(_ sender: UIButton) {
        guard let label = sender.accessibilityLabel,
              let mode = VACGoalMode(rawValue: label) else { return }
        currentMode = mode
        rebuildModeButtons()
        applyLocalSuggestions()     // instant update for mode change
        scheduleServerFetch()       // also enrich from server
    }

    // MARK: - Suggestions (two-tier)

    // ── Tier 1: Instant local (0ms, always works offline) ─────────────────

    private func applyLocalSuggestions() {
        let (draft, ctx) = extractDraftAndContext()

        // Generate suggestions instantly
        let items = LocalSuggestionEngine.suggest(
            draft: draft, contextBefore: ctx, goalMode: currentMode)
        suggestions = items
        renderChips(items)

        // Tone + timing + rash — all local, instant
        let incomingText = ctx.isEmpty ? "" : String(ctx.suffix(300))
        let tone    = LocalSuggestionEngine.analyzeTone(incomingText)
        let rash    = LocalSuggestionEngine.detectRash(draft)
        let timing  = LocalSuggestionEngine.replyTiming(toneScore: tone.score)

        toneOfIncoming  = tone.displayString
        bestReplyWindow = timing.displayString
        rashReason      = rash.isRash ? rash.reason : nil
        sendingContext  = ""
        updateInfoBar()

        if let reason = rashReason { showToneWarning(reason: reason) } else { hideTone() }
    }

    // ── Tier 2: Server enrichment (debounced, uses WA bridge history) ──────

    private func scheduleServerFetch() {
        serverFetchTimer?.invalidate()
        serverFetchTimer = Timer.scheduledTimer(withTimeInterval: 0.85, repeats: false) { [weak self] _ in
            self?.fetchFromServer()
        }
    }

    private func fetchFromServer() {
        guard !isServerFetching else { return }
        let (draft, ctx) = extractDraftAndContext()
        let after = textDocumentProxy.documentContextAfterInput ?? ""
        let app   = hostAppName()
        let name  = VACConfig.shared.contactName
        let mode  = currentMode

        isServerFetching = true
        loadingDots.startAnimating()

        VACClient.shared.suggest(
            draft:         draft,
            contextBefore: ctx,
            contextAfter:  after,
            appContext:    app,
            senderName:    name.isEmpty ? nil : name,
            goalMode:      mode,
            serverURL:     VACConfig.shared.serverURL
        ) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.isServerFetching = false
                self.loadingDots.stopAnimating()

                // Only update if server returns something meaningful
                if case .success(let items) = result, !items.isEmpty {
                    // Check if suggestions differ enough to update
                    if items.first?.text != self.suggestions.first?.text {
                        self.suggestions = items
                        self.renderChips(items)
                    }
                    // Always update rich context from server (has WA bridge data)
                    let tone = VACClient.shared.lastTone
                    let time = VACClient.shared.lastBestTime
                    let rash = VACClient.shared.lastRashReason
                    let ctx2 = VACClient.shared.lastSendingContext
                    if !tone.isEmpty { self.toneOfIncoming  = tone }
                    if !time.isEmpty { self.bestReplyWindow = time }
                    self.rashReason     = rash
                    self.sendingContext = ctx2
                    self.updateInfoBar()
                    if let reason = rash { self.showToneWarning(reason: reason) }
                }
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /// Split documentContextBeforeInput into (draft, conversationContext).
    /// In chat apps, lines before the last \n are the "context" (their messages shown above).
    private func extractDraftAndContext() -> (draft: String, context: String) {
        let full  = textDocumentProxy.documentContextBeforeInput ?? ""
        let lines = full.components(separatedBy: "\n")
        let draft = lines.last ?? ""
        let ctx   = lines.count > 1 ? lines.dropLast().joined(separator: "\n") : ""
        return (draft, ctx)
    }

    private func clearChips() {
        chipStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    }

    private func showPlaceholderChip() {
        clearChips()
        let lbl = UILabel()
        lbl.text = "✦ Suggestions loading…"
        lbl.font = .systemFont(ofSize: 12)
        lbl.textColor = UIColor.white.withAlphaComponent(0.3)
        chipStack.addArrangedSubview(lbl)
    }

    private func renderChips(_ items: [VACSuggestion]) {
        clearChips()
        dismissExpandOverlay()
        if items.isEmpty { showPlaceholderChip(); return }
        for item in items {
            let chip = VACChip(suggestion: item)
            chip.onInsert  = { [weak self] in self?.insertSuggestion(item, andSend: false) }
            chip.onSend    = { [weak self] in self?.insertSuggestion(item, andSend: true) }
            chip.onExpand  = { [weak self] s in self?.showExpandOverlay(for: s) }
            chipStack.addArrangedSubview(chip)
        }
        chipScrollView.setContentOffset(.zero, animated: false)
    }

    // MARK: - Expand Overlay

    private func showExpandOverlay(for suggestion: VACSuggestion) {
        dismissExpandOverlay()
        let overlay = VACExpandOverlay(suggestion: suggestion)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.onDismiss = { [weak self] in self?.dismissExpandOverlay() }
        overlay.onInsert  = { [weak self] in
            self?.dismissExpandOverlay()
            self?.insertSuggestion(suggestion, andSend: false)
        }
        overlay.onSend    = { [weak self] in
            self?.dismissExpandOverlay()
            self?.insertSuggestion(suggestion, andSend: true)
        }
        view.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        overlay.alpha = 0
        UIView.animate(withDuration: 0.2) { overlay.alpha = 1 }
        expandOverlay = overlay
    }

    private func dismissExpandOverlay() {
        guard let ov = expandOverlay else { return }
        expandOverlay = nil
        UIView.animate(withDuration: 0.15) { ov.alpha = 0 } completion: { _ in ov.removeFromSuperview() }
    }

    // MARK: - Info Bar

    private func updateInfoBar() {
        DispatchQueue.main.async {
            if !self.toneOfIncoming.isEmpty {
                self.toneChip.text    = "  \(self.toneOfIncoming)  "
                self.toneChip.isHidden = false
            }
            if !self.bestReplyWindow.isEmpty {
                self.timingChip.text    = "  \(self.bestReplyWindow)  "
                self.timingChip.isHidden = false
            }
            if !self.sendingContext.isEmpty {
                self.contextLabel.text = self.sendingContext
            }
        }
    }

    // MARK: - Insert & Send

    private func insertSuggestion(_ suggestion: VACSuggestion, andSend: Bool) {
        UIImpactFeedbackGenerator(style: andSend ? .medium : .light).impactOccurred()

        let full  = textDocumentProxy.documentContextBeforeInput ?? ""
        let draft = full.components(separatedBy: "\n").last ?? ""
        for _ in draft { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(suggestion.text)

        if andSend { doSend(text: suggestion.text) }

        VACConfig.shared.recordUsage(tone: suggestion.tone)
        let key = VACConfig.shared.contactName.isEmpty ? "ios-global" : VACConfig.shared.contactName
        VACClient.shared.learn(profileKey: key, tone: suggestion.tone, text: suggestion.text,
                               platform: "ios", serverURL: VACConfig.shared.serverURL)
        // After inserting, refresh suggestions for the new context
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.applyLocalSuggestions()
        }
    }

    private func doSend(text: String) {
        let id = textInputContextIdentifier ?? ""
        let isWA = id.contains("WhatsApp") || id.contains("net.whatsapp")
        let contact = VACConfig.shared.contactName

        if isWA && !contact.isEmpty {
            VACClient.shared.sendViaWhatsApp(text: text, senderName: contact, chatId: nil,
                                             serverURL: VACConfig.shared.serverURL) { [weak self] ok in
                DispatchQueue.main.async {
                    if ok {
                        let before = self?.textDocumentProxy.documentContextBeforeInput ?? ""
                        for _ in before { self?.textDocumentProxy.deleteBackward() }
                    } else {
                        self?.textDocumentProxy.insertText("\n")
                    }
                }
            }
        } else {
            textDocumentProxy.insertText("\n")
        }
    }

    // Note: tone analysis is now handled by LocalSuggestionEngine in applyLocalSuggestions()

    private func showToneWarning(reason: String) {
        toneLabel.text = "⚠️ \(reason) — tap chip to send a better version"
        guard toneView.isHidden else { return }
        toneView.isHidden = false
        toneView.alpha = 0
        UIView.animate(withDuration: 0.2) { self.toneView.alpha = 1 }
    }

    private func showTone(_ message: String) {
        showToneWarning(reason: message)
    }

    private func hideTone() {
        guard !toneView.isHidden else { return }
        UIView.animate(withDuration: 0.15) { self.toneView.alpha = 0 } completion: { _ in
            self.toneView.isHidden = true
        }
    }

    @objc private func dismissTone() { hideTone() }

    // MARK: - Helpers

    private func hostAppName() -> String {
        let id = (textInputContextIdentifier ?? "").lowercased()
        if id.contains("whatsapp")                    { return "WhatsApp" }
        if id.contains("imessage") || id.contains("sms") { return "iMessage" }
        if id.contains("instagram")                   { return "Instagram" }
        if id.contains("telegram")                    { return "Telegram" }
        if id.contains("gmail")                       { return "Gmail" }
        if id.contains("slack")                       { return "Slack" }
        if id.contains("twitter") || id.contains("x.com") { return "X" }
        if id.contains("linkedin")                    { return "LinkedIn" }
        return ""
    }

    @objc override func advanceToNextInputMode() { super.advanceToNextInputMode() }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        // Rebuild key frames when screen width is known
        buildKeys()
    }
}

// MARK: - VACChip
// Shows truncated message (≤40 chars) in chip. Long messages show "…" indicator.
// Tap → insert (short) or expand overlay (long). Hold ↑ button to send.

final class VACChip: UIView {
    var onInsert:  (() -> Void)?
    var onSend:    (() -> Void)?
    var onExpand:  ((VACSuggestion) -> Void)?   // called when message is long

    private let toneLabel  = UILabel()
    private let textLabel  = UILabel()
    private let moreLabel  = UILabel()
    private let sendButton = UIButton(type: .system)
    private let fullText:  String
    private static let truncLimit = 38

    init(suggestion: VACSuggestion) {
        self.fullText = suggestion.text
        super.init(frame: .zero)

        backgroundColor    = UIColor(red: 0.22, green: 0.22, blue: 0.28, alpha: 1)
        layer.cornerRadius = 13
        layer.borderWidth  = 1
        layer.borderColor  = UIColor.white.withAlphaComponent(0.12).cgColor
        clipsToBounds      = true

        let isLong = suggestion.text.count > VACChip.truncLimit
        let displayText = isLong
            ? String(suggestion.text.prefix(VACChip.truncLimit)) + "…"
            : suggestion.text

        toneLabel.text      = suggestion.tone.uppercased()
        toneLabel.font      = .systemFont(ofSize: 8, weight: .bold)
        toneLabel.textColor = UIColor(red: 0.4, green: 0.7, blue: 1.0, alpha: 0.85)
        toneLabel.translatesAutoresizingMaskIntoConstraints = false

        textLabel.text          = displayText
        textLabel.font          = .systemFont(ofSize: 13, weight: .regular)
        textLabel.textColor     = .white
        textLabel.numberOfLines = 1
        textLabel.translatesAutoresizingMaskIntoConstraints = false

        // "↗ expand" badge for long messages
        moreLabel.text      = "↗"
        moreLabel.font      = .systemFont(ofSize: 9, weight: .semibold)
        moreLabel.textColor = UIColor(red: 0.4, green: 0.7, blue: 1.0, alpha: 0.7)
        moreLabel.isHidden  = !isLong
        moreLabel.translatesAutoresizingMaskIntoConstraints = false

        let textStack       = UIStackView(arrangedSubviews: [toneLabel, textLabel])
        textStack.axis      = .vertical
        textStack.spacing   = 1
        textStack.translatesAutoresizingMaskIntoConstraints = false

        let sep = UIView()
        sep.backgroundColor = UIColor.white.withAlphaComponent(0.12)
        sep.translatesAutoresizingMaskIntoConstraints = false

        sendButton.setTitle("↑", for: .normal)
        sendButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        sendButton.tintColor        = UIColor(red: 0.3, green: 0.85, blue: 0.55, alpha: 1)
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        sendButton.addTarget(self, action: #selector(sendTap), for: .touchUpInside)

        addSubview(textStack)
        addSubview(moreLabel)
        addSubview(sep)
        addSubview(sendButton)

        NSLayoutConstraint.activate([
            textStack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 9),
            textStack.topAnchor.constraint(equalTo: topAnchor, constant: 5),
            textStack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -5),

            moreLabel.leadingAnchor.constraint(equalTo: textStack.trailingAnchor, constant: 3),
            moreLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            sep.leadingAnchor.constraint(equalTo: moreLabel.trailingAnchor, constant: 4),
            sep.widthAnchor.constraint(equalToConstant: 0.5),
            sep.topAnchor.constraint(equalTo: topAnchor, constant: 7),
            sep.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -7),

            sendButton.leadingAnchor.constraint(equalTo: sep.trailingAnchor, constant: 4),
            sendButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            sendButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 24),

            widthAnchor.constraint(greaterThanOrEqualToConstant: 100),
            widthAnchor.constraint(lessThanOrEqualToConstant: 220),
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(insertTap))
        addGestureRecognizer(tap)
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func insertTap() {
        UIView.animate(withDuration: 0.08) { self.alpha = 0.6 } completion: { _ in
            UIView.animate(withDuration: 0.1) { self.alpha = 1 }
        }
        // Long message → show expand overlay instead of inserting truncated text
        if fullText.count > VACChip.truncLimit {
            onExpand?(VACSuggestion(tone: toneLabel.text ?? "", text: fullText, why: ""))
        } else {
            onInsert?()
        }
    }

    @objc private func sendTap() {
        UIView.animate(withDuration: 0.08) {
            self.sendButton.transform = CGAffineTransform(scaleX: 0.85, y: 0.85)
        } completion: { _ in
            UIView.animate(withDuration: 0.1) { self.sendButton.transform = .identity }
        }
        onSend?()
    }
}

// MARK: - VACExpandOverlay
// Full-message card that slides up above the keyboard when a long chip is tapped.

final class VACExpandOverlay: UIView {
    var onInsert: (() -> Void)?
    var onSend:   (() -> Void)?
    var onDismiss:(() -> Void)?

    private let suggestion: VACSuggestion

    init(suggestion: VACSuggestion) {
        self.suggestion = suggestion
        super.init(frame: .zero)
        setup()
    }
    required init?(coder: NSCoder) { fatalError() }

    private func setup() {
        backgroundColor = UIColor.black.withAlphaComponent(0.55)

        let card = UIView()
        card.backgroundColor    = UIColor(red: 0.14, green: 0.14, blue: 0.18, alpha: 0.98)
        card.layer.cornerRadius = 16
        card.layer.shadowColor  = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.4
        card.layer.shadowRadius  = 12
        card.translatesAutoresizingMaskIntoConstraints = false
        addSubview(card)

        // Close button
        let closeBtn = UIButton(type: .system)
        closeBtn.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeBtn.tintColor = UIColor.white.withAlphaComponent(0.5)
        closeBtn.addTarget(self, action: #selector(dismiss), for: .touchUpInside)
        closeBtn.translatesAutoresizingMaskIntoConstraints = false

        // Tone badge
        let toneLbl = UILabel()
        toneLbl.text      = suggestion.tone.uppercased()
        toneLbl.font      = .systemFont(ofSize: 9, weight: .bold)
        toneLbl.textColor = UIColor(red: 0.4, green: 0.7, blue: 1.0, alpha: 0.85)
        toneLbl.translatesAutoresizingMaskIntoConstraints = false

        // Full message text
        let msgLbl = UILabel()
        msgLbl.text          = suggestion.text
        msgLbl.font          = .systemFont(ofSize: 15, weight: .regular)
        msgLbl.textColor     = .white
        msgLbl.numberOfLines = 0
        msgLbl.translatesAutoresizingMaskIntoConstraints = false

        // Why label
        let whyLbl = UILabel()
        whyLbl.text      = suggestion.why.isEmpty ? "" : "✦ \(suggestion.why)"
        whyLbl.font      = .systemFont(ofSize: 11)
        whyLbl.textColor = UIColor.white.withAlphaComponent(0.4)
        whyLbl.translatesAutoresizingMaskIntoConstraints = false

        // Action buttons
        let insertBtn = makeActionBtn(title: "Use this reply", color: UIColor(red: 0.20, green: 0.60, blue: 1.00, alpha: 1))
        insertBtn.addTarget(self, action: #selector(insertTap), for: .touchUpInside)

        let sendBtn = makeActionBtn(title: "↑ Send now", color: UIColor(red: 0.3, green: 0.85, blue: 0.55, alpha: 1))
        sendBtn.addTarget(self, action: #selector(sendTap), for: .touchUpInside)

        let btnStack = UIStackView(arrangedSubviews: [insertBtn, sendBtn])
        btnStack.axis       = .horizontal
        btnStack.spacing    = 8
        btnStack.distribution = .fillEqually
        btnStack.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(closeBtn)
        card.addSubview(toneLbl)
        card.addSubview(msgLbl)
        card.addSubview(whyLbl)
        card.addSubview(btnStack)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            card.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            card.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),

            closeBtn.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            closeBtn.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            closeBtn.widthAnchor.constraint(equalToConstant: 28),
            closeBtn.heightAnchor.constraint(equalToConstant: 28),

            toneLbl.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            toneLbl.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),

            msgLbl.topAnchor.constraint(equalTo: toneLbl.bottomAnchor, constant: 6),
            msgLbl.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            msgLbl.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),

            whyLbl.topAnchor.constraint(equalTo: msgLbl.bottomAnchor, constant: 6),
            whyLbl.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            whyLbl.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),

            btnStack.topAnchor.constraint(equalTo: whyLbl.bottomAnchor, constant: 12),
            btnStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            btnStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            btnStack.heightAnchor.constraint(equalToConstant: 38),
            btnStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])

        // Tap background to dismiss
        let bgTap = UITapGestureRecognizer(target: self, action: #selector(dismiss))
        addGestureRecognizer(bgTap)
        card.isUserInteractionEnabled = true
        let cardTap = UITapGestureRecognizer(target: self, action: #selector(noop))
        card.addGestureRecognizer(cardTap)
    }

    private func makeActionBtn(title: String, color: UIColor) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font  = .systemFont(ofSize: 13, weight: .semibold)
        b.tintColor         = .white
        b.backgroundColor   = color.withAlphaComponent(0.85)
        b.layer.cornerRadius = 8
        b.translatesAutoresizingMaskIntoConstraints = false
        return b
    }

    @objc private func dismiss()    { onDismiss?() }
    @objc private func insertTap()  { onInsert?() }
    @objc private func sendTap()    { onSend?() }
    @objc private func noop()       {}
}

// MARK: - VACLoadingView

final class VACLoadingView: UIView {
    private var dots:  [UIView] = []
    private var timer: Timer?

    override var intrinsicContentSize: CGSize { CGSize(width: 36, height: 16) }

    override init(frame: CGRect) {
        super.init(frame: frame)
        for i in 0..<3 {
            let d = UIView()
            d.backgroundColor    = UIColor.white.withAlphaComponent(0.5)
            d.layer.cornerRadius = 3
            d.frame = CGRect(x: i * 11, y: 4, width: 7, height: 7)
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
                self.dots.enumerated().forEach { idx, d in d.alpha = idx == i % 3 ? 1 : 0.15 }
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
