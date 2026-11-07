package com.otcvision.radar.capture

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.Toast

/**
 * Minimal one-button overlay. All WindowManager/View mutations are marshalled
 * onto the Android main thread; capture and upload workers never touch Views.
 */
class ManualFloatingControls(
    private val context: Context,
    private val windowManager: WindowManager,
    private val onCapture: () -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var button: Button? = null
    @Volatile private var params: WindowManager.LayoutParams? = null
    private var displayWidth = 1
    private var displayHeight = 1
    private var downRawX = 0f
    private var downRawY = 0f
    private var startX = 0
    private var startY = 0
    private var moved = false

    private fun onMain(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) action()
        else mainHandler.post { action() }
    }

    fun show(screenWidth: Int, screenHeight: Int) = onMain {
        if (button != null) return@onMain
        displayWidth = screenWidth.coerceAtLeast(1)
        displayHeight = screenHeight.coerceAtLeast(1)
        val saved = context.getSharedPreferences("scan_button", Context.MODE_PRIVATE)
        val view = Button(context).apply {
            text = "CAPTURE & SEND"
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
                text = "SENDING…"
                try {
                    onCapture()
                } catch (error: Throwable) {
                    isEnabled = true
                    text = "FAILED · TAP TO RETRY"
                    runCatching {
                        Toast.makeText(context, error.message ?: "Scan request failed", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
        button = view
        params = overlayParams().apply {
            gravity = Gravity.TOP or Gravity.START
            x = saved.getInt("x", (displayWidth * 0.55f).toInt()).coerceIn(0, displayWidth - 1)
            y = saved.getInt("y", (displayHeight * 0.12f).toInt()).coerceIn(0, displayHeight - 1)
        }
        try {
            windowManager.addView(view, params)
        } catch (error: Throwable) {
            button = null
            params = null
            throw error
        }
    }

    fun hideForCapture() = onMain { button?.visibility = View.INVISIBLE }

    fun showAfterFrame() = onMain { button?.visibility = View.VISIBLE }

    fun setStatus(message: String, ready: Boolean = true) = onMain {
        button?.apply {
            text = message.take(42)
            isEnabled = ready
            visibility = View.VISIBLE
        }
    }

    fun remove() = onMain {
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
