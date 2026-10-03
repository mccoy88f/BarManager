package it.mccoy88f.barmanager

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

/**
 * Shell nativa (§5.11 di docs/DEVELOPMENT.md): stesso frontend React del
 * sito/PWA, caricato nella WebView del Bridge Capacitor puntata però su un
 * dominio configurabile a runtime (il sotto-dominio del locale), non sugli
 * asset web impacchettati nell'APK — quelli restano solo come schermata di
 * fallback iniziale, mai mostrata davvero a dominio configurato.
 *
 * Nessun dominio salvato (primo avvio) -> DomainSetupActivity, non la
 * WebView. launchMode="singleTask" (AndroidManifest) vuol dire che un
 * ritorno da quella schermata richiama onNewIntent(), non onCreate(): la
 * stessa identica logica va ripetuta lì per intercettare un cambio
 * dominio fatto a chiacchiera (app già aperta).
 *
 * onResume() ricarica sempre la pagina (anche a dominio invariato): senza,
 * riaprire l'app dopo averla solo messa in background (non un vero
 * riavvio del processo) mostra lo stato già in memoria della WebView,
 * mai una richiesta di rete nuova — un redeploy del sito non si vedrebbe
 * mai finché l'app non viene forzatamente chiusa e riaperta da zero.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AppSettingsPlugin::class.java)
        registerPlugin(EscPosPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)
        loadConfiguredDomainOrSetup(forceReload = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        loadConfiguredDomainOrSetup(forceReload = false)
    }

    override fun onResume() {
        super.onResume()
        loadConfiguredDomainOrSetup(forceReload = true)
    }

    private fun loadConfiguredDomainOrSetup(forceReload: Boolean) {
        val domain = DomainPrefs.getDomain(this)
        if (domain.isNullOrBlank()) {
            startActivity(Intent(this, DomainSetupActivity::class.java))
            return
        }

        val target = "https://$domain"
        val webView = bridge.webView
        if (webView.url != target) {
            webView.loadUrl(target)
        } else if (forceReload) {
            webView.reload()
        }
    }
}
