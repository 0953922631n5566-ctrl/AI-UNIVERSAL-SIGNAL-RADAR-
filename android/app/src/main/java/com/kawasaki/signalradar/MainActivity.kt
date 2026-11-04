package com.kawasaki.signalradar

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val PREFS = "signal_radar_pro"
private const val DEFAULT_SERVER = "https://ai-universal-signal-radar-main.onrender.com"

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (granted && prefs.getBoolean("monitoring_enabled", false)) startRadarService()
        if (!granted) prefs.edit().putBoolean("monitoring_enabled", false).apply()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean("monitoring_enabled", false) && notificationAllowed()) startRadarService()
        setContent { MinimalRadarScreen() }
    }

    private fun notificationAllowed(): Boolean =
        Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun startRadarService() {
        val intent = Intent(this, SignalPollingService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
    }

    fun setMonitoring(enabled: Boolean) {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (enabled && !notificationAllowed()) {
            prefs.edit().putBoolean("monitoring_enabled", true).apply()
            if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        prefs.edit().putBoolean("monitoring_enabled", enabled).apply()
        if (enabled) startRadarService() else stopService(Intent(this, SignalPollingService::class.java))
    }
}

@Composable
private fun MinimalRadarScreen() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val activity = context as MainActivity
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", DEFAULT_SERVER) ?: DEFAULT_SERVER) }
    var monitoring by remember { mutableStateOf(prefs.getBoolean("monitoring_enabled", false)) }
    var soundEnabled by remember { mutableStateOf(prefs.getBoolean("alert_sound_enabled", true)) }
    var saved by remember { mutableStateOf("Server URL ที่บันทึกไว้") }

    MaterialTheme(colorScheme = darkColorScheme(
        primary = Color(0xFF20D68A), background = Color(0xFF080E18),
        surface = Color(0xFF111B2A), onSurface = Color.White
    )) {
        Surface(Modifier.fillMaxSize(), color = Color(0xFF080E18)) {
            Column(
                Modifier.fillMaxSize().padding(22.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("SIGNAL RADAR PRO", color = Color.White, fontSize = 23.sp)
                Spacer(Modifier.height(8.dp))
                Text("EUR/USD · MAIN MARKET · M1 · Threshold 64", color = Color(0xFF91A3B9), fontSize = 12.sp)
                Spacer(Modifier.height(34.dp))
                Button(
                    onClick = {
                        val next = !monitoring
                        activity.setMonitoring(next)
                        monitoring = prefs.getBoolean("monitoring_enabled", false)
                    },
                    modifier = Modifier.fillMaxWidth().height(58.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (monitoring) Color(0xFF147D55) else Color(0xFF39465A)
                    ),
                    shape = RoundedCornerShape(18.dp)
                ) {
                    Text(if (monitoring) "●  SYSTEM ON" else "○  SYSTEM OFF", fontSize = 18.sp, color = Color.White)
                }
                Spacer(Modifier.height(14.dp))
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("เสียงแจ้งเตือน", color = Color.White, fontSize = 16.sp)
                        Text(
                            if (soundEnabled) "เปิดเสียง CALL / PUT" else "ปิดเสียงแจ้งเตือน",
                            color = Color(0xFF91A3B9), fontSize = 12.sp
                        )
                    }
                    Switch(
                        checked = soundEnabled,
                        onCheckedChange = { enabled ->
                            soundEnabled = enabled
                            prefs.edit().putBoolean("alert_sound_enabled", enabled).apply()
                        }
                    )
                }
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Render Server URL") }
                )
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = {
                        val value = serverUrl.trim().trimEnd('/')
                        if (value.startsWith("https://")) {
                            prefs.edit().putString("server_url", value).apply()
                            serverUrl = value
                            saved = "บันทึก Server URL แล้ว"
                        } else saved = "กรุณาใช้ URL แบบ HTTPS"
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("SAVE SERVER URL") }
                Spacer(Modifier.height(10.dp))
                Text(saved, color = Color(0xFF91A3B9), fontSize = 11.sp)
                Spacer(Modifier.height(18.dp))
                Text(
                    if (monitoring) "เฝ้าระวังเบื้องหลัง · ไม่ต้องเปิดหน้าจอแอป" else "ระบบหยุดทำงาน",
                    color = if (monitoring) Color(0xFF20D68A) else Color(0xFF91A3B9),
                    fontSize = 12.sp
                )
            }
        }
    }
}
