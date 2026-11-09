import UIKit

/**
 * Schermata nativa di configurazione del dominio (§5.11): mostrata al primo
 * avvio e da Impostazioni app. Verifica che l'indirizzo sia raggiungibile
 * prima di salvarlo.
 */
final class DomainSetupViewController: UIViewController {
    var onSaved: (() -> Void)?

    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let domainField = UITextField()
    private let errorLabel = UILabel()
    private let saveButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        setupUI()
        if let existing = DomainPrefs.getDomain() {
            domainField.text = DomainPrefs.normalize(existing)
        }
    }

    private func setupUI() {
        titleLabel.text = "Configura il locale"
        titleLabel.font = .boldSystemFont(ofSize: 20)
        titleLabel.textAlignment = .center

        subtitleLabel.text = "Inserisci l'indirizzo del tuo locale su BarManager (es. demo.bm.mccoy88f.link), senza \"https://\"."
        subtitleLabel.font = .systemFont(ofSize: 14)
        subtitleLabel.numberOfLines = 0
        subtitleLabel.textAlignment = .center
        subtitleLabel.textColor = .secondaryLabel

        domainField.placeholder = "slug.tuodominio.it"
        domainField.borderStyle = .roundedRect
        domainField.autocapitalizationType = .none
        domainField.autocorrectionType = .no
        domainField.keyboardType = .URL
        domainField.returnKeyType = .done

        errorLabel.textColor = .systemRed
        errorLabel.font = .systemFont(ofSize: 13)
        errorLabel.numberOfLines = 0
        errorLabel.isHidden = true

        saveButton.setTitle("Salva", for: .normal)
        saveButton.titleLabel?.font = .boldSystemFont(ofSize: 17)
        saveButton.addTarget(self, action: #selector(saveTapped), for: .touchUpInside)

        spinner.hidesWhenStopped = true

        let stack = UIStackView(arrangedSubviews: [
            titleLabel, subtitleLabel, domainField, errorLabel, saveButton, spinner,
        ])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor, constant: -16),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    @objc private func saveTapped() {
        let raw = domainField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let domain = DomainPrefs.normalize(raw)
        if domain.isEmpty {
            showError("Inserisci un indirizzo valido.")
            return
        }

        errorLabel.isHidden = true
        saveButton.isEnabled = false
        spinner.startAnimating()

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let reachable = self?.determineReachableUrl(rawInput: raw, normalizedDomain: domain)
            DispatchQueue.main.async {
                guard let self else { return }
                self.spinner.stopAnimating()
                self.saveButton.isEnabled = true
                guard let target = reachable else {
                    self.showError("Impossibile raggiungere questo indirizzo: controlla che sia scritto giusto e che il dispositivo sia connesso a internet.")
                    return
                }
                DomainPrefs.setDomain(target)
                self.onSaved?()
            }
        }
    }

    private func showError(_ message: String) {
        errorLabel.text = message
        errorLabel.isHidden = false
    }

    private func determineReachableUrl(rawInput: String, normalizedDomain: String) -> String? {
        if rawInput.lowercased().hasPrefix("http://"), checkUrlReachable(rawInput) {
            return rawInput.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
        if rawInput.lowercased().hasPrefix("https://"), checkUrlReachable(rawInput) {
            return rawInput.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
        if checkUrlReachable("https://\(normalizedDomain)") { return "https://\(normalizedDomain)" }
        if checkUrlReachable("http://\(normalizedDomain)") { return "http://\(normalizedDomain)" }
        return nil
    }

    private func checkUrlReachable(_ urlString: String) -> Bool {
        guard let url = URL(string: urlString) else { return false }
        var request = URLRequest(url: url, timeoutInterval: 7)
        request.httpMethod = "HEAD"
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        let task = URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse, (200...499).contains(http.statusCode) {
                ok = true
            }
            sem.signal()
        }
        task.resume()
        _ = sem.wait(timeout: .now() + 8)
        return ok
    }
}
