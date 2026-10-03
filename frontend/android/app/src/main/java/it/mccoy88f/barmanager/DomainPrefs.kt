package it.mccoy88f.barmanager

import android.content.Context

/**
 * Dominio del locale (es. "demo.bm.mccoy88f.link") a cui l'app carica la
 * WebView — vive fuori dalla WebView, in SharedPreferences native, non nel
 * localStorage della pagina web: deve esistere prima ancora che una
 * pagina venga caricata (§5.11 di docs/DEVELOPMENT.md).
 */
object DomainPrefs {
    private const val PREFS_NAME = "barmanager_settings"
    private const val KEY_DOMAIN = "domain"

    fun getDomain(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_DOMAIN, null)
    }

    fun setDomain(context: Context, domain: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_DOMAIN, domain).apply()
    }

    /** Ripulisce un input utente: niente "https://", niente slash finale, niente spazi. */
    fun normalize(input: String): String {
        return input.trim().removePrefix("https://").removePrefix("http://").trimEnd('/')
    }
}
