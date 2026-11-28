package com.universalbrokervision
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
 private val captureRequest=4107
 private lateinit var endpoint:EditText
 private lateinit var token:EditText
 private lateinit var status:TextView
 private val prefs by lazy { getSharedPreferences("vision",Context.MODE_PRIVATE) }
 override fun onCreate(savedInstanceState:Bundle?) { super.onCreate(savedInstanceState)
  val pad=(18*resources.displayMetrics.density).toInt()
  val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(pad,pad,pad,pad) }
  root.addView(TextView(this).apply { text="BROKER VISION AI";textSize=24f })
  root.addView(TextView(this).apply { text="จับภาพหน้าจอเพื่ออ่านป้ายราคาและแท่งเทียน" })
  endpoint=EditText(this).apply { hint="https://your-vision-api.onrender.com";setText(prefs.getString("endpoint","https://universal-broker-vision-api.onrender.com")) }
  token=EditText(this).apply { hint="Vision API token";setText(prefs.getString("token",""));inputType=129 }
  root.addView(endpoint);root.addView(token)
  status=TextView(this).apply { text="พร้อมเริ่ม · ต้องอนุญาตการจับภาพหน้าจอ" };root.addView(status)
  root.addView(Button(this).apply { text="เริ่มจับภาพหน้าจอ";setOnClickListener { beginCapture() } })
  root.addView(Button(this).apply { text="หยุดจับภาพ";setOnClickListener { stopService(Intent(this@MainActivity,CaptureService::class.java));status.text="หยุดจับภาพแล้ว" } })
  root.addView(TextView(this).apply { text="กรอก API URL และ Token กดเริ่ม อนุญาตการจับภาพ แล้วสลับไปหน้าแพลตฟอร์มโบรกเกอร์" })
  setContentView(root)
 }
 private fun beginCapture() {
  val url=endpoint.text.toString().trim().trimEnd('/');val secret=token.text.toString().trim()
  if(!url.startsWith("https://")||secret.isBlank()){status.text="กรุณากรอก HTTPS API URL และ Token ให้ครบ";return}
  prefs.edit().putString("endpoint",url).putString("token",secret).apply()
  val manager=getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
  startActivityForResult(manager.createScreenCaptureIntent(),captureRequest)
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