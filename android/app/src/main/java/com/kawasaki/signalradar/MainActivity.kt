package com.kawasaki.signalradar

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt

private const val PREFS = "signal_radar_pro"
private const val DEFAULT_SERVER = "https://ai-universal-signal-radar-main.onrender.com"
private val BG = Color(0xFF080E18)
private val PANEL = Color(0xFF111B2A)
private val MUTED = Color(0xFF91A3B9)
private val GREEN = Color(0xFF20D68A)
private val RED = Color(0xFFFF5364)

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        setContent { RadarThaiScreen() }
    }
}

@Composable
private fun RadarThaiScreen() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()
    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", DEFAULT_SERVER) ?: DEFAULT_SERVER) }
    var savedUrl by remember { mutableStateOf(serverUrl) }
    var monitoring by remember { mutableStateOf(prefs.getBoolean("monitoring_enabled", false)) }
    var signal by remember { mutableStateOf("STANDBY") }
    var connection by remember { mutableStateOf("กำลังเชื่อมต่อ") }
    var reason by remember { mutableStateOf("รอข้อมูลตลาดจากเซิร์ฟเวอร์") }
    var price by remember { mutableStateOf("--") }
    var score by remember { mutableStateOf("--") }
    var regime by remember { mutableStateOf("ยังไม่ทราบ") }
    var countdown by remember { mutableStateOf("--") }
    var dataAge by remember { mutableStateOf("--") }
    var ema9 by remember { mutableStateOf("--") }; var ema21 by remember { mutableStateOf("--") }; var ema50 by remember { mutableStateOf("--") }
    var rsi by remember { mutableStateOf("--") }; var macd by remember { mutableStateOf("--") }
    var support by remember { mutableStateOf("--") }; var resistance by remember { mutableStateOf("--") }
    var volatility by remember { mutableStateOf("--") }; var momentum by remember { mutableStateOf("--") }
    var buyPressure by remember { mutableStateOf(50f) }
    var alertVolume by remember { mutableFloatStateOf(prefs.getInt("alert_volume", 75).toFloat()) }
    var mute by remember { mutableStateOf(prefs.getBoolean("mute_alerts", false)) }
    var message by remember { mutableStateOf("พร้อมทำงาน") }
    var testing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        while (true) {
            signal = prefs.getString("signal", "STANDBY") ?: "STANDBY"
            connection = prefs.getString("connection", "กำลังเชื่อมต่อ") ?: "กำลังเชื่อมต่อ"
            reason = prefs.getString("reason", "รอข้อมูลตลาด") ?: ""
            price = prefs.getString("price", "--") ?: "--"
            score = prefs.getString("score", "--") ?: "--"
            regime = prefs.getString("regime", "ยังไม่ทราบ") ?: "ยังไม่ทราบ"
            countdown = prefs.getString("countdown", "--") ?: "--"
            dataAge = prefs.getString("data_age", "--") ?: "--"
            ema9 = prefs.getString("ema9", "--") ?: "--"; ema21 = prefs.getString("ema21", "--") ?: "--"; ema50 = prefs.getString("ema50", "--") ?: "--"
            rsi = prefs.getString("rsi", "--") ?: "--"; macd = prefs.getString("macd", "--") ?: "--"
            support = prefs.getString("support", "--") ?: "--"; resistance = prefs.getString("resistance", "--") ?: "--"
            volatility = prefs.getString("volatility", "--") ?: "--"; momentum = prefs.getString("momentum", "--") ?: "--"
            monitoring = prefs.getBoolean("monitoring_enabled", false)
            val m = prefs.getString("momentum", "NEUTRAL") ?: "NEUTRAL"
            val emaBull = (prefs.getString("ema9", "0")?.toDoubleOrNull() ?: 0.0) > (prefs.getString("ema21", "0")?.toDoubleOrNull() ?: 0.0)
            buyPressure = when { m == "BULLISH" && emaBull -> 78f; m == "BEARISH" && !emaBull -> 22f; m == "BULLISH" || emaBull -> 62f; m == "BEARISH" || !emaBull -> 38f; else -> 50f }
            delay(1000)
        }
    }

    val signalColor = when (signal) { "CALL" -> GREEN; "PUT" -> RED; else -> Color(0xFF8793A5) }
    val thaiSignal = when (signal) { "CALL" -> "แรงซื้อเด่น · CALL"; "PUT" -> "แรงขายเด่น · PUT"; else -> "รอจังหวะ · STANDBY" }
    MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF63E6BE), background = BG, surface = PANEL, onSurface = Color.White)) {
        Surface(Modifier.fillMaxSize(), color = BG) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column { Text("AI SIGNAL RADAR", color = Color.White, fontSize = 21.sp, fontWeight = FontWeight.Black); Text("ตลาดจริง · EUR/USD · 1 นาที", color = MUTED, fontSize = 12.sp) }
                    Text(if (connection == "ONLINE") "● ออนไลน์" else "● $connection", color = if (connection == "ONLINE") GREEN else Color(0xFFFFB454), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Card(colors = CardDefaults.cardColors(containerColor = PANEL), shape = RoundedCornerShape(22.dp)) {
                    Column(Modifier.fillMaxWidth().padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("สถานะสัญญาณล่าสุด", color = MUTED, fontSize = 12.sp)
                        Text(thaiSignal, color = signalColor, fontSize = 27.sp, fontWeight = FontWeight.Black)
                        Spacer(Modifier.height(8.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                            MetricThai("ราคาปัจจุบัน", price); MetricThai("คะแนนหลักฐาน", if (score == "--") "--" else "$score%"); MetricThai("นับถอยหลัง", if (countdown == "--") "--" else "$countdown วิ")
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    InfoThai("สภาพตลาด", regime, Modifier.weight(1f))
                    InfoThai("อายุข้อมูล", dataAge, Modifier.weight(1f))
                }
                Card(colors = CardDefaults.cardColors(containerColor = PANEL), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("แรงซื้อ / แรงขาย (ประเมินจากอินดิเคเตอร์)", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("แรงขาย ${(100-buyPressure).roundToInt()}%", color = RED, fontSize = 12.sp)
                            Text("แรงซื้อ ${buyPressure.roundToInt()}%", color = GREEN, fontSize = 12.sp)
                        }
                        LinearProgressIndicator(progress = { buyPressure / 100f }, modifier = Modifier.fillMaxWidth().height(9.dp), color = GREEN, trackColor = RED)
                        Text("เป็นค่าประเมินจาก EMA และ Momentum ไม่ใช่ข้อมูล Order Book หรือปริมาณคำสั่งซื้อขายจริง", color = MUTED, fontSize = 10.sp)
                    }
                }
                Card(colors = CardDefaults.cardColors(containerColor = PANEL), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text("รายละเอียดการวิเคราะห์", color = Color.White, fontWeight = FontWeight.Bold)
                        DataRowThai("EMA 9 / 21 / 50", "$ema9  /  $ema21  /  $ema50")
                        DataRowThai("RSI (14)", rsi); DataRowThai("MACD Histogram", macd)
                        DataRowThai("แนวรับ", support); DataRowThai("แนวต้าน", resistance)
                        DataRowThai("ความผันผวน", volatility); DataRowThai("โมเมนตัม", momentum)
                        Divider(color = Color(0xFF29374A))
                        Text("เหตุผลจาก AI", color = MUTED, fontSize = 11.sp)
                        Text(reason, color = Color.White, fontSize = 13.sp)
                    }
                }
                Card(colors = CardDefaults.cardColors(containerColor = PANEL), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text("เปิด / ปิด การเฝ้าระวัง", color = Color.White, fontWeight = FontWeight.Bold); Text("ทำงานต่อเมื่อออกจากหน้าจอ", color = MUTED, fontSize = 11.sp) }
                            Switch(checked = monitoring, onCheckedChange = { enabled ->
                                prefs.edit().putBoolean("monitoring_enabled", enabled).apply(); monitoring = enabled
                                val intent = Intent(context, SignalPollingService::class.java)
                                if (enabled) { if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent) }
                                else context.stopService(intent)
                            })
                        }
                        Text(if (monitoring) "กำลังเฝ้าระวังอยู่" else "หยุดการเฝ้าระวังแล้ว", color = if (monitoring) GREEN else MUTED, fontSize = 12.sp)
                    }
                }
                Card(colors = CardDefaults.cardColors(containerColor = PANEL), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("ตั้งค่าเสียงแจ้งเตือน", color = Color.White, fontWeight = FontWeight.Bold)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("ระดับเสียง", color = MUTED, fontSize = 12.sp); Text("${alertVolume.roundToInt()}%", color = Color.White, fontSize = 12.sp)
                        }
                        Slider(value = alertVolume, onValueChange = { alertVolume = it }, valueRange = 0f..100f, onValueChangeFinished = { prefs.edit().putInt("alert_volume", alertVolume.roundToInt()).apply() })
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("ปิดเสียงแจ้งเตือน", color = MUTED, fontSize = 12.sp)
                            Switch(checked = mute, onCheckedChange = { mute = it; prefs.edit().putBoolean("mute_alerts", it).apply() })
                        }
                        Button(onClick = { playTestTone(alertVolume.roundToInt(), mute); message = if (mute) "เปิดปิดเสียงอยู่ กรุณาปลดปิดเสียงก่อน" else "ทดสอบเสียงแล้ว" }, modifier = Modifier.fillMaxWidth()) { Text("ทดสอบเสียง") }
                    }
                }
                Card(colors = CardDefaults.cardColors(containerColor = PANEL), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("การเชื่อมต่อเซิร์ฟเวอร์", color = Color.White, fontWeight = FontWeight.Bold)
                        OutlinedTextField(value = serverUrl, onValueChange = { serverUrl = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("ที่อยู่ Server") })
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { val u = serverUrl.trim().trimEnd('/'); if (u.startsWith("https://")) { savedUrl = u; prefs.edit().putString("server_url", u).apply(); message = "บันทึกที่อยู่ Server แล้ว" } else message = "กรุณาใช้ https://" }, modifier = Modifier.weight(1f)) { Text("บันทึก") }
                            Button(onClick = { testing = true; scope.launch { message = withContext(Dispatchers.IO) { testServer(savedUrl) }; testing = false } }, enabled = !testing, modifier = Modifier.weight(1f)) { Text(if (testing) "กำลังทดสอบ" else "ทดสอบระบบ") }
                        }
                        Text(message, color = Color(0xFF63E6BE), fontSize = 11.sp)
                    }
                }
                Text("หมายเหตุ: สัญญาณคำนวณจาก Server เดิม · ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ", color = MUTED, fontSize = 10.sp)
            }
        }
    }
}

