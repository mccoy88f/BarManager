package it.mccoy88f.barmanager

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Schermata nativa di configurazione del dominio (§5.11 di
 * docs/DEVELOPMENT.md): mostrata obbligatoriamente al primo avvio (se
 * nessun dominio è salvato) e raggiungibile in qualsiasi altro momento da
 * un pulsante nella pagina web "Impostazioni" (quando l'app gira dentro
 * BarManager nativo), tramite AppSettingsPlugin.openDomainSettings().
 */
class DomainSetupActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_domain_setup)

        val domainInput = findViewById<EditText>(R.id.domainInput)
        val errorText = findViewById<TextView>(R.id.errorText)
        val saveButton = findViewById<Button>(R.id.saveButton)

        DomainPrefs.getDomain(this)?.let { domainInput.setText(it) }

        saveButton.setOnClickListener {
            val domain = DomainPrefs.normalize(domainInput.text.toString())
            if (domain.isEmpty()) {
                errorText.text = getString(R.string.domain_setup_error_empty)
                errorText.visibility = TextView.VISIBLE
                return@setOnClickListener
            }

            DomainPrefs.setDomain(this, domain)

            val intent = Intent(this, MainActivity::class.java)
            intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP
            startActivity(intent)
            finish()
        }
    }
}
