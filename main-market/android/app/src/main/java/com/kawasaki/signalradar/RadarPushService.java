package com.kawasaki.signalradar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Build;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class RadarPushService extends FirebaseMessagingService {
    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        if(!getSharedPreferences("radar_app_settings",Context.MODE_PRIVATE).getBoolean("systemEnabled",true)){
            android.util.Log.i("RadarFCM","Dropped signal while Master OFF");return;
        }
        String signal = message.getData().get("signal");
        String alertId = message.getData().get("alertId");
        if (!"CALL".equals(signal) && !"PUT".equals(signal)) return;
        if (alertId == null || alertId.isEmpty()) return;
        SharedPreferences prefs = getSharedPreferences("radar_app_settings", Context.MODE_PRIVATE);
        SharedPreferences seen = getSharedPreferences("radar_push_state", Context.MODE_PRIVATE);
        if (alertId.equals(seen.getString("last_alert_id", ""))) return;
        boolean sound = prefs.getBoolean("soundEnabled", true);
        boolean vibration = prefs.getBoolean("vibrationEnabled", true);
        String channel = sound ? (vibration ? "signal_sv_v3" : "signal_s_v3") :
            (vibration ? "signal_v_v3" : "signal_silent_v3");
        ensureChannel(channel, sound, vibration);
        boolean call = "CALL".equals(signal);
        int color = parseColor(message.getData().get("signalColor"), call ? Color.rgb(22,163,74) : Color.rgb(220,38,38));
        String glyph = call ? "↑" : "↓";
        String badge = message.getData().getOrDefault("signalBadge", call ? "CALL" : "PUT");
        String title = message.getData().getOrDefault("title", badge + (call ? " · สัญญาณขาขึ้น" : " · สัญญาณขาลง"));
        String body = message.getData().getOrDefault("body", message.getData().getOrDefault("symbol", "EUR/USD"));
        String notificationTag = message.getData().getOrDefault("notificationTag", alertId);
        MainActivity.showSignalPopupIfVisible(this,signal,message.getData().getOrDefault("symbol","EUR/USD"),message.getData().getOrDefault("price","--"),body);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
        Notification notification = builder.setSmallIcon(R.drawable.ic_stat_signal)
            .setLargeIcon(badgeIcon(color, glyph)).setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setColor(color)
            .setAutoCancel(false)
            .setContentIntent(PendingIntent.getActivity(this, alertId.hashCode(),
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0)))
            .setDefaults((sound ? Notification.DEFAULT_SOUND : 0) | (vibration ? Notification.DEFAULT_VIBRATE : 0)).build();
        NotificationManager manager = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notificationTag, alertId.hashCode(), notification);
        seen.edit().putString("last_alert_id", alertId).apply();
    }

    private int parseColor(String value, int fallback) {
        if (value == null || value.isEmpty()) return fallback;
        try { return Color.parseColor(value); } catch (IllegalArgumentException ignored) { return fallback; }
    }
    private Bitmap badgeIcon(int color, String glyph) {
        Bitmap bitmap = Bitmap.createBitmap(112, 112, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap); Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(color); canvas.drawCircle(56, 56, 54, paint);
        paint.setColor(Color.WHITE); paint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        paint.setTextAlign(Paint.Align.CENTER); paint.setTextSize(62);
        Paint.FontMetrics metrics = paint.getFontMetrics();
        canvas.drawText(glyph, 56, 56 - (metrics.ascent + metrics.descent) / 2, paint);
        return bitmap;
    }
    private void ensureChannel(String id, boolean sound, boolean vibration) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(id, "Main Market Signal Alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("High-priority CALL/PUT alert with native sound and vibration");channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(vibration);
        if (vibration) channel.setVibrationPattern(new long[]{0,180,70,180,70,320});
        if (sound) channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
            new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        else channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }
}
