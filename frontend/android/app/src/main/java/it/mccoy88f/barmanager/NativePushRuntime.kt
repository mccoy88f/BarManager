package it.mccoy88f.barmanager

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Canali, preferenze e costruzione delle notifiche usate dal servizio in ascolto. */
object NativePushRuntime {
    const val EXTRA_PATH = "barmanager_push_path"
    const val PERMISSION_REQUEST = 4101
    const val PREFS = "barmanager_push"
    const val KEY_SINCE = "since"
    const val KEY_BASE = "api_base"
    const val KEY_TOKEN = "token"
    const val KEY_ENABLED = "enabled"
    const val LISTENING_ID = 1001
    private const val KEY_OPEN_PATH = "open_path"
    const val ALERT_CHANNEL_ID = "barmanager_push"
    private const val LISTENING_CHANNEL_ID = "barmanager_push_listener"

    fun enable(context: Context, base: String, deviceToken: String) {
        val app = context.applicationContext
        ensureChannels(app)
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_BASE, base.trimEnd('/'))
            .putString(KEY_TOKEN, deviceToken)
            .putBoolean(KEY_ENABLED, true)
            .apply()
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains(KEY_SINCE)) {
            prefs.edit().putString(KEY_SINCE, nowIso()).apply()
        }
        PushListenerService.start(app)
    }

    fun isEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_ENABLED, false) &&
            !prefs.getString(KEY_BASE, null).isNullOrBlank() &&
            !prefs.getString(KEY_TOKEN, null).isNullOrBlank()
    }

    fun nowIso(): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date())
    }

    fun storeOpenPath(context: Context, intent: Intent?) {
        val path = intent?.getStringExtra(EXTRA_PATH) ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_OPEN_PATH, path)
            .apply()
    }

    fun consumeOpenPath(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val path = prefs.getString(KEY_OPEN_PATH, null)
        if (path != null) prefs.edit().remove(KEY_OPEN_PATH).apply()
        return path
    }

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(ALERT_CHANNEL_ID, "Avvisi BarManager", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Prenotazioni, ordini, aggiornamenti e richieste di permesso"
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(LISTENING_CHANNEL_ID, "Ascolto notifiche", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Tiene l'app in ascolto anche a schermo spento"
                setShowBadge(false)
            },
        )
    }

    fun listeningNotification(context: Context): Notification {
        ensureChannels(context)
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, LISTENING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_barmanager)
            .setContentTitle("BarManager in ascolto")
            .setContentText("Prenotazioni, ordini e richieste arrivano anche a schermo spento")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .build()
    }

    fun canPostNotifications(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    fun showAlert(context: Context, id: String, title: String, body: String, url: String) {
        if (!canPostNotifications(context)) return
        ensureChannels(context)
        val launch = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_PATH, url)
        }
        val pending = PendingIntent.getActivity(
            context,
            id.hashCode(),
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_barmanager)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val notifyId = if (id.hashCode() == LISTENING_ID) id.hashCode() + 1 else id.hashCode()
        manager.notify(notifyId, notification)
    }
}
