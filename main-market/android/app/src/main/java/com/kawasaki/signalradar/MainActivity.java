package com.kawasaki.signalradar;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.google.firebase.messaging.FirebaseMessaging;
public final class MainActivity extends Activity {
 private static final String APP_URL="https://ai-signal-radar-main-market.onrender.com/signal";
 private static final String APP_HOST="ai-signal-radar-main-market.onrender.com";
 private WebView webView;
 @Override protected void onCreate(Bundle state){super.onCreate(state);getWindow().setStatusBarColor(android.graphics.Color.rgb(7,17,13));getWindow().setNavigationBarColor(android.graphics.Color.rgb(7,17,13));webView=new WebView(this);webView.setBackgroundColor(android.graphics.Color.rgb(7,17,13));WebSettings s=webView.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);webView.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){Uri u=r.getUrl();if("https".equalsIgnoreCase(u.getScheme())&&APP_HOST.equalsIgnoreCase(u.getHost()))return false;if("https".equalsIgnoreCase(u.getScheme()))startActivity(new Intent(Intent.ACTION_VIEW,u));return true;}});setContentView(webView);createNotificationChannel();FirebaseMessaging.getInstance().subscribeToTopic("main-market-signals").addOnSuccessListener(x->Log.i("RadarFCM","Subscribed")).addOnFailureListener(e->Log.w("RadarFCM","Subscribe failed",e));if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},4102);webView.loadUrl(APP_URL);}
 private void createNotificationChannel(){if(Build.VERSION.SDK_INT<Build.VERSION_CODES.O)return;NotificationManager m=getSystemService(NotificationManager.class);if(m==null||m.getNotificationChannel("market_signals")!=null)return;NotificationChannel c=new NotificationChannel("market_signals","Main Market Signals",NotificationManager.IMPORTANCE_HIGH);c.enableVibration(true);c.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build());m.createNotificationChannel(c);}
 @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
}