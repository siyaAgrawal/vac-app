// SettingsViewController.swift
// The VAC containing app — configure server URL and contact.
// No API key needed — VAC uses Ollama AI on your Mac server.

import UIKit

final class SettingsViewController: UITableViewController {

    // MARK: - Data

    private let cfg = VACConfig.shared

    private lazy var serverField: UITextField = makeField(
        placeholder: "http://192.0.0.2:8787",
        value:       cfg.serverURL,
        secure:      false
    )
    private lazy var contactField: UITextField = makeField(
        placeholder: "Contact name (optional)",
        value:       cfg.contactName,
        secure:      false
    )

    private let statusLabel: UILabel = {
        let l = UILabel()
        l.font          = .systemFont(ofSize: 13)
        l.textColor     = .secondaryLabel
        l.textAlignment = .center
        l.numberOfLines = 0
        return l
    }()

    // MARK: - Sections / rows

    private enum Section: Int, CaseIterable {
        case server, contact, action, status
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "VAC Settings"
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Save", style: .done, target: self, action: #selector(save))
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
        tableView.keyboardDismissMode = .onDrag
        updateStatus()
    }

    // MARK: - TableView

    override func numberOfSections(in tableView: UITableView) -> Int { Section.allCases.count }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch Section(rawValue: section)! {
        case .server, .contact, .status: return 1
        case .action: return 2
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .server:  return "VAC Mac Server URL"
        case .contact: return "Current Contact"
        case .action:  return "Actions"
        case .status:  return "Status"
        }
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch Section(rawValue: section)! {
        case .server:
            return "Your Mac's IP + port 8787. When iPhone is USB-tethered to Mac, use http://192.0.0.2:8787. Tap 'Discover Server' to auto-detect."
        case .contact:
            return "When set, VAC learns your tone for this specific person and enables direct WhatsApp send."
        default: return nil
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: "cell")
        cell.selectionStyle = .none

        switch Section(rawValue: indexPath.section)! {
        case .server:
            embed(serverField, in: cell)
        case .contact:
            embed(contactField, in: cell)
        case .action:
            if indexPath.row == 0 {
                cell.textLabel?.text          = "Save Settings"
                cell.textLabel?.textColor     = UIColor(red: 0, green: 0.44, blue: 0.87, alpha: 1)
                cell.textLabel?.font          = .systemFont(ofSize: 17, weight: .semibold)
                cell.textLabel?.textAlignment = .center
                cell.selectionStyle           = .default
            } else {
                cell.textLabel?.text          = "Discover Server Automatically"
                cell.textLabel?.textColor     = .systemGreen
                cell.textLabel?.font          = .systemFont(ofSize: 15)
                cell.textLabel?.textAlignment = .center
                cell.selectionStyle           = .default
            }
        case .status:
            cell.contentView.addSubview(statusLabel)
            statusLabel.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                statusLabel.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 10),
                statusLabel.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -10),
                statusLabel.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 16),
                statusLabel.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor, constant: -16),
            ])
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard Section(rawValue: indexPath.section) == .action else { return }
        if indexPath.row == 0 { save() }
        else                  { discoverServer() }
    }

    // MARK: - Actions

    @objc private func save() {
        view.endEditing(true)
        cfg.serverURL   = serverField.text?.trimmingCharacters(in: .whitespaces)
                          .replacingOccurrences(of: " ", with: "") ?? cfg.serverURL
        cfg.contactName = contactField.text?.trimmingCharacters(in: .whitespaces) ?? ""
        // Clear cached resolved URL so next suggest re-discovers
        VACClient.shared.clearResolvedURL()
        updateStatus()
        showAlert(title: "Saved", message: "Settings saved and shared to VAC keyboard.")
    }

    private func discoverServer() {
        statusLabel.text      = "Scanning for VAC server…"
        statusLabel.textColor = .secondaryLabel

        VACClient.shared.resolveServerURL { [weak self] found in
            DispatchQueue.main.async {
                if let url = found {
                    self?.cfg.serverURL      = url
                    self?.serverField.text   = url
                    self?.statusLabel.text   = "✓ Found: \(url)"
                    self?.statusLabel.textColor = .systemGreen
                } else {
                    self?.statusLabel.text      = "✗ No server found — make sure Mac is running 'npm run dev' and phone is connected"
                    self?.statusLabel.textColor = .systemRed
                }
            }
        }
    }

    private func updateStatus() {
        let url = cfg.serverURL
        statusLabel.text      = "Ollama AI (no API key needed) · Server: \(url)"
        statusLabel.textColor = .secondaryLabel
    }

    // MARK: - Helpers

    private func makeField(placeholder: String, value: String, secure: Bool) -> UITextField {
        let f = UITextField()
        f.placeholder        = placeholder
        f.text               = value
        f.isSecureTextEntry  = secure
        f.font               = .monospacedSystemFont(ofSize: 14, weight: .regular)
        f.autocorrectionType = .no
        f.autocapitalizationType = .none
        f.clearButtonMode    = .whileEditing
        return f
    }

    private func embed(_ field: UITextField, in cell: UITableViewCell) {
        cell.contentView.addSubview(field)
        field.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            field.topAnchor.constraint(equalTo: cell.contentView.topAnchor),
            field.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor),
            field.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 16),
            field.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor, constant: -16),
            field.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    private func showAlert(title: String, message: String) {
        let a = UIAlertController(title: title, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}
