package it.mccoy88f.barmanager.kiosk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Avvia automaticamente l'app BarManager Kiosk al boot del dispositivo
 * (accensione del TV Box o alimentazione ripristinata).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (Intent.ACTION_BOOT_COMPLETED == action ||
            "android.intent.action.QUICKBOOT_POWERON" == action ||
            "com.htc.intent.action.QUICKBOOT_POWERON" == action
        ) {
            val launchIntent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(launchIntent)
        }
    }
}

