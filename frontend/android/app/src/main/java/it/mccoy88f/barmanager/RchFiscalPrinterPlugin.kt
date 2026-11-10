package it.mccoy88f.barmanager

import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.charset.Charset
import java.util.concurrent.Executors

/**
 * Stampa scontrino fiscale RCH PRINT! F via TCP raw (XON/XOFF LAN).
 * Apre il socket solo per l'invio, poi chiude subito (coesistenza con Loyverse).
 *
 * Chiamata JS: RchFiscal.print({ host, port, payload }).
 */
@CapacitorPlugin(name = "RchFiscal")
class RchFiscalPrinterPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private val maxAttempts = 3
    private val retryDelayMs = 2000L
    private val connectTimeoutMs = 3000
    private val soTimeoutMs = 3000

    @PluginMethod
    fun print(call: PluginCall) {
        val host = call.getString("host")?.trim()
        val port = call.getInt("port", 9100) ?: 9100
        val payload = call.getString("payload")

        if (host.isNullOrBlank() || payload.isNullOrBlank()) {
            call.reject("Parametri mancanti: host e payload sono obbligatori.")
            return
        }

        Log.i("RchFiscal", "Avvio stampa fiscale su $host:$port (${payload.length} byte payload)")

        executor.execute {
            var lastError: Exception? = null
            for (attempt in 1..maxAttempts) {
                try {
                    sendPayload(host, port, payload)
                    Log.i("RchFiscal", "Stampa fiscale inviata su $host:$port (tentativo $attempt)")
                    call.resolve()
                    return@execute
                } catch (err: Exception) {
                    lastError = err
                    Log.w("RchFiscal", "Tentativo $attempt/$maxAttempts fallito su $host:$port", err)
                    if (attempt < maxAttempts) {
                        try {
                            Thread.sleep(retryDelayMs)
                        } catch (_: InterruptedException) {
                        }
                    }
                }
            }
            val detail = lastError?.localizedMessage ?: lastError?.message ?: "errore sconosciuto"
            call.reject("Registratore RCH non raggiungibile ($host:$port): $detail", lastError)
        }
    }

    private fun sendPayload(host: String, port: Int, payload: String) {
        val socket = Socket()
        try {
            socket.soTimeout = soTimeoutMs
            socket.connect(InetSocketAddress(host, port), connectTimeoutMs)
            val out: OutputStream = socket.getOutputStream()
            // ASCII/ISO-8859-1: il dialetto XON/XOFF RCH non usa UTF-8 multibyte.
            out.write(payload.toByteArray(Charset.forName("ISO-8859-1")))
            out.flush()
            // Breve attesa per far scaricare il buffer verso la cassa prima della close.
            try {
                Thread.sleep(300)
            } catch (_: InterruptedException) {
            }
        } finally {
            try {
                socket.close()
            } catch (e: Exception) {
                Log.w("RchFiscal", "Errore chiusura socket verso $host:$port", e)
            }
        }
    }
}
