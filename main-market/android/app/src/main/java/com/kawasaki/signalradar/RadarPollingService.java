package com.kawasaki.signalradar;

import android.app.*;
import android.content.*;
import android.graphics.*;
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
    private volatile HttpURLConnection activeConnection;

    @Override public void onCreate() {
        super.onCreate();
        createStatusChannel();
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        boolean enabled=getSharedPreferences("radar_app_settings",MODE_PRIVATE).getBoolean("systemEnabled",true);
        if(!enabled){stopSelf(startId);return START_NOT_STICKY;}
        if(executor==null){
            startForeground(NOTIFICATION_ID,statusNotification("LIVE · กำลังเฝ้าระวัง EUR/USD"));
            PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
            if(pm!=null){wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SignalRadar:Polling");wakeLock.setReferenceCounted(false);wakeLock.acquire(10*60*1000L);}
            executor=Executors.newSingleThreadScheduledExecutor();
            executor.scheduleWithFixedDelay(this::pollSafely,0,15,TimeUnit.SECONDS);
        }
        return START_STICKY;
    }

    private void pollSafely(){
        try{
            if(!getSharedPreferences("radar_app_settings",MODE_PRIVATE).getBoolean("systemEnabled",true)){
                stopSelf();return;
            }
            JSONObject root=fetchSignal(), market=root.optJSONObject("market");
            if(market==null)market=root;
            String signal=market.optString("signal","STANDBY").toUpperCase();
            if(!"CALL".equals(signal)&&!"PUT".equals(signal))signal="STANDBY";
            String reason=market.optString("reason","กำลังประเมินข้อมูลตลาด");
            String price=market.optString("price",market.optString("lastPrice","--"));
            String expiry=market.optString("signalExpiresAt","");
            String symbol=market.optString("symbol","EUR/USD");
            String key=symbol+"|"+signal+"|"+expiry;
            if(("CALL".equals(signal)||"PUT".equals(signal))&&!expiry.isEmpty()&&!key.equals(lastAlertKey)){
                lastAlertKey=key;showSignal(signal,symbol,price,reason,key);
            }
            updateStatus("API "+market.optString("apiStatus","ONLINE")+" · "+signal+" · "+price);
        }catch(Exception e){Log.w(TAG,"Signal polling failed",e);updateStatus("STANDBY · รอเชื่อมต่อ Render · ลองใหม่อัตโนมัติ");}
    }
    private JSONObject fetchSignal()throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(SERVER+"/api/public/signal").openConnection();activeConnection=c;
        c.setRequestMethod("GET");c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setUseCaches(false);c.setRequestProperty("Accept","application/json");
        try{
            int code=c.getResponseCode();InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();
            if(in==null)throw new IllegalStateException("HTTP "+code);
            BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();String line;
            while((line=r.readLine())!=null)b.append(line);r.close();
            if(code<200||code>=300)throw new IllegalStateException("HTTP "+code);
            JSONObject j=new JSONObject(b.toString());if(!j.optBoolean("ok",false))throw new IllegalStateException("API not ready");return j;
        }finally{activeConnection=null;c.disconnect();}
    }
    private void showSignal(String signal,String symbol,String price,String reason,String tag){
        SharedPreferences p=getSharedPreferences("radar_app_settings",MODE_PRIVATE);
        boolean sound=p.getBoolean("soundEnabled",true),vibration=p.getBoolean("vibrationEnabled",true);
        String channel=sound?(vibration?"signal_sv_v3":"signal_s_v3"):(vibration?"signal_v_v3":"signal_silent_v3");
        ensureAlertChannel(channel,sound,vibration);boolean call="CALL".equals(signal);
        int color=call?Color.rgb(22,163,74):Color.rgb(220,38,38);
        String badge=call?"↑ CALL":"↓ PUT";
        Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi=PendingIntent.getActivity(this,signal.hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0));
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,channel):new Notification.Builder(this);
        MainActivity.showSignalPopupIfVisible(this,signal,symbol,price,reason);
        Notification n=b.setSmallIcon(R.drawable.ic_stat_signal).setLargeIcon(badgeIcon(color,call?"↑":"↓"))
            .setContentTitle(badge+" · "+symbol).setContentText("ราคา "+price+" · "+reason)
            .setStyle(new Notification.BigTextStyle().bigText("ราคา "+price+"\n"+reason))
            .setColor(color).setContentIntent(pi).setAutoCancel(false)
            .setDefaults((sound?Notification.DEFAULT_SOUND:0)|(vibration?Notification.DEFAULT_VIBRATE:0)).build();
        NotificationManager m=getSystemService(NotificationManager.class);if(m!=null)m.notify(tag,tag.hashCode(),n);
    }
    private Bitmap badgeIcon(int color,String glyph){
        Bitmap bitmap=Bitmap.createBitmap(112,112,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(bitmap);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(color);canvas.drawCircle(56,56,54,paint);
        paint.setColor(Color.WHITE);paint.setTypeface(Typeface.create("sans-serif",Typeface.BOLD));
        paint.setTextAlign(Paint.Align.CENTER);paint.setTextSize(glyph.length()>1?34:62);
        Paint.FontMetrics fm=paint.getFontMetrics();canvas.drawText(glyph,56,56-(fm.ascent+fm.descent)/2,paint);
        return bitmap;
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
        c.setDescription("High-priority CALL/PUT alert with native sound and vibration");c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        c.enableVibration(vibration);if(vibration)c.setVibrationPattern(new long[]{0,180,70,180,70,320});
        if(sound)c.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());else c.setSound(null,null);
        m.createNotificationChannel(c);
    }
    private Notification statusNotification(String s){
        Intent i=new Intent(this,MainActivity.class);PendingIntent pi=PendingIntent.getActivity(this,6401,i,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0));
        boolean call=s.contains("CALL"),put=s.contains("PUT");
        int color=call?Color.rgb(22,163,74):put?Color.rgb(220,38,38):Color.rgb(107,114,128);
        String glyph=call?"↑":put?"↓":"—";
        String title=call?"CALL · SIGNAL RADAR PRO":put?"PUT · SIGNAL RADAR PRO":"STANDBY · SIGNAL RADAR PRO";
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        return b.setSmallIcon(R.drawable.ic_stat_signal).setLargeIcon(badgeIcon(color,glyph))
            .setContentTitle(title).setContentText(s).setStyle(new Notification.BigTextStyle().bigText(s))
            .setColor(color).setContentIntent(pi).setOngoing(true).build();
    }
    private void updateStatus(String s){NotificationManager m=getSystemService(NotificationManager.class);if(m!=null)m.notify(NOTIFICATION_ID,statusNotification(s));}
    @Override public void onDestroy(){
        if(executor!=null){executor.shutdownNow();executor=null;}
        HttpURLConnection connection=activeConnection;if(connection!=null){connection.disconnect();activeConnection=null;}
        if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();wakeLock=null;
        stopForeground(true);
        NotificationManager manager=getSystemService(NotificationManager.class);if(manager!=null)manager.cancel(NOTIFICATION_ID);
        Log.i(TAG,"Monitoring service stopped; polling executor and wake lock released");
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent i){return null;}
}
