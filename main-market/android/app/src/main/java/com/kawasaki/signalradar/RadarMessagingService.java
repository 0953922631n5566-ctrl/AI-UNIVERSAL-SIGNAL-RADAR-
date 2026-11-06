package com.kawasaki.signalradar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class RadarMessagingService extends FirebaseMessagingService {
    private static final String TAG = "RadarFCM";
    private static final String CHANNEL_ID = "market_signals";
    private static final String TOPIC = "main-market-signals";
    private static final String PREFS = "radar_push_state";
    private static final String LAST_ALERT = "last_alert_id";

    @Override
    public void onNewToken(@NonNull String token) {
        FirebaseMessaging.getInstance().subscribeToTopic(TOPIC)
            .addOnFailureListener(error -> Log.w(TAG, "Topic subscription failed", error));
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        String signal = message.getData().get("signal");
        String alertId = message.getData().get("alertId");
        if (!"CALL".equals(signal) && !"PUT".equals(signal)) return;
        if (alertId == null || alertId.isEmpty()) return;

        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (alertId.equals(prefs.getString(LAST_ALERT, ""))) return;

        ensureChannel();
        boolean isCall = "CALL".equals(signal);
        String title = isCall ? "CALL · สัญญาณขาขึ้น" : "PUT · สัญญาณขาลง";
        String symbol = message.getData().getOrDefault("symbol", "EUR/USD");
        String price = message.getData().get("price");
        String body = symbol + (price == null || price.isEmpty() ? "" : " · " + price);
        int color = isCall ? Color.rgb(22, 163, 74) : Color.rgb(220, 38, 38);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        Notification notification = builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setColor(color)
            .setAutoCancel(true)
            .setPriority(Notification.PRIORITY_HIGH)
            .setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE)
            .build();

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(alertId.hashCode(), notification);
        prefs.edit().putString(LAST_ALERT, alertId).apply();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Main Market Signals", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("CALL and PUT alerts from Main Market");
        channel.enableVibration(true);
        channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
            new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .build());
        manager.createNotificationChannel(channel);
    }
}
