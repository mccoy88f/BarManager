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
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AppSettingsPlugin::class.java)
        registerPlugin(EscPosPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)
        loadConfiguredDomainOrSetup()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        loadConfiguredDomainOrSetup()
    }

    private fun loadConfiguredDomainOrSetup() {
        val domain = DomainPrefs.getDomain(this)
        if (domain.isNullOrBlank()) {
            startActivity(Intent(this, DomainSetupActivity::class.java))
            return
        }

        val target = "https://$domain"
        val webView = bridge.webView
        if (webView.url != target) {
            webView.loadUrl(target)
        }
    }
}
