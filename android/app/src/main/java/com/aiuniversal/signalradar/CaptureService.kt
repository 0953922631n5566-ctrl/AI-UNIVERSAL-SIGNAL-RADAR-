package com.aiuniversal.signalradar

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder

class CaptureService : Service() {
    companion object {
        const val ACTION_START = "radar.START"
        const val ACTION_STOP = "radar.STOP"
        const val ACTION_READY = "radar.READY"
        const val ACTION_FAILED = "radar.FAILED"
        const val ACTION_STOPPED = "radar.STOPPED"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_ERROR = "error"
        private const val CHANNEL_ID = "radar_capture"
        private const val NOTIFICATION_ID = 73
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null
    private var isCleaningUp = false

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            stopCapture(stopProjection = false)
            sendStatus(ACTION_STOPPED)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopCapture()
                sendStatus(ACTION_STOPPED)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                try {
                    createNotificationChannel()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(
                            NOTIFICATION_ID,
                            notification("กำลังเริ่มระบบจับภาพหน้าจอ"),
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, notification("กำลังเริ่มระบบจับภาพหน้าจอ"))
                    }

                    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                    val resultData = if (Build.VERSION.SDK_INT >= 33) {
                        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(EXTRA_RESULT_DATA)
                    } ?: throw IllegalArgumentException("ไม่พบข้อมูลอนุญาตจับภาพจาก Android")

                    startCapture(resultCode, resultData)
                    sendStatus(ACTION_READY)
                    val manager = getSystemService(NotificationManager::class.java)
                    manager.notify(NOTIFICATION_ID, notification("กำลังจับภาพตามสิทธิ์ที่อนุญาต"))
                } catch (e: Exception) {
                    val reason = "${e.javaClass.simpleName}: ${e.message ?: "ไม่มีรายละเอียด"}"
                    getSharedPreferences("radar_state", MODE_PRIVATE).edit()
                        .putString("last_capture_error", reason).apply()
                    sendStatus(ACTION_FAILED, reason)
                    stopCapture()
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun startCapture(resultCode: Int, data: Intent) {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val activeProjection = manager.getMediaProjection(resultCode, data)
            ?: throw IllegalStateException("Android ไม่ส่ง MediaProjection กลับมา")
        projection = activeProjection

        val metrics = resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        if (width <= 0 || height <= 0) throw IllegalStateException("ขนาดหน้าจอไม่ถูกต้อง: ${width}x${height}")

        reader = ImageReader.newInstance(width, height, android.graphics.PixelFormat.RGBA_8888, 2)
        thread = HandlerThread("radar-capture").also { it.start() }
        val handler = Handler(thread!!.looper)

        // Android requires a registered callback before creating the virtual display.
        activeProjection.registerCallback(projectionCallback, handler)
        virtualDisplay = activeProjection.createVirtualDisplay(
            "RadarScreenCapture",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader!!.surface,
            null,
            handler
        ) ?: throw IllegalStateException("สร้าง VirtualDisplay ไม่สำเร็จ")
    }

    private fun stopCapture(stopProjection: Boolean = true) {
        if (isCleaningUp) return
        isCleaningUp = true
        try { virtualDisplay?.release() } catch (_: Exception) { }
        virtualDisplay = null
        try { reader?.close() } catch (_: Exception) { }
        reader = null
        try { projection?.unregisterCallback(projectionCallback) } catch (_: Exception) { }
        if (stopProjection) {
            try { projection?.stop() } catch (_: Exception) { }
        }
        projection = null
        try { thread?.quitSafely() } catch (_: Exception) { }
        thread = null
        isCleaningUp = false
    }

    private fun sendStatus(action: String, error: String? = null) {
        val result = Intent(action).setPackage(packageName)
        if (error != null) result.putExtra(EXTRA_ERROR, error)
        sendBroadcast(result)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "Screen capture", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun notification(message: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder.setContentTitle("AI Signal Radar")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .build()
    }

    override fun onDestroy() {
        stopCapture()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
