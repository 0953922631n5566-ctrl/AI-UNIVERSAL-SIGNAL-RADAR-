package com.aiuniversal.signalradar

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val captureRequest = 4102
    private lateinit var status: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private var receiverRegistered = false

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                CaptureService.ACTION_READY -> {
                    status.text = "อนุญาตแล้ว — เริ่มจับภาพหน้าจอ"
                    startButton.isEnabled = false
                    stopButton.isEnabled = true
                }
                CaptureService.ACTION_FAILED -> {
                    val reason = intent.getStringExtra(CaptureService.EXTRA_ERROR) ?: "ไม่ทราบสาเหตุ"
                    status.text = "เริ่มจับภาพไม่สำเร็จ: $reason"
                    startButton.isEnabled = true
                    stopButton.isEnabled = false
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
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        status = TextView(this).apply { text = "พร้อมเริ่มจับภาพ"; textSize = 18f }
        startButton = Button(this).apply { text = "START" }
        stopButton = Button(this).apply { text = "STOP"; isEnabled = false }
        layout.addView(status)
        layout.addView(startButton)
        layout.addView(stopButton)
        setContentView(layout)

        val filter = IntentFilter().apply {
            addAction(CaptureService.ACTION_READY)
            addAction(CaptureService.ACTION_FAILED)
            addAction(CaptureService.ACTION_STOPPED)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(serviceReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(serviceReceiver, filter)
        }
        receiverRegistered = true

        startButton.setOnClickListener {
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
            try {
                startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP))
                status.text = "กำลังหยุดจับภาพ…"
            } catch (e: Exception) {
                status.text = "หยุดไม่สำเร็จ: ${e.javaClass.simpleName}"
            }
        }
    }

    @Deprecated("Deprecated in Android API; retained for the platform consent result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != captureRequest) return

        if (resultCode == Activity.RESULT_OK && data != null) {
            val service = Intent(this, CaptureService::class.java).apply {
                action = CaptureService.ACTION_START
                putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
                putExtra(CaptureService.EXTRA_RESULT_DATA, data)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service)
                else startService(service)
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
        if (receiverRegistered) {
            unregisterReceiver(serviceReceiver)
            receiverRegistered = false
        }
        super.onDestroy()
    }
}
