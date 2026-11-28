package com.aiuniversal.signalradar

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    companion object {
        private const val CAPTURE_REQUEST = 4107
        private const val DEFAULT_ENDPOINT = "https://universal-broker-vision-api.onrender.com"
    }

    private lateinit var endpointInput: EditText
    private lateinit var intervalInput: EditText
    private lateinit var status: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private var activeEndpoint = DEFAULT_ENDPOINT
    private var deviceToken = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("vision_config", MODE_PRIVATE)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        root.addView(TextView(this).apply { text = "UNIVERSAL BROKER VISION"; textSize = 22f; setPadding(0, 0, 0, pad / 2) })
        root.addView(TextView(this).apply { text = "จับภาพหน้าจอโบรกเกอร์ อ่านราคาและแท่งเทียน แล้วส่งเข้า Telegram Mini App"; textSize = 14f })
        endpointInput = EditText(this).apply {
            hint = "Vision API URL"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI; setSingleLine(true)
            setText(prefs.getString("endpoint", DEFAULT_ENDPOINT))
        }
        root.addView(endpointInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(TextView(this).apply { text = "รอบจับภาพ (มิลลิวินาที) · แนะนำ 300"; textSize = 13f; setPadding(0, pad / 2, 0, 0) })
        intervalInput = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER; setSingleLine(true); setText(prefs.getLong("interval_ms", 300L).toString()) }
        root.addView(intervalInput)
        status = TextView(this).apply { text = "พร้อมทำงาน · ใช้ราคาและภาพจาก APK เท่านั้น"; textSize = 15f; setPadding(0, pad, 0, pad / 2) }
        startButton = Button(this).apply { text = "เริ่มจับภาพหน้าจอ" }
        stopButton = Button(this).apply { text = "หยุดจับภาพ"; isEnabled = false }
        root.addView(status); root.addView(startButton); root.addView(stopButton)
        root.addView(TextView(this).apply {
            text = "เมื่ออนุญาตจับภาพแล้ว ให้สลับไปหน้าโบรกเกอร์และเปิด Telegram Mini App ได้"
            textSize = 12f; setPadding(0, pad / 2, 0, 0)
        })
        setContentView(root)
        startButton.setOnClickListener { enrollAndRequestCapture() }
        stopButton.setOnClickListener {
            startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP))
            status.text = "ส่งคำสั่งหยุดจับภาพแล้ว"; startButton.isEnabled = true; stopButton.isEnabled = false
        }
        requestNotificationPermission()
    }

    private fun enrollAndRequestCapture() {
        val url = endpointInput.text.toString().trim().trimEnd('/')
        if (!url.startsWith("https://")) { status.text = "กรุณาใส่ Vision API URL ที่ขึ้นต้นด้วย https://"; return }
        val interval = intervalInput.text.toString().toLongOrNull()?.coerceIn(100L, 2000L) ?: 300L
        activeEndpoint = url
        getSharedPreferences("vision_config", MODE_PRIVATE).edit().putString("endpoint", url).putLong("interval_ms", interval).apply()
        startButton.isEnabled = false; status.text = "กำลังเชื่อมต่อ Vision API และขอ Token อุปกรณ์…"
        Thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL("$url/api/vision/enroll").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; connectTimeout = 12000; readTimeout = 12000; doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                if (code !in 200..299) throw IllegalStateException("API ตอบ HTTP $code: $body")
                deviceToken = JSONObject(body).getString("token")
                runOnUiThread {
                    status.text = "เชื่อมต่อสำเร็จ · กำลังขออนุญาตจับภาพหน้าจอ"
                    val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                    startActivityForResult(manager.createScreenCaptureIntent(), CAPTURE_REQUEST)
                }
            } catch (e: Exception) {
                runOnUiThread { status.text = "เชื่อมต่อไม่สำเร็จ: ${e.message ?: e.javaClass.simpleName}"; startButton.isEnabled = true }
            } finally { connection?.disconnect() }
        }.start()
    }

    @Deprecated("MediaProjection consent result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != CAPTURE_REQUEST) return
        if (resultCode != Activity.RESULT_OK || data == null) {
            status.text = "ไม่ได้อนุญาตให้จับภาพหน้าจอ"; startButton.isEnabled = true; return
        }
        val interval = intervalInput.text.toString().toLongOrNull()?.coerceIn(100L, 2000L) ?: 300L
        val service = Intent(this, CaptureService::class.java).apply {
            action = CaptureService.ACTION_START
            putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(CaptureService.EXTRA_RESULT_DATA, data)
            putExtra(CaptureService.EXTRA_ENDPOINT, activeEndpoint)
            putExtra(CaptureService.EXTRA_TOKEN, deviceToken)
            putExtra(CaptureService.EXTRA_INTERVAL_MS, interval)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service) else startService(service)
            status.text = "กำลังจับภาพต่อเนื่องทุก ${interval} ms · สลับไปหน้าโบรกเกอร์ได้"; stopButton.isEnabled = true
        } catch (e: Exception) {
            status.text = "เริ่มบริการไม่สำเร็จ: ${e.message ?: e.javaClass.simpleName}"
            startButton.isEnabled = true; stopButton.isEnabled = false
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 101)
    }
}
