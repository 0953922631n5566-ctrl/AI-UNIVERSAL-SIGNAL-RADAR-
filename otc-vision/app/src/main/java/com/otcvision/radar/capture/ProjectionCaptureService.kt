package com.otcvision.radar.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Rect
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
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.otcvision.radar.vision.BitmapPreprocessor
import com.otcvision.radar.vision.PriceTextParser
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Manual capture service:
 * - ImageReader only drains frames while idle.
 * - A user tap arms exactly one frame for ROI extraction and OCR.
 * - No timer, anchor scan, polling OCR loop, or background auto-analysis exists.
 */
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
        private const val CHANNEL_ID = "otc_manual_capture"
        private const val NOTIFICATION_ID = 811
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureThread: HandlerThread? = null
    private var controls: ManualFloatingControls? = null
    private var screenWidth = 0
    private var screenHeight = 0
    private val captureRequested = AtomicBoolean(false)
    private val processing = AtomicBoolean(false)
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    private var isStopping = false

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            stopCapture(stopProjection = false)
            broadcast(ACTION_STOPPED, "Screen capture permission revoked or session ended")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopCapture()
                broadcast(ACTION_STOPPED, "Manual capture stopped by user")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                try {
                    check(Settings.canDrawOverlays(this)) { "Allow Display over other apps to use floating ROI controls" }
                    startForegroundCompat()
                    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                    val data = if (Build.VERSION.SDK_INT >= 33) {
                        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(EXTRA_RESULT_DATA)
                    } ?: error("Missing MediaProjection consent result")
                    startCapture(resultCode, data)
                    updateNotification("Manual ROI ready · automatic OCR disabled")
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
                NotificationChannel(CHANNEL_ID, "OTC manual capture", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification = buildNotification("Waiting for screen-capture consent")
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

        val metrics = displayMetrics()
        screenWidth = metrics.widthPixels
        screenHeight = metrics.heightPixels
        require(screenWidth > 0 && screenHeight > 0) { "Invalid display dimensions" }

        val reader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        val thread = HandlerThread("otc-manual-frame-reader").also { it.start() }
        captureThread = thread
        val handler = Handler(thread.looper)
        activeProjection.registerCallback(projectionCallback, handler)

        reader.setOnImageAvailableListener({ source ->
            analyzeRequestedFrame(source)
        }, handler)

        virtualDisplay = activeProjection.createVirtualDisplay(
            "OtcManualRoiCapture",
            screenWidth,
            screenHeight,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler
        ) ?: error("Could not create capture virtual display")

        controls = ManualFloatingControls(
            this,
            getSystemService(WINDOW_SERVICE) as WindowManager,
            onCapture = { requestManualCapture() },
            onStop = {
                stopCapture()
                broadcast(ACTION_STOPPED, "Manual capture stopped by user")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        ).also { it.show(screenWidth, screenHeight) }
        broadcast(ACTION_METRIC, "MANUAL_READY · move the ROI box over the broker price tag, then tap CAPTURE & ANALYZE")
    }

    private fun requestManualCapture() {
        if (projection == null) {
            controls?.setStatus("Capture session is not active", true)
            return
        }
        if (processing.get() || !captureRequested.compareAndSet(false, true)) {
            controls?.setStatus("One capture is already in progress", false)
            return
        }
        updateNotification("Manual capture requested · waiting for next frame")
    }

    /** Idle frames are discarded. A single frame is retained only after the user taps Capture. */
    private fun analyzeRequestedFrame(source: ImageReader) {
        if (!captureRequested.get() || !processing.compareAndSet(false, true)) {
            runCatching { source.acquireLatestImage()?.close() }
            return
        }
        if (!captureRequested.compareAndSet(true, false)) {
            processing.set(false)
            runCatching { source.acquireLatestImage()?.close() }
            return
        }
        val frame = try {
            source.acquireLatestImage()
        } catch (error: Exception) {
            processing.set(false)
            controls?.setStatus("Frame error: " + (error.message ?: error.javaClass.simpleName), true)
            broadcast(ACTION_ERROR, "Frame acquire: " + (error.message ?: error.javaClass.simpleName))
            return
        }
        if (frame == null) {
            processing.set(false)
            controls?.setStatus("No frame available · tap to retry", true)
            return
        }
        try {
            processSingleFrame(frame)
        } catch (error: Exception) {
            runCatching { frame.close() }
            processing.set(false)
            controls?.setStatus("Capture failed · tap to retry", true)
            broadcast(ACTION_ERROR, "Manual frame processing: " + (error.message ?: error.javaClass.simpleName))
        }
    }

    private fun processSingleFrame(image: Image) {
        var handedToMlKit = false
        var fullFrame: Bitmap? = null
        var roiCrop: Bitmap? = null
        var scaled: Bitmap? = null
        var prepared: Bitmap? = null
        var ocrBitmap: Bitmap? = null
        val frameStartedAt = System.currentTimeMillis()
        try {
            val frameWidth = image.width
            val frameHeight = image.height
            val plane = image.planes.firstOrNull() ?: error("Screen frame has no pixel plane")
            val pixelStride = plane.pixelStride
            val rowPadding = plane.rowStride - pixelStride * frameWidth
            val paddedWidth = frameWidth + rowPadding / pixelStride
            fullFrame = Bitmap.createBitmap(paddedWidth, frameHeight, Bitmap.Config.ARGB_8888)
            try {
                fullFrame.copyPixelsFromBuffer(plane.buffer)
            } finally {
                image.close()
            }

            val roiOnScreen = controls?.roiBoundsOnScreen() ?: error("ROI overlay is not available")
            val left = (roiOnScreen.left.toFloat() * frameWidth / screenWidth).toInt().coerceIn(0, frameWidth - 1)
            val top = (roiOnScreen.top.toFloat() * frameHeight / screenHeight).toInt().coerceIn(0, frameHeight - 1)
            val right = (roiOnScreen.right.toFloat() * frameWidth / screenWidth).toInt().coerceIn(left + 1, frameWidth)
            val bottom = (roiOnScreen.bottom.toFloat() * frameHeight / screenHeight).toInt().coerceIn(top + 1, frameHeight)
            val cropRect = Rect(left, top, right, bottom)
            roiCrop = Bitmap.createBitmap(fullFrame, cropRect.left, cropRect.top, cropRect.width(), cropRect.height())
            fullFrame.recycle()
            fullFrame = null

            scaled = BitmapPreprocessor.scaleForOcr(roiCrop)
            roiCrop.recycle()
            roiCrop = null
            prepared = BitmapPreprocessor.prepareForOcr(scaled)
            scaled.recycle()
            scaled = null

            check(!prepared.isRecycled) { "Prepared ROI bitmap was recycled before OCR handoff" }
            ocrBitmap = prepared.copy(Bitmap.Config.ARGB_8888, false)
                ?: error("Could not create OCR-owned bitmap copy")
            prepared.recycle()
            prepared = null

            val ownedBitmap = ocrBitmap
            val ocrStartedAt = System.nanoTime()
            recognizer.process(InputImage.fromBitmap(ownedBitmap, 0))
                .addOnSuccessListener { result ->
                    val ocrMs = (System.nanoTime() - ocrStartedAt) / 1_000_000L
                    val parsed = PriceTextParser.parse(result.text)
                    val status = when {
                        parsed.isAmbiguous -> "AMBIGUOUS_PRICE"
                        parsed.value != null -> "PRICE_READ"
                        else -> "NO_VALID_PRICE"
                    }
                    val frameMs = (System.currentTimeMillis() - frameStartedAt).coerceAtLeast(0L)
                    val memoryKb = usedHeapKb()
                    val message = status + " · manual ROI " + cropRect.width() + "x" + cropRect.height() + " px"
                    controls?.setStatus(
                        if (parsed.value != null) "PRICE " + parsed.value + " · ready for next capture"
                        else status + " · adjust ROI and tap again",
                        true
                    )
                    broadcast(
                        ACTION_METRIC,
                        message,
                        price = parsed.value,
                        candidates = parsed.candidates.joinToString(","),
                        ocrMs = ocrMs,
                        frameMs = frameMs,
                        memoryKb = memoryKb
                    )
                }
                .addOnFailureListener { error ->
                    controls?.setStatus("OCR failed · adjust ROI and retry", true)
                    broadcast(ACTION_ERROR, "OCR failed: " + (error.message ?: error.javaClass.simpleName))
                }
                .addOnCompleteListener {
                    if (!ownedBitmap.isRecycled) ownedBitmap.recycle()
                    processing.set(false)
                }
            handedToMlKit = true
        } finally {
            runCatching { image.close() }
            listOfNotNull(fullFrame, roiCrop, scaled, prepared).forEach { bitmap ->
                if (!bitmap.isRecycled) bitmap.recycle()
            }
            if (!handedToMlKit) {
                if (ocrBitmap != null && !ocrBitmap.isRecycled) ocrBitmap.recycle()
                processing.set(false)
            }
        }
    }

    private fun usedHeapKb(): Long {
        val runtime = Runtime.getRuntime()
        return (runtime.totalMemory() - runtime.freeMemory()) / 1024L
    }

    private fun displayMetrics(): DisplayMetrics {
        val result = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(result)
        return result
    }

    private fun buildNotification(message: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder.setContentTitle("OTC Vision Radar · Manual")
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
        captureRequested.set(false)
        controls?.remove()
        controls = null
        runCatching { imageReader?.setOnImageAvailableListener(null, null) }
        runCatching { virtualDisplay?.release() }
        virtualDisplay = null
        runCatching { imageReader?.close() }
        imageReader = null
        runCatching { projection?.unregisterCallback(projectionCallback) }
        if (stopProjection) runCatching { projection?.stop() }
        projection = null
        runCatching { captureThread?.quitSafely() }
        captureThread = null
        processing.set(false)
        isStopping = false
    }

    override fun onDestroy() {
        stopCapture()
        runCatching { recognizer.close() }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
