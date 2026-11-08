package it.mccoy88f.barmanager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Dopo un riavvio del tablet l'ascolto riparte da solo, senza riaprire l'app. */
class PushBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        PushListenerService.startIfConfigured(context)
    }
}
