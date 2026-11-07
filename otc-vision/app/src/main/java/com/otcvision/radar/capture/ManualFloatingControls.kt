package com.otcvision.radar.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * User-operated controls. No frame polling or OCR is started from this class;
 * a single capture is requested only by an explicit button tap.
 */
class ManualFloatingControls(
    private val context: Context,
    private val windowManager: WindowManager,
    private val onCapture: () -> Unit,
    private val onStop: () -> Unit
) {
    private val prefs = context.getSharedPreferences("manual_roi", Context.MODE_PRIVATE)
    private var roiParams: WindowManager.LayoutParams? = null
    private var roiView: RoiOverlayView? = null
    private var panel: LinearLayout? = null
    private var status: TextView? = null
    private var captureButton: Button? = null

    fun show(screenWidth: Int, screenHeight: Int) {
        if (panel != null) return
        val savedX = prefs.getInt("x", (screenWidth * 0.68f).toInt()).coerceIn(0, screenWidth - 80)
        val savedY = prefs.getInt("y", (screenHeight * 0.40f).toInt()).coerceIn(0, screenHeight - 60)
        val savedW = prefs.getInt("w", (screenWidth * 0.25f).toInt()).coerceIn(100, screenWidth - savedX)
        val savedH = prefs.getInt("h", (screenHeight * 0.065f).toInt()).coerceIn(48, screenHeight - savedY)

        val roi = RoiOverlayView(context) { x, y, w, h ->
            prefs.edit().putInt("x", x).putInt("y", y).putInt("w", w).putInt("h", h).apply()
        }
        roiView = roi
        roiParams = overlayParams(savedW, savedH).apply {
            gravity = Gravity.TOP or Gravity.START
            x = savedX
            y = savedY
        }
        windowManager.addView(roi, roiParams)

        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(10, 8, 10, 8)
            setBackgroundColor(Color.argb(235, 25, 30, 38))
        }
        status = TextView(context).apply {
            text = "ROI READY · drag box / resize corner"
            setTextColor(Color.WHITE)
            textSize = 12f
            setPadding(6, 4, 6, 6)
        }
        captureButton = Button(context).apply {
            text = "CAPTURE & ANALYZE"
            isAllCaps = false
            setOnClickListener {
                isEnabled = false
                text = "CAPTURING…"
                status?.text = "Waiting for next screen frame…"
                onCapture()
            }
        }
        val stopButton = Button(context).apply {
            text = "STOP"
            isAllCaps = false
            setOnClickListener { onStop() }
        }
        column.addView(status)
        column.addView(captureButton)
        column.addView(stopButton)
        panel = column
        windowManager.addView(column, overlayParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (screenHeight * 0.08f).toInt()
        })
    }

    /** Temporarily hide both app-owned overlays so they are not present in the captured pixels. */
    fun hideForCapture() {
        panel?.visibility = View.INVISIBLE
        roiView?.visibility = View.INVISIBLE
    }

    fun showAfterFrame() {
        roiView?.visibility = View.VISIBLE
        panel?.visibility = View.VISIBLE
        setStatus("Analyzing selected ROI…", false)
    }

    fun setStatus(message: String, ready: Boolean = true) {
        status?.text = message
        captureButton?.isEnabled = ready
        if (ready) captureButton?.text = "CAPTURE & ANALYZE"
    }

    fun roiBoundsOnScreen(): Rect? {
        val view = roiView ?: return null
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
    }

    fun remove() {
        runCatching { panel?.let { windowManager.removeView(it) } }
        runCatching { roiView?.let { windowManager.removeView(it) } }
        panel = null
        status = null
        captureButton = null
        roiView = null
        roiParams = null
    }

    @Suppress("DEPRECATION")
    private fun overlayParams(width: Int, height: Int): WindowManager.LayoutParams {
        val windowType = if (Build.VERSION.SDK_INT >= 26) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }
        return WindowManager.LayoutParams(
            width,
            height,
            windowType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        )
    }

    private inner class RoiOverlayView(
        context: Context,
        private val onGeometryChanged: (Int, Int, Int, Int) -> Unit
    ) : View(context) {
        private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(255, 190, 35)
            style = Paint.Style.STROKE
            strokeWidth = 5f
        }
        private val handle = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(255, 190, 35)
            style = Paint.Style.FILL
        }
        private var downRawX = 0f
        private var downRawY = 0f
        private var startX = 0
        private var startY = 0
        private var startW = 0
        private var startH = 0
        private var resizing = false

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val inset = 4f
            canvas.drawRect(inset, inset, width - inset, height - inset, border)
            canvas.drawCircle(width - 14f, height - 14f, 12f, handle)
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            val params = roiParams ?: return false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = params.x
                    startY = params.y
                    startW = params.width
                    startH = params.height
                    resizing = event.x >= width - 42f && event.y >= height - 42f
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downRawX).toInt()
                    val dy = (event.rawY - downRawY).toInt()
                    val metrics = context.resources.displayMetrics
                    if (resizing) {
                        params.width = (startW + dx).coerceIn(100, metrics.widthPixels - params.x)
                        params.height = (startH + dy).coerceIn(48, metrics.heightPixels - params.y)
                    } else {
                        params.x = (startX + dx).coerceIn(0, metrics.widthPixels - params.width)
                        params.y = (startY + dy).coerceIn(0, metrics.heightPixels - params.height)
                    }
                    runCatching { windowManager.updateViewLayout(this, params) }
                    onGeometryChanged(params.x, params.y, params.width, params.height)
                    return true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> return true
            }
            return true
        }
    }
}
