package it.mccoy88f.barmanager

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.getcapacitor.CapConfig

/**
 * Shell nativa (§5.11 di docs/DEVELOPMENT.md): stesso frontend React del
 * sito/PWA, caricato nella WebView del Bridge Capacitor puntata però su un
 * dominio configurabile a runtime (il sotto-dominio del locale), non sugli
 * asset web impacchettati nell'APK — quelli restano solo come schermata di
 * fallback iniziale, mai mostrata davvero a dominio configurato.
 *
 * Il dominio va impostato con `CapConfig.Builder.setServerUrl()` PRIMA che
 * `super.onCreate()` costruisca il Bridge, non con un semplice
 * `webView.loadUrl()` dopo: Capacitor inietta il ponte nativo JS
 * (`window.androidBridge`, da cui dipende `Capacitor.isNativePlatform()`,
 * quindi `isNativeApp()` lato web e tutto ciò che ne dipende: voce
 * "Impostazioni app", stampa ESC/POS, barra di stato) SOLO sulle origin
 * presenti in `allowedOriginRules` — popolate da `setServerUrl` quando il
 * Bridge viene creato, mai aggiornabili dopo (bug reale riscontrato: con
 * solo `loadUrl()` la pagina si vedeva perfettamente ma senza alcuna delle
 * funzionalità native, perché il dominio del locale non vi era mai incluso).
 *
 * Nessun dominio salvato (primo avvio) -> DomainSetupActivity, non la
 * WebView. launchMode="singleTask" (AndroidManifest) vuol dire che un
 * ritorno da quella schermata richiama onNewIntent(), non onCreate(): il
 * Bridge è però già stato costruito con la config (quindi l'origin
 * consentita) del dominio precedente, quindi l'unico modo corretto per
 * applicarne uno nuovo è `recreate()` (ricostruisce l'Activity da zero,
 * richiamando onCreate con il dominio aggiornato), non un altro `loadUrl`.
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
        val domain = DomainPrefs.getDomain(this)
        if (!domain.isNullOrBlank()) {
            config = CapConfig.Builder(this).setServerUrl("https://$domain").create()
        }
        super.onCreate(savedInstanceState)
        if (domain.isNullOrBlank()) {
            startActivity(Intent(this, DomainSetupActivity::class.java))
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        recreate()
    }

    override fun onResume() {
        super.onResume()
        if (bridge.webView.url != null) {
            bridge.webView.reload()
        }
    }
}
