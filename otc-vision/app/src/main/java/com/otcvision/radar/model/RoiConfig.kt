package com.otcvision.radar.model

import android.graphics.Rect
import kotlin.math.roundToInt

data class NormalizedRoi(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    init {
        require(left in 0f..1f && top in 0f..1f)
        require(right in 0f..1f && bottom in 0f..1f)
        require(right > left && bottom > top)
    }
    fun toRect(width: Int, height: Int): Rect {
        val l = (left * width).roundToInt().coerceIn(0, width - 1)
        val t = (top * height).roundToInt().coerceIn(0, height - 1)
        val r = (right * width).roundToInt().coerceIn(l + 1, width)
        val b = (bottom * height).roundToInt().coerceIn(t + 1, height)
        return Rect(l, t, r, b)
    }
}

data class RoiConfig(
    val priceLabel: NormalizedRoi = NormalizedRoi(0.72f, 0.08f, 0.995f, 0.58f),
    val candleChart: NormalizedRoi = NormalizedRoi(0.04f, 0.12f, 0.96f, 0.88f)
) {
    companion object { fun defaults() = RoiConfig() }
}
