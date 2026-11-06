package com.kawasaki.signalradar;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.google.firebase.messaging.FirebaseMessaging;

public final class MainActivity extends Activity {
    private static final String DEFAULT_SERVER = "https://ai-signal-radar-main-market.onrender.com";
    private static final String PREFS = "radar_app_settings";
    // Managed device credential; provision the matching value in Render Environment.
    private static final String MANAGED_DEVICE_TOKEN = "9aa0e7580b26861a42bdd8ab74d471879f508856cd5efdd0cc829e63b3be6092";
    private WebView webView;

    private android.content.SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String serverUrl() {
        String value = prefs().getString("serverUrl", DEFAULT_SERVER);
        return value == null || value.trim().isEmpty() ? DEFAULT_SERVER : value.replaceAll("/+$", "");
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(7, 17, 13));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(7, 17, 13));
        createNotificationChannels();
        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(7, 17, 13));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new RadarBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                Uri base = Uri.parse(serverUrl());
                if ("https".equalsIgnoreCase(uri.getScheme()) &&
                    base.getHost() != null && base.getHost().equalsIgnoreCase(uri.getHost())) return false;
                if ("https".equalsIgnoreCase(uri.getScheme())) startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        setContentView(webView);
        FirebaseMessaging.getInstance().subscribeToTopic("main-market-signals")
            .addOnSuccessListener(x -> Log.i("RadarFCM", "Subscribed"))
            .addOnFailureListener(e -> Log.w("RadarFCM", "Subscribe failed", e));
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4102);
        }
        webView.loadUrl(serverUrl() + "/control");
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        createChannel(manager, "signal_sv", true, true);
        createChannel(manager, "signal_s", true, false);
        createChannel(manager, "signal_v", false, true);
        createChannel(manager, "signal_silent", false, false);
    }

    private void createChannel(NotificationManager manager, String id, boolean sound, boolean vibration) {
        if (manager.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(id, "Main Market " + id, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("CALL and PUT alerts. Sound and vibration follow in-app settings.");
        channel.enableVibration(vibration);
        if (vibration) channel.setVibrationPattern(new long[]{0, 220, 90, 220});
        if (sound) {
            channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build());
        } else {
            channel.setSound(null, null);
        }
        manager.createNotificationChannel(channel);
    }

    public final class RadarBridge {
        @JavascriptInterface public String getServerUrl() { return serverUrl(); }
        @JavascriptInterface public void saveServerUrl(String value) {
            try {
                Uri uri = Uri.parse(value == null ? "" : value.trim());
                if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return;
                prefs().edit().putString("serverUrl", uri.toString().replaceAll("/+$", "")).apply();
            } catch (Exception ignored) {}
        }
        @JavascriptInterface public String getClientToken() { return MANAGED_DEVICE_TOKEN; }
        @JavascriptInterface public void saveClientToken(String value) {
            // Device credential is provisioned by the app build; never requested from the user.
        }
        @JavascriptInterface public String getPreference(String name) {
            if ("soundEnabled".equals(name)) return Boolean.toString(prefs().getBoolean(name, true));
            if ("vibrationEnabled".equals(name)) return Boolean.toString(prefs().getBoolean(name, true));
            return "";
        }
        @JavascriptInterface public void setPreference(String name, String value) {
            if (!"soundEnabled".equals(name) && !"vibrationEnabled".equals(name)) return;
            prefs().edit().putBoolean(name, Boolean.parseBoolean(value)).apply();
        }
        @JavascriptInterface public void testSound() {
            runOnUiThread(() -> {
                try {
                    ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85);
                    tone.startTone(ToneGenerator.TONE_PROP_ACK, 250);
                    webView.postDelayed(tone::release, 400);
                } catch (Exception error) { Log.w("RadarUI", "Test sound failed", error); }
            });
        }
        @JavascriptInterface public void testVibration() {
            runOnUiThread(() -> {
                try {
                    Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                    if (vibrator != null && vibrator.hasVibrator()) {
                        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(180, VibrationEffect.DEFAULT_AMPLITUDE));
                        else vibrator.vibrate(180);
                    }
                } catch (Exception error) { Log.w("RadarUI", "Test vibration failed", error); }
            });
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
