package it.mccoy88f.barmanager

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Ponte JS -> nativo per la configurazione del dominio e gli aggiornamenti dell'app:
 * - getDomain() / openDomainSettings() per cambiare dominio
 * - getAppInfo() per versione installata e dominio
 * - checkForUpdate() per verificare release su GitHub
 * - downloadAndInstallUpdate() per scaricare l'APK di BarManager e lanciare l'installer di sistema
 */
@CapacitorPlugin(name = "AppSettings")
class AppSettingsPlugin : Plugin() {

    private val pluginScope = CoroutineScope(Dispatchers.Main)

    @PluginMethod
    fun getDomain(call: PluginCall) {
        val result = JSObject()
        result.put("domain", DomainPrefs.getDomain(context))
        call.resolve(result)
    }

    @PluginMethod
    fun openDomainSettings(call: PluginCall) {
        val intent = Intent(context, DomainSetupActivity::class.java)
        activity.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun getAppInfo(call: PluginCall) {
        val result = JSObject()
        val currentVersion = try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            pInfo.versionName ?: "1.0.0"
        } catch (_: Exception) {
            "1.0.0"
        }
        val currentCode = try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
        } catch (_: Exception) {
            1L
        }
        result.put("versionName", currentVersion)
        result.put("versionCode", currentCode)
        result.put("domain", DomainPrefs.getDomain(context))
        result.put("packageName", context.packageName)
        call.resolve(result)
    }

    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        pluginScope.launch {
            try {
                val currentVersion = try {
                    val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                    pInfo.versionName ?: "1.0.0"
                } catch (_: Exception) {
                    "1.0.0"
                }

                val updateInfo = UpdateManager.checkForUpdate(context)
                val result = JSObject()
                result.put("currentVersion", currentVersion)
                if (updateInfo != null) {
                    result.put("hasUpdate", true)
                    result.put("latestVersion", updateInfo.tagName)
                    result.put("downloadUrl", updateInfo.downloadUrl)
                    result.put("apkName", updateInfo.apkName)
                    result.put("sizeBytes", updateInfo.sizeBytes)
                    result.put("releaseNotes", updateInfo.releaseNotes ?: "")
                } else {
                    result.put("hasUpdate", false)
                    result.put("latestVersion", currentVersion)
                }
                call.resolve(result)
            } catch (e: Exception) {
                call.reject("Errore verifica aggiornamento: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun downloadAndInstallUpdate(call: PluginCall) {
        val downloadUrl = call.getString("downloadUrl")
        if (downloadUrl.isNullOrBlank()) {
            call.reject("URL di download non fornito")
            return
        }

        pluginScope.launch {
            try {
                val apkFile = UpdateManager.downloadApk(context, downloadUrl) { percent, downloadedMb, totalMb ->
                    val progressObj = JSObject()
                    progressObj.put("percent", percent)
                    progressObj.put("downloadedMb", downloadedMb)
                    progressObj.put("totalMb", totalMb)
                    notifyListeners("updateProgress", progressObj)
                }

                val act = activity
                if (act != null) {
                    UpdateManager.installApk(act, apkFile)
                    val result = JSObject()
                    result.put("success", true)
                    call.resolve(result)
                } else {
                    call.reject("Activity non disponibile per l'installazione")
                }
            } catch (e: Exception) {
                call.reject("Errore durante il download o l'installazione: ${e.message}", e)
            }
        }
    }
}
