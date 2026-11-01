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
 * Bridge viene creato, mai aggiornabili dopo.
 *
 * Nessun dominio salvato (primo avvio) -> DomainSetupActivity, non la
 * WebView: questa Activity viene chiusa subito dopo (non resta in coda a
 * ricaricare gli asset impacchettati di fallback sotto la schermata di
 * configurazione).
 *
 * launchMode="singleTask" (AndroidManifest) vuol dire che un cambio
 * dominio ad app già aperta (da "Impostazioni app") richiama onNewIntent()
 * su questa stessa istanza, non onCreate(): il Bridge è però già stato
 * costruito con la config (quindi l'origin consentita) del dominio
 * precedente, e l'unico modo corretto per applicarne uno nuovo è
 * ricostruirlo da zero. NON farlo con `recreate()`: su un'Activity
 * singleTask può innescare un loop onNewIntent() -> recreate() ->
 * onNewIntent() -> ... (bug reale riscontrato: lampeggio bianco/nero
 * continuo, app inutilizzabile). Si rilancia l'intero task con un nuovo
 * Intent FLAG_ACTIVITY_NEW_TASK + FLAG_ACTIVITY_CLEAR_TASK, poi si chiude
 * il task corrente con finishAffinity(): questo crea una MainActivity
 * davvero nuova (onCreate puro, mai un altro onNewIntent nel mezzo).
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val domain = DomainPrefs.getDomain(this)
        if (domain.isNullOrBlank()) {
            super.onCreate(savedInstanceState)
            startActivity(Intent(this, DomainSetupActivity::class.java))
            finish()
            return
        }

        registerPlugin(AppSettingsPlugin::class.java)
        registerPlugin(EscPosPrinterPlugin::class.java)

        val url = if (domain.startsWith("http://") || domain.startsWith("https://")) {
            domain
        } else {
            "https://$domain"
        }

        config = CapConfig.Builder(this).setServerUrl(url).create()
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Riavvia il task solo se richiesto esplicitamente da un cambio dominio,
        // MAI sulla normale chiamata interna di Capacitor (BridgeActivity.load() chiama onNewIntent ad ogni onCreate).
        if (intent.getBooleanExtra("reload_domain", false)) {
            val restart = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivity(restart)
            finish()
        }
    }
}
