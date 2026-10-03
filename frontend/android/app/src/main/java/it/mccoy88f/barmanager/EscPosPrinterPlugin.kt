package it.mccoy88f.barmanager

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.dantsu.escposprinter.EscPosPrinter
import com.dantsu.escposprinter.connection.tcp.TcpConnection
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

/**
 * Stampa diretta ESC/POS via socket TCP (§5.11 di docs/DEVELOPMENT.md),
 * usando DantSu/ESCPOS-ThermalPrinter-Android (MIT) invece di un encoder
 * scritto ad-hoc — scelta esplicita dell'utente per lasciare a una
 * libreria matura la codifica dei caratteri accentati italiani.
 *
 * Chiamata JS attesa: Escpos.print({ host, port, sections }), dove
 * "sections" è lo stesso array ReceiptSection[] già usato lato backend
 * per generare i PDF (v. ReceiptSection.kt). Risolve a stampa avvenuta,
 * rifiuta con un messaggio comprensibile se manca la rete o la stampante
 * non risponde — mai un fallimento silenzioso, a differenza di
 * window.print() nel browser (v. §9.2 di docs/DEVELOPMENT.md).
 */
@CapacitorPlugin(name = "Escpos")
class EscPosPrinterPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    // 203 dpi, 80mm, 46 caratteri per riga: valori tipici per stampanti a
    // rullo 80mm con font normale — DA VERIFICARE contro una stampante
    // reale (modelli diversi possono richiedere un valore diverso).
    private val dpi = 203
    private val widthMM = 80f
    private val charactersPerLine = 46

    @PluginMethod
    fun print(call: PluginCall) {
        val host = call.getString("host")
        val port = call.getInt("port", 9100) ?: 9100
        val sectionsArray = call.getArray("sections")

        if (host.isNullOrBlank() || sectionsArray == null) {
            call.reject("Parametri mancanti: host e sections sono obbligatori.")
            return
        }
        if (!hasActiveNetwork()) {
            call.reject("Stampa non riuscita: nessuna connessione di rete attiva.")
            return
        }

        val sections = (0 until sectionsArray.length())
            .map { sectionsArray.getJSONObject(it) }
            .map { ReceiptSection.fromJson(it) }

        executor.execute {
            try {
                val connection = TcpConnection(host, port)
                val printer = EscPosPrinter(connection, dpi, widthMM, charactersPerLine)
                val markup = sections.joinToString("") { it.toDantSuMarkup() }
                printer.printFormattedTextAndCut(markup)
                activity.runOnUiThread { call.resolve() }
            } catch (err: Exception) {
                activity.runOnUiThread {
                    call.reject("Stampante non raggiungibile (${host}:${port}): verifica che sia accesa e collegata alla rete.", err)
                }
            }
        }
    }

    private fun hasActiveNetwork(): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
