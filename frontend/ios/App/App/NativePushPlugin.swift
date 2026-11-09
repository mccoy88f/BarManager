import Foundation
import Capacitor
import AVFoundation
import CoreLocation
import UIKit
import UserNotifications

/** Ponte JS → notifiche, fotocamera e posizione (pari a NativePush Android). */
@objc(NativePushPlugin)
public class NativePushPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "NativePushPlugin"
    public let jsName = "NativePush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestDevicePermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
    ]

    private let locationManager = CLLocationManager()
    private var locationCall: CAPPluginCall?

    @objc func start(_ call: CAPPluginCall) {
        guard let apiBase = call.getString("apiBase"), !apiBase.isEmpty,
              let token = call.getString("token"), !token.isEmpty else {
            call.reject("apiBase e token sono obbligatori")
            return
        }
        NativePushRuntime.enable(base: apiBase, deviceToken: token)
        call.resolve(["started": true])
    }

    @objc func consumePath(_ call: CAPPluginCall) {
        call.resolve(["path": NativePushRuntime.consumeOpenPath() as Any])
    }

    @objc func permissionStatus(_ call: CAPPluginCall) {
        currentStates { states in
            call.resolve(states)
        }
    }

    @objc func requestNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async {
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                    PushListenerService.shared.startIfConfigured()
                }
                call.resolve(["notifications": granted ? "granted" : "denied"])
            }
        }
    }

    @objc func requestDevicePermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { notifGranted, _ in
            AVCaptureDevice.requestAccess(for: .video) { _ in
                DispatchQueue.main.async {
                    self.locationCall = call
                    self.locationManager.delegate = self
                    let status = self.locationManager.authorizationStatus
                    if status == .notDetermined {
                        self.locationManager.requestWhenInUseAuthorization()
                    } else {
                        self.finishDevicePermissions(notificationsGranted: notifGranted, call: call)
                    }
                }
            }
        }
    }

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let call = locationCall else { return }
        if manager.authorizationStatus != .notDetermined {
            locationCall = nil
            finishDevicePermissions(notificationsGranted: nil, call: call)
        }
    }

    private func finishDevicePermissions(notificationsGranted: Bool?, call: CAPPluginCall) {
        currentStates { states in
            if let notificationsGranted {
                var merged = states
                merged["notifications"] = notificationsGranted ? "granted" : "denied"
                call.resolve(merged)
            } else {
                call.resolve(states)
            }
        }
    }

    private func currentStates(completion: @escaping ([String: String]) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let camera: String
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: camera = "granted"
            case .denied, .restricted: camera = "denied"
            case .notDetermined: camera = "prompt"
            @unknown default: camera = "prompt"
            }

            let location: String
            switch CLLocationManager().authorizationStatus {
            case .authorizedAlways, .authorizedWhenInUse: location = "granted"
            case .denied, .restricted: location = "denied"
            case .notDetermined: location = "prompt"
            @unknown default: location = "prompt"
            }

            DispatchQueue.main.async {
                completion([
                    "notifications": NativePushRuntime.permissionLabel(for: settings.authorizationStatus),
                    "camera": camera,
                    "location": location,
                ])
            }
        }
    }
}
