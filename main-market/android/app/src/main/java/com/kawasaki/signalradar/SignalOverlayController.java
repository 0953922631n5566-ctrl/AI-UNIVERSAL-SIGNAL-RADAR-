package com.kawasaki.signalradar;

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
import android.widget.TextView;

public final class SignalOverlayController {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static WindowManager manager;
    private static View currentView;
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
        MAIN.post(() -> showOnMain(app, signal, symbol, price));
        return true;
    }

    private static void showOnMain(Context context, String signal, String symbol, String price) {
        dismissOnMain();
        boolean call = "CALL".equals(signal);
        int accent = call ? Color.rgb(0, 230, 118) : Color.rgb(255, 55, 75);
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            call ? new int[]{Color.rgb(0, 105, 57), Color.rgb(0, 65, 45)}
                 : new int[]{Color.rgb(145, 0, 30), Color.rgb(80, 0, 24)}
        );
        background.setCornerRadius(dp(context, 14));
        background.setStroke(dp(context, 1), accent);

        TextView banner = new TextView(context);
        banner.setText((call ? "↑  CALL" : "↓  PUT") + "     " +
            (symbol == null || symbol.isEmpty() ? "EUR/USD" : symbol) + "     " +
            (price == null || price.isEmpty() ? "--" : price));
        banner.setTextColor(Color.WHITE);
        banner.setTextSize(16);
        banner.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
        banner.setGravity(Gravity.CENTER_VERTICAL);
        banner.setSingleLine(true);
        banner.setPadding(dp(context, 18), dp(context, 10), dp(context, 18), dp(context, 10));
        banner.setBackground(background);
        banner.setElevation(dp(context, 12));
        banner.setClickable(false);
        banner.setFocusable(false);

        WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            context.getResources().getDisplayMetrics().widthPixels - dp(context, 16),
            WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE |
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = dp(context, 8);
        try {
            wm.addView(banner, params);
            manager = wm;
            currentView = banner;
            banner.setAlpha(0f);
            banner.setTranslationY(-dp(context, 12));
            banner.animate().alpha(1f).translationY(0f).setDuration(180).start();
            timeout = SignalOverlayController::dismissOnMain;
            MAIN.postDelayed(timeout, 6500L);
        } catch (Exception e) {
            Log.w("RadarOverlay", "Could not add compact top banner", e);
            dismissOnMain();
        }
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
        if (manager != null && currentView != null) {
            try { manager.removeView(currentView); } catch (Exception ignored) {}
        }
        manager = null;
        currentView = null;
    }
}
