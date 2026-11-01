package com.aiuniversal.signalradar

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
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
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        private const val CHANNEL_ID = "radar_capture"
        private const val NOTIFICATION_ID = 73
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() { stopCapture() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopCapture()
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_START) {
            createNotificationChannel()
            startForeground(NOTIFICATION_ID, notification())
            val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
            val resultData = if (Build.VERSION.SDK_INT >= 33)
                intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA)
            if (resultData == null) { stopSelf(); return START_NOT_STICKY }
            startCapture(resultCode, resultData)
        }
        return START_NOT_STICKY
    }

    private fun startCapture(resultCode: Int, data: Intent) {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = manager.getMediaProjection(resultCode, data)
        val metrics = resources.displayMetrics
        val w = metrics.widthPixels
        val h = metrics.heightPixels
        reader = ImageReader.newInstance(w, h, android.graphics.PixelFormat.RGBA_8888, 2)
        thread = HandlerThread("radar-capture").also { it.start() }
        projection?.registerCallback(projectionCallback, Handler(thread!!.looper))
        virtualDisplay = projection?.createVirtualDisplay(
            "RadarScreenCapture", w, h, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader?.surface, null, Handler(thread!!.looper)
        )
        // Upload loop and result rendering are intentionally not enabled until HTTPS endpoint,
        // server token provisioning, bounded image encoding and response handling are configured.
    }

    private fun stopCapture() {
        virtualDisplay?.release(); virtualDisplay = null
        reader?.close(); reader = null
        projection?.unregisterCallback(projectionCallback)
        projection?.stop(); projection = null
        thread?.quitSafely(); thread = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "Screen capture", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun notification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder.setContentTitle("AI Signal Radar")
            .setContentText("กำลังจับภาพหน้าจอตามสิทธิ์ที่อนุญาต")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .build()
    }

    override fun onDestroy() { stopCapture(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
