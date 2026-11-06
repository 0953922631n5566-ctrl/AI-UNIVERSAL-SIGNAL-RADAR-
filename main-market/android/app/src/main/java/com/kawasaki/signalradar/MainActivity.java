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
    private static final String APP_URL = "https://ai-signal-radar-main-market.onrender.com/signal";
    private static final String APP_HOST = "ai-signal-radar-main-market.onrender.com";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(7, 17, 13));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(7, 17, 13));

        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(7, 17, 13));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                if ("https".equalsIgnoreCase(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                }
                return true;
            }
        });
        setContentView(webView);
        createNotificationChannel();
        subscribeToSignalTopic();
        requestNotificationPermission();
        webView.loadUrl(APP_URL);
    }

    private void subscribeToSignalTopic() {
        FirebaseMessaging.getInstance().subscribeToTopic("main-market-signals")
            .addOnSuccessListener(unused -> Log.i("RadarFCM", "Subscribed to Main Market signal topic"))
            .addOnFailureListener(error -> Log.w("RadarFCM", "Topic subscription failed", error));
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4102);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel("market_signals") != null) return;
        NotificationChannel channel = new NotificationChannel(
            "market_signals", "Main Market Signals", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("CALL and PUT alerts from Main Market");
        channel.enableVibration(true);
        channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
            new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .build());
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
