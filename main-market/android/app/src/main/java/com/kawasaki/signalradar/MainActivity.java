package com.kawasaki.signalradar;

import android.app.*;
import android.content.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.util.Log;
import android.webkit.*;
import com.google.firebase.messaging.FirebaseMessaging;

public final class MainActivity extends Activity {
    private static final String DEFAULT_SERVER="https://ai-signal-radar-main-market.onrender.com";
    private static final String PREFS="radar_app_settings";
    private WebView webView;
    private android.content.SharedPreferences prefs(){return getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    private String serverUrl(){String v=prefs().getString("serverUrl",DEFAULT_SERVER);return v==null||v.trim().isEmpty()?DEFAULT_SERVER:v.replaceAll("/+$","");}
    @Override protected void onCreate(Bundle state){
        super.onCreate(state);getWindow().setStatusBarColor(android.graphics.Color.rgb(7,17,13));getWindow().setNavigationBarColor(android.graphics.Color.rgb(7,17,13));
        createNotificationChannels();startRadarService();
        webView=new WebView(this);webView.setBackgroundColor(android.graphics.Color.rgb(7,17,13));WebSettings s=webView.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new RadarBridge(),"AndroidBridge");
        webView.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){Uri u=r.getUrl(),b=Uri.parse(serverUrl());if("https".equalsIgnoreCase(u.getScheme())&&b.getHost()!=null&&b.getHost().equalsIgnoreCase(u.getHost()))return false;if("https".equalsIgnoreCase(u.getScheme()))startActivity(new Intent(Intent.ACTION_VIEW,u));return true;}});
        setContentView(webView);FirebaseMessaging.getInstance().subscribeToTopic("main-market-signals").addOnSuccessListener(x->Log.i("RadarFCM","Subscribed")).addOnFailureListener(e->Log.w("RadarFCM","Subscribe failed",e));
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},4102);
        webView.loadUrl(DEFAULT_SERVER+"/control");
    }
    private void startRadarService(){Intent i=new Intent(this,RadarPollingService.class);if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O)startForegroundService(i);else startService(i);}
    private void createNotificationChannels(){
        if(Build.VERSION.SDK_INT<26)return;NotificationManager m=getSystemService(NotificationManager.class);if(m==null)return;
        createChannel(m,"signal_sv_v2",true,true);createChannel(m,"signal_s_v2",true,false);
        createChannel(m,"signal_v_v2",false,true);createChannel(m,"signal_silent_v2",false,false);
    }
    private void createChannel(NotificationManager m,String id,boolean sound,boolean vibration){
        if(m.getNotificationChannel(id)!=null)return;
        NotificationChannel c=new NotificationChannel(id,"Main Market "+id,NotificationManager.IMPORTANCE_HIGH);
        c.setDescription("CALL and PUT alerts with native sound and vibration preferences.");
        c.enableVibration(vibration);
        if(vibration)c.setVibrationPattern(new long[]{0,220,90,220});
        if(sound)c.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        else c.setSound(null,null);
        m.createNotificationChannel(c);
    }
    public final class RadarBridge{
        @JavascriptInterface public String getServerUrl(){return DEFAULT_SERVER;}
        @JavascriptInterface public String getClientToken(){return "";}
        @JavascriptInterface public void saveClientToken(String v){}
        @JavascriptInterface public String getPreference(String n){if("soundEnabled".equals(n)||"vibrationEnabled".equals(n)||"systemEnabled".equals(n))return Boolean.toString(prefs().getBoolean(n,true));return "";}
        @JavascriptInterface public void setPreference(String n,String v){if(!"soundEnabled".equals(n)&&!"vibrationEnabled".equals(n)&&!"systemEnabled".equals(n))return;prefs().edit().putBoolean(n,Boolean.parseBoolean(v)).apply();}
        @JavascriptInterface public void setSystemEnabled(boolean enabled){prefs().edit().putBoolean("systemEnabled",enabled).apply();}
        @JavascriptInterface public void testSound(){runOnUiThread(()->{try{ToneGenerator t=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,85);t.startTone(ToneGenerator.TONE_PROP_ACK,250);webView.postDelayed(t::release,400);}catch(Exception e){Log.w("RadarUI","Sound test failed",e);}});}
        @JavascriptInterface public void testVibration(){runOnUiThread(()->{try{Vibrator v=(Vibrator)getSystemService(VIBRATOR_SERVICE);if(v!=null&&v.hasVibrator()){if(Build.VERSION.SDK_INT>=26)v.vibrate(VibrationEffect.createOneShot(180,VibrationEffect.DEFAULT_AMPLITUDE));else v.vibrate(180);}}catch(Exception e){Log.w("RadarUI","Vibration test failed",e);}});}
    }
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
}
