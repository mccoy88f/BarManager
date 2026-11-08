package it.mccoy88f.barmanager

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Ponte JS → notifiche di sistema dell'APK. */
@CapacitorPlugin(name = "NativePush")
class NativePushPlugin : Plugin() {
    @PluginMethod
    fun start(call: PluginCall) {
        val apiBase = call.getString("apiBase")
        val token = call.getString("token")
        if (apiBase.isNullOrBlank() || token.isNullOrBlank()) {
            call.reject("apiBase e token sono obbligatori")
            return
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            activity != null
        ) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                4101,
            )
        }
        NativePushRuntime.enable(context, apiBase, token)
        val result = JSObject()
        result.put("started", true)
        call.resolve(result)
    }

    @PluginMethod
    fun consumePath(call: PluginCall) {
        val result = JSObject()
        result.put("path", NativePushRuntime.consumeOpenPath(context))
        call.resolve(result)
    }
}
