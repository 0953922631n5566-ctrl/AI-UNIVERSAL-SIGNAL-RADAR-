package com.otcvision.radar

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.otcvision.radar.capture.ProjectionCaptureService

class MainActivity : Activity() {
    private val projectionRequestCode = 9101
    private lateinit var statusView: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private var receiverRegistered = false

    private val events = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ProjectionCaptureService.ACTION_METRIC -> {
                    val state = intent.getStringExtra(ProjectionCaptureService.EXTRA_MESSAGE) ?: "UNKNOWN"
                    val price = intent.getStringExtra(ProjectionCaptureService.EXTRA_PRICE) ?: "—"
                    val candidates = intent.getStringExtra(ProjectionCaptureService.EXTRA_CANDIDATES).orEmpty()
                    val ocrMs = intent.getLongExtra(ProjectionCaptureService.EXTRA_OCR_MS, -1L)
                    val frameMs = intent.getLongExtra(ProjectionCaptureService.EXTRA_FRAME_MS, -1L)
                    val memoryKb = intent.getLongExtra(ProjectionCaptureService.EXTRA_MEMORY_KB, -1L)
                    statusView.text = "Capture: ACTIVE\nOCR: " + state +
                        "\nPrice: " + price +
                        "\nCandidates: " + candidates.ifBlank { "—" } +
                        "\nOCR latency: " + ocrMs + " ms" +
                        "\nFrame age: " + frameMs + " ms" +
                        "\nApp heap used: " + (memoryKb / 1024) + " MB"
                }
                ProjectionCaptureService.ACTION_ERROR -> {
                    statusView.text = "ERROR\n" + (intent.getStringExtra(ProjectionCaptureService.EXTRA_MESSAGE) ?: "Unknown")
                    setCapturing(false)
                }
                ProjectionCaptureService.ACTION_STOPPED -> {
                    statusView.text = intent.getStringExtra(ProjectionCaptureService.EXTRA_MESSAGE) ?: "Capture stopped"
                    setCapturing(false)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 48, 36, 36)
        }
        val title = TextView(this).apply {
            text = "OTC VISION RADAR · PHASE 1"
            textSize = 21f
        }
        val description = TextView(this).apply {
            text = "Offline screen capture + on-device OCR. No network, server, FCM, or trade execution."
            textSize = 14f
        }
        statusView = TextView(this).apply {
            text = "Ready. Default price and chart ROIs are placeholders; calibrate for your broker layout."
            textSize = 15f
            setPadding(0, 24, 0, 24)
        }
        startButton = Button(this).apply { text = "START · Grant screen capture" }
        stopButton = Button(this).apply {
            text = "STOP · End capture"
            isEnabled = false
        }
        root.addView(title)
        root.addView(description)
        root.addView(statusView)
        root.addView(startButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(stopButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)

        val filter = IntentFilter().apply {
            addAction(ProjectionCaptureService.ACTION_METRIC)
            addAction(ProjectionCaptureService.ACTION_ERROR)
            addAction(ProjectionCaptureService.ACTION_STOPPED)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(events, filter, Context.RECEIVER_NOT_EXPORTED)
        else {
            @Suppress("DEPRECATION")
            registerReceiver(events, filter)
        }
        receiverRegistered = true

        startButton.setOnClickListener {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            statusView.text = "Waiting for Android screen-capture consent…"
            startActivityForResult(manager.createScreenCaptureIntent(), projectionRequestCode)
        }
        stopButton.setOnClickListener {
            startService(Intent(this, ProjectionCaptureService::class.java).setAction(ProjectionCaptureService.ACTION_STOP))
            statusView.text = "Stopping capture…"
        }
    }

    @Deprecated("Platform consent result callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != projectionRequestCode) return
        if (resultCode != RESULT_OK || data == null) {
            statusView.text = "Screen capture permission was not granted."
            setCapturing(false)
            return
        }
        val service = Intent(this, ProjectionCaptureService::class.java).apply {
            action = ProjectionCaptureService.ACTION_START
            putExtra(ProjectionCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ProjectionCaptureService.EXTRA_RESULT_DATA, data)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service) else startService(service)
            setCapturing(true)
            statusView.text = "Starting local capture and ML Kit OCR…"
        } catch (error: Exception) {
            statusView.text = "Could not start capture: " + error.javaClass.simpleName + ": " + (error.message ?: "")
            setCapturing(false)
        }
    }

    private fun setCapturing(active: Boolean) {
        startButton.isEnabled = !active
        stopButton.isEnabled = active
    }

    override fun onDestroy() {
        if (receiverRegistered) unregisterReceiver(events)
        super.onDestroy()
    }
}
