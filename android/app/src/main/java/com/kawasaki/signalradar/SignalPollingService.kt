package com.kawasaki.signalradar

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL

class SignalPollingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollingJob: Job? = null
    private val prefs by lazy { getSharedPreferences("signal_radar_pro", MODE_PRIVATE) }
    private val manager by lazy { getSystemService(NOTIFICATION_SERVICE) as NotificationManager }

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForeground(1001, serviceNotification("กำลังเชื่อมต่อ Render · EUR/USD M1"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            prefs.edit().putBoolean("monitoring_enabled", false).apply()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!prefs.getBoolean("monitoring_enabled", false)) {
            prefs.edit().putBoolean("monitoring_enabled", true).apply()
        }
        if (pollingJob?.isActive != true) {
            pollingJob = scope.launch {
                while (isActive) {
                    pollOnce()
                    delay(1000)
                }
            }
        }
        return START_STICKY
    }

    private suspend fun pollOnce() {
        val base = (prefs.getString("server_url", DEFAULT_SERVER) ?: DEFAULT_SERVER).trim().trimEnd('/')
        if (!base.startsWith("https://")) {
            saveError("URL ไม่ถูกต้อง", "Server URL ต้องใช้ HTTPS")
            return
        }
        try {
            val json = URL("$base/api/market").openConnection().let { raw ->
                val conn = raw as HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.setRequestProperty("Accept", "application/json")
                try {
                    if (conn.responseCode !in 200..299) throw IllegalStateException("HTTP ${conn.responseCode}")
                    JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                } finally { conn.disconnect() }
            }
            val status = json.optString("status", "UNKNOWN")
            val signal = json.optString("signal", "STANDBY")
            val age = json.optLong("dataAgeMs", Long.MAX_VALUE)
            val candle = json.optString("candleTime", "unknown")
            val reason = json.optString("reason", "")
            val price = if (json.isNull("price")) "--" else json.optString("price")
            prefs.edit()
                .putString("connection", if (status == "ONLINE") "ONLINE" else status)
                .putString("signal", signal)
                .putString("reason", reason)
                .putString("price", price)
                .putLong("last_success_at", System.currentTimeMillis())
                .apply()
            manager.notify(1001, serviceNotification("ออนไลน์ · EUR/USD M1 · รอสัญญาณ"))
            if (age <= 150000L && json.optBoolean("signalWindowOpen", false) &&
                (signal == "CALL" || signal == "PUT")) {
                val key = "$candle:$signal"
                if (prefs.getString("last_notified_signal", "") != key) {
                    prefs.edit().putString("last_notified_signal", key).apply()
                    showSignalNotification(signal, price, reason, candle)
                }
            }
        } catch (error: Exception) {
            saveError("OFFLINE", error.message ?: "เชื่อมต่อ Server ไม่สำเร็จ")
        }
    }

    private fun showSignalNotification(signal: String, price: String, reason: String, candle: String) {
        val isCall = signal == "CALL"
        val accent = if (isCall) Color.rgb(23, 107, 67) else Color.rgb(152, 45, 59)
        val title = if (isCall) "CALL · EUR/USD" else "PUT · EUR/USD"
        val subtitle = if (isCall) "สัญญาณซื้อ · M1" else "สัญญาณขาย · M1"
        if (prefs.getBoolean("alert_sound_enabled", true)) playAlertTone()

        // Use a real colored custom notification card rather than relying only on
        // Android's small accent stripe, which varies by device/OS skin.
        val card = android.widget.RemoteViews(packageName, R.layout.notification_signal).apply {
            setInt(R.id.signal_notification_root, "setBackgroundColor", accent)
            setTextViewText(R.id.signal_notification_title, title)
            setTextViewText(R.id.signal_notification_subtitle, subtitle)
            setTextViewText(R.id.signal_notification_price, "ราคา: $price")
            setTextViewText(
                R.id.signal_notification_reason,
                "$reason\nแท่ง M1: $candle\nSignal Radar PRO"
            )
        }
        val openApp = PendingIntent.getActivity(
            this, 10, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(this, SIGNAL_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText("$subtitle · ราคา $price")
            .setCustomContentView(card)
            .setCustomBigContentView(card)
            .setStyle(Notification.DecoratedCustomViewStyle())
            .setContentIntent(openApp)
            .setColor(accent)
            .setColorized(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setDefaults(Notification.DEFAULT_VIBRATE)
            .build()
        manager.notify(if (isCall) 2001 else 2002, notification)
    }

    private fun playAlertTone() {
        try {
            val volume = 85
            val tone = ToneGenerator(AudioManager.STREAM_ALARM, volume)
            if (tone.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 800)) {
                Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, 1000)
            } else {
                tone.release()
            }
        } catch (_: Exception) { }
    }

    private fun serviceNotification(text: String): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Signal Radar PRO")
            .setContentText(text)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun saveError(status: String, detail: String) {
        prefs.edit().putString("connection", status).putString("signal", "STANDBY")
            .putString("reason", detail).apply()
        manager.notify(1001, serviceNotification("Server ไม่พร้อม · รอเชื่อมต่อใหม่"))
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(
                SERVICE_CHANNEL, "Radar background service", NotificationManager.IMPORTANCE_LOW
            ))
            val alerts = NotificationChannel(
                SIGNAL_CHANNEL, "CALL / PUT signal alerts", NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "เสียงและการสั่นเมื่อพบสัญญาณใหม่"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 180, 600)
                setSound(null, null)
            }
            manager.createNotificationChannel(alerts)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // START_STICKY allows Android to recreate the foreground service after process reclaim.
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        pollingJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_STOP = "com.kawasaki.signalradar.STOP"
        const val DEFAULT_SERVER = "https://ai-universal-signal-radar-main.onrender.com"
        private const val SERVICE_CHANNEL = "radar_service_v2"
        private const val SIGNAL_CHANNEL = "radar_signal_alerts_v2"
    }
}
