package com.aiuniversal.signalradar

import android.graphics.Bitmap
import android.graphics.Color
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.abs

data class CandleData(
    val timestampMinute: Long,
    var open: Double,
    var high: Double,
    var low: Double,
    var close: Double
) {
    val direction: String get() = when { close > open -> "BULLISH"; close < open -> "BEARISH"; else -> "DOJI" }
    val bodySize: Double get() = abs(close - open)
    val upperWick: Double get() = high - maxOf(open, close)
    val lowerWick: Double get() = minOf(open, close) - low
}

object CandleAnalyzer {
    private var currentCandle: CandleData? = null
    private var previousCandle: CandleData? = null

    @Synchronized
    fun updatePriceTick(price: Double, nowMs: Long = System.currentTimeMillis()): JSONObject {
        val minute = nowMs / 60_000L
        val second = Calendar.getInstance().apply { timeInMillis = nowMs }.get(Calendar.SECOND)
        val active = currentCandle
        if (active == null || active.timestampMinute != minute) {
            if (active != null) previousCandle = active.copy()
            currentCandle = CandleData(minute, price, price, price, price)
        } else {
            active.high = maxOf(active.high, price); active.low = minOf(active.low, price); active.close = price
        }
        val candle = currentCandle!!
        val previous = previousCandle
        val engulfing = previous != null && candle.direction != previous.direction && candle.bodySize > previous.bodySize
        return JSONObject().apply {
            put("timestamp_minute", candle.timestampMinute); put("second_in_candle", second)
            put("direction", candle.direction); put("open", candle.open); put("high", candle.high)
            put("low", candle.low); put("close", candle.close); put("body_size", candle.bodySize)
            put("upper_wick", candle.upperWick); put("lower_wick", candle.lowerWick); put("is_engulfing", engulfing)
        }
    }

    fun analyzeChartZoneFromBitmap(bitmap: Bitmap, nowMs: Long = System.currentTimeMillis()): JSONObject {
        val second = Calendar.getInstance().apply { timeInMillis = nowMs }.get(Calendar.SECOND)
        val startX = (bitmap.width * .20).toInt(); val endX = (bitmap.width * .80).toInt()
        val startY = (bitmap.height * .25).toInt(); val endY = (bitmap.height * .75).toInt()
        var green = 0; var red = 0
        for (y in startY until endY step 4) for (x in startX until endX step 4) {
            val p = bitmap.getPixel(x, y); val r = Color.red(p); val g = Color.green(p); val b = Color.blue(p)
            if (g > r + 35 && g > b + 35) green++ else if (r > g + 35 && r > b + 35) red++
        }
        val bias = when { green > red * 1.15 -> "GREEN_BULLISH"; red > green * 1.15 -> "RED_BEARISH"; else -> "NEUTRAL" }
        return JSONObject().apply {
            put("timestamp_ms", nowMs); put("second_in_candle", second)
            put("green_pixels", green); put("red_pixels", red); put("visual_candle_bias", bias)
        }
    }
}
