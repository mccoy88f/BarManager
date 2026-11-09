import Foundation
import UIKit

struct UpdateInfo {
    let tagName: String
    let downloadUrl: String
    let apkName: String
    let sizeBytes: Int64
    let releaseNotes: String?
}

enum UpdateManager {
    private static let githubLatest = "https://api.github.com/repos/mccoy88f/BarManager/releases/latest"

    static func currentVersionName() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    static func currentVersionCode() -> Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1") ?? 1
    }

    static func checkForUpdate(completion: @escaping (Result<UpdateInfo?, Error>) -> Void) {
        guard let url = URL(string: githubLatest) else {
            completion(.success(nil))
            return
        }
        var request = URLRequest(url: url)
        request.setValue("BarManager-iOS", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard let data,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(.success(nil))
                return
            }

            let tagName = (root["tag_name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !tagName.isEmpty, isNewerVersion(latestTag: tagName, currentVersion: currentVersionName()) else {
                completion(.success(nil))
                return
            }

            let assets = root["assets"] as? [[String: Any]] ?? []
            // Preferisci IPA iOS; fallback alla pagina release se assente.
            var downloadUrl = ""
            var assetName = ""
            var size: Int64 = 0
            for asset in assets {
                let name = asset["name"] as? String ?? ""
                if name.lowercased().hasPrefix("barmanager-") &&
                    !name.lowercased().contains("kiosk") &&
                    name.lowercased().hasSuffix(".ipa") {
                    downloadUrl = asset["browser_download_url"] as? String ?? ""
                    assetName = name
                    size = (asset["size"] as? NSNumber)?.int64Value ?? 0
                    break
                }
            }
            if downloadUrl.isEmpty {
                downloadUrl = root["html_url"] as? String ?? "https://github.com/mccoy88f/BarManager/releases/latest"
                assetName = "release-page"
            }

            completion(.success(UpdateInfo(
                tagName: tagName,
                downloadUrl: downloadUrl,
                apkName: assetName,
                sizeBytes: size,
                releaseNotes: root["body"] as? String
            )))
        }.resume()
    }

    static func isNewerVersion(latestTag: String, currentVersion: String) -> Bool {
        let cleanLatest = latestTag.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "v"))
        let cleanCurrent = currentVersion.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "v"))
        if cleanLatest == cleanCurrent { return false }
        if cleanCurrent.isEmpty || cleanCurrent == "1.0" || cleanCurrent == "1.0.0" { return true }

        func parse(_ v: String) -> [Int] {
            v.split { $0 == "." || $0 == "-" }.compactMap { Int($0) }
        }
        let vLatest = parse(cleanLatest)
        let vCurrent = parse(cleanCurrent)
        let maxLen = max(vLatest.count, vCurrent.count)
        for i in 0..<maxLen {
            let l = i < vLatest.count ? vLatest[i] : 0
            let c = i < vCurrent.count ? vCurrent[i] : 0
            if l > c { return true }
            if l < c { return false }
        }
        return cleanLatest != cleanCurrent
    }

    /// Su iOS non si possono installare IPA in silenzio come gli APK: apre il link di download/release.
    static func openUpdate(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url)
        }
    }
}