@Composable private fun MetricThai(label: String, value: String) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(label, color = MUTED, fontSize = 10.sp); Text(value, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold) } }
@Composable private fun InfoThai(label: String, value: String, modifier: Modifier = Modifier) { Card(modifier, colors = CardDefaults.cardColors(containerColor = PANEL), shape = RoundedCornerShape(14.dp)) { Column(Modifier.padding(13.dp)) { Text(label, color = MUTED, fontSize = 10.sp); Text(value, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp) } } }
@Composable private fun DataRowThai(label: String, value: String) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, color = MUTED, fontSize = 12.sp); Text(value, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) } }

private fun playTestTone(volume: Int, muted: Boolean) {
    if (muted || volume <= 0) return
    try { val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, volume.coerceIn(1, 100)); tone.startTone(ToneGenerator.TONE_PROP_BEEP, 450) }
    catch (_: Exception) { }
}
private fun testServer(baseUrl: String): String = try {
    val conn = URL(baseUrl.trimEnd('/') + "/health").openConnection() as HttpURLConnection
    conn.requestMethod = "GET"; conn.connectTimeout = 7000; conn.readTimeout = 7000
    val body = conn.inputStream.bufferedReader().use { it.readText() }; conn.disconnect()
    val json = JSONObject(body)
    if (json.optString("status") == "ONLINE") "เชื่อมต่อสำเร็จ: " + json.optString("service") else "Server ตอบกลับ แต่ยังไม่ ONLINE"
} catch (e: Exception) { "เชื่อมต่อไม่สำเร็จ: " + (e.message ?: "ไม่ทราบสาเหตุ") }
