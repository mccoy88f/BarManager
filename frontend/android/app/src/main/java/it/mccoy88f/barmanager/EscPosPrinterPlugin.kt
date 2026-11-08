package it.mccoy88f.barmanager

import android.util.Log
import com.dantsu.escposprinter.EscPosPrinter
import com.dantsu.escposprinter.connection.tcp.TcpConnection
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

/**
 * Stampa diretta ESC/POS via socket TCP (§5.11 di docs/DEVELOPMENT.md),
 * usando DantSu/ESCPOS-ThermalPrinter-Android (MIT).
 *
 * Chiamata JS attesa: Escpos.print({ host, port, sections }).
 * Risolve a stampa avvenuta e disconnette il socket; rifiuta con messaggio
 * dettagliato se la stampante non risponde o la porta è chiusa.
 */
@CapacitorPlugin(name = "Escpos")
class EscPosPrinterPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    // 203 dpi, 80mm, 46 caratteri per riga: valori tipici per stampanti a rullo 80mm
    private val dpi = 203
    private val widthMM = 80f
    private val charactersPerLine = 46

    @PluginMethod
    fun print(call: PluginCall) {
        val host = call.getString("host")?.trim()
        val port = call.getInt("port", 9100) ?: 9100
        val sectionsArray = call.getArray("sections")

        if (host.isNullOrBlank() || sectionsArray == null) {
            call.reject("Parametri mancanti: host e sections sono obbligatori.")
            return
        }

        val sections = try {
            (0 until sectionsArray.length())
                .map { sectionsArray.getJSONObject(it) }
                .map { ReceiptSection.fromJson(it) }
        } catch (e: Exception) {
            call.reject("Dati documento non validi: ${e.message}", e)
            return
        }

        Log.i("EscPosPrinter", "Avvio stampa su $host:$port (${sections.size} sezioni)")

        executor.execute {
            var connection: TcpConnection? = null
            try {
                // Timeout di connessione a 5000 ms (5s), superando il bug del costruttore a 2 parametri
                // di DantSu che imposta erroneamente 30 ms come timeout socket.
                connection = TcpConnection(host, port, 5000)
                val printer = EscPosPrinter(connection, dpi, widthMM, charactersPerLine)
                val markup = sections.joinToString("") { it.toDantSuMarkup() }
                printer.printFormattedTextAndCut(markup)
                Log.i("EscPosPrinter", "Stampa completata con successo su $host:$port")
                activity.runOnUiThread { call.resolve() }
            } catch (err: Exception) {
                Log.e("EscPosPrinter", "Errore durante la stampa su $host:$port", err)
                val detail = err.localizedMessage ?: err.message ?: err.javaClass.simpleName
                activity.runOnUiThread {
                    call.reject("Stampante non raggiungibile ($host:$port): $detail", err)
                }
            } finally {
                try {
                    connection?.disconnect()
                } catch (e: Exception) {
                    Log.w("EscPosPrinter", "Errore chiusura socket verso $host:$port", e)
                }
            }
        }
    }
}
