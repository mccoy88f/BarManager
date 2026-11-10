package it.mccoy88f.barmanager

import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.regex.Pattern

/**
 * Stampa scontrino fiscale RCH PRINT! F via web service HTTP.
 * POST `http://host:port/service.cgi` con body XML `<Service><cmd>…</cmd></Service>`
 * (protocollo RCH Standard, come epson-fiscal-printer / RCHXmlHttpClient).
 *
 * Chiamata JS: RchFiscal.print({ host, port, payload }).
 * `payload` è l'XML già composto dal backend; `port` tipica 80.
 */
@CapacitorPlugin(name = "RchFiscal")
class RchFiscalPrinterPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private val maxAttempts = 3
    private val retryDelayMs = 2000L
    private val connectTimeoutMs = 5000
    private val readTimeoutMs = 15000

    @PluginMethod
    fun print(call: PluginCall) {
        val host = call.getString("host")?.trim()
        val port = call.getInt("port", 80) ?: 80
        val payload = call.getString("payload")

        if (host.isNullOrBlank() || payload.isNullOrBlank()) {
            call.reject("Parametri mancanti: host e payload sono obbligatori.")
            return
        }

        val url = "http://$host:$port/service.cgi"
        Log.i("RchFiscal", "Avvio stampa fiscale su $url (${payload.length} byte XML)")

        executor.execute {
            var lastError: Exception? = null
            for (attempt in 1..maxAttempts) {
                try {
                    val result = postXml(url, payload)
                    if (result.busy && attempt < maxAttempts) {
                        Log.w("RchFiscal", "Cassa occupata (tentativo $attempt/$maxAttempts), riprovo…")
                        Thread.sleep(retryDelayMs)
                        continue
                    }
                    if (!result.ok) {
                        throw Exception(result.message)
                    }
                    Log.i("RchFiscal", "Stampa fiscale OK su $url (tentativo $attempt): ${result.message}")
                    call.resolve()
                    return@execute
                } catch (err: Exception) {
                    lastError = err
                    Log.w("RchFiscal", "Tentativo $attempt/$maxAttempts fallito su $url", err)
                    if (attempt < maxAttempts) {
                        try {
                            Thread.sleep(retryDelayMs)
                        } catch (_: InterruptedException) {
                        }
                    }
                }
            }
            val detail = lastError?.localizedMessage ?: lastError?.message ?: "errore sconosciuto"
            call.reject("Stampante fiscale non raggiungibile ($url): $detail", lastError)
        }
    }

    private data class FiscalHttpResult(
        val ok: Boolean,
        val busy: Boolean,
        val message: String,
    )

    private fun postXml(url: String, xml: String): FiscalHttpResult {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            doOutput = true
            doInput = true
            setRequestProperty("Content-Type", "application/xml; charset=utf-8")
            setRequestProperty("Accept", "application/xml, text/xml, */*")
            instanceFollowRedirects = false
        }
        try {
            OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { writer ->
                writer.write(xml)
                writer.flush()
            }
            val httpCode = conn.responseCode
            val stream = if (httpCode in 200..299) conn.inputStream else conn.errorStream
            val body = if (stream != null) {
                BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { it.readText() }
            } else {
                ""
            }
            if (httpCode !in 200..299) {
                return FiscalHttpResult(
                    ok = false,
                    busy = false,
                    message = "HTTP $httpCode${if (body.isNotBlank()) ": ${body.take(200)}" else ""}",
                )
            }
            return parseServiceResponse(body)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Risposta tipica:
     * <Service><Request>
     *   <errorCode>0</errorCode><printerError>0</printerError>
     *   <paperEnd>0</paperEnd><coverOpen>0</coverOpen>
     *   <lastCmd>…</lastCmd><busy>0</busy>
     * </Request></Service>
     */
    private fun parseServiceResponse(body: String): FiscalHttpResult {
        val errorCode = xmlTag(body, "errorCode") ?: "?"
        val printerError = xmlTag(body, "printerError") ?: "0"
        val paperEnd = xmlTag(body, "paperEnd") ?: "0"
        val coverOpen = xmlTag(body, "coverOpen") ?: "0"
        val busy = xmlTag(body, "busy") == "1"

        if (busy) {
            return FiscalHttpResult(ok = false, busy = true, message = "cassa occupata (busy=1)")
        }
        if (errorCode == "0" && printerError == "0") {
            val extras = buildList {
                if (paperEnd == "1") add("carta in esaurimento")
                if (coverOpen == "1") add("coperchio aperto")
            }
            val suffix = if (extras.isEmpty()) "" else " (${extras.joinToString(", ")})"
            return FiscalHttpResult(ok = true, busy = false, message = "errorCode=0$suffix")
        }
        return FiscalHttpResult(
            ok = false,
            busy = false,
            message = "errorCode=$errorCode printerError=$printerError paperEnd=$paperEnd coverOpen=$coverOpen",
        )
    }

    private fun xmlTag(xml: String, tag: String): String? {
        val pattern = Pattern.compile("<$tag>\\s*([^<]*?)\\s*</$tag>", Pattern.CASE_INSENSITIVE)
        val matcher = pattern.matcher(xml)
        return if (matcher.find()) matcher.group(1)?.trim() else null
    }
}
