package com.aiuniversal.signalradar
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
class MainActivity:ComponentActivity(){
 private val prefs by lazy{getSharedPreferences("radar",MODE_PRIVATE)}
 private lateinit var status:TextView;private lateinit var signal:TextView;private lateinit var table:TextView
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)ActivityCompat.requestPermissions(this,arrayOf(Manifest.permission.POST_NOTIFICATIONS),7)
 val root=LinearLayout(this).apply{orientation=1;setPadding(24,24,24,24);setBackgroundColor(0xFF07110D.toInt())}
 fun label(s:String,n:Float=16f)=TextView(this).apply{text=s;textSize=n;setTextColor(0xFFFFFFFF.toInt());setPadding(0,10,0,10)}
 root.addView(label("KAWASAKI SIGNAL RADAR",22f));root.addView(label("MAIN MARKET · EUR/USD · M1",13f));status=label("● OFFLINE");root.addView(status);signal=label("STANDBY",34f);root.addView(signal)
 val url=EditText(this).apply{hint="HTTPS Server URL";setSingleLine();setText(prefs.getString("url","https://ai-signal-radar-main-market.onrender.com"))};val token=EditText(this).apply{hint="Android Client Token";setSingleLine();setText(prefs.getString("token",""))};root.addView(url);root.addView(token)
 root.addView(Button(this).apply{text="เริ่มแจ้งเตือนเบื้องหลัง";setOnClickListener{prefs.edit().putString("url",url.text.toString().trim()).putString("token",token.text.toString().trim()).apply();ContextCompat.startForegroundService(this@MainActivity,Intent(this@MainActivity,RadarService::class.java))}})
 root.addView(Button(this).apply{text="หยุดบริการ";setOnClickListener{stopService(Intent(this@MainActivity,RadarService::class.java))}});root.addView(label("สถานะ API Keys",18f));table=label("รอข้อมูลจากเซิร์ฟเวอร์");root.addView(table);root.addView(label("ทำงานเบื้องหลัง ไม่ใช้หน้าต่างลอยหรือ OCR",12f));setContentView(ScrollView(this).apply{addView(root)})
 RadarEvents.listener={d->runOnUiThread{val s=d.optString("signal","STANDBY");signal.text=s;signal.setTextColor(when(s){"CALL"->0xFF35D07F.toInt();"PUT"->0xFFFF5656.toInt();else->0xFFBBBBBB.toInt()});status.text="● "+d.optString("apiStatus","CONNECTING");table.text=d.optJSONObject("apiPool")?.toString(2)?:"API status unavailable"}}
 }
}