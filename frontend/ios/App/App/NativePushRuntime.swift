import Foundation
import UserNotifications
import UIKit

/** Preferenze e notifiche locali usate dall'ascolto push nativo (pari ad Android). */
enum NativePushRuntime {
    static let prefs = UserDefaults.standard
    static let keyBase = "api_base"
    static let keyToken = "token"
    static let keyEnabled = "enabled"
    static let keySince = "since"
    static let keyOpenPath = "open_path"
    static let extraPath = "barmanager_push_path"

    static func enable(base: String, deviceToken: String) {
        prefs.set(base.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: keyBase)
        prefs.set(deviceToken, forKey: keyToken)
        prefs.set(true, forKey: keyEnabled)
        if prefs.string(forKey: keySince) == nil {
            prefs.set(nowIso(), forKey: keySince)
        }
        PushListenerService.shared.startIfConfigured()
    }

    static func isEnabled() -> Bool {
        prefs.bool(forKey: keyEnabled)
            && !(prefs.string(forKey: keyBase) ?? "").isEmpty
            && !(prefs.string(forKey: keyToken) ?? "").isEmpty
    }

    static func nowIso() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    static func storeOpenPath(_ path: String?) {
        guard let path, !path.isEmpty else { return }
        prefs.set(path, forKey: keyOpenPath)
    }

    static func consumeOpenPath() -> String? {
        let path = prefs.string(forKey: keyOpenPath)
        if path != nil { prefs.removeObject(forKey: keyOpenPath) }
        return path
    }

    static func canPostNotifications(completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                completion(settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional)
            }
        }
    }

    static func showAlert(id: String, title: String, body: String, url: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = [extraPath: url]
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    static func permissionLabel(for status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }
}
