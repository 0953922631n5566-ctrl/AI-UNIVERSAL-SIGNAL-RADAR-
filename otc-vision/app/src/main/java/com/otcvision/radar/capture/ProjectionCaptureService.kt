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
import android.util.Log
import android.os.Looper
import android.widget.Toast
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
    @Volatile private var pendingRoiBounds: Rect? = null
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
        try {
            if (projection == null) {
                controls?.setStatus("Capture session is not active", true)
                return
            }
            val selectedBounds = controls?.roiBoundsOnScreen()
            if (selectedBounds == null || selectedBounds.width() <= 0 || selectedBounds.height() <= 0) {
                controls?.setStatus("ROI box is not ready · reposition it and retry", true)
                showCaptureToast("ROI box is not ready")
                return
            }
            if (processing.get() || !captureRequested.compareAndSet(false, true)) {
                controls?.setStatus("One capture is already in progress", false)
                return
            }
            pendingRoiBounds = Rect(selectedBounds)
            controls?.hideForCapture()
            updateNotification("Manual capture requested · waiting for next frame")
        } catch (error: Exception) {
            captureRequested.set(false)
            pendingRoiBounds = null
            controls?.showAfterFrame()
            controls?.setStatus("Capture request failed · tap to retry", true)
            reportCaptureFailure("CAPTURE_REQUEST", error)
        }
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
            controls?.showAfterFrame()
            controls?.setStatus("Frame error: " + (error.message ?: error.javaClass.simpleName), true)
            broadcast(ACTION_METRIC, "FRAME_ERROR · " + (error.message ?: error.javaClass.simpleName))
            return
        }
        if (frame == null) {
            processing.set(false)
            controls?.showAfterFrame()
            controls?.setStatus("No frame available · tap to retry", true)
            return
        }
        controls?.showAfterFrame()
        try {
            processSingleFrame(frame)
        } catch (error: Exception) {
            runCatching { frame.close() }
            processing.set(false)
            controls?.setStatus("Capture failed · tap to retry", true)
            broadcast(ACTION_METRIC, "CAPTURE_ERROR · " + (error.message ?: error.javaClass.simpleName))
        }
    }

    private fun processSingleFrame(image: Image) {
        var handedToMlKit = false
        var screenBitmap: Bitmap? = null
        var roiCrop: Bitmap? = null
        var scaled: Bitmap? = null
        var prepared: Bitmap? = null
        var ocrBitmap: Bitmap? = null
        val frameStartedAt = System.currentTimeMillis()
        var cropWidth = 0
        var cropHeight = 0
        try {
            // All capture conversion, coordinate mapping and cropping is guarded.
            val frameWidth = image.width
            val frameHeight = image.height
            check(frameWidth > 0 && frameHeight > 0) { "Screen frame has invalid dimensions" }
            val plane = image.planes.firstOrNull() ?: error("Screen frame has no pixel plane")
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            check(pixelStride > 0 && rowStride >= pixelStride * frameWidth) { "Screen frame has invalid row layout" }
            val rowPadding = rowStride - pixelStride * frameWidth
            val paddedWidth = frameWidth + rowPadding / pixelStride
            check(paddedWidth >= frameWidth && paddedWidth > 0) { "Screen frame bitmap width is invalid" }

            val frameBitmap = Bitmap.createBitmap(paddedWidth, frameHeight, Bitmap.Config.ARGB_8888)
            screenBitmap = frameBitmap
            frameBitmap.copyPixelsFromBuffer(plane.buffer)

            val roi = pendingRoiBounds?.let { Rect(it) }
                ?: error("ROI coordinates were not saved before capture")
            pendingRoiBounds = null
            check(screenWidth > 0 && screenHeight > 0) { "Display dimensions are unavailable" }

            // Convert absolute screen coordinates to frame pixels, then clamp to the real image bounds.
            val rawLeft = (roi.left.toDouble() * frameWidth / screenWidth).toInt()
            val rawTop = (roi.top.toDouble() * frameHeight / screenHeight).toInt()
            val rawRight = (roi.right.toDouble() * frameWidth / screenWidth).toInt()
            val rawBottom = (roi.bottom.toDouble() * frameHeight / screenHeight).toInt()
            val startX = rawLeft.coerceIn(0, frameBitmap.width)
            val startY = rawTop.coerceIn(0, frameBitmap.height)
            val endX = rawRight.coerceIn(0, frameBitmap.width)
            val endY = rawBottom.coerceIn(0, frameBitmap.height)
            val cropWidthSafe = endX - startX
            val cropHeightSafe = endY - startY
            check(startX >= 0 && startY >= 0 && cropWidthSafe > 0 && cropHeightSafe > 0 &&
                startX + cropWidthSafe <= frameBitmap.width &&
                startY + cropHeightSafe <= frameBitmap.height) {
                "ROI is outside the captured screen · move the box fully onto the display"
            }

            // Crop exactly the user-positioned ROI rectangle after strict bounds validation.
            val cropBitmap = Bitmap.createBitmap(frameBitmap, startX, startY, cropWidthSafe, cropHeightSafe)
            roiCrop = cropBitmap
            cropWidth = cropBitmap.width
            cropHeight = cropBitmap.height
            frameBitmap.recycle()
            screenBitmap = null

            val scaledBitmap = BitmapPreprocessor.scaleForOcr(cropBitmap)
            scaled = scaledBitmap
            cropBitmap.recycle()
            roiCrop = null
            val preparedBitmap = BitmapPreprocessor.prepareForOcr(scaledBitmap)
            prepared = preparedBitmap
            scaledBitmap.recycle()
            scaled = null

            check(!preparedBitmap.isRecycled && preparedBitmap.width > 0 && preparedBitmap.height > 0) {
                "Prepared ROI bitmap is empty or recycled"
            }
            val ownedBitmap = preparedBitmap.copy(Bitmap.Config.ARGB_8888, false)
                ?: error("Could not create OCR-owned bitmap copy")
            ocrBitmap = ownedBitmap
            preparedBitmap.recycle()
            prepared = null

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
                    val message = status + " · manual ROI " + cropWidth + "x" + cropHeight + " px"
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
                    reportCaptureFailure("OCR_FAILURE", error)
                }
                .addOnCompleteListener {
                    if (!ownedBitmap.isRecycled) ownedBitmap.recycle()
                    processing.set(false)
                }
            handedToMlKit = true
        } catch (error: Exception) {
            reportCaptureFailure("CAPTURE_OR_CROP", error)
            controls?.setStatus("Capture failed · adjust ROI and tap again", true)
            showCaptureToast(error.message ?: "Unable to capture selected ROI")
        } finally {
            runCatching { image.close() }
            listOfNotNull(screenBitmap, roiCrop, scaled, prepared).forEach { bitmap ->
                runCatching { if (!bitmap.isRecycled) bitmap.recycle() }
            }
            if (!handedToMlKit) {
                if (ocrBitmap != null && !ocrBitmap.isRecycled) runCatching { ocrBitmap.recycle() }
                processing.set(false)
            }
        }
    }

    private fun showCaptureToast(message: String) {
        Handler(Looper.getMainLooper()).post {
            runCatching { Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show() }
        }
    }

    private fun reportCaptureFailure(stage: String, error: Throwable) {
        Log.e("OtcManualCapture", "$stage: ${error.message}", error)
        runCatching {
            broadcast(ACTION_ERROR, "$stage · ${error.javaClass.simpleName}: ${error.message ?: "unknown error"}")
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
