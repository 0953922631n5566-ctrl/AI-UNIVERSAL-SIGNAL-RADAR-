package com.otcvision.radar.vision

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

object BitmapPreprocessor {
    /**
     * Converts the anchored orange tag to a high-contrast, black-ink/white-paper OCR image.
     * It detects whether the non-orange glyphs are light or dark, then normalizes either polarity.
     */
    fun prepareOrangeTagForOcr(source: Bitmap): Bitmap {
        val width = source.width
        val height = source.height
        val input = IntArray(width * height)
        source.getPixels(input, 0, width, 0, 0, width, height)

        var nonOrangeSum = 0L
        var nonOrangeCount = 0
        for (color in input) {
            if (!OrangeTagDetector.isOrange(color)) {
                nonOrangeSum += luminance(color)
                nonOrangeCount++
            }
        }
        // White price glyphs on orange have high luminance; dark glyphs have low luminance.
        val brightGlyphs = nonOrangeCount == 0 || nonOrangeSum.toFloat() / nonOrangeCount >= 145f

        val gray = IntArray(input.size) { index ->
            val color = input[index]
            if (OrangeTagDetector.isOrange(color)) {
                255
            } else {
                val luma = luminance(color)
                val normalized = if (brightGlyphs) 255f - luma else luma
                // Expand the glyph range while retaining antialiased edges for local thresholding.
                ((normalized - 112f) * 2.15f + 128f).roundToInt().coerceIn(0, 255)
            }
        }

        if (width < 3 || height < 3) return grayBitmap(width, height, gray)

        val stride = width + 1
        val integral = LongArray((width + 1) * (height + 1))
        for (y in 1..height) {
            var rowSum = 0L
            for (x in 1..width) {
                rowSum += gray[(y - 1) * width + (x - 1)]
                integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum
            }
        }

        // A compact local window handles uneven anti-aliasing and residual orange gradients.
        val radius = (minOf(width, height) / 6).coerceIn(4, 12)
        val output = IntArray(gray.size)
        for (y in 0 until height) {
            val top = (y - radius).coerceAtLeast(0)
            val bottom = (y + radius + 1).coerceAtMost(height)
            for (x in 0 until width) {
                val left = (x - radius).coerceAtLeast(0)
                val right = (x + radius + 1).coerceAtMost(width)
                val count = (right - left) * (bottom - top)
                val sum = integral[bottom * stride + right] -
                    integral[top * stride + right] -
                    integral[bottom * stride + left] +
                    integral[top * stride + left]
                val localMean = sum.toFloat() / count
                val value = gray[y * width + x]
                val threshold = (localMean - 7f).coerceIn(88f, 242f)
                val binary = if (value < threshold) 0 else 255
                output[y * width + x] = Color.rgb(binary, binary, binary)
            }
        }
        return grayBitmap(width, height, output)
    }

    /**
     * Bicubic 2x resize (Catmull-Rom cubic kernel). Caller owns returned bitmap.
     * This is deliberately explicit: Bitmap.createScaledBitmap(filter=true) is not bicubic.
     */
    fun upscaleBicubic2x(source: Bitmap): Bitmap {
        val srcW = source.width
        val srcH = source.height
        if (srcW <= 0 || srcH <= 0) return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        val src = IntArray(srcW * srcH)
        source.getPixels(src, 0, srcW, 0, 0, srcW, srcH)
        val dstW = srcW * 2
        val dstH = srcH * 2
        val dst = IntArray(dstW * dstH)

        for (dy in 0 until dstH) {
            val sy = (dy + 0.5f) / 2f - 0.5f
            val yBase = floor(sy).toInt()
            val fy = sy - yBase
            for (dx in 0 until dstW) {
                val sx = (dx + 0.5f) / 2f - 0.5f
                val xBase = floor(sx).toInt()
                val fx = sx - xBase
                var red = 0f
                var green = 0f
                var blue = 0f
                var total = 0f
                for (oy in -1..2) {
                    val py = (yBase + oy).coerceIn(0, srcH - 1)
                    val wy = cubicWeight(oy - fy)
                    for (ox in -1..2) {
                        val px = (xBase + ox).coerceIn(0, srcW - 1)
                        val weight = wy * cubicWeight(ox - fx)
                        val color = src[py * srcW + px]
                        red += Color.red(color) * weight
                        green += Color.green(color) * weight
                        blue += Color.blue(color) * weight
                        total += weight
                    }
                }
                val divisor = if (abs(total) < 0.0001f) 1f else total
                dst[dy * dstW + dx] = Color.rgb(
                    (red / divisor).roundToInt().coerceIn(0, 255),
                    (green / divisor).roundToInt().coerceIn(0, 255),
                    (blue / divisor).roundToInt().coerceIn(0, 255)
                )
            }
        }
        return Bitmap.createBitmap(dst, dstW, dstH, Bitmap.Config.ARGB_8888)
    }

    private fun cubicWeight(distance: Float): Float {
        val x = abs(distance)
        val a = -0.5f
        return when {
            x <= 1f -> (a + 2f) * x * x * x - (a + 3f) * x * x + 1f
            x < 2f -> a * x * x * x - 5f * a * x * x + 8f * a * x - 4f * a
            else -> 0f
        }
    }

    private fun luminance(color: Int): Float =
        Color.red(color) * 0.299f + Color.green(color) * 0.587f + Color.blue(color) * 0.114f

    private fun grayBitmap(width: Int, height: Int, pixels: IntArray): Bitmap =
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
            it.setPixels(pixels, 0, width, 0, 0, width, height)
        }

    /** General scale helper retained for non-tag ROIs. */
    fun scaleForOcr(source: Bitmap, maxDimension: Int = 1400, minHeight: Int = 96): Bitmap {
        val largest = max(source.width, source.height)
        val scaleDown = if (largest > maxDimension) maxDimension.toFloat() / largest else 1f
        val scaleUp = if (source.height * scaleDown < minHeight) {
            minHeight.toFloat() / source.height
        } else 1f
        val ratio = scaleDown * scaleUp
        if (abs(ratio - 1f) < 0.001f) return Bitmap.createBitmap(source)
        return Bitmap.createScaledBitmap(
            source,
            max(1, (source.width * ratio).roundToInt()),
            max(1, (source.height * ratio).roundToInt()),
            true
        )
    }

    /** Legacy grayscale + contrast + 3x3 median denoise. Caller owns returned bitmap. */
    fun prepareForOcr(source: Bitmap, contrast: Float = 1.35f): Bitmap {
        val width = source.width
        val height = source.height
        val input = IntArray(width * height)
        source.getPixels(input, 0, width, 0, 0, width, height)
        val gray = IntArray(input.size) { index ->
            val c = input[index]
            val luminance = luminance(c).roundToInt()
            val adjusted = (((luminance - 128) * contrast) + 128).roundToInt().coerceIn(0, 255)
            Color.rgb(adjusted, adjusted, adjusted)
        }
        if (width >= 3 && height >= 3) {
            val filtered = gray.copyOf()
            val samples = IntArray(9)
            for (y in 1 until height - 1) for (x in 1 until width - 1) {
                var k = 0
                for (dy in -1..1) for (dx in -1..1) samples[k++] = Color.red(gray[(y + dy) * width + x + dx])
                samples.sort()
                filtered[y * width + x] = Color.rgb(samples[4], samples[4], samples[4])
            }
            filtered.copyInto(gray)
        }
        return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
            it.setPixels(gray, 0, width, 0, 0, width, height)
        }
    }
}
