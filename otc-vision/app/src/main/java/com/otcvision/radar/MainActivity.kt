package com.otcvision.radar

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.net.Uri
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.otcvision.radar.capture.ProjectionCaptureService
import com.otcvision.radar.capture.SecureServerConfig

class MainActivity : Activity() {
    private val projectionRequestCode = 9101
    private val overlayRequestCode = 9102
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
                    val signal = intent.getStringExtra(ProjectionCaptureService.EXTRA_SIGNAL) ?: "STANDBY"
                    val serverStatus = intent.getStringExtra(ProjectionCaptureService.EXTRA_SERVER_STATUS) ?: "WAITING"
                    val reason = intent.getStringExtra(ProjectionCaptureService.EXTRA_SERVER_REASON).orEmpty()
                    val elapsedMs = intent.getLongExtra(ProjectionCaptureService.EXTRA_FRAME_MS, -1L)
                    statusView.text = "Capture: ACTIVE\nServer signal: " + signal +
                        "\nServer status: " + serverStatus +
                        "\nPrice: " + price +
                        "\nUpload + analysis: " + elapsedMs + " ms" +
                        "\nDetails: " + (reason.ifBlank { state })
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
            setPadding(36, 40, 36, 36)
        }
        val title = TextView(this).apply {
            text = "OTC VISION RADAR · SERVER MODE"
            textSize = 21f
        }
        val description = TextView(this).apply {
            text = "One-tap full-screen capture. JPEG is sent over HTTPS; OCR and analysis run on the server."
            textSize = 14f
        }
        val serverUrlInput = EditText(this).apply {
            hint = "HTTPS server base URL (without /v1/frame)"
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        val serverTokenInput = EditText(this).apply {
            hint = "Server ingest token"
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val saveServerButton = Button(this).apply { text = "SAVE SERVER SETTINGS" }
        statusView = TextView(this).apply {
            text = "Enter the server URL and token, save once, then start capture. The token is encrypted with Android Keystore."
            textSize = 15f
            setPadding(0, 20, 0, 20)
        }
        startButton = Button(this).apply { text = "START · Grant screen capture" }
        stopButton = Button(this).apply {
            text = "STOP · End capture"
            isEnabled = false
        }
        root.addView(title)
        root.addView(description)
        root.addView(serverUrlInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(serverTokenInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(saveServerButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
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

        saveServerButton.setOnClickListener {
            try {
                SecureServerConfig.save(this, serverUrlInput.text.toString(), serverTokenInput.text.toString())
                serverTokenInput.text?.clear()
                statusView.text = "Server settings saved. Token encrypted with Android Keystore."
            } catch (error: Exception) {
                statusView.text = "Server settings invalid: " + (error.message ?: error.javaClass.simpleName)
            }
        }
        startButton.setOnClickListener {
            if (SecureServerConfig.load(this) == null) {
                statusView.text = "Save a valid HTTPS server URL and ingest token first."
                return@setOnClickListener
            }
            if (!Settings.canDrawOverlays(this)) {
                statusView.text = "Allow Display over other apps so the floating CAPTURE & SEND button can appear above the broker app."
                startActivityForResult(
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")),
                    overlayRequestCode
                )
            } else {
                requestScreenCaptureConsent()
            }
        }
        stopButton.setOnClickListener {
            startService(Intent(this, ProjectionCaptureService::class.java).setAction(ProjectionCaptureService.ACTION_STOP))
            statusView.text = "Stopping capture…"
        }
    }

    private fun requestScreenCaptureConsent() {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        statusView.text = "Waiting for Android screen-capture consent…"
        startActivityForResult(manager.createScreenCaptureIntent(), projectionRequestCode)
    }

    @Deprecated("Platform consent result callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == overlayRequestCode) {
            if (Settings.canDrawOverlays(this)) requestScreenCaptureConsent()
            else statusView.text = "Overlay permission is required for the floating scan button."
            return
        }
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
            statusView.text = "Starting one-tap full-screen server uploader…"
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
