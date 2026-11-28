package com.universalbrokervision

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager

/**
 * User-positioned transparent price-reading window.
 * Coordinates are stored as screen-relative fractions so they survive resolution changes.
 */
class PriceRegionOverlay(private val context: Context) {
    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val prefs = context.getSharedPreferences("vision_price_region", Context.MODE_PRIVATE)
    private var overlayView: RegionView? = null
    private var params: WindowManager.LayoutParams? = null
    private var screenWidth = context.resources.displayMetrics.widthPixels
    private var screenHeight = context.resources.displayMetrics.heightPixels

    fun show(width: Int = screenWidth, height: Int = screenHeight) {
        if (!Settings.canDrawOverlays(context) || overlayView != null) return
        screenWidth = width.coerceAtLeast(1)
        screenHeight = height.coerceAtLeast(1)

        val savedX = prefs.getFloat(KEY_X, 0.66f)
        val savedY = prefs.getFloat(KEY_Y, 0.40f)
        val savedW = prefs.getFloat(KEY_W, 0.30f)
        val savedH = prefs.getFloat(KEY_H, 0.11f)
        val w = (savedW * screenWidth).toInt().coerceIn(MIN_WIDTH, screenWidth)
        val h = (savedH * screenHeight).toInt().coerceIn(MIN_HEIGHT, screenHeight)
        val x = (savedX * screenWidth).toInt().coerceIn(0, screenWidth - w)
        val y = (savedY * screenHeight).toInt().coerceIn(0, screenHeight - h)

        val layout = WindowManager.LayoutParams(
            w,
            h,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            this.x = x
            this.y = y
        }

        val view = RegionView(context) { savePosition() }
        try {
            windowManager.addView(view, layout)
            params = layout
            overlayView = view
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Unable to show price region overlay", e)
        }
    }

    fun remove() {
        val view = overlayView ?: return
        try { windowManager.removeView(view) } catch (_: Exception) { }
        overlayView = null
        params = null
    }

    private fun savePosition() {
        val p = params ?: return
        prefs.edit()
            .putFloat(KEY_X, p.x.toFloat() / screenWidth)
            .putFloat(KEY_Y, p.y.toFloat() / screenHeight)
            .putFloat(KEY_W, p.width.toFloat() / screenWidth)
            .putFloat(KEY_H, p.height.toFloat() / screenHeight)
            .apply()
    }

    private inner class RegionView(
        context: Context,
        private val onPositionChanged: () -> Unit
    ) : View(context) {
        private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(34, 230, 125)
            style = Paint.Style.STROKE
            strokeWidth = 4f * resources.displayMetrics.density
        }
        private val handle = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(34, 230, 125)
            style = Paint.Style.FILL
        }
        private var downRawX = 0f
        private var downRawY = 0f
        private var startX = 0
        private var startY = 0
        private var startWidth = 0
        private var startHeight = 0
        private var resizing = false
        private val handleSize = 30f * resources.displayMetrics.density

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val inset = border.strokeWidth
            canvas.drawRect(inset, inset, width - inset, height - inset, border)
            canvas.drawCircle(width - handleSize / 2, height - handleSize / 2, handleSize / 2, handle)
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            val p = params ?: return false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = p.x
                    startY = p.y
                    startWidth = p.width
                    startHeight = p.height
                    resizing = event.x >= width - handleSize * 1.5f &&
                        event.y >= height - handleSize * 1.5f
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downRawX).toInt()
                    val dy = (event.rawY - downRawY).toInt()
                    if (resizing) {
                        p.width = (startWidth + dx).coerceIn(MIN_WIDTH, screenWidth - p.x)
                        p.height = (startHeight + dy).coerceIn(MIN_HEIGHT, screenHeight - p.y)
                    } else {
                        p.x = (startX + dx).coerceIn(0, screenWidth - p.width)
                        p.y = (startY + dy).coerceIn(0, screenHeight - p.height)
                    }
                    try { windowManager.updateViewLayout(this, p) } catch (_: Exception) { }
                    invalidate()
                    return true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    onPositionChanged()
                    performClick()
                    return true
                }
            }
            return true
        }

        override fun performClick(): Boolean {
            super.performClick()
            return true
        }
    }

    companion object {
        private const val TAG = "BrokerVisionROI"
        private const val KEY_X = "roi_x"
        private const val KEY_Y = "roi_y"
        private const val KEY_W = "roi_w"
        private const val KEY_H = "roi_h"
        private const val MIN_WIDTH = 120
        private const val MIN_HEIGHT = 64

        fun cropRect(context: Context, bitmapWidth: Int, bitmapHeight: Int): Rect {
            val prefs = context.getSharedPreferences("vision_price_region", Context.MODE_PRIVATE)
            val w = (prefs.getFloat(KEY_W, 0.30f) * bitmapWidth).toInt().coerceIn(1, bitmapWidth)
            val h = (prefs.getFloat(KEY_H, 0.11f) * bitmapHeight).toInt().coerceIn(1, bitmapHeight)
            val x = (prefs.getFloat(KEY_X, 0.66f) * bitmapWidth).toInt().coerceIn(0, bitmapWidth - w)
            val y = (prefs.getFloat(KEY_Y, 0.40f) * bitmapHeight).toInt().coerceIn(0, bitmapHeight - h)
            return Rect(x, y, x + w, y + h)
        }
    }
}
