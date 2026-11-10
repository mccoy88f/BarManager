package it.mccoy88f.barmanager

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.http.SslError
import android.os.Bundle
import android.webkit.SslErrorHandler
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebViewClient
import com.getcapacitor.CapConfig

/**
 * Shell nativa (§5.11 di docs/DEVELOPMENT.md): stesso frontend React del
 * sito/PWA, caricato nella WebView del Bridge Capacitor puntata però su un
 * dominio configurabile a runtime (il sotto-dominio del locale), non sugli
 * asset web impacchettati nell'APK — quelli restano solo come schermata di
 * fallback iniziale, mai mostrata davvero a dominio configurato.
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
        registerPlugin(RchFiscalPrinterPlugin::class.java)
        registerPlugin(NativePushPlugin::class.java)

        val url = if (domain.startsWith("http://") || domain.startsWith("https://")) {
            domain
        } else {
            "https://$domain"
        }

        config = CapConfig.Builder(this).setServerUrl(url).create()
        super.onCreate(savedInstanceState)
        NativePushRuntime.storeOpenPath(this, intent)
        PushListenerService.startIfConfigured(this)

        // Risolve il problema del certificato Let's Encrypt ISRG Root X1 non riconosciuto dai vecchi trust store Android 6/7
        bridge?.let { b ->
            b.setWebViewClient(object : BridgeWebViewClient(b) {
                @SuppressLint("WebViewClientOnReceivedSslError")
                override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                    val errorUrl = error?.url ?: view?.url ?: ""
                    if (errorUrl.contains("mccoy88f.link") ||
                        errorUrl.contains("localhost") ||
                        errorUrl.contains("10.0.2.2") ||
                        errorUrl.contains("192.168.")
                    ) {
                        handler?.proceed()
                        return
                    }
                    super.onReceivedSslError(view, handler, error)
                }
            })
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        NativePushRuntime.storeOpenPath(this, intent)
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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NativePushRuntime.PERMISSION_REQUEST &&
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        ) {
            PushListenerService.startIfConfigured(this)
        }
    }
}
