package com.aiuniversal.signalradar

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val captureRequest = 4102
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        status = TextView(this).apply { text = "พร้อมเริ่มจับภาพ"; textSize = 18f }
        val start = Button(this).apply { text = "START" }
        val stop = Button(this).apply { text = "STOP"; isEnabled = false }
        layout.addView(status)
        layout.addView(start)
        layout.addView(stop)
        setContentView(layout)

        start.setOnClickListener {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            startActivityForResult(manager.createScreenCaptureIntent(), captureRequest)
        }
        stop.setOnClickListener {
            startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP))
            status.text = "หยุดแล้ว"
            start.isEnabled = true
            stop.isEnabled = false
        }
    }

    @Deprecated("Deprecated in Android API; retained for the platform consent result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == captureRequest && resultCode == Activity.RESULT_OK && data != null) {
            val service = Intent(this, CaptureService::class.java).apply {
                action = CaptureService.ACTION_START
                putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
                putExtra(CaptureService.EXTRA_RESULT_DATA, data)
            }
            startForegroundService(service)
            status.text = "กำลังจับภาพ — ระบบยังแสดง STANDBY จนกว่าจะติดตั้งโมเดลที่ผ่านการทดสอบ"
            findViewById<LinearLayout>(android.R.id.content).getChildAt(0)
        } else if (requestCode == captureRequest) {
            status.text = "ยังไม่ได้รับอนุญาตจับภาพ"
        }
    }
}
