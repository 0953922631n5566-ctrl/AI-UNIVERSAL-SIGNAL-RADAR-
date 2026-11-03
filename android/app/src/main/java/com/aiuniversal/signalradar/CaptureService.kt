package com.aiuniversal.signalradar

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class CaptureService : Service() {
    companion object {
        const val ACTION_START = "radar.START"
        const val ACTION_STOP = "radar.STOP"
        const val ACTION_READY = "radar.READY"
        const val ACTION_FAILED = "radar.FAILED"
        const val ACTION_STATUS = "radar.STATUS"
        const val ACTION_STOPPED = "radar.STOPPED"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_TOKEN = "ingest_token"
        const val EXTRA_ERROR = "error"
        const val EXTRA_MESSAGE = "message"
        private const val CHANNEL_ID = "radar_capture"
        private const val NOTIFICATION_ID = 73
        private const val FRAME_INTERVAL_MS = 1500L
        private const val CONNECT_TIMEOUT_MS = 8000
        private const val READ_TIMEOUT_MS = 8000
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null
    private var token: String = ""
    private var sessionId: String = UUID.randomUUID().toString()
    private var sequence = 0L
    private var lastFrameAt = 0L
    private val uploader = Executors.newSingleThreadExecutor()
    private val uploadBusy = AtomicBoolean(false)
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
                    token = intent.getStringExtra(EXTRA_TOKEN)?.trim().orEmpty()
                    if (token.isBlank()) throw IllegalArgumentException("ไม่พบ Backend access token")
                    if (BuildConfig.BACKEND_URL.contains("REPLACE_WITH_BACKEND_HOST")) {
                        throw IllegalStateException("ยังไม่ได้กำหนด Backend URL")
                    }
                    createNotificationChannel()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIFICATION_ID, notification("กำลังเริ่มระบบจับภาพหน้าจอ"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
                    } else startForeground(NOTIFICATION_ID, notification("กำลังเริ่มระบบจับภาพหน้าจอ"))

                    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                    val resultData = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                    else { @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA) }
                        ?: throw IllegalArgumentException("ไม่พบข้อมูลอนุญาตจับภาพจาก Android")
                    startCapture(resultCode, resultData)
                    sendStatus(ACTION_READY)
                    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification("จับภาพและส่งเฟรมทุก 1.5 วินาที"))
                } catch (e: Exception) {
                    val reason = "${e.javaClass.simpleName}: ${e.message ?: "ไม่มีรายละเอียด"}"
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
        projection = manager.getMediaProjection(resultCode, data) ?: throw IllegalStateException("Android ไม่ส่ง MediaProjection กลับมา")
        val metrics = resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        if (width <= 0 || height <= 0) throw IllegalStateException("ขนาดหน้าจอไม่ถูกต้อง: ${width}x${height}")
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
        thread = HandlerThread("radar-capture").also { it.start() }
        val handler = Handler(thread!!.looper)
        projection!!.registerCallback(projectionCallback, handler)
        reader!!.setOnImageAvailableListener({ source ->
            val now = android.os.SystemClock.elapsedRealtime()
            if (now - lastFrameAt < FRAME_INTERVAL_MS || !uploadBusy.compareAndSet(false, true)) {
                source.acquireLatestImage()?.close()
                return@setOnImageAvailableListener
            }
            val image = source.acquireLatestImage() ?: run { uploadBusy.set(false); return@setOnImageAvailableListener }
            lastFrameAt = now
            val frameSequence = sequence++
            val capturedAt = System.currentTimeMillis()
            try {
                val jpeg = imageToJpeg(image)
                uploader.execute {
                    try {
                        val result = uploadFrame(jpeg, imageWidth, imageHeight, frameSequence, capturedAt)
                        sendStatus(ACTION_STATUS, "ส่งภาพ #$frameSequence สำเร็จ · $result")
                    } catch (e: Exception) {
                        sendStatus(ACTION_STATUS, "ส่งภาพไม่สำเร็จ: ${e.message ?: e.javaClass.simpleName}")
                    } finally { uploadBusy.set(false) }
                }
            } catch (e: Exception) {
                uploadBusy.set(false)
                sendStatus(ACTION_STATUS, "แปลงภาพไม่สำเร็จ: ${e.message ?: e.javaClass.simpleName}")
            } finally { image.close() }
        }, handler)
        virtualDisplay = projection!!.createVirtualDisplay("RadarScreenCapture", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader!!.surface, null, handler)
            ?: throw IllegalStateException("สร้าง VirtualDisplay ไม่สำเร็จ")
    }

    private var imageWidth = 0
    private var imageHeight = 0

    private fun imageToJpeg(image: Image): ByteArray {
        val plane = image.planes[0]
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val paddedWidth = rowStride / pixelStride
        val padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        val buffer = plane.buffer
        buffer.rewind()
        padded.copyPixelsFromBuffer(buffer)
        val cropped = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
        imageWidth = image.width
        imageHeight = image.height
        val output = ByteArrayOutputStream()
        cropped.compress(Bitmap.CompressFormat.JPEG, 65, output)
        padded.recycle()
        cropped.recycle()
        return output.toByteArray()
    }

    private fun uploadFrame(jpeg: ByteArray, width: Int, height: Int, seq: Long, capturedAt: Long): String {
        val boundary = "RadarBoundary${UUID.randomUUID()}"
        val connection = (URL(BuildConfig.BACKEND_URL.trimEnd('/') + "/v1/frame").openConnection() as HttpURLConnection)
        connection.requestMethod = "POST"
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        connection.setRequestProperty("Accept", "application/json")
        try {
            connection.outputStream.use { out ->
                fun field(name: String, value: String) {
                    out.write("--$boundary\r\n".toByteArray())
                    out.write("Content-Disposition: form-data; name=\"$name\"\r\n\r\n".toByteArray())
                    out.write(value.toByteArray())
                    out.write("\r\n".toByteArray())
                }
                field("session_id", sessionId)
                field("sequence", seq.toString())
                field("captured_at_ms", capturedAt.toString())
                field("width", width.toString())
                field("height", height.toString())
                out.write("--$boundary\r\n".toByteArray())
                out.write("Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n".toByteArray())
                out.write("Content-Type: image/jpeg\r\n\r\n".toByteArray())
                out.write(jpeg)
                out.write("\r\n--$boundary--\r\n".toByteArray())
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty().take(500)
            if (code !in 200..299) throw IllegalStateException("HTTP $code: $body")
            return body
        } finally { connection.disconnect() }
    }

    private fun stopCapture(stopProjection: Boolean = true) {
        if (isCleaningUp) return
        isCleaningUp = true
        try { virtualDisplay?.release() } catch (_: Exception) { }
        virtualDisplay = null
        try { reader?.setOnImageAvailableListener(null, null); reader?.close() } catch (_: Exception) { }
        reader = null
        try { projection?.unregisterCallback(projectionCallback) } catch (_: Exception) { }
        if (stopProjection) try { projection?.stop() } catch (_: Exception) { }
        projection = null
        try { thread?.quitSafely() } catch (_: Exception) { }
        thread = null
        token = ""
        isCleaningUp = false
    }

    private fun sendStatus(action: String, message: String? = null) {
        val result = Intent(action).setPackage(packageName)
        if (message != null) result.putExtra(if (action == ACTION_FAILED) EXTRA_ERROR else EXTRA_MESSAGE, message)
        sendBroadcast(result)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL_ID, "Screen capture", NotificationManager.IMPORTANCE_LOW))
    }

    private fun notification(message: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder.setContentTitle("AI Signal Radar").setContentText(message).setSmallIcon(android.R.drawable.ic_menu_view).build()
    }

    override fun onDestroy() {
        stopCapture()
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
