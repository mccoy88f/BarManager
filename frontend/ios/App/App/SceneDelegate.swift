import UIKit
import Capacitor
import UserNotifications

class SceneDelegate: UIResponder, UIWindowSceneDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        UNUserNotificationCenter.current().delegate = self

        window = UIWindow(windowScene: windowScene)
        installRoot(animated: false)
        window?.makeKeyAndVisible()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(reloadDomain),
            name: .barManagerReloadDomain,
            object: nil
        )

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    @objc private func reloadDomain() {
        installRoot(animated: true)
    }

    private func installRoot(animated: Bool) {
        guard let window else { return }
        let root: UIViewController
        if DomainPrefs.getDomain() == nil {
            let setup = DomainSetupViewController()
            setup.onSaved = { [weak self] in
                self?.installRoot(animated: true)
            }
            root = setup
        } else {
            root = MainBridgeViewController()
        }
        if animated {
            UIView.transition(with: window, duration: 0.25, options: .transitionCrossDissolve, animations: {
                window.rootViewController = root
            })
        } else {
            window.rootViewController = root
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        PushListenerService.shared.startIfConfigured()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Il loop resta attivo finché iOS concede tempo in background.
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // Tocca una notifica locale → salva il path da aprire nella WebView.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        if let path = info[NativePushRuntime.extraPath] as? String {
            NativePushRuntime.storeOpenPath(path)
        }
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }
}
