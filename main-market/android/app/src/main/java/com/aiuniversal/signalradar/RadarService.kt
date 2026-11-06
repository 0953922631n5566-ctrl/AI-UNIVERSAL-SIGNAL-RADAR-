package com.aiuniversal.signalradar
import android.app.*
import android.content.Intent
import android.os.IBinder
import android.os.Build
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
class RadarService:Service(){
 private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO);private val client=OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build();private var socket:WebSocket?=null;private var session="";private var lastAlert="";private val channel="radar_signal"
 override fun onStartCommand(i:Intent?,f:Int,id:Int):Int{createChannel();startForeground(100,notification("Radar starting","Connecting to Main Market"));scope.launch{connect()};return START_STICKY}
 private fun pref(k:String)=getSharedPreferences("radar",MODE_PRIVATE).getString(k,"")?:""
 private suspend fun connect(){try{val base=pref("url").trimEnd('/');val body=JSONObject().put("clientToken",pref("token")).toString().toRequestBody("application/json".toMediaType());val r=client.newCall(Request.Builder().url("$base/api/auth").post(body).build()).execute();val j=JSONObject(r.body?.string().orEmpty());if(!r.isSuccessful)throw Exception(j.optString("error","Auth failed"));session=j.getString("sessionToken");val req=Request.Builder().url(base.replace("https://","wss://").replace("http://","ws://")+"/live").header("Authorization","Bearer $session").build();socket=client.newWebSocket(req,object:WebSocketListener(){override fun onMessage(ws:WebSocket,text:String){try{val e=JSONObject(text);if(e.optString("type")!="market_state")return;val d=e.getJSONObject("data");RadarEvents.emit(d);val s=d.optString("signal");val a=d.optString("alertId");if((s=="CALL"||s=="PUT")&&a.isNotBlank()&&a!=lastAlert){lastAlert=a;val title=if(s=="CALL")"🟢 CALL" else "🔴 PUT";val n=NotificationCompat.Builder(this@RadarService,channel).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(d.optString("symbol","EUR/USD")+" · "+d.optString("reason")).setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).build();getSystemService(NotificationManager::class.java).notify((System.currentTimeMillis()%100000).toInt(),n)};getSystemService(NotificationManager::class.java).notify(100,notification("Radar connected","Signal: $s"))}catch(_:Exception){}};override fun onFailure(ws:WebSocket,t:Throwable,r:Response?){scope.launch{delay(7000);connect()}};override fun onClosed(ws:WebSocket,c:Int,r:String){scope.launch{delay(5000);connect()}}})}catch(e:Exception){getSystemService(NotificationManager::class.java).notify(100,notification("Radar reconnecting",e.message?:"Connection error"));delay(10000);connect()}}
 private fun createChannel(){if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(channel,"Signal alerts",NotificationManager.IMPORTANCE_HIGH))}
 private fun notification(t:String,m:String)=NotificationCompat.Builder(this,channel).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(t).setContentText(m).setOngoing(true).setPriority(NotificationCompat.PRIORITY_LOW).build()
 override fun onDestroy(){socket?.close(1000,"stop");scope.cancel();super.onDestroy()};override fun onBind(i:Intent?):IBinder?=null
}