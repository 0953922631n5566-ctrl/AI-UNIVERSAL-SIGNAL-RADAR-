package com.kawasaki.signalradar;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import android.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class MainActivity extends Activity {
    private static final String APP_URL = "https://ai-signal-radar-main-market.onrender.com/";
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
        webView.addJavascriptInterface(new SecureCredentialBridge(this), "AndroidBridge");
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
        webView.loadUrl(APP_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private static final class SecureCredentialBridge {
        private static final String PREFS = "radar_secure_credentials";
        private static final String ALIAS = "kawasaki_radar_android_client_v1";
        private static final String TOKEN = "encrypted_client_token";
        private final Context context;

        SecureCredentialBridge(Context context) { this.context = context.getApplicationContext(); }

        @JavascriptInterface
        public String getClientToken() {
            try {
                android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String ivText = prefs.getString(TOKEN + "_iv", null);
                String cipherText = prefs.getString(TOKEN, null);
                if (ivText == null || cipherText == null) return "";
                byte[] iv = Base64.decode(ivText, Base64.NO_WRAP);
                byte[] encrypted = Base64.decode(cipherText, Base64.NO_WRAP);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
                return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public void saveClientToken(String token) {
            if (token == null || !token.matches("[a-f0-9]{64}")) {
                throw new IllegalArgumentException("Invalid device credential");
            }
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
                byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
                android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                prefs.edit()
                    .putString(TOKEN + "_iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .putString(TOKEN, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .apply();
            } catch (Exception e) {
                throw new IllegalStateException("Unable to store device credential securely", e);
            }
        }

        @JavascriptInterface
        public void clearClientToken() {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(TOKEN).remove(TOKEN + "_iv").apply();
        }

        private SecretKey getOrCreateKey() throws Exception {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(ALIAS)) {
                return (SecretKey) keyStore.getKey(ALIAS, null);
            }
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
            return generator.generateKey();
        }
    }
}
