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
import java.util.Locale;
import java.util.concurrent.*;

public final class RadarPollingService extends Service {
    private static final String TAG="RadarPolling", SERVER="https://ai-signal-radar-main-market.onrender.com";
    private static final String CHANNEL="radar_background_monitor";
    private static final int NOTIFICATION_ID=6401;
    private ScheduledExecutorService executor;
    private PowerManager.WakeLock wakeLock;
    private volatile String lastAlertKey="";
    private volatile HttpURLConnection activeConnection;

    // Cached feed snapshot drives the persistent notification between 15-second API polls.
    private volatile String latestSymbol="EUR/USD";
    private volatile String latestPrice="--";
    private volatile String latestApiStatus="CONNECTING";
    private volatile String latestFeedStatus="WAITING";
    private volatile int latestTickAgeSeconds=-1;
    private volatile long nextM1CloseAt=0L;
    private final Handler statusHandler=new Handler(Looper.getMainLooper());
    private final Runnable statusTicker=new Runnable(){
        @Override public void run(){
            if(executor!=null) updateStatusNotification();
            if(executor!=null) statusHandler.postDelayed(this,1000L);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        createStatusChannel();
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        boolean enabled=getSharedPreferences("radar_app_settings",MODE_PRIVATE).getBoolean("systemEnabled",true);
        if(!enabled){stopSelf(startId);return START_NOT_STICKY;}
        if(executor==null){
            startForeground(NOTIFICATION_ID,statusNotification());
            PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
            if(pm!=null){wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SignalRadar:Polling");wakeLock.setReferenceCounted(false);wakeLock.acquire(10*60*1000L);}
            executor=Executors.newSingleThreadScheduledExecutor();
            statusHandler.removeCallbacks(statusTicker);
            statusHandler.post(statusTicker);
            executor.scheduleWithFixedDelay(this::pollSafely,0,15,TimeUnit.SECONDS);
        }
        return START_STICKY;
    }

    private void pollSafely(){
        try{
            if(!getSharedPreferences("radar_app_settings",MODE_PRIVATE).getBoolean("systemEnabled",true)){
                stopSelf();return;
            }
            JSONObject root=fetchSignal();
            // Master OFF may be pressed while the HTTP request is in flight.
            // Drop its result before any alert, UI update or follow-up work.
            if(!isSystemEnabled())return;
            JSONObject market=root.optJSONObject("market");
            if(market==null)market=root;
            String signal=market.optString("signal","STANDBY").toUpperCase();
            if(!"CALL".equals(signal)&&!"PUT".equals(signal))signal="STANDBY";
            String reason=market.optString("reason","กำลังประเมินข้อมูลตลาด");
            String price=market.optString("price",market.optString("lastTickPrice",market.optString("lastPrice","--")));
            String expiry=market.optString("signalExpiresAt","");
            String symbol=market.optString("symbol","EUR/USD");
            String key=market.optString("alertId","");
            latestSymbol=symbol;
            latestPrice=price;
            latestApiStatus=market.optString("apiStatus","OFFLINE").toUpperCase();
            latestFeedStatus=market.optString("supportStatus","UNKNOWN").toUpperCase();
            latestTickAgeSeconds=market.has("tickAgeSeconds")&&!market.isNull("tickAgeSeconds")
                ?market.optInt("tickAgeSeconds",-1):-1;
            nextM1CloseAt=market.optLong("nextCandleAt",0L);
            if(key.isEmpty())key=symbol+"|"+signal+"|"+expiry;
            if(("CALL".equals(signal)||"PUT".equals(signal))&&!expiry.isEmpty()&&!key.equals(lastAlertKey)){
                lastAlertKey=key;showSignal(signal,symbol,price,reason,key);
            }
            updateStatusNotification();
        }catch(Exception e){
            if(!isSystemEnabled())return;
            Log.w(TAG,"Signal polling failed",e);
            latestApiStatus="OFFLINE";
            latestFeedStatus="OFFLINE";
            latestTickAgeSeconds=-1;
            updateStatusNotification();
        }
    }
    private boolean isSystemEnabled(){
        return getSharedPreferences("radar_app_settings",MODE_PRIVATE).getBoolean("systemEnabled",true);
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
        if(!SignalAlertDispatcher.claimAndFeedback(this,tag,signal))return;
        boolean visibleInApp=MainActivity.showSignalPopupIfVisible(this,signal,symbol,price,reason);
        boolean displayed=visibleInApp||SignalOverlayController.show(this,signal,symbol,price,reason);
        if(displayed)return;
        ensureFallbackChannel();
        Intent i=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi=PendingIntent.getActivity(this,tag.hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0));
        Notification.Builder b=Build.VERSION.SDK_INT>=26
            ?new Notification.Builder(this,"signal_overlay_fallback_v1_11")
            :new Notification.Builder(this).setPriority(Notification.PRIORITY_MAX);
        boolean call="CALL".equals(signal);
        Notification n=b.setSmallIcon(R.drawable.ic_stat_signal)
            .setContentTitle((call?"↑ CALL":"↓ PUT")+" · "+symbol)
            .setContentText("ราคา "+price+" · "+reason)
            .setStyle(new Notification.BigTextStyle().bigText("ราคา "+price+"\n"+reason))
            .setColor(call?Color.rgb(0,205,88):Color.rgb(255,45,65))
            .setContentIntent(pi).setCategory(Notification.CATEGORY_EVENT)
            .setAutoCancel(true).setDefaults(0).build();
        NotificationManager m=getSystemService(NotificationManager.class);
        if(m!=null)m.notify(tag,tag.hashCode(),n);
    }
    private void ensureFallbackChannel(){
        if(Build.VERSION.SDK_INT<26)return;
        NotificationManager m=getSystemService(NotificationManager.class);
        if(m==null||m.getNotificationChannel("signal_overlay_fallback_v1_11")!=null)return;
        NotificationChannel c=new NotificationChannel("signal_overlay_fallback_v1_11",
            "Signal Radar PRO · Overlay fallback",NotificationManager.IMPORTANCE_HIGH);
        c.setDescription("Fallback CALL/PUT alert when floating overlay permission is unavailable");
        c.enableVibration(false);c.setSound(null,null);c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        m.createNotificationChannel(c);
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
        c.setDescription("Ongoing live feed, current price and M1/M5 candle countdown while monitoring is active");
        c.setShowBadge(false);m.createNotificationChannel(c);
    }
    private String countdown(long targetMillis,long nowMillis){
        if(targetMillis<=0L)return "--:--";
        long seconds=Math.max(0L,(targetMillis-nowMillis+999L)/1000L);
        return String.format(Locale.US,"%02d:%02d",seconds/60L,seconds%60L);
    }
    private String m5Countdown(long nowMillis){
        long nextM5=((nowMillis/300000L)+1L)*300000L;
        return countdown(nextM5,nowMillis);
    }
    private boolean isActuallyLive(){
        return "ONLINE".equals(latestApiStatus) && "SUPPORTED".equals(latestFeedStatus) &&
            latestTickAgeSeconds>=0 && latestTickAgeSeconds<=25;
    }
    private Notification statusNotification(){
        Intent i=new Intent(this,MainActivity.class);
        PendingIntent pi=PendingIntent.getActivity(this,6401,i,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0));
        long now=System.currentTimeMillis();
        String m1=countdown(nextM1CloseAt,now);
        String m5=m5Countdown(now);
        boolean live=isActuallyLive();
        String headline=live?"Live":("ONLINE".equals(latestApiStatus)?"REST ONLY":("CONNECTING".equals(latestApiStatus)?"CONNECTING":"OFFLINE"));
        int color=live?Color.rgb(0,205,88):("ONLINE".equals(latestApiStatus)?Color.rgb(245,166,35):Color.rgb(107,114,128));
        String title=headline+" · SIGNAL RADAR PRO";
        String body=latestSymbol+"  "+latestPrice+"  ·  M1 "+m1+"  ·  M5 "+m5;
        String detail=live
            ?"API LIVE · Streaming tick "+latestTickAgeSeconds+"s ago"
            :"API "+latestApiStatus+" · "+latestFeedStatus;
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
        return b.setSmallIcon(R.drawable.ic_stat_signal).setLargeIcon(badgeIcon(color,live?"LIVE":"…"))
            .setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().setBigContentTitle(title).bigText(body+"\n"+detail))
            .setSubText(detail).setColor(color).setContentIntent(pi)
            .setCategory(Notification.CATEGORY_SERVICE).setOnlyAlertOnce(true).setOngoing(true).build();
    }
    private void updateStatusNotification(){
        NotificationManager m=getSystemService(NotificationManager.class);
        if(m!=null)m.notify(NOTIFICATION_ID,statusNotification());
    }
    @Override public void onDestroy(){
        statusHandler.removeCallbacks(statusTicker);
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