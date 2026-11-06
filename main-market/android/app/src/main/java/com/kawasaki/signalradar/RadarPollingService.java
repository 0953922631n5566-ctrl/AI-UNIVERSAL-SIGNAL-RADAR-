package com.kawasaki.signalradar;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.os.*;
import android.util.Log;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public final class RadarPollingService extends Service {
    private static final String TAG="RadarPolling", SERVER="https://ai-signal-radar-main-market.onrender.com";
    private static final String CHANNEL="radar_background_monitor";
    private static final int NOTIFICATION_ID=6401;
    private ScheduledExecutorService executor;
    private PowerManager.WakeLock wakeLock;
    private volatile String lastAlertKey="";

    @Override public void onCreate() {
        super.onCreate();
        createStatusChannel();
        startForeground(NOTIFICATION_ID,statusNotification("เฝ้าระวัง EUR/USD · MAIN MARKET · M1"));
        PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
        if(pm!=null){wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SignalRadar:Polling");wakeLock.setReferenceCounted(false);wakeLock.acquire(10*60*1000L);}
        executor=Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::pollSafely,0,15,TimeUnit.SECONDS);
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){return START_STICKY;}

    private void pollSafely(){
        try{
            if(!getSharedPreferences("radar_app_settings",MODE_PRIVATE).getBoolean("systemEnabled",true)){
                updateStatus("SYSTEM OFF · ปิดการรับสัญญาณบนอุปกรณ์");return;
            }
            JSONObject root=fetchSignal(), market=root.optJSONObject("market");
            if(market==null)market=root;
            String signal=market.optString("signal","STANDBY").toUpperCase();
            String reason=market.optString("reason","กำลังประเมินข้อมูลตลาด");
            String price=market.optString("price",market.optString("lastPrice","--"));
            String expiry=market.optString("signalExpiresAt","");
            String symbol=market.optString("symbol","EUR/USD");
            String key=symbol+"|"+signal+"|"+expiry;
            if(("CALL".equals(signal)||"PUT".equals(signal))&&!expiry.isEmpty()&&!key.equals(lastAlertKey)){
                lastAlertKey=key;showSignal(signal,symbol,price,reason);
            }
            updateStatus("API "+market.optString("apiStatus","ONLINE")+" · "+signal+" · "+price);
        }catch(Exception e){Log.w(TAG,"Signal polling failed",e);updateStatus("รอเชื่อมต่อ Render · ลองใหม่อัตโนมัติ");}
    }
    private JSONObject fetchSignal()throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(SERVER+"/api/public/signal").openConnection();
        c.setRequestMethod("GET");c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setUseCaches(false);c.setRequestProperty("Accept","application/json");
        try{
            int code=c.getResponseCode();InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();
            if(in==null)throw new IllegalStateException("HTTP "+code);
            BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();String line;
            while((line=r.readLine())!=null)b.append(line);r.close();
            if(code<200||code>=300)throw new IllegalStateException("HTTP "+code);
            JSONObject j=new JSONObject(b.toString());if(!j.optBoolean("ok",false))throw new IllegalStateException("API not ready");return j;
        }finally{c.disconnect();}
    }
    private void showSignal(String signal,String symbol,String price,String reason){
        SharedPreferences p=getSharedPreferences("radar_app_settings",MODE_PRIVATE);
        boolean sound=p.getBoolean("soundEnabled",true),vibration=p.getBoolean("vibrationEnabled",true);
        String channel=sound?(vibration?"signal_sv":"signal_s"):(vibration?"signal_v":"signal_silent");
        ensureAlertChannel(channel,sound,vibration);boolean call="CALL".equals(signal);
        Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi=PendingIntent.getActivity(this,signal.hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0));
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,channel):new Notification.Builder(this);
        Notification n=b.setSmallIcon(R.drawable.ic_stat_signal).setContentTitle((call?"CALL":"PUT")+" · "+symbol)
            .setContentText("ราคา "+price+" · "+reason).setStyle(new Notification.BigTextStyle().bigText("ราคา "+price+"\n"+reason))
            .setColor(call?Color.rgb(22,163,74):Color.rgb(220,38,38)).setContentIntent(pi).setAutoCancel(true)
            .setDefaults((sound?Notification.DEFAULT_SOUND:0)|(vibration?Notification.DEFAULT_VIBRATE:0)).build();
        NotificationManager m=getSystemService(NotificationManager.class);if(m!=null)m.notify((int)(System.currentTimeMillis()/1000),n);
    }
    private void createStatusChannel(){
        if(Build.VERSION.SDK_INT<26)return;NotificationManager m=getSystemService(NotificationManager.class);
        if(m==null||m.getNotificationChannel(CHANNEL)!=null)return;
        NotificationChannel c=new NotificationChannel(CHANNEL,"Radar background monitoring",NotificationManager.IMPORTANCE_LOW);
        c.setDescription("Ongoing status while Main Market monitoring is active");c.setShowBadge(false);m.createNotificationChannel(c);
    }
    private void ensureAlertChannel(String id,boolean sound,boolean vibration){
        if(Build.VERSION.SDK_INT<26)return;NotificationManager m=getSystemService(NotificationManager.class);
        if(m==null||m.getNotificationChannel(id)!=null)return;
        NotificationChannel c=new NotificationChannel(id,"Main Market Signal Alerts",NotificationManager.IMPORTANCE_HIGH);
        c.enableVibration(vibration);if(vibration)c.setVibrationPattern(new long[]{0,220,90,220});
        if(sound)c.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build());else c.setSound(null,null);
        m.createNotificationChannel(c);
    }
    private Notification statusNotification(String s){
        Intent i=new Intent(this,MainActivity.class);PendingIntent pi=PendingIntent.getActivity(this,6401,i,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0));
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        return b.setSmallIcon(R.drawable.ic_stat_signal).setContentTitle("SIGNAL RADAR PRO").setContentText(s).setContentIntent(pi).setOngoing(true).build();
    }
    private void updateStatus(String s){NotificationManager m=getSystemService(NotificationManager.class);if(m!=null)m.notify(NOTIFICATION_ID,statusNotification(s));}
    @Override public void onDestroy(){if(executor!=null)executor.shutdownNow();if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}