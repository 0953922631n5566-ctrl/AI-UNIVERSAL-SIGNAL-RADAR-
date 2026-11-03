package com.aiuniversal.signalradar

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val captureRequest = 4102
    private lateinit var status: TextView
    private lateinit var tokenInput: EditText
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private var receiverRegistered = false

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                CaptureService.ACTION_READY -> {
                    status.text = "อนุญาตแล้ว — กำลังจับภาพและส่งเฟรม"
                    startButton.isEnabled = false
                    stopButton.isEnabled = true
                }
                CaptureService.ACTION_FAILED -> {
                    val reason = intent.getStringExtra(CaptureService.EXTRA_ERROR) ?: "ไม่ทราบสาเหตุ"
                    status.text = "เริ่มจับภาพไม่สำเร็จ: $reason"
                    startButton.isEnabled = true
                    stopButton.isEnabled = false
                }
                CaptureService.ACTION_STATUS -> {
                    status.text = intent.getStringExtra(CaptureService.EXTRA_MESSAGE) ?: "กำลังทำงาน"
                }
                CaptureService.ACTION_STOPPED -> {
                    status.text = "หยุดจับภาพแล้ว"
                    startButton.isEnabled = true
                    stopButton.isEnabled = false
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("radar_state", MODE_PRIVATE)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        status = TextView(this).apply { text = "พร้อมเริ่มจับภาพ"; textSize = 17f }
        tokenInput = EditText(this).apply {
            hint = "Backend access token"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(prefs.getString("ingest_token", ""))
        }
        startButton = Button(this).apply { text = "START" }
        stopButton = Button(this).apply { text = "STOP"; isEnabled = false }
        layout.addView(status)
        layout.addView(tokenInput)
        layout.addView(startButton)
        layout.addView(stopButton)
        setContentView(layout)

        val filter = IntentFilter().apply {
            addAction(CaptureService.ACTION_READY)
            addAction(CaptureService.ACTION_FAILED)
            addAction(CaptureService.ACTION_STATUS)
            addAction(CaptureService.ACTION_STOPPED)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(serviceReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else { @Suppress("DEPRECATION") registerReceiver(serviceReceiver, filter) }
        receiverRegistered = true

        startButton.setOnClickListener {
            val token = tokenInput.text.toString().trim()
            if (token.isBlank()) {
                status.text = "กรุณาใส่ access token ที่ตั้งไว้ใน Backend ก่อน"
                return@setOnClickListener
            }
            prefs.edit().putString("ingest_token", token).apply()
            try {
                val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                startButton.isEnabled = false
                status.text = "รออนุญาตจับภาพหน้าจอ…"
                startActivityForResult(manager.createScreenCaptureIntent(), captureRequest)
            } catch (e: Exception) {
                startButton.isEnabled = true
                status.text = "เปิดหน้าขออนุญาตไม่สำเร็จ: ${e.javaClass.simpleName}: ${e.message ?: "-"}"
            }
        }
        stopButton.setOnClickListener {
            startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP))
            status.text = "กำลังหยุดจับภาพ…"
        }
    }

    @Deprecated("Deprecated for platform consent result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != captureRequest) return
        if (resultCode == Activity.RESULT_OK && data != null) {
            val token = getSharedPreferences("radar_state", MODE_PRIVATE).getString("ingest_token", "") ?: ""
            val service = Intent(this, CaptureService::class.java).apply {
                action = CaptureService.ACTION_START
                putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
                putExtra(CaptureService.EXTRA_RESULT_DATA, data)
                putExtra(CaptureService.EXTRA_TOKEN, token)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service) else startService(service)
                status.text = "กำลังเริ่มบริการจับภาพ…"
            } catch (e: Exception) {
                status.text = "เปิดบริการจับภาพไม่สำเร็จ: ${e.javaClass.simpleName}: ${e.message ?: "-"}"
                startButton.isEnabled = true
                stopButton.isEnabled = false
            }
        } else {
            status.text = "ยกเลิกการอนุญาตจับภาพ"
            startButton.isEnabled = true
            stopButton.isEnabled = false
        }
    }

    override fun onDestroy() {
        if (receiverRegistered) unregisterReceiver(serviceReceiver)
        super.onDestroy()
    }
}
