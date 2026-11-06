package com.kawasaki.signalradar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class RadarPushService extends FirebaseMessagingService {
    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        String signal = message.getData().get("signal");
        String alertId = message.getData().get("alertId");
        if (!"CALL".equals(signal) && !"PUT".equals(signal)) return;
        if (alertId == null || alertId.isEmpty()) return;
        SharedPreferences prefs = getSharedPreferences("radar_app_settings", Context.MODE_PRIVATE);
        SharedPreferences seen = getSharedPreferences("radar_push_state", Context.MODE_PRIVATE);
        if (alertId.equals(seen.getString("last_alert_id", ""))) return;
        boolean sound = prefs.getBoolean("soundEnabled", true);
        boolean vibration = prefs.getBoolean("vibrationEnabled", true);
        String channel = sound ? (vibration ? "signal_sv" : "signal_s") : (vibration ? "signal_v" : "signal_silent");
        ensureChannel(channel, sound, vibration);
        boolean call = "CALL".equals(signal);
        String title = message.getData().getOrDefault("title", call ? "CALL · สัญญาณขาขึ้น" : "PUT · สัญญาณขาลง");
        String body = message.getData().getOrDefault("body", message.getData().getOrDefault("symbol", "EUR/USD"));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
        Notification notification = builder.setSmallIcon(R.drawable.ic_stat_signal)
            .setContentTitle(title).setContentText(body).setColor(call ? Color.rgb(22,163,74) : Color.rgb(220,38,38))
            .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(this, alertId.hashCode(), new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0)))
            .setDefaults((sound ? Notification.DEFAULT_SOUND : 0) | (vibration ? Notification.DEFAULT_VIBRATE : 0)).build();
        NotificationManager manager = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(alertId.hashCode(), notification);
        seen.edit().putString("last_alert_id", alertId).apply();
    }

    private void ensureChannel(String id, boolean sound, boolean vibration) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(id, "Main Market Signal Alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(vibration);
        if (vibration) channel.setVibrationPattern(new long[]{0,220,90,220});
        if (sound) channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
            new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build());
        else channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }
}
