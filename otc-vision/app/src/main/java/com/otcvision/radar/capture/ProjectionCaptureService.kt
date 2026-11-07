package com.otcvision.radar.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.IntentFilter
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
import android.os.PowerManager
import android.os.BatteryManager
import android.os.Environment
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.otcvision.radar.model.RoiConfig
import com.otcvision.radar.vision.BitmapPreprocessor
import com.otcvision.radar.vision.OrangeTagDetector
import com.otcvision.radar.vision.PriceTextParser
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

class ProjectionCaptureService : Service() {
    companion object {
        const val ACTION_START = "com.otcvision.radar.START_CAPTURE"
        const val ACTION_STOP = "com.otcvision.radar.STOP_CAPTURE"
        const val ACTION_METRIC = "com.otcvision.radar.CAPTURE_METRIC"
        const val ACTION_STOPPED = "com.otcvision.radar.CAPTURE_STOPPED"
        const val ACTION_ERROR = "com.otcvision.radar.CAPTURE_ERROR"
        const val EXTRA_RESULT_CODE = "projection_result_code"
        const val EXTRA_RESULT_DATA = "projection_result_data"
        const val EXTRA_PRICE = "price"
        const val EXTRA_CANDIDATES = "candidates"
        const val EXTRA_OCR_MS = "ocr_ms"
        const val EXTRA_FRAME_MS = "frame_ms"
        const val EXTRA_MEMORY_KB = "memory_kb"
        const val EXTRA_MESSAGE = "message"
        private const val CHANNEL_ID = "otc_capture"
        private const val NOTIFICATION_ID = 810
        private const val MIN_FRAME_INTERVAL_MS = 650L
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureThread: HandlerThread? = null
    private var lastFrameAt = 0L
    private val processing = AtomicBoolean(false)
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    private val roiConfig = RoiConfig.defaults()
    private var isStopping = false
    private lateinit var benchmarkRecorder: OcrBenchmarkRecorder
    private var debugSnapshotsSaved = 0

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            stopCapture(stopProjection = false)
            broadcast(ACTION_STOPPED, "Screen capture permission revoked or session ended")
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopCapture()
                broadcast(ACTION_STOPPED, "Capture stopped by user")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                try {
                    startForegroundCompat()
                    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                    val data = if (Build.VERSION.SDK_INT >= 33) {
                        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(EXTRA_RESULT_DATA)
                    } ?: error("Missing MediaProjection consent result")
                    startCapture(resultCode, data)
                    updateNotification("Capturing locally · dynamic orange-tag OCR")
                } catch (error: Exception) {
                    broadcast(ACTION_ERROR, error.javaClass.simpleName + ": " + (error.message ?: "Capture startup failed"))
                    stopCapture()
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "OTC screen capture", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification = buildNotification("Waiting for capture session")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startCapture(resultCode: Int, data: Intent) {
        check(projection == null) { "A capture session is already active" }
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val activeProjection = manager.getMediaProjection(resultCode, data)
            ?: error("Android did not provide a MediaProjection instance")
        projection = activeProjection
        benchmarkRecorder = OcrBenchmarkRecorder(this).also { it.reset() }

        val metrics = displayMetrics()
        require(metrics.widthPixels > 0 && metrics.heightPixels > 0) { "Invalid display dimensions" }
        val reader = ImageReader.newInstance(metrics.widthPixels, metrics.heightPixels, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        val thread = HandlerThread("otc-vision-frame-reader").also { it.start() }
        captureThread = thread
        val handler = Handler(thread.looper)

        activeProjection.registerCallback(projectionCallback, handler)
        reader.setOnImageAvailableListener({ source ->
            analyzeLatestFrame(source)
        }, handler)

        virtualDisplay = activeProjection.createVirtualDisplay(
            "OtcVisionCapture",
            metrics.widthPixels,
            metrics.heightPixels,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler
        ) ?: error("Could not create capture virtual display")
    }

    /**
     * Owns the ImageProxy-like Image lifecycle and contains every frame-level exception.
     * The Image is closed exactly once by processFrame; failures never escape the handler.
     */
    private fun analyzeLatestFrame(source: ImageReader) {
        val now = System.currentTimeMillis()
        if (now - lastFrameAt < MIN_FRAME_INTERVAL_MS || !processing.compareAndSet(false, true)) {
            runCatching { source.acquireLatestImage()?.close() }
            return
        }
        val frame = try {
            source.acquireLatestImage()
        } catch (error: Exception) {
            processing.set(false)
            broadcast(ACTION_ERROR, "Frame acquire: " + (error.message ?: error.javaClass.simpleName))
            return
        }
        if (frame == null) {
            processing.set(false)
            return
        }
        lastFrameAt = now
        try {
            processFrame(frame, now)
        } catch (error: Exception) {
            runCatching { frame.close() }
            processing.set(false)
            broadcast(ACTION_ERROR, "Frame processing: " + (error.message ?: error.javaClass.simpleName))
        }
    }

    private fun processFrame(image: Image, frameStartedAt: Long) {
        val frameWidth = image.width
        val frameHeight = image.height
        val plane = image.planes.firstOrNull() ?: run {
            image.close()
            processing.set(false)
            return
        }
        val pixelStride = plane.pixelStride
        val rowPadding = plane.rowStride - pixelStride * frameWidth
        val paddedWidth = frameWidth + rowPadding / pixelStride
        val fullFrame = Bitmap.createBitmap(paddedWidth, frameHeight, Bitmap.Config.ARGB_8888)
        try {
            fullFrame.copyPixelsFromBuffer(plane.buffer)
        } finally {
            image.close()
        }

        val scanRect = roiConfig.priceLabel.toRect(frameWidth, frameHeight)
        val chartRect = roiConfig.candleChart.toRect(frameWidth, frameHeight)
        val axisScan = Bitmap.createBitmap(fullFrame, scanRect.left, scanRect.top, scanRect.width(), scanRect.height())
        val tagRect = OrangeTagDetector.findTag(axisScan)
        val priceCrop = tagRect?.let {
            Bitmap.createBitmap(axisScan, it.left, it.top, it.width(), it.height())
        }
        axisScan.recycle()

        val chartCrop = Bitmap.createBitmap(fullFrame, chartRect.left, chartRect.top, chartRect.width(), chartRect.height())
        fullFrame.recycle()
        val chartRoiPixels = chartCrop.width.toLong() * chartCrop.height.toLong()
        chartCrop.recycle()

        if (priceCrop == null) {
            val frameMs = (System.currentTimeMillis() - frameStartedAt).coerceAtLeast(0L)
            val heapKb = usedHeapKb()
            val progress = recordBenchmark("NO_ORANGE_TAG", null, -1L, frameMs, heapKb)
            processing.set(false)
            broadcast(
                ACTION_METRIC,
                "NO_ORANGE_TAG · right-axis scan " + scanRect.width() + "x" + scanRect.height() + progress,
                frameMs = frameMs,
                memoryKb = heapKb
            )
            return
        }

        // Every anchored quote is first enlarged by exactly 2x with bicubic interpolation.
        val doubled = BitmapPreprocessor.upscaleBicubic2x(priceCrop)
        priceCrop.recycle()
        val scaled = BitmapPreprocessor.scaleForOcr(doubled)
        doubled.recycle()
        val prepared = BitmapPreprocessor.prepareOrangeTagForOcr(scaled)
        scaled.recycle()

        // ML Kit receives its own bitmap. It remains alive until the Task completes,
        // independently of the temporary preprocessing chain and frame-reader lifecycle.
        val ocrBitmap = try {
            check(!prepared.isRecycled) { "Prepared OCR bitmap was recycled before handoff" }
            prepared.copy(Bitmap.Config.ARGB_8888, false)
                ?: error("Could not copy prepared OCR bitmap")
        } finally {
            if (!prepared.isRecycled) prepared.recycle()
        }

        val ocrStartedAt = System.nanoTime()
        try {
            recognizer.process(InputImage.fromBitmap(ocrBitmap, 0))
            .addOnSuccessListener { result ->
                val ocrMs = (System.nanoTime() - ocrStartedAt) / 1_000_000L
                // ML Kit has no native whitelist API; sanitize to [0-9.] before regex validation.
                val numericText = PriceTextParser.sanitizeOcrText(result.text)
                val parsed = PriceTextParser.parse(numericText)
                val frameAgeMs = (System.currentTimeMillis() - frameStartedAt).coerceAtLeast(0L)
                val usedMemoryKb = usedHeapKb()
                val status = when {
                    parsed.isAmbiguous -> "AMBIGUOUS"
                    parsed.value != null -> "PRICE_READ"
                    else -> "NO_VALID_PRICE"
                }
                if (parsed.value == null && !ocrBitmap.isRecycled) saveDebugBitmap(ocrBitmap, status)
                val progress = recordBenchmark(status, parsed.value, ocrMs, frameAgeMs, usedMemoryKb)
                broadcast(
                    ACTION_METRIC,
                    status + " · orange tag anchored · chart ROI " + chartRoiPixels + " px" + progress,
                    price = parsed.value,
                    candidates = parsed.candidates.joinToString(","),
                    ocrMs = ocrMs,
                    frameMs = frameAgeMs,
                    memoryKb = usedMemoryKb
                )
            }
            .addOnFailureListener { error ->
                val frameAgeMs = (System.currentTimeMillis() - frameStartedAt).coerceAtLeast(0L)
                if (!ocrBitmap.isRecycled) saveDebugBitmap(ocrBitmap, "OCR_FAILURE")
                val progress = recordBenchmark("OCR_FAILURE", null, -1L, frameAgeMs, usedHeapKb())
                broadcast(ACTION_METRIC, "OCR_FAILURE · " + (error.localizedMessage ?: error.javaClass.simpleName) + progress, frameMs = frameAgeMs, memoryKb = usedHeapKb())
            }
            .addOnCompleteListener {
                if (!ocrBitmap.isRecycled) ocrBitmap.recycle()
                processing.set(false)
            }
        } catch (error: Exception) {
            if (!ocrBitmap.isRecycled) ocrBitmap.recycle()
            processing.set(false)
            broadcast(ACTION_ERROR, "OCR dispatch: " + (error.message ?: error.javaClass.simpleName))
        }
    }

    /**
     * Stores at most five failed OCR crops per capture session in app-specific local storage.
     * Debug I/O is best-effort: storage/permission failures are swallowed and never stop capture.
     */
    private fun saveDebugBitmap(bitmap: Bitmap, reason: String) {
        if (debugSnapshotsSaved >= 5 || bitmap.isRecycled) return
        runCatching {
            if (bitmap.isRecycled) return@runCatching
            val base = getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: filesDir
            val directory = File(base, "ocr-debug")
            if (!directory.exists() && !directory.mkdirs()) return
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(Date())
            val safeReason = reason.replace(Regex("[^A-Za-z0-9_-]"), "_").take(24)
            val file = File(directory, "ocr-$stamp-$safeReason.png")
            file.outputStream().use { stream ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                    "Could not encode debug OCR bitmap"
                }
            }
            debugSnapshotsSaved++
        }
    }

    private fun usedHeapKb(): Long {
        val runtime = Runtime.getRuntime()
        return (runtime.totalMemory() - runtime.freeMemory()) / 1024L
    }

    private fun recordBenchmark(
        status: String,
        price: String?,
        ocrMs: Long,
        frameMs: Long,
        heapKb: Long
    ): String {
        if (!::benchmarkRecorder.isInitialized) return ""
        val thermalStatus = if (Build.VERSION.SDK_INT >= 29) {
            getSystemService(PowerManager::class.java).currentThermalStatus
        } else -1
        val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val rawTemp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1
        val batteryTemp = if (rawTemp >= 0) rawTemp / 10f else null
        val summary = benchmarkRecorder.record(
            OcrBenchmarkRecorder.Sample(status, price, ocrMs, frameMs, heapKb, thermalStatus, batteryTemp)
        )
        if (summary != null) {
            val rate = String.format(java.util.Locale.US, "%.1f", summary.extractionRate)
            val batteryMax = summary.maxBatteryTempC?.toString()?.plus("C") ?: "n/a"
            return " · BENCHMARK_COMPLETE " + summary.samples + "/100" +
                " · extraction " + rate + "%" +
                " · OCR avg/max " + summary.meanOcrMs + "/" + summary.maxOcrMs + "ms" +
                " · peak heap " + summary.peakHeapKb + "KB" +
                " · thermal max " + summary.maxThermalStatus +
                " · battery max " + batteryMax +
                " · CSV " + summary.csvFile.name + " (exact-match labels pending)"
        }
        return " · benchmark " + benchmarkRecorder.currentCount() + "/100"
    }

    private fun displayMetrics(): DisplayMetrics {
        val result = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(result)
        return result
    }

    private fun buildNotification(message: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder.setContentTitle("OTC Vision Radar")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(message: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(message))
    }

    private fun broadcast(
        action: String,
        message: String,
        price: String? = null,
        candidates: String? = null,
        ocrMs: Long = -1L,
        frameMs: Long = -1L,
        memoryKb: Long = -1L
    ) {
        val intent = Intent(action).setPackage(packageName)
            .putExtra(EXTRA_MESSAGE, message)
            .putExtra(EXTRA_PRICE, price)
            .putExtra(EXTRA_CANDIDATES, candidates)
            .putExtra(EXTRA_OCR_MS, ocrMs)
            .putExtra(EXTRA_FRAME_MS, frameMs)
            .putExtra(EXTRA_MEMORY_KB, memoryKb)
        sendBroadcast(intent)
    }

    private fun stopCapture(stopProjection: Boolean = true) {
        if (isStopping) return
        isStopping = true
        try { imageReader?.setOnImageAvailableListener(null, null) } catch (_: Exception) {}
        try { virtualDisplay?.release() } catch (_: Exception) {}
        virtualDisplay = null
        try { imageReader?.close() } catch (_: Exception) {}
        imageReader = null
        try { projection?.unregisterCallback(projectionCallback) } catch (_: Exception) {}
        if (stopProjection) try { projection?.stop() } catch (_: Exception) {}
        projection = null
        try { captureThread?.quitSafely() } catch (_: Exception) {}
        captureThread = null
        processing.set(false)
        isStopping = false
    }

    override fun onDestroy() {
        stopCapture()
        try { recognizer.close() } catch (_: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
