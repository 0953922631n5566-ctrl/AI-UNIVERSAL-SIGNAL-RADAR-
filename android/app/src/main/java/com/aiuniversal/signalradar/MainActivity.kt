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
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val captureRequest = 4102
    private lateinit var status: TextView
    private lateinit var tokenInput: EditText
    private lateinit var saveTokenButton: Button
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private var receiverRegistered = false

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                CaptureService.ACTION_READY -> {
                    status.text = "กำลังจับภาพและอ่านป้ายราคา EUR/USD"
                    startButton.isEnabled = false
                    stopButton.isEnabled = true
                }
                CaptureService.ACTION_PRICE -> {
                    val price = intent.getStringExtra(CaptureService.EXTRA_PRICE) ?: "—"
                    val signal = intent.getStringExtra(CaptureService.EXTRA_SIGNAL) ?: "STANDBY"
                    val reason = intent.getStringExtra(CaptureService.EXTRA_REASON) ?: "ยังไม่มีเหตุผลจาก Server"
                    status.text = "ส่งราคา $price สำเร็จ · สัญญาณ $signal\nเหตุผล: $reason"
                }
                CaptureService.ACTION_FAILED -> {
                    val reason = intent.getStringExtra(CaptureService.EXTRA_ERROR) ?: "ไม่ทราบสาเหตุ"
                    status.text = "แจ้งเตือน: $reason"
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
            setPadding(32, 40, 32, 32)
        }
        val heading = TextView(this).apply {
            text = "AI SIGNAL RADAR OCR"
            textSize = 22f
        }
        val explanation = TextView(this).apply {
            text = "อ่านตัวเลขราคาบริเวณขอบขวาของกราฟ แล้วส่งราคา EUR/USD จริงเข้า Mini App"
            textSize = 14f
        }
        tokenInput = EditText(this).apply {
            hint = "วาง OCR Token ที่ได้รับ"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine(true)
        }
        val savedToken = getSharedPreferences("radar_config", MODE_PRIVATE).getString("ocr_token", "").orEmpty()
        if (savedToken.isNotBlank()) tokenInput.setText(savedToken)

        status = TextView(this).apply {
            text = if (savedToken.isBlank()) "กรุณาบันทึก Token ก่อนเริ่ม" else "พร้อมเชื่อมต่อ · Token บันทึกไว้ในเครื่อง"
            textSize = 16f
        }
        saveTokenButton = Button(this).apply { text = "บันทึก Token ในเครื่อง" }
        startButton = Button(this).apply {
            text = "START · เริ่มอ่านราคา"
            isEnabled = savedToken.isNotBlank()
        }
        stopButton = Button(this).apply { text = "STOP · หยุด"; isEnabled = false }

        layout.addView(heading)
        layout.addView(explanation)
        layout.addView(tokenInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        layout.addView(saveTokenButton)
        layout.addView(status)
        layout.addView(startButton)
        layout.addView(stopButton)
        setContentView(layout)

        val filter = IntentFilter().apply {
            addAction(CaptureService.ACTION_READY)
            addAction(CaptureService.ACTION_FAILED)
            addAction(CaptureService.ACTION_STOPPED)
            addAction(CaptureService.ACTION_PRICE)
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(serviceReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else {
            @Suppress("DEPRECATION")
            registerReceiver(serviceReceiver, filter)
        }
        receiverRegistered = true

        saveTokenButton.setOnClickListener {
            val token = tokenInput.text.toString().trim()
            if (token.length < 32) {
                status.text = "Token ไม่ถูกต้องหรือสั้นเกินไป"
                startButton.isEnabled = false
            } else {
                getSharedPreferences("radar_config", MODE_PRIVATE).edit().putString("ocr_token", token).apply()
                status.text = "บันทึก Token ในพื้นที่ส่วนตัวของแอปแล้ว"
                startButton.isEnabled = true
            }
        }

        startButton.setOnClickListener {
            try {
                val token = getSharedPreferences("radar_config", MODE_PRIVATE).getString("ocr_token", "").orEmpty()
                if (token.isBlank()) {
                    status.text = "กรุณาบันทึก Token ก่อน"
                    return@setOnClickListener
                }
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service) else startService(service)
                status.text = "กำลังเริ่ม OCR…"
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
