package it.mccoy88f.barmanager.kiosk

import android.content.Context
import java.util.UUID

/**
 * Persistenza della configurazione del Kiosk su SharedPreferences.
 * Sopravvive al riavvio del dispositivo, permettendo all'app di
 * caricare direttamente lo schermo configurato senza ri-mostrare il codice.
 */
object KioskPrefs {
    private const val PREFS_NAME = "barmanager_kiosk_prefs"

    const val DEFAULT_SERVER_URL = "https://civico39it.bm.mccoy88f.link"

    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_PAIRING_CODE = "pairing_code"
    private const val KEY_SCREEN_ID = "screen_id"
    private const val KEY_SCREEN_NAME = "screen_name"
    private const val KEY_SCREEN_URL = "screen_url"

    fun normalize(input: String): String {
        var clean = input.trim().removePrefix("https://").removePrefix("http://").trimEnd('/')
        if (clean.isBlank()) return DEFAULT_SERVER_URL
        if (!clean.contains(".")) {
            clean = "$clean.bm.mccoy88f.link"
        }
        return "https://$clean"
    }

    fun getServerUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SERVER_URL, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER_URL
    }

    fun setServerUrl(context: Context, url: String) {
        val normalized = normalize(url)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_SERVER_URL, normalized).apply()
    }

    fun getDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var id = prefs.getString(KEY_DEVICE_ID, null)
        if (id.isNullOrBlank()) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun getPairingCode(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PAIRING_CODE, null)
    }

    fun setPairingCode(context: Context, code: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_PAIRING_CODE, code.uppercase()).apply()
    }

    fun getScreenId(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SCREEN_ID, null)
    }

    fun getScreenName(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SCREEN_NAME, null)
    }

    fun getScreenUrl(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SCREEN_URL, null)
    }

    fun isPaired(context: Context): Boolean {
        return !getScreenUrl(context).isNullOrBlank()
    }

    fun savePairing(context: Context, screenId: String, screenName: String?, screenUrl: String, code: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_SCREEN_ID, screenId)
            .putString(KEY_SCREEN_NAME, screenName)
            .putString(KEY_SCREEN_URL, screenUrl)
            .putString(KEY_PAIRING_CODE, code.uppercase())
            .apply()
    }

    fun clearPairing(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .remove(KEY_SCREEN_ID)
            .remove(KEY_SCREEN_NAME)
            .remove(KEY_SCREEN_URL)
            .apply()
    }
}

