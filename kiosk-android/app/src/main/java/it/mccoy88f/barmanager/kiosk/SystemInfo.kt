package it.mccoy88f.barmanager.kiosk

import android.content.Context
import android.os.Build
import java.net.NetworkInterface
import java.util.Collections

object SystemInfo {
    fun getDeviceInfo(): String {
        val manufacturer = Build.MANUFACTURER.capitalize()
        val model = Build.MODEL
        val androidVer = Build.VERSION.RELEASE
        val api = Build.VERSION.SDK_INT
        return "$manufacturer $model (Android $androidVer, API $api)"
    }

    fun getAppVersion(context: Context): String {
        return try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            pInfo.versionName ?: "1.0.0"
        } catch (_: Exception) {
            "1.0.0"
        }
    }

    fun getLocalIpAddress(): String? {
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (intf in interfaces) {
                if (intf.isLoopback || !intf.isUp) continue
                val addrs = Collections.list(intf.inetAddresses)
                for (addr in addrs) {
                    if (!addr.isLoopbackAddress) {
                        val host = addr.hostAddress ?: continue
                        // Seleziona IPv4
                        if (host.indexOf(':') < 0) {
                            return host
                        }
                    }
                }
            }
        } catch (_: Exception) {
        }
        return null
    }

    private fun String.capitalize(): String {
        return replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }
}

