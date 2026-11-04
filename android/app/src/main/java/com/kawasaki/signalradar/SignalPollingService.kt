package com.kawasaki.signalradar

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL

class SignalPollingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefs by lazy { getSharedPreferences("signal_radar_pro", MODE_PRIVATE) }
    private val manager by lazy { getSystemService(NOTIFICATION_SERVICE) as NotificationManager }

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForeground(1001, serviceNotification("Connecting to signal server…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (scope.isActive) {
            scope.launch {
                while (isActive) {
                    pollOnce()
                    delay(1000)
                }
            }
        }
        return START_STICKY
    }

    private suspend fun pollOnce() {
        val base = (prefs.getString("server_url", "https://ai-universal-signal-radar-main.onrender.com") ?: "")
            .trim().trimEnd('/')
        if (!base.startsWith("https://")) {
            saveError("INVALID SERVER URL", "Server URL must use HTTPS")
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
            val countdown = json.optInt("countdownSeconds", -1)
            val regime = thaiRegime(json.optString("regime", "UNCLEAR"))
            val reason = json.optString("reason", "")
            val price = if (json.isNull("price")) "--" else json.optString("price")
            val score = json.optInt("score", 0).toString()
            val indicators = json.optJSONObject("indicators")
            val fmt = { key: String -> indicators?.let { if (it.isNull(key)) "--" else it.opt(key).toString() } ?: "--" }
            prefs.edit()
                .putString("connection", if (status == "ONLINE") "ONLINE" else status)
                .putString("signal", signal)
                .putString("reason", reason)
                .putString("price", price)
                .putString("score", score)
                .putString("regime", regime)
                .putString("countdown", if (countdown >= 0) countdown.toString() else "--")
                .putString("data_age", if (age < 1000) "สดใหม่" else (age / 1000).toString() + " วินาที")
                .putString("ema9", fmt("ema9")).putString("ema21", fmt("ema21")).putString("ema50", fmt("ema50"))
                .putString("rsi", fmt("rsi")).putString("macd", fmt("macdHistogram"))
                .putString("support", fmt("support")).putString("resistance", fmt("resistance"))
                .putString("volatility", fmt("volatility")).putString("momentum", fmt("momentum"))
                .putLong("last_success_at", System.currentTimeMillis())
                .apply()
            manager.notify(1001, serviceNotification("เชื่อมต่อแล้ว · EUR/USD · M1 · " + signal))
            val candle = json.optString("candleTime", "unknown")
            if (age <= 150000L && countdown == 10 && prefs.getString("last_pre10_candle", "") != candle) {
                prefs.edit().putString("last_pre10_candle", candle).apply()
                playAlertTone(1)
            }
            if (age <= 150000L && countdown == 3 && prefs.getString("last_pre3_candle", "") != candle) {
                prefs.edit().putString("last_pre3_candle", candle).apply()
                playAlertTone(2)
            }
            if (age <= 150000L && json.optBoolean("signalWindowOpen", false) && (signal == "CALL" || signal == "PUT")) {
                val key = "$candle:$signal"
                if (prefs.getString("last_notified_signal", "") != key) {
                    prefs.edit().putString("last_notified_signal", key).apply()
                    showSignalNotification(signal, price, reason, candle)
                }
            }
        } catch (error: Exception) {
            saveError("OFFLINE", error.message ?: "Unable to reach server")
        }
    }

    private fun playAlertTone(kind: Int) {
        if (prefs.getBoolean("mute_alerts", false)) return
        val volume = prefs.getInt("alert_volume", 75).coerceIn(0, 100)
        if (volume == 0) return
        try {
            val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, volume)
            val toneType = when (kind) {
                1 -> ToneGenerator.TONE_PROP_ACK
                2 -> ToneGenerator.TONE_PROP_BEEP2
                else -> ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD
            }
            tone.startTone(toneType, if (kind == 3) 700 else 300)
        } catch (_: Exception) { }
    }

    private fun thaiRegime(value: String): String = when (value) {
        "TRENDING" -> "แนวโน้มชัดเจน"
        "RANGING" -> "แกว่งตัวในกรอบ"
        "HIGH VOLATILITY" -> "ผันผวนสูง"
        "REVERSAL" -> "มีโอกาสกลับตัว"
        else -> "ยังไม่ชัดเจน"
    }

    private fun saveError(status: String, detail: String) {
        prefs.edit().putString("connection", status).putString("signal", "STANDBY")
            .putString("reason", detail).putString("price", "--").apply()
        manager.notify(1001, serviceNotification("Connection issue · Signal set to STANDBY"))
    }

    private fun showSignalNotification(signal: String, price: String, reason: String, candle: String) {
        val isBuy = signal == "CALL"
        val title = if (isBuy) "🟢 BUY · EUR/USD" else "🔴 SELL · EUR/USD"
        val text = if (isBuy) "CALL signal received" else "PUT signal received"
        playAlertTone(3)
        val notification = Notification.Builder(this, SIGNAL_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText("$text · Price $price")
            .setStyle(Notification.BigTextStyle().bigText("$text\nPrice: $price\n$reason\nM1 candle: $candle"))
            .setCategory(Notification.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setDefaults(Notification.DEFAULT_VIBRATE)
            .build()
        manager.notify(2001, notification)
    }

    private fun serviceNotification(text: String): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("AI Signal Radar PRO")
            .setContentText(text)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val service = NotificationChannel(SERVICE_CHANNEL, "Radar connection", NotificationManager.IMPORTANCE_LOW)
            val alerts = NotificationChannel(SIGNAL_CHANNEL, "Trading signal alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Vibration for new EUR/USD M1 signals; sound is controlled in the app"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 350, 180, 500)
                setSound(null, null)
            }
            manager.createNotificationChannel(service)
            manager.createNotificationChannel(alerts)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val SERVICE_CHANNEL = "radar_service"
        private const val SIGNAL_CHANNEL = "radar_signal_alerts"
    }
}
