package it.mccoy88f.barmanager.kiosk

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

data class UpdateInfo(
    val tagName: String,
    val downloadUrl: String,
    val apkName: String,
    val sizeBytes: Long,
    val releaseNotes: String?,
)

object UpdateManager {

    private const val GITHUB_REPO = "mccoy88f/BarManager"
    private const val GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/$GITHUB_REPO/releases/latest"

    private val client: OkHttpClient by lazy {
        val builder = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)

        try {
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
            builder.hostnameVerifier { _, _ -> true }
        } catch (_: Exception) {}

        builder.build()
    }

    /**
     * Confronta la versione corrente con l'ultima disponibile su GitHub Releases.
     * Ritorna UpdateInfo se c'è una versione più recente con l'APK del Kiosk, oppure null.
     */
    suspend fun checkForUpdate(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(GITHUB_LATEST_RELEASE_URL)
            .header("User-Agent", "BarManager-Kiosk")
            .header("Accept", "application/vnd.github.v3+json")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            return@withContext null
        }

        val jsonStr = response.body?.string() ?: return@withContext null
        val root = JSONObject(jsonStr)

        val tagName = root.optString("tag_name", "").trim()
        if (tagName.isBlank()) return@withContext null

        val currentVersion = SystemInfo.getAppVersion(context)
        if (!isNewerVersion(tagName, currentVersion)) {
            return@withContext null
        }

        val assets = root.optJSONArray("assets") ?: return@withContext null
        var kioskApkUrl: String? = null
        var kioskApkName: String? = null
        var kioskApkSize = 0L

        for (i in 0 until assets.length()) {
            val asset = assets.getJSONObject(i)
            val name = asset.optString("name", "")
            if (name.startsWith("BarManager-Kiosk", ignoreCase = true) && name.endsWith(".apk", ignoreCase = true)) {
                kioskApkName = name
                kioskApkUrl = asset.optString("browser_download_url", "")
                kioskApkSize = asset.optLong("size", 0L)
                break
            }
        }

        if (kioskApkUrl.isNullOrBlank()) {
            return@withContext null
        }

        val body = root.optString("body", "").takeIf { it.isNotBlank() }

        UpdateInfo(
            tagName = tagName,
            downloadUrl = kioskApkUrl,
            apkName = kioskApkName ?: "BarManager-Kiosk-$tagName.apk",
            sizeBytes = kioskApkSize,
            releaseNotes = body
        )
    }

    fun isNewerVersion(latestTag: String, currentVersion: String): Boolean {
        val cleanLatest = latestTag.trim().removePrefix("v").trim()
        val cleanCurrent = currentVersion.trim().removePrefix("v").trim()
        if (cleanLatest == cleanCurrent) return false
        if (cleanCurrent.isBlank() || cleanCurrent == "1.0" || cleanCurrent == "1.0.0") {
            return true
        }

        fun parseVer(v: String): List<Int> {
            return v.split('.', '-').mapNotNull { it.toIntOrNull() }
        }

        val vLatest = parseVer(cleanLatest)
        val vCurrent = parseVer(cleanCurrent)

        if (vLatest.isNotEmpty() && vCurrent.isNotEmpty()) {
            val maxLen = maxOf(vLatest.size, vCurrent.size)
            for (i in 0 until maxLen) {
                val l = vLatest.getOrElse(i) { 0 }
                val c = vCurrent.getOrElse(i) { 0 }
                if (l > c) return true
                if (l < c) return false
            }
        }
        return cleanLatest != cleanCurrent
    }

    suspend fun downloadApk(
        context: Context,
        downloadUrl: String,
        onProgress: (percent: Int, downloadedMb: Double, totalMb: Double) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.cacheDir
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, "BarManager-Kiosk-update.apk")
        if (file.exists()) file.delete()

        val request = Request.Builder()
            .url(downloadUrl)
            .header("User-Agent", "BarManager-Kiosk")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw IOException("Errore download: codice HTTP ${response.code}")
        }
        val body = response.body ?: throw IOException("Risposta vuota dal server")
        val totalBytes = body.contentLength()

        body.byteStream().use { input ->
            FileOutputStream(file).use { output ->
                val buffer = ByteArray(8192)
                var downloadedBytes = 0L
                var read: Int
                var lastReportTime = 0L

                while (input.read(buffer).also { read = it } != -1) {
                    output.write(buffer, 0, read)
                    downloadedBytes += read

                    val now = System.currentTimeMillis()
                    if (now - lastReportTime > 200 || downloadedBytes == totalBytes) {
                        lastReportTime = now
                        val percent = if (totalBytes > 0) ((downloadedBytes * 100) / totalBytes).toInt() else 0
                        val downMb = downloadedBytes / (1024.0 * 1024.0)
                        val totMb = if (totalBytes > 0) totalBytes / (1024.0 * 1024.0) else 0.0
                        withContext(Dispatchers.Main) {
                            onProgress(percent, downMb, totMb)
                        }
                    }
                }
                output.flush()
            }
        }
        file
    }

    fun installApk(activity: Activity, apkFile: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.packageManager.canRequestPackageInstalls()) {
                Toast.makeText(
                    activity,
                    "Abilita 'Consenti da questa fonte' per completare l'installazione",
                    Toast.LENGTH_LONG
                ).show()
                val intent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
                activity.startActivity(intent)
                return
            }
        }

        val uri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                apkFile
            )
        } else {
            Uri.fromFile(apkFile)
        }

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
        }
        activity.startActivity(intent)
    }
}
