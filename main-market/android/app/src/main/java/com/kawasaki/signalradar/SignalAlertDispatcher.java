package com.kawasaki.signalradar;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

public final class SignalAlertDispatcher {
    private static final Object LOCK = new Object();
    private static final String PREFS = "radar_alert_dedupe";
    private static final long SAME_ALERT_DEDUPE_MS = 10 * 60 * 1000L;
    private static final long GLOBAL_COOLDOWN_MS = 60 * 1000L;

    private SignalAlertDispatcher() {}

    public static boolean claimAndFeedback(Context context, String alertId, String signal) {
        if (!"CALL".equals(signal) && !"PUT".equals(signal)) return false;
        if (alertId == null || alertId.trim().isEmpty()) return false;
        SharedPreferences master = context.getSharedPreferences("radar_app_settings", Context.MODE_PRIVATE);
        if (!master.getBoolean("systemEnabled", true)) return false;

        synchronized (LOCK) {
            SharedPreferences seen = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String previous = seen.getString("last_alert_id", "");
            long previousAt = seen.getLong("last_alert_at", 0L);
            long now = System.currentTimeMillis();
            if (alertId.equals(previous) && now - previousAt < SAME_ALERT_DEDUPE_MS) return false;
            // FCM and foreground polling share this persistent gate: only one
            // CALL/PUT feedback event is allowed in any 60-second candle cycle.
            if (previousAt > 0L && now - previousAt < GLOBAL_COOLDOWN_MS) return false;
            if (!seen.edit().putString("last_alert_id", alertId).putLong("last_alert_at", now).commit()) {
                Log.w("RadarAlert", "Could not persist alert dedupe marker");
            }
        }

        boolean sound = master.getBoolean("soundEnabled", true);
        boolean vibration = master.getBoolean("vibrationEnabled", true);
        if (sound) playSound(context, signal);
        if (vibration) vibrate(context, signal);
        return true;
    }

    private static void playSound(Context context, String signal) {
        ToneGenerator tone = null;
        try {
            AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audio == null || audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION) <= 0) return;
            tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100);
            tone.startTone("CALL".equals(signal) ? ToneGenerator.TONE_PROP_ACK : ToneGenerator.TONE_PROP_NACK, 420);
            ToneGenerator release = tone;
            new Handler(Looper.getMainLooper()).postDelayed(release::release, 650);
        } catch (Exception e) {
            if (tone != null) tone.release();
            Log.w("RadarAlert", "Signal audio failed", e);
        }
    }

    private static void vibrate(Context context, String signal) {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = "CALL".equals(signal)
                ? new long[]{0, 120, 55, 120, 55, 240}
                : new long[]{0, 360, 90, 360};
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            else vibrator.vibrate(pattern, -1);
        } catch (Exception e) {
            Log.w("RadarAlert", "Signal haptic failed", e);
        }
    }
}
