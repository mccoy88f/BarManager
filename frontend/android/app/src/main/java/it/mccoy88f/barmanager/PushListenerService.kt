package it.mccoy88f.barmanager

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Ascolto continuo sull'APK. La WebView non riceve le push del browser:
 * questo servizio resta attivo anche a schermo spento e legge la stessa
 * coda del sito, svegliandosi appena il server ha un evento.
 */
class PushListenerService : Service() {
    private var loop: Thread? = null

    @Volatile private var running = false
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!NativePushRuntime.canPostNotifications(this) || !NativePushRuntime.isEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            val notification = NativePushRuntime.listeningNotification(this)
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NativePushRuntime.LISTENING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NativePushRuntime.LISTENING_ID, notification)
            }
        } catch (_: Exception) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!running) {
            running = true
            acquireWakeLock()
            loop = Thread({ runLoop() }, "barmanager-push").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        loop?.interrupt()
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun acquireWakeLock() {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BarManager:push").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun runLoop() {
        val client = insecureClient()
        val prefs = getSharedPreferences(NativePushRuntime.PREFS, MODE_PRIVATE)
        while (running) {
            val base = prefs.getString(NativePushRuntime.KEY_BASE, null)
            val token = prefs.getString(NativePushRuntime.KEY_TOKEN, null)
            val since = prefs.getString(NativePushRuntime.KEY_SINCE, null) ?: NativePushRuntime.nowIso()
            if (base.isNullOrBlank() || token.isNullOrBlank()) {
                sleepQuiet(5_000)
                continue
            }
            try {
                val url = "$base/api/push/feed?wait=25&since=" + URLEncoder.encode(since, "UTF-8")
                val request = Request.Builder()
                    .url(url)
                    .header("X-Device-Token", token)
                    .header("Accept", "application/json")
                    .build()
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        sleepQuiet(if (response.code == 401) 60_000 else 5_000)
                        return@use
                    }
                    val json = JSONObject(response.body?.string().orEmpty())
                    val now = json.optString("now", since)
                    val events = json.optJSONArray("events")
                    if (events != null) {
                        for (i in 0 until events.length()) {
                            val event = events.getJSONObject(i)
                            NativePushRuntime.showAlert(
                                this,
                                event.optString("id", "$i"),
                                event.optString("title", "BarManager"),
                                event.optString("body", ""),
                                event.optString("url", "/"),
                            )
                        }
                    }
                    prefs.edit().putString(NativePushRuntime.KEY_SINCE, now).apply()
                }
            } catch (_: Exception) {
                sleepQuiet(5_000)
            }
        }
    }

    private fun sleepQuiet(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (_: InterruptedException) {
            running = false
        }
    }

    /**
     * Stesso trattamento dei certificati già usato dalla WebView e dagli
     * aggiornamenti APK: i tablet Android 7 non riconoscono la radice
     * Let's Encrypt attuale e altrimenti non raggiungerebbero il sito.
     */
    private fun insecureClient(): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(40, TimeUnit.SECONDS)
            .callTimeout(45, TimeUnit.SECONDS)
        try {
            val trustAll = arrayOf<TrustManager>(@SuppressLint("CustomX509TrustManager") object : X509TrustManager {
                @SuppressLint("TrustAllX509TrustManager")
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                @SuppressLint("TrustAllX509TrustManager")
                override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            })
            val ssl = SSLContext.getInstance("TLS")
            ssl.init(null, trustAll, SecureRandom())
            builder.sslSocketFactory(ssl.socketFactory, trustAll[0] as X509TrustManager)
            builder.hostnameVerifier { _, _ -> true }
        } catch (_: Exception) {
        }
        return builder.build()
    }

    companion object {
        fun start(context: Context) {
            val intent = Intent(context, PushListenerService::class.java)
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (_: Exception) {
            }
        }

        fun startIfConfigured(context: Context) {
            if (NativePushRuntime.isEnabled(context)) start(context)
        }
    }
}
