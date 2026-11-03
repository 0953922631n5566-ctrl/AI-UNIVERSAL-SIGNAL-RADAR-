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
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class CaptureService : Service() {
    companion object {
        const val ACTION_START = "radar.START"
        const val ACTION_STOP = "radar.STOP"
        const val ACTION_READY = "radar.READY"
        const val ACTION_FAILED = "radar.FAILED"
        const val ACTION_STOPPED = "radar.STOPPED"
        const val ACTION_PRICE = "radar.PRICE"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_ERROR = "error"
        const val EXTRA_PRICE = "price"
        const val EXTRA_SIGNAL = "signal"
        private const val CHANNEL_ID = "radar_capture"
        private const val NOTIFICATION_ID = 73
        private const val OCR_INTERVAL_MS = 1000L
        private const val UPLOAD_URL = BuildConfig.BACKEND_URL + "/api/upload-screen"
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null
    private var recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val network = Executors.newSingleThreadExecutor()
    private val uploadInProgress = AtomicBoolean(false)
    private var lastOcrAt = 0L
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
                    val token = getSharedPreferences("radar_config", MODE_PRIVATE).getString("ocr_token", "").orEmpty()
                    if (token.isBlank()) throw IllegalStateException("กรุณาบันทึก OCR Token ในแอปก่อนเริ่ม")
                    if (BuildConfig.BACKEND_URL.contains("REPLACE_WITH_BACKEND_HOST")) {
                        throw IllegalStateException("ยังไม่ได้กำหนด Server URL ในตัวแอป")
                    }
                    createNotificationChannel()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(
                            NOTIFICATION_ID,
                            notification("กำลังเริ่มระบบ OCR และเชื่อมต่อ Server"),
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, notification("กำลังเริ่มระบบ OCR และเชื่อมต่อ Server"))
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
                    getSystemService(NotificationManager::class.java)
                        .notify(NOTIFICATION_ID, notification("กำลังอ่านป้ายราคา EUR/USD และส่งข้อมูลจริง"))
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

        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
        thread = HandlerThread("radar-capture").also { it.start() }
        val handler = Handler(thread!!.looper)

        activeProjection.registerCallback(projectionCallback, handler)
        reader!!.setOnImageAvailableListener({ source ->
            val now = System.currentTimeMillis()
            if (now - lastOcrAt < OCR_INTERVAL_MS) {
                source.acquireLatestImage()?.close()
                return@setOnImageAvailableListener
            }
            val image = source.acquireLatestImage() ?: return@setOnImageAvailableListener
            lastOcrAt = now
            try {
                processFrame(image)
            } catch (_: Exception) {
                image.close()
            }
        }, handler)

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

    private fun processFrame(image: Image) {
        val width = image.width
        val height = image.height
        val plane = image.planes.firstOrNull() ?: run { image.close(); return }
        val pixelStride = plane.pixelStride
        val rowPadding = plane.rowStride - pixelStride * width
        val paddedWidth = width + rowPadding / pixelStride
        val full = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        full.copyPixelsFromBuffer(plane.buffer)
        image.close()

        val cropLeft = (width * 0.80f).toInt().coerceAtMost(width - 1)
        val cropTop = (height * 0.12f).toInt()
        val cropWidth = (width - cropLeft).coerceAtLeast(1)
        val cropHeight = (height * 0.78f).toInt().coerceAtMost(height - cropTop).coerceAtLeast(1)
        val badgeCrop = Bitmap.createBitmap(full, cropLeft, cropTop, cropWidth, cropHeight)
        full.recycle()
        val enlarged = Bitmap.createScaledBitmap(badgeCrop, badgeCrop.width * 2, badgeCrop.height * 2, true)
        badgeCrop.recycle()

        recognizer.process(InputImage.fromBitmap(enlarged, 0))
            .addOnSuccessListener { result ->
                val matches = Regex("""(?<!\d)([01]\.\d{4,6})(?!\d)""")
                    .findAll(result.text)
                    .mapNotNull { it.groupValues.getOrNull(1)?.toDoubleOrNull() }
                    .filter { it in 0.5..2.0 }
                    .toList()
                val detected = matches.firstOrNull()
                if (detected != null) uploadPrice(detected)
            }
            .addOnFailureListener { /* Keep scanning; next fresh frame will retry. */ }
            .addOnCompleteListener { enlarged.recycle() }
    }

    private fun uploadPrice(price: Double) {
        if (!uploadInProgress.compareAndSet(false, true)) return
        val token = getSharedPreferences("radar_config", MODE_PRIVATE).getString("ocr_token", "").orEmpty()
        network.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(UPLOAD_URL).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 7000
                    readTimeout = 7000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("x-ocr-token", token)
                }
                val body = JSONObject()
                    .put("detectedPrice", price)
                    .put("timestamp", System.currentTimeMillis())
                    .put("symbol", "EUR/USD")
                    .put("source", "ANDROID_OCR_ML_KIT")
                    .toString()
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                if (code in 200..299) {
                    val json = JSONObject(response)
                    sendPriceStatus(price, json.optString("signal", "STANDBY"), "ส่งราคาเข้า Server แล้ว")
                } else {
                    sendStatus(ACTION_FAILED, "Server ตอบ HTTP $code — ตรวจ Token หรือการเชื่อมต่อ")
                }
            } catch (e: Exception) {
                sendStatus(ACTION_FAILED, "ส่งราคาไม่สำเร็จ: ${e.javaClass.simpleName}")
            } finally {
                connection?.disconnect()
                uploadInProgress.set(false)
            }
        }
    }

    private fun sendPriceStatus(price: Double, signal: String, message: String) {
        val intent = Intent(ACTION_PRICE).setPackage(packageName)
            .putExtra(EXTRA_PRICE, price.toString())
            .putExtra(EXTRA_SIGNAL, signal)
            .putExtra(EXTRA_ERROR, message)
        sendBroadcast(intent)
    }

    private fun stopCapture(stopProjection: Boolean = true) {
        if (isCleaningUp) return
        isCleaningUp = true
        try { virtualDisplay?.release() } catch (_: Exception) { }
        virtualDisplay = null
        try { reader?.setOnImageAvailableListener(null, null) } catch (_: Exception) { }
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
        return builder.setContentTitle("AI Signal Radar OCR")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .build()
    }

    override fun onDestroy() {
        stopCapture()
        try { recognizer.close() } catch (_: Exception) { }
        network.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
