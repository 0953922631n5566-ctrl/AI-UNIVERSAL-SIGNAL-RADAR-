package com.universalbrokervision
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
 private val captureRequest=4107
 private lateinit var endpoint:EditText
 private lateinit var status:TextView
 private val prefs by lazy { getSharedPreferences("vision",Context.MODE_PRIVATE) }
 override fun onCreate(savedInstanceState:Bundle?) { super.onCreate(savedInstanceState)
  val pad=(18*resources.displayMetrics.density).toInt()
  val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(pad,pad,pad,pad) }
  root.addView(TextView(this).apply { text="BROKER VISION AI";textSize=24f })
  root.addView(TextView(this).apply { text="จับภาพหน้าจอเพื่ออ่านป้ายราคาและแท่งเทียน" })
  endpoint=EditText(this).apply { hint="https://your-vision-api.onrender.com";setText(prefs.getString("endpoint","https://universal-broker-vision-api.onrender.com")) }
  root.addView(endpoint)
  status=TextView(this).apply { text="พร้อมเริ่ม · ต้องอนุญาตการจับภาพหน้าจอ" };root.addView(status)
  root.addView(Button(this).apply { text="เริ่มจับภาพหน้าจอ";setOnClickListener { beginCapture() } })
  root.addView(Button(this).apply { text="หยุดจับภาพ";setOnClickListener { stopService(Intent(this@MainActivity,CaptureService::class.java));status.text="หยุดจับภาพแล้ว" } })
  root.addView(TextView(this).apply { text="ไม่ต้องกรอก Token · แอปจะเชื่อมต่อและขอสิทธิ์จับภาพให้อัตโนมัติ" })
  setContentView(root)
 }
 private fun beginCapture() {
  val url=endpoint.text.toString().trim().trimEnd('/')
  if(!url.startsWith("https://")){status.text="กรุณาตรวจสอบ HTTPS API URL";return}
  prefs.edit().putString("endpoint",url).apply()
  status.text="กำลังเชื่อมต่อและขอ Token ชั่วคราวอัตโนมัติ…"
  Thread {
   var connection:HttpURLConnection?=null
   try {
    connection=(URL("$url/api/vision/enroll").openConnection() as HttpURLConnection).apply {
     requestMethod="POST";connectTimeout=15000;readTimeout=15000;doOutput=true
     setRequestProperty("Content-Type","application/json")
    }
    connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
    val responseCode=connection.responseCode
    val stream=if(responseCode in 200..299)connection.inputStream else connection.errorStream
    val body=stream.bufferedReader().use{it.readText()}
    if(responseCode !in 200..299) throw IllegalStateException("เชื่อมต่อไม่สำเร็จ ($responseCode): $body")
    val secret=JSONObject(body).getString("token")
    prefs.edit().putString("token",secret).apply()
    runOnUiThread {
     status.text="เชื่อมต่อสำเร็จ · กำลังขออนุญาตจับภาพหน้าจอ"
     val manager=getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
     startActivityForResult(manager.createScreenCaptureIntent(),captureRequest)
    }
   } catch(e:Exception) {
    runOnUiThread { status.text="เชื่อมต่อไม่สำเร็จ: ${e.message ?: "โปรดลองอีกครั้ง"}" }
   } finally { connection?.disconnect() }
  }.start()
 }
 @Deprecated("MediaProjection consent result")
 override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) { super.onActivityResult(requestCode,resultCode,data)
  if(requestCode!=captureRequest)return
  if(resultCode!=Activity.RESULT_OK||data==null){status.text="ไม่ได้อนุญาตการจับภาพ";return}
  val service=Intent(this,CaptureService::class.java).apply {
   action=CaptureService.ACTION_START;putExtra(CaptureService.EXTRA_RESULT_CODE,resultCode)
   putExtra(CaptureService.EXTRA_RESULT_DATA,data);putExtra(CaptureService.EXTRA_ENDPOINT,prefs.getString("endpoint",""))
   putExtra(CaptureService.EXTRA_TOKEN,prefs.getString("token",""))
  }
  androidx.core.content.ContextCompat.startForegroundService(this,service)
  status.text="เริ่มจับภาพแล้ว · สลับไปหน้าโบรกเกอร์ได้"
 }
}