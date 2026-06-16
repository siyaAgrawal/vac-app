// HomeViewController.swift
// VAC home screen — shows connection status, all features, setup guide, and stats.

import UIKit

final class HomeViewController: UIViewController {

    // MARK: - State
    private var serverURL: String { VACConfig.shared.serverURL }
    private var isConnected = false
    private var pollTimer: Timer?

    // MARK: - Views
    private let scrollView   = UIScrollView()
    private let stack        = UIStackView()

    // Connection card
    private let connCard     = UIView()
    private let connDot      = UIView()
    private let connTitle    = UILabel()
    private let connSub      = UILabel()
    private let connBtn      = UIButton(type: .system)

    // Stats bar
    private let statsCard    = UIView()

    // Feature cards container
    private let featuresGrid = UIStackView()

    // MARK: - Colors
    private let bg           = UIColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1)
    private let cardBg       = UIColor(red: 0.11, green: 0.11, blue: 0.14, alpha: 1)
    private let accent       = UIColor(red: 0.20, green: 0.60, blue: 1.00, alpha: 1)
    private let green        = UIColor(red: 0.20, green: 0.85, blue: 0.50, alpha: 1)
    private let red          = UIColor(red: 1.00, green: 0.27, blue: 0.27, alpha: 1)
    private let textPrimary  = UIColor.white
    private let textSec      = UIColor.white.withAlphaComponent(0.50)
    private let border       = UIColor.white.withAlphaComponent(0.08)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "VAC"
        view.backgroundColor = bg

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            image:  UIImage(systemName: "gearshape.fill"),
            style:  .plain,
            target: self,
            action: #selector(openSettings)
        )
        navigationItem.rightBarButtonItem?.tintColor = textSec

        setupScrollView()
        setupConnectionCard()
        setupSetupChecklist()
        setupFeatureGrid()
        setupStatsBar()
        setupFooter()

        checkConnection()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startPolling()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopPolling()
    }

    // MARK: - ScrollView

    private func setupScrollView() {
        scrollView.alwaysBounceVertical = true
        scrollView.showsVerticalScrollIndicator = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        stack.axis      = .vertical
        stack.spacing   = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -30),
            stack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -36),
        ])
    }

    // MARK: - Header

    private func setupConnectionCard() {
        connCard.backgroundColor    = cardBg
        connCard.layer.cornerRadius = 18
        connCard.layer.borderWidth  = 1
        connCard.layer.borderColor  = border.cgColor
        connCard.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(connCard)

        // Glow badge
        let badge = UIView()
        badge.backgroundColor    = UIColor(red: 0.20, green: 0.60, blue: 1.0, alpha: 0.12)
        badge.layer.cornerRadius = 22
        badge.translatesAutoresizingMaskIntoConstraints = false
        connCard.addSubview(badge)

        let icon = UILabel()
        icon.text = "✦"
        icon.font = .systemFont(ofSize: 22, weight: .black)
        icon.textColor = accent
        icon.translatesAutoresizingMaskIntoConstraints = false
        badge.addSubview(icon)

        // Status dot
        connDot.layer.cornerRadius = 5
        connDot.backgroundColor    = textSec
        connDot.translatesAutoresizingMaskIntoConstraints = false
        connCard.addSubview(connDot)

        let appTitle = UILabel()
        appTitle.text      = "VAC"
        appTitle.font      = .systemFont(ofSize: 28, weight: .black)
        appTitle.textColor = textPrimary
        appTitle.translatesAutoresizingMaskIntoConstraints = false
        connCard.addSubview(appTitle)

        let tagline = UILabel()
        tagline.text          = "Say it right. Every time."
        tagline.font          = .systemFont(ofSize: 13, weight: .medium)
        tagline.textColor     = textSec
        tagline.translatesAutoresizingMaskIntoConstraints = false
        connCard.addSubview(tagline)

        connTitle.text          = "Connecting…"
        connTitle.font          = .systemFont(ofSize: 13, weight: .semibold)
        connTitle.textColor     = textSec
        connTitle.translatesAutoresizingMaskIntoConstraints = false
        connCard.addSubview(connTitle)

        connSub.text          = serverURL
        connSub.font          = .monospacedSystemFont(ofSize: 10, weight: .regular)
        connSub.textColor     = textSec.withAlphaComponent(0.6)
        connSub.numberOfLines = 1
        connSub.lineBreakMode = .byTruncatingMiddle
        connSub.translatesAutoresizingMaskIntoConstraints = false
        connCard.addSubview(connSub)

        connBtn.setTitle("Discover server", for: .normal)
        connBtn.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        connBtn.backgroundColor  = accent.withAlphaComponent(0.15)
        connBtn.setTitleColor(accent, for: .normal)
        connBtn.layer.cornerRadius = 10
        connBtn.contentEdgeInsets  = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        connBtn.addTarget(self, action: #selector(discoverTapped), for: .touchUpInside)
        connBtn.translatesAutoresizingMaskIntoConstraints = false
        connCard.addSubview(connBtn)

        NSLayoutConstraint.activate([
            badge.topAnchor.constraint(equalTo: connCard.topAnchor, constant: 20),
            badge.leadingAnchor.constraint(equalTo: connCard.leadingAnchor, constant: 20),
            badge.widthAnchor.constraint(equalToConstant: 44),
            badge.heightAnchor.constraint(equalToConstant: 44),

            icon.centerXAnchor.constraint(equalTo: badge.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: badge.centerYAnchor),

            appTitle.topAnchor.constraint(equalTo: connCard.topAnchor, constant: 22),
            appTitle.leadingAnchor.constraint(equalTo: badge.trailingAnchor, constant: 12),

            tagline.topAnchor.constraint(equalTo: appTitle.bottomAnchor, constant: 2),
            tagline.leadingAnchor.constraint(equalTo: badge.trailingAnchor, constant: 12),

            connDot.topAnchor.constraint(equalTo: tagline.bottomAnchor, constant: 16),
            connDot.leadingAnchor.constraint(equalTo: connCard.leadingAnchor, constant: 20),
            connDot.widthAnchor.constraint(equalToConstant: 10),
            connDot.heightAnchor.constraint(equalToConstant: 10),

            connTitle.centerYAnchor.constraint(equalTo: connDot.centerYAnchor),
            connTitle.leadingAnchor.constraint(equalTo: connDot.trailingAnchor, constant: 8),

            connSub.topAnchor.constraint(equalTo: connDot.bottomAnchor, constant: 4),
            connSub.leadingAnchor.constraint(equalTo: connCard.leadingAnchor, constant: 20),
            connSub.trailingAnchor.constraint(equalTo: connCard.trailingAnchor, constant: -20),

            connBtn.topAnchor.constraint(equalTo: connSub.bottomAnchor, constant: 14),
            connBtn.leadingAnchor.constraint(equalTo: connCard.leadingAnchor, constant: 20),
            connBtn.bottomAnchor.constraint(equalTo: connCard.bottomAnchor, constant: -20),
        ])
    }

    // MARK: - Setup Checklist

    private func setupSetupChecklist() {
        let card = makeCard(title: "Setup", icon: "checkmark.seal.fill", iconColor: green)

        let items: [(String, String)] = [
            ("Enable VAC Keyboard", "Settings → General → Keyboard → Add New Keyboard → VAC"),
            ("Allow Full Access", "Settings → General → Keyboard → VAC → Allow Full Access"),
            ("Connect to Mac",    "Connect iPhone to Mac via USB (or same Wi-Fi). Tap Discover above."),
        ]

        var prev: UIView? = nil
        for (i, (title, sub)) in items.enumerated() {
            let row = makeCheckRow(number: i + 1, title: title, subtitle: sub)
            card.addSubview(row)
            row.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                row.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
                row.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            ])
            if let p = prev {
                row.topAnchor.constraint(equalTo: p.bottomAnchor, constant: 10).isActive = true
            } else {
                row.topAnchor.constraint(equalTo: card.subviews.first!.bottomAnchor, constant: 14).isActive = true
            }
            prev = row
        }
        prev?.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16).isActive = true
        stack.addArrangedSubview(card)
    }

    private func makeCheckRow(number: Int, title: String, subtitle: String) -> UIView {
        let container = UIView()

        let numLabel = UILabel()
        numLabel.text = "\(number)"
        numLabel.font = .systemFont(ofSize: 11, weight: .black)
        numLabel.textColor = accent
        numLabel.textAlignment = .center
        numLabel.backgroundColor = accent.withAlphaComponent(0.15)
        numLabel.layer.cornerRadius = 10
        numLabel.clipsToBounds = true
        numLabel.translatesAutoresizingMaskIntoConstraints = false

        let titleLbl = UILabel()
        titleLbl.text = title
        titleLbl.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLbl.textColor = textPrimary
        titleLbl.translatesAutoresizingMaskIntoConstraints = false

        let subLbl = UILabel()
        subLbl.text = subtitle
        subLbl.font = .systemFont(ofSize: 11)
        subLbl.textColor = textSec
        subLbl.numberOfLines = 0
        subLbl.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(numLabel)
        container.addSubview(titleLbl)
        container.addSubview(subLbl)

        NSLayoutConstraint.activate([
            numLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            numLabel.topAnchor.constraint(equalTo: container.topAnchor, constant: 1),
            numLabel.widthAnchor.constraint(equalToConstant: 20),
            numLabel.heightAnchor.constraint(equalToConstant: 20),

            titleLbl.leadingAnchor.constraint(equalTo: numLabel.trailingAnchor, constant: 10),
            titleLbl.topAnchor.constraint(equalTo: container.topAnchor),
            titleLbl.trailingAnchor.constraint(equalTo: container.trailingAnchor),

            subLbl.leadingAnchor.constraint(equalTo: numLabel.trailingAnchor, constant: 10),
            subLbl.topAnchor.constraint(equalTo: titleLbl.bottomAnchor, constant: 2),
            subLbl.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            subLbl.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        return container
    }

    // MARK: - Feature Grid

    private func setupFeatureGrid() {
        let header = makeSectionHeader("Features")
        stack.addArrangedSubview(header)

        let features: [(String, String, String, UIColor)] = [
            ("AI Replies",      "brain.fill",           "Context-aware suggestions in any app. Tap to insert, ↑ to send.",         accent),
            ("Tone Guard",      "shield.fill",           "Real-time warning when your message is too aggressive or rash.",           UIColor(red: 1, green: 0.6, blue: 0.2, alpha: 1)),
            ("Goal Modes",      "target",                "Switch between Auto, Persuade, Reconnect, Impress, Firm, Funny.",          UIColor(red: 0.8, green: 0.4, blue: 1.0, alpha: 1)),
            ("WhatsApp Send",   "arrow.up.circle.fill",  "Send replies directly from keyboard without switching apps.",              green),
            ("Message Preview", "eye.fill",              "Long messages show a preview card — tap ↗ to see the full text.",         UIColor(red: 0.4, green: 0.8, blue: 1.0, alpha: 1)),
            ("Smart Learning",  "sparkles",              "VAC learns your tone and adapts suggestions to sound like you.",           UIColor(red: 1.0, green: 0.8, blue: 0.2, alpha: 1)),
        ]

        var row: UIStackView? = nil
        for (i, f) in features.enumerated() {
            if i % 2 == 0 {
                let r = UIStackView()
                r.axis         = .horizontal
                r.spacing      = 10
                r.distribution = .fillEqually
                stack.addArrangedSubview(r)
                row = r
            }
            let card = makeFeatureCard(title: f.0, icon: f.1, desc: f.2, color: f.3)
            row?.addArrangedSubview(card)
        }
    }

    private func makeFeatureCard(title: String, icon: String, desc: String, color: UIColor) -> UIView {
        let card = UIView()
        card.backgroundColor    = cardBg
        card.layer.cornerRadius = 16
        card.layer.borderWidth  = 1
        card.layer.borderColor  = border.cgColor
        card.translatesAutoresizingMaskIntoConstraints = false

        let img = UIImageView(image: UIImage(systemName: icon))
        img.tintColor           = color
        img.contentMode         = .scaleAspectFit
        img.translatesAutoresizingMaskIntoConstraints = false

        let titleLbl = UILabel()
        titleLbl.text      = title
        titleLbl.font      = .systemFont(ofSize: 13, weight: .bold)
        titleLbl.textColor = textPrimary
        titleLbl.translatesAutoresizingMaskIntoConstraints = false

        let descLbl = UILabel()
        descLbl.text          = desc
        descLbl.font          = .systemFont(ofSize: 11)
        descLbl.textColor     = textSec
        descLbl.numberOfLines = 3
        descLbl.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(img)
        card.addSubview(titleLbl)
        card.addSubview(descLbl)

        NSLayoutConstraint.activate([
            card.heightAnchor.constraint(greaterThanOrEqualToConstant: 120),

            img.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            img.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            img.widthAnchor.constraint(equalToConstant: 26),
            img.heightAnchor.constraint(equalToConstant: 26),

            titleLbl.topAnchor.constraint(equalTo: img.bottomAnchor, constant: 10),
            titleLbl.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            titleLbl.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -10),

            descLbl.topAnchor.constraint(equalTo: titleLbl.bottomAnchor, constant: 4),
            descLbl.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            descLbl.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -10),
            descLbl.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])
        return card
    }

    // MARK: - Stats Bar

    private func setupStatsBar() {
        let header = makeSectionHeader("This Session")
        stack.addArrangedSubview(header)

        let card = UIView()
        card.backgroundColor    = cardBg
        card.layer.cornerRadius = 16
        card.layer.borderWidth  = 1
        card.layer.borderColor  = border.cgColor
        stack.addArrangedSubview(card)

        let total     = VACConfig.shared.totalSuggestionsUsed
        let preferred = VACConfig.shared.preferredTone ?? "—"

        let statsStack = UIStackView()
        statsStack.axis         = .horizontal
        statsStack.distribution = .fillEqually
        statsStack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(statsStack)

        for (val, label) in [
            (String(total), "Suggestions used"),
            (preferred,     "Preferred tone"),
            ("Ollama",      "AI engine"),
        ] {
            statsStack.addArrangedSubview(makeStat(value: val, label: label))
        }

        NSLayoutConstraint.activate([
            statsStack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            statsStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            statsStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            statsStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])
    }

    private func makeStat(value: String, label: String) -> UIView {
        let v = UIView()
        let val = UILabel()
        val.text          = value
        val.font          = .systemFont(ofSize: 20, weight: .black)
        val.textColor     = textPrimary
        val.textAlignment = .center
        val.translatesAutoresizingMaskIntoConstraints = false
        let lbl = UILabel()
        lbl.text          = label
        lbl.font          = .systemFont(ofSize: 10)
        lbl.textColor     = textSec
        lbl.textAlignment = .center
        lbl.numberOfLines = 2
        lbl.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(val)
        v.addSubview(lbl)
        NSLayoutConstraint.activate([
            val.topAnchor.constraint(equalTo: v.topAnchor),
            val.leadingAnchor.constraint(equalTo: v.leadingAnchor),
            val.trailingAnchor.constraint(equalTo: v.trailingAnchor),
            lbl.topAnchor.constraint(equalTo: val.bottomAnchor, constant: 2),
            lbl.leadingAnchor.constraint(equalTo: v.leadingAnchor),
            lbl.trailingAnchor.constraint(equalTo: v.trailingAnchor),
            lbl.bottomAnchor.constraint(equalTo: v.bottomAnchor),
        ])
        return v
    }

    // MARK: - Footer

    private func setupFooter() {
        let lbl = UILabel()
        lbl.text          = "VAC · Powered by Ollama AI · No API key needed"
        lbl.font          = .systemFont(ofSize: 11)
        lbl.textColor     = textSec.withAlphaComponent(0.5)
        lbl.textAlignment = .center
        lbl.numberOfLines = 0
        stack.addArrangedSubview(lbl)
    }

    // MARK: - Helpers

    private func makeCard(title: String, icon: String, iconColor: UIColor) -> UIView {
        let card = UIView()
        card.backgroundColor    = cardBg
        card.layer.cornerRadius = 16
        card.layer.borderWidth  = 1
        card.layer.borderColor  = border.cgColor

        let img = UIImageView(image: UIImage(systemName: icon))
        img.tintColor   = iconColor
        img.contentMode = .scaleAspectFit
        img.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(img)

        let titleLbl = UILabel()
        titleLbl.text      = title
        titleLbl.font      = .systemFont(ofSize: 14, weight: .bold)
        titleLbl.textColor = textPrimary
        titleLbl.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(titleLbl)

        NSLayoutConstraint.activate([
            img.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            img.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            img.widthAnchor.constraint(equalToConstant: 20),
            img.heightAnchor.constraint(equalToConstant: 20),

            titleLbl.leadingAnchor.constraint(equalTo: img.trailingAnchor, constant: 8),
            titleLbl.centerYAnchor.constraint(equalTo: img.centerYAnchor),
        ])
        return card
    }

    private func makeSectionHeader(_ text: String) -> UILabel {
        let l = UILabel()
        l.text      = text.uppercased()
        l.font      = .systemFont(ofSize: 11, weight: .bold)
        l.textColor = textSec
        l.letterSpacing(1.2)
        return l
    }

    // MARK: - Connection Logic

    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in
            self?.checkConnection()
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func checkConnection() {
        VACClient.shared.checkConnection(serverURL: serverURL) { [weak self] ok in
            DispatchQueue.main.async {
                self?.updateConnectionUI(ok)
            }
        }
    }

    private func updateConnectionUI(_ connected: Bool) {
        isConnected = connected
        if connected {
            connDot.backgroundColor = green
            connTitle.text          = "Connected to VAC server"
            connTitle.textColor     = green
            connSub.text            = serverURL
        } else {
            connDot.backgroundColor = red
            connTitle.text          = "Not connected"
            connTitle.textColor     = red
            connSub.text            = "Tap 'Discover server' to find your Mac"
        }
    }

    // MARK: - Actions

    @objc private func discoverTapped() {
        connBtn.setTitle("Scanning…", for: .normal)
        connBtn.isEnabled = false
        connTitle.text    = "Looking for VAC server…"
        connDot.backgroundColor = UIColor.systemYellow

        VACClient.shared.resolveServerURL { [weak self] found in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.connBtn.setTitle("Discover server", for: .normal)
                self.connBtn.isEnabled = true
                if let url = found {
                    VACConfig.shared.serverURL = url
                    self.connSub.text = url
                    self.updateConnectionUI(true)
                } else {
                    self.updateConnectionUI(false)
                    self.showAlert(
                        title:   "Server not found",
                        message: "Make sure:\n• Mac is running 'npm run dev'\n• iPhone is connected via USB cable\n• Both are on same Wi-Fi\n\nMac address tried: \(VACConfig.serverCandidates.joined(separator: ", "))"
                    )
                }
            }
        }
    }

    @objc private func openSettings() {
        let vc = SettingsViewController()
        navigationController?.pushViewController(vc, animated: true)
    }

    private func showAlert(title: String, message: String) {
        let a = UIAlertController(title: title, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

// MARK: - UILabel letter spacing helper

extension UILabel {
    @discardableResult
    func letterSpacing(_ spacing: CGFloat) -> Self {
        guard let t = text else { return self }
        let attributed = NSAttributedString(string: t, attributes: [
            .kern: spacing,
            .foregroundColor: textColor as Any,
            .font: font as Any,
        ])
        attributedText = attributed
        return self
    }
}
