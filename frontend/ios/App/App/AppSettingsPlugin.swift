import Foundation
import Capacitor
import UIKit

/**
 * Ponte JS → nativo per dominio e aggiornamenti (pari ad AppSettings Android).
 */
@objc(AppSettingsPlugin)
public class AppSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppSettingsPlugin"
    public let jsName = "AppSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getDomain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openDomainSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAppInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkForUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadAndInstallUpdate", returnType: CAPPluginReturnPromise),
    ]

    @objc func getDomain(_ call: CAPPluginCall) {
        call.resolve(["domain": DomainPrefs.getDomain() as Any])
    }

    @objc func openDomainSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let root = self.bridge?.viewController else {
                call.reject("ViewController non disponibile")
                return
            }
            let setup = DomainSetupViewController()
            setup.modalPresentationStyle = .fullScreen
            setup.onSaved = {
                setup.dismiss(animated: true) {
                    NotificationCenter.default.post(name: .barManagerReloadDomain, object: nil)
                }
            }
            root.present(setup, animated: true) {
                call.resolve()
            }
        }
    }

    @objc func getAppInfo(_ call: CAPPluginCall) {
        call.resolve([
            "versionName": UpdateManager.currentVersionName(),
            "versionCode": UpdateManager.currentVersionCode(),
            "domain": DomainPrefs.getDomain() as Any,
            "packageName": Bundle.main.bundleIdentifier ?? "it.mccoy88f.barmanager",
        ])
    }

    @objc func checkForUpdate(_ call: CAPPluginCall) {
        UpdateManager.checkForUpdate { result in
            switch result {
            case .failure(let error):
                call.reject("Errore verifica aggiornamento: \(error.localizedDescription)", nil, error)
            case .success(let info):
                var payload: [String: Any] = [
                    "currentVersion": UpdateManager.currentVersionName(),
                ]
                if let info {
                    payload["hasUpdate"] = true
                    payload["latestVersion"] = info.tagName
                    payload["downloadUrl"] = info.downloadUrl
                    payload["apkName"] = info.apkName
                    payload["sizeBytes"] = info.sizeBytes
                    payload["releaseNotes"] = info.releaseNotes ?? ""
                } else {
                    payload["hasUpdate"] = false
                    payload["latestVersion"] = UpdateManager.currentVersionName()
                }
                call.resolve(payload)
            }
        }
    }

    @objc func downloadAndInstallUpdate(_ call: CAPPluginCall) {
        guard let downloadUrl = call.getString("downloadUrl"), !downloadUrl.isEmpty else {
            call.reject("URL di download non fornito")
            return
        }
        UpdateManager.openUpdate(urlString: downloadUrl)
        call.resolve(["success": true])
    }
}

extension Notification.Name {
    static let barManagerReloadDomain = Notification.Name("barManagerReloadDomain")
}
