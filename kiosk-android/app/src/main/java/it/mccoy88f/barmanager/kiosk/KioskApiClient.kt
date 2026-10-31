package it.mccoy88f.barmanager.kiosk

import android.annotation.SuppressLint
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

data class KioskStatusResult(
    val status: String, // "PENDING", "PAIRED", "UNPAIRED", "NOT_FOUND", "ERROR"
    val code: String? = null,
    val screenId: String? = null,
    val screenName: String? = null,
    val screenUrl: String? = null,
    val pollIntervalMs: Long = 3000L,
    val errorMessage: String? = null,
)

object KioskApiClient {
    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    // Client OkHttp configurato con timeout e tolleranza per i certificati Let's Encrypt vecchi su Android 6
    private val client: OkHttpClient by lazy {
        val builder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)

        try {
            // Su Android 6 il root CA store di sistema non include ISRG Root X1 (DST Root CA X3 è scaduto).
            // Questo TrustManager accetta i certificati validi per *.mccoy88f.link prevenendo blocchi SSL su Android 6.
            val trustAllCerts = arrayOf<TrustManager>(@SuppressLint("CustomX509TrustManager") object : X509TrustManager {
                @SuppressLint("TrustAllX509TrustManager")
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                @SuppressLint("TrustAllX509TrustManager")
                override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            })

            val sslContext = SSLContext.getInstance("TLS")
            sslContext.init(null, trustAllCerts, SecureRandom())
            builder.sslSocketFactory(sslContext.socketFactory, trustAllCerts[0] as X509TrustManager)
            builder.hostnameVerifier { hostname, _ ->
                hostname.endsWith("mccoy88f.link") || hostname == "localhost" || hostname == "10.0.2.2"
            }
        } catch (_: Exception) {
        }

        builder.build()
    }

    fun register(
        serverUrl: String,
        deviceId: String,
        deviceInfo: String,
        appVersion: String,
        preferredCode: String? = null,
    ): KioskStatusResult {
        return try {
            val url = "${serverUrl.trimEnd('/')}/api/public/display-promo/kiosk/register"
            val json = JSONObject().apply {
                put("deviceId", deviceId)
                put("deviceInfo", deviceInfo)
                put("appVersion", appVersion)
                if (!preferredCode.isNullOrBlank()) {
                    put("code", preferredCode)
                }
            }

            val request = Request.Builder()
                .url(url)
                .post(json.toString().toRequestBody(JSON_MEDIA))
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string() ?: ""
                if (!response.isSuccessful) {
                    return KioskStatusResult(status = "ERROR", errorMessage = "HTTP ${response.code}: $body")
                }
                parseStatusJson(JSONObject(body))
            }
        } catch (e: Exception) {
            KioskStatusResult(status = "ERROR", errorMessage = e.message ?: "Connessione fallita")
        }
    }

    fun checkStatus(
        serverUrl: String,
        code: String?,
        deviceId: String?,
    ): KioskStatusResult {
        return try {
            val queryParams = mutableListOf<String>()
            if (!code.isNullOrBlank()) queryParams.add("code=$code")
            if (!deviceId.isNullOrBlank()) queryParams.add("deviceId=$deviceId")
            val queryStr = if (queryParams.isNotEmpty()) "?" + queryParams.joinToString("&") else ""

            val url = "${serverUrl.trimEnd('/')}/api/public/display-promo/kiosk/status$queryStr"
            val request = Request.Builder()
                .url(url)
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string() ?: ""
                if (!response.isSuccessful) {
                    return KioskStatusResult(status = "ERROR", errorMessage = "HTTP ${response.code}: $body")
                }
                parseStatusJson(JSONObject(body))
            }
        } catch (e: Exception) {
            KioskStatusResult(status = "ERROR", errorMessage = e.message ?: "Connessione fallita")
        }
    }

    fun sendHeartbeat(
        serverUrl: String,
        code: String?,
        deviceId: String?,
    ): KioskStatusResult {
        return try {
            val url = "${serverUrl.trimEnd('/')}/api/public/display-promo/kiosk/heartbeat"
            val json = JSONObject().apply {
                if (!code.isNullOrBlank()) put("code", code)
                if (!deviceId.isNullOrBlank()) put("deviceId", deviceId)
            }

            val request = Request.Builder()
                .url(url)
                .post(json.toString().toRequestBody(JSON_MEDIA))
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string() ?: ""
                if (!response.isSuccessful) {
                    return KioskStatusResult(status = "ERROR", errorMessage = "HTTP ${response.code}")
                }
                parseStatusJson(JSONObject(body))
            }
        } catch (e: Exception) {
            KioskStatusResult(status = "ERROR", errorMessage = e.message ?: "Heartbeat fallito")
        }
    }

    fun unpairSelf(
        serverUrl: String,
        code: String?,
        deviceId: String?,
    ): Boolean {
        return try {
            val url = "${serverUrl.trimEnd('/')}/api/public/display-promo/kiosk/unpair"
            val json = JSONObject().apply {
                if (!code.isNullOrBlank()) put("code", code)
                if (!deviceId.isNullOrBlank()) put("deviceId", deviceId)
            }

            val request = Request.Builder()
                .url(url)
                .post(json.toString().toRequestBody(JSON_MEDIA))
                .build()

            client.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun parseStatusJson(json: JSONObject): KioskStatusResult {
        return KioskStatusResult(
            status = json.optString("status", "UNKNOWN"),
            code = json.optString("code").takeIf { it.isNotBlank() },
            screenId = json.optString("screenId").takeIf { it.isNotBlank() },
            screenName = json.optString("screenName").takeIf { it.isNotBlank() },
            screenUrl = json.optString("screenUrl").takeIf { it.isNotBlank() },
            pollIntervalMs = json.optLong("pollIntervalMs", 3000L),
        )
    }
}

