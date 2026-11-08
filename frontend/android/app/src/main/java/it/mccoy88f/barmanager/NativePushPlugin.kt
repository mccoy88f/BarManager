package it.mccoy88f.barmanager

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/** Ponte JS → notifiche, fotocamera e posizione dell'APK. */
@CapacitorPlugin(
    name = "NativePush",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
        Permission(
            strings = [
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION,
            ],
            alias = "location",
        ),
    ],
)
class NativePushPlugin : Plugin() {
    @PluginMethod
    fun start(call: PluginCall) {
        val apiBase = call.getString("apiBase")
        val token = call.getString("token")
        if (apiBase.isNullOrBlank() || token.isNullOrBlank()) {
            call.reject("apiBase e token sono obbligatori")
            return
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

    @PluginMethod
    fun permissionStatus(call: PluginCall) {
        call.resolve(currentStates())
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33) {
            val result = JSObject()
            result.put("notifications", "granted")
            call.resolve(result)
            return
        }
        requestPermissionForAlias("notifications", call, "notificationResult")
    }

    @PluginMethod
    fun requestDevicePermissions(call: PluginCall) {
        val aliases = mutableListOf("camera", "location")
        if (Build.VERSION.SDK_INT >= 33) aliases.add("notifications")
        requestPermissionForAliases(aliases.toTypedArray(), call, "devicePermissionResult")
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        call.resolve()
    }

    @PermissionCallback
    private fun notificationResult(call: PluginCall) {
        val result = JSObject()
        result.put("notifications", getPermissionState("notifications").toString())
        call.resolve(result)
    }

    @PermissionCallback
    private fun devicePermissionResult(call: PluginCall) {
        call.resolve(currentStates())
    }

    private fun currentStates(): JSObject {
        val result = JSObject()
        result.put(
            "notifications",
            if (Build.VERSION.SDK_INT < 33) "granted" else getPermissionState("notifications").toString(),
        )
        result.put("camera", getPermissionState("camera").toString())
        result.put("location", getPermissionState("location").toString())
        return result
    }
}
