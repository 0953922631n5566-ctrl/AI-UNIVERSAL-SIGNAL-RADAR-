package com.kawasaki.signalradar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class RadarPushService extends FirebaseMessagingService {
    private static final String FALLBACK_CHANNEL = "signal_overlay_fallback_v1_11";

    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        if (!getSharedPreferences("radar_app_settings", Context.MODE_PRIVATE).getBoolean("systemEnabled", true)) {
            android.util.Log.i("RadarFCM", "Dropped signal while Master OFF");
            return;
        }
        String signal = message.getData().get("signal");
        String alertId = message.getData().get("alertId");
        if (!"CALL".equals(signal) && !"PUT".equals(signal)) return;
        if (!SignalAlertDispatcher.claimAndFeedback(this, alertId, signal)) return;

        String symbol = message.getData().getOrDefault("symbol", "EUR/USD");
        String price = message.getData().getOrDefault("price", "--");
        String reason = message.getData().getOrDefault("body", message.getData().getOrDefault("reason", ""));
        boolean visibleInApp = MainActivity.showSignalPopupIfVisible(this, signal, symbol, price, reason);
        boolean displayed = visibleInApp || SignalOverlayController.show(this, signal, symbol, price, reason);
        if (!displayed) postFallbackNotification(message, signal, alertId, symbol, price, reason);
    }

    private void postFallbackNotification(RemoteMessage message, String signal, String alertId,
                                          String symbol, String price, String reason) {
        ensureFallbackChannel();
        boolean call = "CALL".equals(signal);
        int color = call ? Color.rgb(0, 205, 88) : Color.rgb(255, 45, 65);
        String title = message.getData().getOrDefault("title", (call ? "↑ CALL" : "↓ PUT") + " · " + symbol);
        String body = price + (reason.isEmpty() ? "" : " · " + reason);
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, alertId.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, FALLBACK_CHANNEL) : new Notification.Builder(this).setPriority(Notification.PRIORITY_MAX);
        Notification notification = builder.setSmallIcon(R.drawable.ic_stat_signal)
            .setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setColor(color).setContentIntent(pi).setCategory(Notification.CATEGORY_EVENT)
            .setAutoCancel(true).setDefaults(0).build();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(alertId, alertId.hashCode(), notification);
    }

    private void ensureFallbackChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(FALLBACK_CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(FALLBACK_CHANNEL,
            "Signal Radar PRO · Overlay fallback", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Fallback CALL/PUT alert when floating overlay permission is unavailable");
        channel.enableVibration(false);
        channel.setSound(null, null);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
}
