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
    private Dialog activeSignalDialog;
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
    @Override protected void onDestroy(){if(activeActivity==this)activeActivity=null;if(activeSignalDialog!=null&&activeSignalDialog.isShowing())activeSignalDialog.dismiss();super.onDestroy();}

    public static boolean showSignalPopupIfVisible(Context context,String signal,String symbol,String price,String reason){
        MainActivity activity=activeActivity;
        if(activity==null||activity.isFinishing()||activity.isDestroyed())return false;
        activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())activity.showSignalPopup(signal,symbol,price,reason);});
        return true;
    }
    private void showSignalPopup(String signal,String symbol,String price,String reason){
        if(!"CALL".equals(signal)&&!"PUT".equals(signal))return;
        if(activeSignalDialog!=null&&activeSignalDialog.isShowing())activeSignalDialog.dismiss();
        boolean call="CALL".equals(signal);int accent=call?Color.rgb(34,224,126):Color.rgb(255,65,75);
        int deep=call?Color.rgb(7,57,39):Color.rgb(73,16,25);
        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setGravity(Gravity.CENTER);
        card.setPadding(dp(24),dp(26),dp(24),dp(22));
        GradientDrawable bg=new GradientDrawable(GradientDrawable.Orientation.TL_BR,call
            ?new int[]{Color.rgb(0,205,88),Color.rgb(0,132,62),Color.rgb(0,74,42)}
            :new int[]{Color.rgb(255,45,65),Color.rgb(195,0,34),Color.rgb(92,0,22)});
        bg.setCornerRadius(dp(26));bg.setStroke(dp(2),accent);card.setBackground(bg);card.setElevation(dp(18));
        TextView eyebrow=new TextView(this);eyebrow.setText("SIGNAL RADAR PRO  •  LIVE ALERT");eyebrow.setTextColor(Color.rgb(195,211,215));eyebrow.setTextSize(11);eyebrow.setLetterSpacing(.12f);eyebrow.setGravity(Gravity.CENTER);
        TextView glyph=new TextView(this);glyph.setText(call?"↗":"↘");glyph.setTextColor(Color.WHITE);glyph.setTextSize(58);glyph.setTypeface(Typeface.DEFAULT,Typeface.BOLD);glyph.setGravity(Gravity.CENTER);
        TextView direction=new TextView(this);direction.setText(call?"CALL":"PUT");direction.setTextColor(Color.WHITE);direction.setTextSize(48);direction.setTypeface(Typeface.DEFAULT,Typeface.BOLD);direction.setGravity(Gravity.CENTER);
        TextView subtitle=new TextView(this);subtitle.setText(call?"UPWARD MOMENTUM":"DOWNWARD MOMENTUM");subtitle.setTextColor(Color.WHITE);subtitle.setTextSize(12);subtitle.setTypeface(Typeface.DEFAULT,Typeface.BOLD);subtitle.setGravity(Gravity.CENTER);
        TextView pair=new TextView(this);pair.setText(symbol+"   ·   "+price);pair.setTextColor(Color.WHITE);pair.setTextSize(19);pair.setTypeface(Typeface.DEFAULT,Typeface.BOLD);pair.setGravity(Gravity.CENTER);pair.setPadding(0,dp(16),0,dp(8));
        TextView detail=new TextView(this);detail.setText(reason==null?"":reason);detail.setTextColor(Color.rgb(204,216,220));detail.setTextSize(13);detail.setGravity(Gravity.CENTER);detail.setMaxLines(3);
        Button close=new Button(this);close.setText("รับทราบ");close.setTextColor(Color.WHITE);close.setAllCaps(false);close.setBackgroundTintList(android.content.res.ColorStateList.valueOf(accent));
        LinearLayout.LayoutParams full=new LinearLayout.LayoutParams(-1,-2);
        card.addView(eyebrow,full);card.addView(glyph,full);card.addView(direction,full);card.addView(subtitle,full);card.addView(pair,full);card.addView(detail,full);
        LinearLayout.LayoutParams buttonLp=new LinearLayout.LayoutParams(-1,dp(48));buttonLp.topMargin=dp(20);card.addView(close,buttonLp);
        Dialog dialog=new Dialog(this);dialog.setContentView(card);dialog.setCancelable(true);dialog.getWindow();
        dialog.setOnDismissListener(d->{if(activeSignalDialog==dialog)activeSignalDialog=null;});
        activeSignalDialog=dialog;dialog.show();
        Window window=dialog.getWindow();if(window!=null){window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);WindowManager.LayoutParams a=window.getAttributes();a.width=getResources().getDisplayMetrics().widthPixels-dp(32);a.height=WindowManager.LayoutParams.WRAP_CONTENT;a.gravity=Gravity.CENTER;a.dimAmount=.58f;window.setAttributes(a);}
        close.setOnClickListener(v->dialog.dismiss());
        card.setAlpha(0f);card.setScaleX(.88f);card.setScaleY(.88f);
        card.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(new DecelerateInterpolator()).start();
        ValueAnimator pulse=ValueAnimator.ofFloat(.55f,1f);pulse.setDuration(900);pulse.setRepeatMode(ValueAnimator.REVERSE);pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.addUpdateListener(v->{int alpha=(int)(150+105*(float)v.getAnimatedValue());bg.setStroke(dp(2+(int)(2*(float)v.getAnimatedValue())),(alpha<<24)|(accent&0x00ffffff));});
        dialog.setOnDismissListener(d->{pulse.cancel();if(activeSignalDialog==dialog)activeSignalDialog=null;});
        pulse.start();
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
    @Override public void onBackPressed(){if(activeSignalDialog!=null&&activeSignalDialog.isShowing()){activeSignalDialog.dismiss();return;}if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
}