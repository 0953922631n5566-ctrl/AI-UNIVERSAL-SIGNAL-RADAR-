package com.kawasaki.signalradar;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.util.Log;
import android.view.*;
import android.view.animation.DecelerateInterpolator;
import android.animation.ValueAnimator;
import android.webkit.*;
import android.widget.*;
import com.google.firebase.messaging.FirebaseMessaging;

public final class MainActivity extends Activity {
    private static final String DEFAULT_SERVER="https://ai-signal-radar-main-market.onrender.com";
    private static final String PREFS="radar_app_settings";
    private static volatile MainActivity activeActivity;
    private WebView webView;
    private android.content.SharedPreferences prefs(){return getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    private String serverUrl(){String v=prefs().getString("serverUrl",DEFAULT_SERVER);return v==null||v.trim().isEmpty()?DEFAULT_SERVER:v.replaceAll("/+$","");}

    @Override protected void onCreate(Bundle state){
        super.onCreate(state);getWindow().setStatusBarColor(android.graphics.Color.rgb(7,17,13));getWindow().setNavigationBarColor(android.graphics.Color.rgb(7,17,13));
        createNotificationChannels();if(prefs().getBoolean("systemEnabled",true)){startRadarService();updatePushSubscription(true);}else{stopRadarService();updatePushSubscription(false);}
        webView=new WebView(this);webView.setBackgroundColor(android.graphics.Color.rgb(7,17,13));WebSettings s=webView.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new RadarBridge(),"AndroidBridge");
        webView.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){Uri u=r.getUrl(),b=Uri.parse(serverUrl());if("https".equalsIgnoreCase(u.getScheme())&&b.getHost()!=null&&b.getHost().equalsIgnoreCase(u.getHost()))return false;if("https".equalsIgnoreCase(u.getScheme()))startActivity(new Intent(Intent.ACTION_VIEW,u));return true;}});
        setContentView(webView);
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},4102);
        webView.loadUrl(DEFAULT_SERVER+"/control");
    }
    @Override protected void onResume(){super.onResume();activeActivity=this;if(webView!=null)webView.postDelayed(()->webView.evaluateJavascript("window.refreshOverlayPermission && window.refreshOverlayPermission()",null),250);}
    @Override protected void onPause(){if(activeActivity==this)activeActivity=null;super.onPause();}
    @Override protected void onDestroy(){if(activeActivity==this)activeActivity=null;super.onDestroy();}

    public static boolean showSignalPopupIfVisible(Context context,String signal,String symbol,String price,String reason){
        MainActivity activity=activeActivity;
        if(activity==null||activity.isFinishing()||activity.isDestroyed())return false;
        if(SignalOverlayController.show(activity,signal,symbol,price,reason))return true;
        activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())activity.showInAppBanner(signal,symbol,price);});
        return true;
    }

    private void showInAppBanner(String signal,String symbol,String price){
        if(!"CALL".equals(signal)&&!"PUT".equals(signal))return;
        View decor=getWindow().getDecorView();
        if(!(decor instanceof android.view.ViewGroup))return;
        android.view.ViewGroup root=(android.view.ViewGroup)decor;
        for(int i=root.getChildCount()-1;i>=0;i--){
            View child=root.getChildAt(i);
            if("radar_signal_banner".equals(child.getTag()))root.removeView(child);
        }
        boolean call="CALL".equals(signal);
        int accent=call?Color.rgb(0,230,118):Color.rgb(255,55,75);
        TextView banner=new TextView(this);
        banner.setTag("radar_signal_banner");
        banner.setText((call?"↑  CALL":"↓  PUT")+"     "+(symbol==null?"EUR/USD":symbol)+"     "+(price==null?"--":price));
        banner.setTextColor(Color.WHITE);banner.setTextSize(16);
        banner.setTypeface(Typeface.create("sans-serif-black",Typeface.BOLD));
        banner.setSingleLine(true);banner.setGravity(Gravity.CENTER_VERTICAL);
        banner.setPadding(dp(18),dp(12),dp(18),dp(12));
        GradientDrawable bg=new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            call?new int[]{Color.rgb(0,105,57),Color.rgb(0,65,45)}:new int[]{Color.rgb(145,0,30),Color.rgb(80,0,24)});
        bg.setCornerRadius(dp(14));bg.setStroke(dp(1),accent);banner.setBackground(bg);banner.setElevation(dp(12));
        banner.setClickable(false);banner.setFocusable(false);
        android.widget.FrameLayout.LayoutParams lp=new android.widget.FrameLayout.LayoutParams(-1,-2,Gravity.TOP|Gravity.CENTER_HORIZONTAL);
        lp.setMargins(dp(8),dp(8),dp(8),0);
        root.addView(banner,lp);
        banner.setAlpha(0f);banner.setTranslationY(-dp(10));
        banner.animate().alpha(1f).translationY(0f).setDuration(180).start();
        banner.postDelayed(()->{if(banner.getParent()==root)root.removeView(banner);},6500L);
    }
    private int dp(float value){return (int)(value*getResources().getDisplayMetrics().density+.5f);}

    private void startRadarService(){
        if(!prefs().getBoolean("systemEnabled",true))return;
        Intent i=new Intent(this,RadarPollingService.class);
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O)startForegroundService(i);else startService(i);
    }
    private void stopRadarService(){
        SignalOverlayController.dismiss(this);
        stopService(new Intent(this,RadarPollingService.class));
        NotificationManager manager=getSystemService(NotificationManager.class);
        if(manager!=null)manager.cancelAll();
    }
    private void updatePushSubscription(boolean enabled){
        if(enabled)FirebaseMessaging.getInstance().subscribeToTopic("main-market-signals")
            .addOnSuccessListener(x->Log.i("RadarFCM","Subscribed"))
            .addOnFailureListener(e->Log.w("RadarFCM","Subscribe failed",e));
        else FirebaseMessaging.getInstance().unsubscribeFromTopic("main-market-signals")
            .addOnSuccessListener(x->Log.i("RadarFCM","Unsubscribed while Master OFF"))
            .addOnFailureListener(e->Log.w("RadarFCM","Unsubscribe failed",e));
    }
    private boolean hasOverlayPermission(){return SignalOverlayController.hasPermission(this);}
    private void openOverlayPermissionSettings(){
        if(hasOverlayPermission())return;
        try{startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));}
        catch(Exception e){Log.w("RadarOverlay","Could not open overlay permission settings",e);}
    }
    private void applyMasterSwitch(boolean enabled){
        prefs().edit().putBoolean("systemEnabled",enabled).commit();
        if(enabled){startRadarService();updatePushSubscription(true);}
        else{updatePushSubscription(false);stopRadarService();}
        Log.i("RadarMaster","Master switch "+(enabled?"ON":"OFF"));
    }
    private void createNotificationChannels(){
        if(Build.VERSION.SDK_INT<26)return;NotificationManager m=getSystemService(NotificationManager.class);if(m==null)return;
        createChannel(m,"signal_sv_v3",true,true);createChannel(m,"signal_s_v3",true,false);
        createChannel(m,"signal_v_v3",false,true);createChannel(m,"signal_silent_v3",false,false);
        createChannel(m,"signal_overlay_fallback_v1_11",false,false);
    }
    private void createChannel(NotificationManager m,String id,boolean sound,boolean vibration){
        if(m.getNotificationChannel(id)!=null)return;
        NotificationChannel c=new NotificationChannel(id,"Signal Radar PRO · "+id,NotificationManager.IMPORTANCE_HIGH);
        c.setDescription("High-priority CALL/PUT alerts. Sound and vibration follow Android channel and device settings.");
        c.enableVibration(vibration);if(vibration)c.setVibrationPattern(new long[]{0,180,70,180,70,320});
        if(sound)c.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        else c.setSound(null,null);
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);m.createNotificationChannel(c);
    }
    public final class RadarBridge{
        @JavascriptInterface public String getServerUrl(){return DEFAULT_SERVER;}
        @JavascriptInterface public String getClientToken(){return "";}
        @JavascriptInterface public void saveClientToken(String v){}
        @JavascriptInterface public String getPreference(String n){if("soundEnabled".equals(n)||"vibrationEnabled".equals(n)||"systemEnabled".equals(n))return Boolean.toString(prefs().getBoolean(n,true));return "";}
        @JavascriptInterface public void setPreference(String n,String v){if(!"soundEnabled".equals(n)&&!"vibrationEnabled".equals(n)&&!"systemEnabled".equals(n))return;prefs().edit().putBoolean(n,Boolean.parseBoolean(v)).apply();}
        @JavascriptInterface public void setSystemEnabled(boolean enabled){runOnUiThread(()->applyMasterSwitch(enabled));}
        @JavascriptInterface public String hasOverlayPermission(){return Boolean.toString(MainActivity.this.hasOverlayPermission());}
        @JavascriptInterface public void requestOverlayPermission(){runOnUiThread(()->openOverlayPermissionSettings());}
        @JavascriptInterface public void testSound(){runOnUiThread(()->{try{ToneGenerator t=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,85);t.startTone(ToneGenerator.TONE_PROP_ACK,250);webView.postDelayed(t::release,400);}catch(Exception e){Log.w("RadarUI","Sound test failed",e);}});}
        @JavascriptInterface public void testVibration(){runOnUiThread(()->{try{Vibrator v=(Vibrator)getSystemService(VIBRATOR_SERVICE);if(v!=null&&v.hasVibrator()){if(Build.VERSION.SDK_INT>=26)v.vibrate(VibrationEffect.createWaveform(new long[]{0,180,70,180,70,320},-1));else v.vibrate(new long[]{0,180,70,180,70,320},-1);}}catch(Exception e){Log.w("RadarUI","Vibration test failed",e);}});}
    }
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
}