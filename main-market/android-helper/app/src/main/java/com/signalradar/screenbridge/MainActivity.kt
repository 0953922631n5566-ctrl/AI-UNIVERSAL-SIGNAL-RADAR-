package com.signalradar.screenbridge

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val requestCapture = 4102
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        status = TextView(this).apply {
            text = "หยุดจับภาพอยู่ — ไม่มีการเชื่อมต่อบัญชี IQ Option"
            textSize = 16f
            setPadding(24, 32, 24, 24)
        }
        val start = Button(this).apply {
            text = "เริ่มอนุญาตจับภาพหน้าจอ"
            setOnClickListener { startActivityForResult(manager.createScreenCaptureIntent(), requestCapture) }
        }
        val stop = Button(this).apply {
            text = "หยุดจับภาพ"
            setOnClickListener {
                stopService(Intent(this@MainActivity, ScreenCaptureService::class.java))
                status.text = "หยุดจับภาพแล้ว"
            }
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 20, 20, 20)
            addView(status)
            addView(start)
            addView(stop)
        })
    }

    @Deprecated("Deprecated by Android, retained for broad device compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != requestCapture) return
        if (resultCode != RESULT_OK || data == null) {
            status.text = "ยังไม่ได้อนุญาตจับภาพ"
            return
        }
        val service = Intent(this, ScreenCaptureService::class.java).apply {
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
        }
        startForegroundService(service)
        status.text = "กำลังจับภาพหน้าจอ — เปิด IQ Option และใช้โหมดแบ่งหน้าจอเพื่อทดสอบ"
    }
}
