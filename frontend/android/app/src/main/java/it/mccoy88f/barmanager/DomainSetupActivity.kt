package it.mccoy88f.barmanager

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.net.HttpURLConnection
import java.net.URL

/**
 * Schermata nativa di configurazione del dominio (§5.11 di
 * docs/DEVELOPMENT.md): mostrata obbligatoriamente al primo avvio (se
 * nessun dominio è salvato) e raggiungibile in qualsiasi altro momento da
 * un pulsante nella pagina web "Impostazioni" (quando l'app gira dentro
 * BarManager nativo), tramite AppSettingsPlugin.openDomainSettings().
 *
 * Prima di salvare, verifica che l'indirizzo sia davvero raggiungibile: un
 * dominio sbagliato (typo, locale non ancora attivo, nessuna connessione)
 * salvato senza controllo blocca l'app al prossimo avvio — MainActivity lo
 * carica direttamente, e l'unico modo per tornare qui è lo stesso
 * "Impostazioni app" dentro la pagina web, che però non può mai caricarsi
 * se il dominio salvato è sbagliato (nessun altro percorso di recupero).
 */
class DomainSetupActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_domain_setup)

        val domainInput = findViewById<EditText>(R.id.domainInput)
        val errorText = findViewById<TextView>(R.id.errorText)
        val saveButton = findViewById<Button>(R.id.saveButton)
        val checkingProgress = findViewById<ProgressBar>(R.id.checkingProgress)

        DomainPrefs.getDomain(this)?.let { domainInput.setText(it) }

        saveButton.setOnClickListener {
            val domain = DomainPrefs.normalize(domainInput.text.toString())
            if (domain.isEmpty()) {
                errorText.text = getString(R.string.domain_setup_error_empty)
                errorText.visibility = TextView.VISIBLE
                return@setOnClickListener
            }

            errorText.visibility = TextView.GONE
            saveButton.isEnabled = false
            checkingProgress.visibility = ProgressBar.VISIBLE

            Thread {
                val reachable = isDomainReachable(domain)
                runOnUiThread {
                    checkingProgress.visibility = ProgressBar.GONE
                    saveButton.isEnabled = true

                    if (!reachable) {
                        errorText.text = getString(R.string.domain_setup_error_unreachable)
                        errorText.visibility = TextView.VISIBLE
                        return@runOnUiThread
                    }

                    DomainPrefs.setDomain(this, domain)

                    val intent = Intent(this, MainActivity::class.java)
                    intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP
                    startActivity(intent)
                    finish()
                }
            }.start()
        }
    }

    private fun isDomainReachable(domain: String): Boolean {
        return try {
            val connection = URL("https://$domain").openConnection() as HttpURLConnection
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.requestMethod = "HEAD"
            connection.instanceFollowRedirects = true
            val code = connection.responseCode
            connection.disconnect()
            code in 200..399
        } catch (e: Exception) {
            false
        }
    }
}
