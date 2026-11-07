package com.otcvision.radar.capture

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
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.widget.Toast
import android.view.WindowManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.UUID

/**
 * Server-side capture transmitter:
 * - ImageReader discards frames while idle.
 * - A user tap arms exactly one full-screen frame for HTTPS upload.
 * - Pixel copy is completed on the ImageReader thread, then Image is closed.
 * - JPEG compression and HTTP upload run only on Dispatchers.IO.
 * - All floating-view mutations are marshalled to the Android main thread.
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
        const val EXTRA_SIGNAL = "signal"
        const val EXTRA_SERVER_STATUS = "server_status"
        const val EXTRA_SERVER_REASON = "server_reason"
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
    @Volatile private var controls: ManualFloatingControls? = null
    private var screenWidth = 0
    private var screenHeight = 0
    private val captureRequested = AtomicBoolean(false)
    private val processing = AtomicBoolean(false)
    private val uploadSequence = AtomicInteger(0)
    private val uploadSessionId = UUID.randomUUID().toString()
    private val uploadScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var isStopping = false

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
                    check(Settings.canDrawOverlays(this)) { "Allow Display over other apps to use floating single scan button" }
                    startForegroundCompat()
                    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                    val data = if (Build.VERSION.SDK_INT >= 33) {
                        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(EXTRA_RESULT_DATA)
                    } ?: error("Missing MediaProjection consent result")
                    startCapture(resultCode, data)
                    updateNotification("Server upload ready · tap CAPTURE & SEND")
                } catch (error: Throwable) {
                    reportCaptureFailure("CAPTURE_START", error)
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
            onCapture = { requestManualCapture() }
        ).also { it.show(screenWidth, screenHeight) }
        broadcast(ACTION_METRIC, "SERVER_READY · tap CAPTURE & SEND to upload one full-screen frame")
    }

    private fun requestManualCapture() {
        try {
            if (projection == null) {
                controls?.setStatus("Capture session is not active", true)
                return
            }
            if (processing.get() || !captureRequested.compareAndSet(false, true)) {
                controls?.setStatus("Scan already in progress", false)
                return
            }
            // Keep the button visible so the user can see CAPTURING / SENDING state.
            updateNotification("Capturing one frame for server upload…")
        } catch (error: Throwable) {
            captureRequested.set(false)
            controls?.setStatus("FAILED · TAP TO RETRY", true)
            reportCaptureFailure("CAPTURE_REQUEST", error)
        }
    }

    /** Idle frames are discarded. A single full-screen frame is retained only after the user taps Capture & Send. */
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
        } catch (error: Throwable) {
            processing.set(false)
            controls?.setStatus("FRAME FAILED · TAP TO RETRY", true)
            reportCaptureFailure("FRAME_ACQUIRE", error)
            return
        }
        if (frame == null) {
            processing.set(false)
            controls?.setStatus("NO FRAME · TAP TO RETRY", true)
            broadcast(ACTION_METRIC, "FRAME_ERROR · no frame available")
            return
        }
        try {
            processSingleFrame(frame)
        } catch (error: Throwable) {
            runCatching { frame.close() }
            processing.set(false)
            controls?.setStatus("FAILED · TAP TO RETRY", true)
            reportCaptureFailure("FRAME_PIPELINE", error)
            showCaptureToast(error.message ?: "Unable to capture screen frame")
        }
    }

    /**
     * Copies the Image pixels into an independently owned Bitmap, closes the
     * Image immediately, and transfers Bitmap ownership to the IO coroutine.
     */
    private fun processSingleFrame(image: Image) {
        var pendingBitmap: Bitmap? = null
        var bitmapTransferredToUpload = false
        val frameStartedAt = System.currentTimeMillis()
        try {
            val config = SecureServerConfig.load(this)
                ?: error("Server URL/token not configured · open app and save server settings")
            val frameWidth = image.width
            val frameHeight = image.height
            check(frameWidth > 0 && frameHeight > 0) { "Screen frame has invalid dimensions" }
            val plane = image.planes.firstOrNull() ?: error("Screen frame has no pixel plane")
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            check(pixelStride > 0 && rowStride >= pixelStride * frameWidth) {
                "Screen frame has invalid row layout"
            }
            val rowPadding = rowStride - pixelStride * frameWidth
            val paddedWidth = frameWidth + rowPadding / pixelStride
            check(paddedWidth >= frameWidth && paddedWidth > 0) {
                "Screen frame bitmap width is invalid"
            }

            // This is only a pixel copy; JPEG compression and networking happen later on IO.
            val bitmap = Bitmap.createBitmap(paddedWidth, frameHeight, Bitmap.Config.ARGB_8888)
            pendingBitmap = bitmap
            bitmap.copyPixelsFromBuffer(plane.buffer)
            val capturedAtMs = System.currentTimeMillis()
            val sequence = uploadSequence.incrementAndGet()

            // ImageReader buffers are no longer referenced after this point.
            runCatching { image.close() }
            val uploadBitmap = bitmap
            pendingBitmap = null
            bitmapTransferredToUpload = true
            controls?.setStatus("SENDING…", false)

            val job = uploadScope.launch {
                try {
                    val result = withContext(Dispatchers.IO) {
                        FrameUploader.upload(
                            config = config,
                            sessionId = uploadSessionId,
                            sequence = sequence,
                            capturedAtMs = capturedAtMs,
                            bitmap = uploadBitmap
                        )
                    }
                    val elapsedMs = (System.currentTimeMillis() - frameStartedAt).coerceAtLeast(0L)
                    val priceText = result.price ?: "—"
                    val message = result.signal + " · " + result.status + " · " + elapsedMs + " ms"
                    val label = if (result.signal == "CALL" || result.signal == "PUT") {
                        result.signal + " · " + priceText
                    } else {
                        "STANDBY · " + priceText
                    }
                    withContext(Dispatchers.Main.immediate) {
                        controls?.setStatus(label, true)
                        showCaptureToast(result.signal + " · price " + priceText + "\n" + result.reason)
                        broadcast(
                            ACTION_METRIC,
                            message,
                            price = result.price,
                            signal = result.signal,
                            serverStatus = result.status,
                            serverReason = result.reason,
                            frameMs = elapsedMs
                        )
                        updateNotification("Server result: " + result.signal + " · " + priceText)
                    }
                } catch (error: Throwable) {
                    if (error is CancellationException) throw error
                    reportCaptureFailure("FRAME_UPLOAD", error)
                    val detail = error.message ?: error.javaClass.simpleName
                    withContext(NonCancellable + Dispatchers.Main.immediate) {
                        controls?.setStatus("FAILED · TAP TO RETRY", true)
                        showCaptureToast("Upload failed: " + detail)
                        broadcast(ACTION_METRIC, "UPLOAD_FAILED · " + detail)
                        runCatching { updateNotification("Upload failed · tap CAPTURE & SEND to retry") }
                    }
                }
            }
            // Also runs if the coroutine is cancelled before its body starts.
            job.invokeOnCompletion {
                runCatching { if (!uploadBitmap.isRecycled) uploadBitmap.recycle() }
                processing.set(false)
            }
        } catch (error: Throwable) {
            reportCaptureFailure("FRAME_PREPARE", error)
            val detail = error.message ?: error.javaClass.simpleName
            controls?.setStatus("FAILED · TAP TO RETRY", true)
            showCaptureToast("Capture failed: " + detail)
            broadcast(ACTION_METRIC, "CAPTURE_FAILED · " + detail)
        } finally {
            // Idempotent close: guarantees ImageReader never retains this frame.
            runCatching { image.close() }
            pendingBitmap?.let { bitmap ->
                runCatching { if (!bitmap.isRecycled) bitmap.recycle() }
            }
            if (!bitmapTransferredToUpload) processing.set(false)
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
        memoryKb: Long = -1L,
        signal: String? = null,
        serverStatus: String? = null,
        serverReason: String? = null
    ) {
        val intent = Intent(action).setPackage(packageName)
            .putExtra(EXTRA_MESSAGE, message)
            .putExtra(EXTRA_PRICE, price)
            .putExtra(EXTRA_CANDIDATES, candidates)
            .putExtra(EXTRA_OCR_MS, ocrMs)
            .putExtra(EXTRA_FRAME_MS, frameMs)
            .putExtra(EXTRA_MEMORY_KB, memoryKb)
            .putExtra(EXTRA_SIGNAL, signal)
            .putExtra(EXTRA_SERVER_STATUS, serverStatus)
            .putExtra(EXTRA_SERVER_REASON, serverReason)
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
        uploadScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
