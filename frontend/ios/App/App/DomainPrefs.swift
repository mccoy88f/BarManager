import Foundation

/**
 * Dominio del locale (es. "demo.bm.mccoy88f.link") a cui l'app carica la
 * WebView — vive fuori dalla WebView, in UserDefaults native (§5.11).
 */
enum DomainPrefs {
    private static let key = "domain"
    private static let suite = UserDefaults.standard

    static func getDomain() -> String? {
        let value = suite.string(forKey: key)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (value?.isEmpty == false) ? value : nil
    }

    static func setDomain(_ domain: String) {
        suite.set(domain, forKey: key)
    }

    static func normalize(_ input: String) -> String {
        var clean = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.lowercased().hasPrefix("https://") {
            clean = String(clean.dropFirst(8))
        } else if clean.lowercased().hasPrefix("http://") {
            clean = String(clean.dropFirst(7))
        }
        while clean.hasSuffix("/") {
            clean = String(clean.dropLast())
        }
        return clean
    }

    static func serverURLString() -> String? {
        guard let domain = getDomain() else { return nil }
        if domain.lowercased().hasPrefix("http://") || domain.lowercased().hasPrefix("https://") {
            return domain
        }
        return "https://\(domain)"
    }
}
