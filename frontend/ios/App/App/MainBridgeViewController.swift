import UIKit
import Capacitor

/**
 * Bridge Capacitor puntato al dominio del locale (pari a MainActivity Android).
 * Imposta server.url via InstanceDescriptor così allowedOriginRules include
 * il sotto-dominio e i plugin nativi funzionano.
 */
final class MainBridgeViewController: CAPBridgeViewController {
    override open func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let urlString = DomainPrefs.serverURLString(), let url = URL(string: urlString) {
            descriptor.serverURL = urlString
            var hosts = descriptor.allowedNavigationHostnames
            if let host = url.host, !hosts.contains(host) {
                hosts.append(host)
            }
            // Consenti anche i sotto-domini del root noto in sviluppo/produzione.
            for extra in ["mccoy88f.link", "localhost", "127.0.0.1"] where !hosts.contains(extra) {
                hosts.append(extra)
            }
            descriptor.allowedNavigationHostnames = hosts
        }
        return descriptor
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppSettingsPlugin())
        bridge?.registerPluginInstance(EscPosPrinterPlugin())
        bridge?.registerPluginInstance(NativePushPlugin())
        PushListenerService.shared.startIfConfigured()
    }
}
