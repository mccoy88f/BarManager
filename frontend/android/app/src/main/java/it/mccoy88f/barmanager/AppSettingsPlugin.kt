package it.mccoy88f.barmanager

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Ponte JS -> nativo per la configurazione del dominio (§5.11 di
 * docs/DEVELOPMENT.md): la pagina web "Impostazioni" mostra un pulsante
 * "Cambia dominio app" solo quando gira dentro l'app nativa
 * (Capacitor.isNativePlatform()), che chiama getDomain()/openDomainSettings()
 * invece di avere un proprio form — niente menu nativo separato da
 * mantenere, la UI resta tutta nella pagina web già esistente.
 */
@CapacitorPlugin(name = "AppSettings")
class AppSettingsPlugin : Plugin() {
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
}
