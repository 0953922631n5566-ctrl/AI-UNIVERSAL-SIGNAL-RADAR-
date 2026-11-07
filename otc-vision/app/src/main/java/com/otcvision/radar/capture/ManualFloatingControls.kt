package com.otcvision.radar.capture

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.Toast

/**
 * Minimal one-button overlay. There is no movable/resizable ROI surface.
 * The button itself can be dragged; every tap requests exactly one capture.
 */
class ManualFloatingControls(
    private val context: Context,
    private val windowManager: WindowManager,
    private val onCapture: () -> Unit
) {
    private var button: Button? = null
    private var params: WindowManager.LayoutParams? = null
    private var displayWidth = 1
    private var displayHeight = 1
    private var downRawX = 0f
    private var downRawY = 0f
    private var startX = 0
    private var startY = 0
    private var moved = false

    fun show(screenWidth: Int, screenHeight: Int) {
        if (button != null) return
        displayWidth = screenWidth.coerceAtLeast(1)
        displayHeight = screenHeight.coerceAtLeast(1)
        val saved = context.getSharedPreferences("scan_button", Context.MODE_PRIVATE)
        val view = Button(context).apply {
            text = "SCAN & ANALYZE"
            isAllCaps = false
            textSize = 13f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(24, 112, 78))
            setPadding(18, 8, 18, 8)
            setOnTouchListener { _, event ->
                val lp = params ?: return@setOnTouchListener false
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        downRawX = event.rawX
                        downRawY = event.rawY
                        startX = lp.x
                        startY = lp.y
                        moved = false
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (event.rawX - downRawX).toInt()
                        val dy = (event.rawY - downRawY).toInt()
                        if (kotlin.math.abs(dx) > 6 || kotlin.math.abs(dy) > 6) moved = true
                        if (moved) {
                            lp.x = (startX + dx).coerceIn(0, (displayWidth - width).coerceAtLeast(0))
                            lp.y = (startY + dy).coerceIn(0, (displayHeight - height).coerceAtLeast(0))
                            runCatching { windowManager.updateViewLayout(this, lp) }
                        }
                        true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (moved) {
                            saved.edit().putInt("x", lp.x).putInt("y", lp.y).apply()
                        } else if (isEnabled) {
                            performClick()
                        }
                        true
                    }
                    MotionEvent.ACTION_CANCEL -> true
                    else -> true
                }
            }
            setOnClickListener {
                isEnabled = false
                text = "SCANNING…"
                try {
                    onCapture()
                } catch (error: Exception) {
                    isEnabled = true
                    text = "SCAN & ANALYZE"
                    Toast.makeText(context, error.message ?: "Scan request failed", Toast.LENGTH_SHORT).show()
                }
            }
        }
        button = view
        params = overlayParams().apply {
            gravity = Gravity.TOP or Gravity.START
            x = saved.getInt("x", (displayWidth * 0.55f).toInt()).coerceIn(0, displayWidth - 1)
            y = saved.getInt("y", (displayHeight * 0.12f).toInt()).coerceIn(0, displayHeight - 1)
        }
        windowManager.addView(view, params)
    }

    /** Fixed right-axis price-tag ROI: X 82–98%, Y 15–85% of the captured display. */
    fun presetRoiBounds(): android.graphics.Rect {
        val left = (displayWidth * 0.82f).toInt().coerceIn(0, displayWidth - 1)
        val right = (displayWidth * 0.98f).toInt().coerceIn(left + 1, displayWidth)
        val top = (displayHeight * 0.15f).toInt().coerceIn(0, displayHeight - 1)
        val bottom = (displayHeight * 0.85f).toInt().coerceIn(top + 1, displayHeight)
        return android.graphics.Rect(left, top, right, bottom)
    }

    fun hideForCapture() {
        button?.visibility = View.INVISIBLE
    }

    fun showAfterFrame() {
        button?.visibility = View.VISIBLE
    }

    fun setStatus(message: String, ready: Boolean = true) {
        button?.apply {
            text = message.take(42)
            isEnabled = ready
        }
    }

    fun remove() {
        runCatching { button?.let { windowManager.removeView(it) } }
        button = null
        params = null
    }

    @Suppress("DEPRECATION")
    private fun overlayParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= 26) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }
        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )
    }
}
