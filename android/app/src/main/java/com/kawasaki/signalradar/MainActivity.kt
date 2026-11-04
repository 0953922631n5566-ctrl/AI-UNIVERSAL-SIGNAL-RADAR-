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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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

private const val PREFS = "signal_radar_pro"
private const val DEFAULT_SERVER = "https://ai-universal-signal-radar-main.onrender.com"

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent { RadarProScreen() }
    }
}

@androidx.compose.runtime.Composable
private fun RadarProScreen() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()
    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", DEFAULT_SERVER) ?: DEFAULT_SERVER) }
    var savedUrl by remember { mutableStateOf(prefs.getString("server_url", DEFAULT_SERVER) ?: DEFAULT_SERVER) }
    var monitoring by remember { mutableStateOf(prefs.getBoolean("monitoring_enabled", false)) }
    var signal by remember { mutableStateOf(prefs.getString("signal", "STANDBY") ?: "STANDBY") }
    var connection by remember { mutableStateOf(prefs.getString("connection", "CONNECTING") ?: "CONNECTING") }
    var reason by remember { mutableStateOf(prefs.getString("reason", "Waiting for first market update") ?: "") }
    var price by remember { mutableStateOf(prefs.getString("price", "--") ?: "--") }
    var score by remember { mutableStateOf(prefs.getString("score", "--") ?: "--") }
    var regime by remember { mutableStateOf(prefs.getString("regime", "UNCLEAR") ?: "UNCLEAR") }
    var countdown by remember { mutableStateOf(prefs.getString("countdown", "--") ?: "--") }
    var message by remember { mutableStateOf("Ready") }
    var testing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        while (true) {
            signal = prefs.getString("signal", "STANDBY") ?: "STANDBY"
            connection = prefs.getString("connection", "CONNECTING") ?: "CONNECTING"
            reason = prefs.getString("reason", "Waiting for market data") ?: ""
            price = prefs.getString("price", "--") ?: "--"
            score = prefs.getString("score", "--") ?: "--"
            regime = prefs.getString("regime", "UNCLEAR") ?: "UNCLEAR"
            countdown = prefs.getString("countdown", "--") ?: "--"
            monitoring = prefs.getBoolean("monitoring_enabled", false)
            delay(1000)
        }
    }

    val signalColor = when (signal) {
        "CALL" -> Color(0xFF20D68A)
        "PUT" -> Color(0xFFFF5364)
        else -> Color(0xFF8793A5)
    }
    val displaySignal = when (signal) {
        "CALL" -> "BUY"
        "PUT" -> "SELL"
        else -> "STANDBY"
    }

    MaterialTheme(colorScheme = darkColorScheme(
        primary = Color(0xFF63E6BE),
        background = Color(0xFF080E18),
        surface = Color(0xFF111B2A),
        onSurface = Color(0xFFEAF1FA)
    )) {
        Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFF080E18)) {
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()) {
                    Column {
                        Text("AI SIGNAL RADAR", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black)
                        Text("PRO  ·  MAIN MARKET  ·  EUR/USD M1", color = Color(0xFF91A3B9), fontSize = 11.sp)
                    }
                    Text("● LIVE", color = if (connection == "ONLINE") Color(0xFF35D69A) else Color(0xFFFFB454),
                        fontWeight = FontWeight.Bold, fontSize = 12.sp)
                }

                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111B2A)),
                    shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("CURRENT SIGNAL", color = Color(0xFF91A3B9), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(8.dp))
                        Text(displaySignal, color = signalColor, fontSize = 42.sp, fontWeight = FontWeight.Black)
                        Text(if (signal == "STANDBY") "Waiting for confirmed setup" else "Signal received · check entry timing",
                            color = Color(0xFFB5C2D2), fontSize = 12.sp)
                        Spacer(Modifier.height(18.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                            Metric("PRICE", price)
                            Metric("EVIDENCE", if (score == "--") "--" else "$score%")
                            Metric("M1 TIMER", if (countdown == "--") "--" else "$countdown s")
                        }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    InfoCard("MARKET REGIME", regime, Modifier.weight(1f))
                    InfoCard("SERVER", connection, Modifier.weight(1f))
                }

                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111B2A)),
                    shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Text("SIGNAL ANALYSIS", color = Color(0xFF91A3B9), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(6.dp))
                        Text(reason, color = Color(0xFFEAF1FA), fontSize = 13.sp)
                    }
                }

                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111B2A)),
                    shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.weight(1f)) {
                                Text("BACKGROUND ALERTS", color = Color.White, fontWeight = FontWeight.Bold)
                                Text("Keep monitoring while the app is in background", color = Color(0xFF91A3B9), fontSize = 11.sp)
                            }
                            Switch(checked = monitoring, onCheckedChange = { enabled ->
                                prefs.edit().putBoolean("monitoring_enabled", enabled).apply()
                                monitoring = enabled
                                val intent = Intent(context, SignalPollingService::class.java)
                                if (enabled) {
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                                    else context.startService(intent)
                                } else context.stopService(intent)
                            })
                        }
                        Text("An ongoing Android notification is shown while monitoring is active.",
                            color = Color(0xFF91A3B9), fontSize = 11.sp)
                    }
                }

                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111B2A)),
                    shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("SERVER SETTINGS", color = Color.White, fontWeight = FontWeight.Bold)
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = { serverUrl = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            label = { Text("Render Server URL") },
                            placeholder = { Text("https://your-service.onrender.com") }
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = {
                                val normalized = serverUrl.trim().trimEnd('/')
                                if (!normalized.startsWith("https://")) {
                                    message = "Use a secure https:// server URL"
                                } else {
                                    savedUrl = normalized
                                    serverUrl = normalized
                                    prefs.edit().putString("server_url", normalized).apply()
                                    message = "Server URL saved"
                                }
                            }, modifier = Modifier.weight(1f)) { Text("SAVE URL") }
                            Button(onClick = {
                                testing = true
                                scope.launch {
                                    message = withContext(Dispatchers.IO) { testServer(savedUrl) }
                                    testing = false
                                }
                            }, modifier = Modifier.weight(1f), enabled = !testing) {
                                Text(if (testing) "TESTING..." else "TEST LINK")
                            }
                        }
                        Text(message, color = Color(0xFF63E6BE), fontSize = 12.sp)
                    }
                }
                Text("Notifications require Android permission. Keep the monitor switch ON for background polling. Force-stopping the app stops monitoring.",
                    color = Color(0xFF77879B), fontSize = 10.sp)
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun Metric(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, color = Color(0xFF91A3B9), fontSize = 9.sp, fontWeight = FontWeight.Bold)
        Text(value, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}

@androidx.compose.runtime.Composable
private fun InfoCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = Color(0xFF111B2A)),
        shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(14.dp)) {
            Text(label, color = Color(0xFF91A3B9), fontSize = 9.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(5.dp))
            Text(value, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}

private fun testServer(baseUrl: String): String {
    return try {
        val connection = (URL(baseUrl.trimEnd('/') + "/health").openConnection() as HttpURLConnection)
        connection.requestMethod = "GET"
        connection.connectTimeout = 7000
        connection.readTimeout = 7000
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        connection.disconnect()
        val json = JSONObject(body)
        if (json.optString("status") == "ONLINE") "Connected: " + json.optString("service")
        else "Server responded, but status is not ONLINE"
    } catch (error: Exception) {
        "Connection failed: " + (error.message ?: "Unknown error")
    }
}
