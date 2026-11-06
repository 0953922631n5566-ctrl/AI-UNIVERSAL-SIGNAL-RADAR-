package com.kawasaki.signalradar;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class SignalOverlayController {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static WindowManager manager;
    private static View currentView;
    private static ValueAnimator pulse;
    private static Runnable timeout;

    private SignalOverlayController() {}

    public static boolean hasPermission(Context context) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context.getApplicationContext());
    }

    public static boolean show(Context context, String signal, String symbol, String price, String reason) {
        if (!"CALL".equals(signal) && !"PUT".equals(signal)) return false;
        if (!context.getSharedPreferences("radar_app_settings", Context.MODE_PRIVATE).getBoolean("systemEnabled", true)) return false;
        if (!hasPermission(context)) return false;
        Context app = context.getApplicationContext();
        MAIN.post(() -> showOnMain(app, signal, symbol, price, reason));
        return true;
    }

    private static void showOnMain(Context context, String signal, String symbol, String price, String reason) {
        dismissOnMain();
        boolean call = "CALL".equals(signal);
        int accent = call ? Color.rgb(0, 255, 112) : Color.rgb(255, 38, 62);
        int[] colors = call
            ? new int[]{Color.rgb(0, 185, 78), Color.rgb(0, 112, 54), Color.rgb(0, 65, 39)}
            : new int[]{Color.rgb(255, 35, 58), Color.rgb(180, 0, 30), Color.rgb(88, 0, 22)};

        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        int pad = dp(context, 22);
        card.setPadding(pad, pad, pad, pad);
        GradientDrawable background = new GradientDrawable(GradientDrawable.Orientation.TL_BR, colors);
        background.setCornerRadius(dp(context, 22));
        background.setStroke(dp(context, 3), accent);
        card.setBackground(background);
        card.setElevation(dp(context, 24));

        TextView eyebrow = text(context, "SIGNAL RADAR PRO  ·  LIVE ALERT", 11, Color.WHITE);
        TextView arrow = text(context, call ? "⬆" : "⬇", 54, Color.WHITE);
        TextView direction = text(context, signal, 46, Color.WHITE);
        TextView pair = text(context, (symbol == null ? "EUR/USD" : symbol) + "   ·   " + (price == null ? "--" : price), 19, Color.WHITE);
        TextView detail = text(context, reason == null ? "" : reason, 13, Color.WHITE);
        card.addView(eyebrow, full());
        card.addView(arrow, full());
        card.addView(direction, full());
        card.addView(pair, full());
        card.addView(detail, full());

        Button close = new Button(context);
        close.setText("รับทราบ");
        close.setAllCaps(false);
        close.setTextColor(Color.WHITE);
        close.setBackgroundTintList(android.content.res.ColorStateList.valueOf(accent));
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(-1, dp(context, 46));
        closeParams.topMargin = dp(context, 14);
        card.addView(close, closeParams);
        close.setOnClickListener(v -> dismiss(context));

        WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            -1, WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = dp(context, 105);
        params.width = context.getResources().getDisplayMetrics().widthPixels - dp(context, 24);
        try {
            wm.addView(card, params);
            manager = wm;
            currentView = card;
            card.setAlpha(0f);
            card.setScaleX(.88f);
            card.setScaleY(.88f);
            card.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(240).start();
            pulse = ValueAnimator.ofFloat(.45f, 1f);
            pulse.setDuration(call ? 760 : 260);
            pulse.setRepeatMode(ValueAnimator.REVERSE);
            pulse.setRepeatCount(ValueAnimator.INFINITE);
            pulse.addUpdateListener(v -> {
                int alpha = (int) (110 + 145 * (float) v.getAnimatedValue());
                background.setStroke(dp(context, 2 + (int) (3 * (float) v.getAnimatedValue())), (alpha << 24) | (accent & 0x00ffffff));
                card.setAlpha(.88f + .12f * (float) v.getAnimatedValue());
            });
            pulse.start();
            timeout = () -> dismissOnMain();
            MAIN.postDelayed(timeout, 6500);
        } catch (Exception e) {
            Log.w("RadarOverlay", "Could not add floating signal banner", e);
            dismissOnMain();
        }
    }

    private static TextView text(Context context, String value, int size, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
        view.setGravity(Gravity.CENTER);
        view.setPadding(0, dp(context, 4), 0, dp(context, 4));
        view.setMaxLines(3);
        return view;
    }

    private static LinearLayout.LayoutParams full() {
        return new LinearLayout.LayoutParams(-1, -2);
    }

    private static int dp(Context context, float value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + .5f);
    }

    public static void dismiss(Context context) {
        MAIN.post(SignalOverlayController::dismissOnMain);
    }

    private static void dismissOnMain() {
        if (timeout != null) {
            MAIN.removeCallbacks(timeout);
            timeout = null;
        }
        if (pulse != null) {
            pulse.cancel();
            pulse = null;
        }
        if (manager != null && currentView != null) {
            try { manager.removeView(currentView); } catch (Exception ignored) {}
        }
        manager = null;
        currentView = null;
    }
}
