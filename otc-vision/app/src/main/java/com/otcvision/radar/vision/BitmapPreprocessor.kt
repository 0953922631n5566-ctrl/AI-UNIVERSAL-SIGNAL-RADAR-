package com.otcvision.radar.vision

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.max
import kotlin.math.roundToInt

object BitmapPreprocessor {
    /** Grayscale + contrast + 3x3 median denoise. Caller owns returned bitmap. */
    fun prepareForOcr(source: Bitmap, contrast: Float = 1.35f): Bitmap {
        val width = source.width
        val height = source.height
        val input = IntArray(width * height)
        source.getPixels(input, 0, width, 0, 0, width, height)
        val gray = IntArray(input.size) { index ->
            val c = input[index]
            val luminance = (Color.red(c) * 0.299f + Color.green(c) * 0.587f + Color.blue(c) * 0.114f).roundToInt()
            val adjusted = (((luminance - 128) * contrast) + 128).roundToInt().coerceIn(0, 255)
            Color.rgb(adjusted, adjusted, adjusted)
        }
        if (width >= 3 && height >= 3) {
            val filtered = gray.copyOf()
            val samples = IntArray(9)
            for (y in 1 until height - 1) for (x in 1 until width - 1) {
                var k = 0
                for (dy in -1..1) for (dx in -1..1) {
                    samples[k++] = Color.red(gray[(y + dy) * width + x + dx])
                }
                samples.sort()
                val median = samples[4]
                filtered[y * width + x] = Color.rgb(median, median, median)
            }
            filtered.copyInto(gray)
        }
        return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
            it.setPixels(gray, 0, width, 0, 0, width, height)
        }
    }

    fun scaleForOcr(source: Bitmap, maxDimension: Int = 1400): Bitmap {
        val largest = max(source.width, source.height)
        if (largest <= maxDimension) return Bitmap.createBitmap(source)
        val ratio = maxDimension.toFloat() / largest
        val width = max(1, (source.width * ratio).roundToInt())
        val height = max(1, (source.height * ratio).roundToInt())
        return Bitmap.createScaledBitmap(source, width, height, true)
    }
}
