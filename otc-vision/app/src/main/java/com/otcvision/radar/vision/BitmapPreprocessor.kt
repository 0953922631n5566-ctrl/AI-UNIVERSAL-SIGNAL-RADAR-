package com.otcvision.radar.vision

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.max
import kotlin.math.roundToInt

object BitmapPreprocessor {
    /**
     * Orange tag -> white canvas, bright quote glyphs -> dark ink.
     * A summed-area table applies a local adaptive threshold without a costly per-pixel window scan.
     */
    fun prepareOrangeTagForOcr(source: Bitmap): Bitmap {
        val width = source.width
        val height = source.height
        val input = IntArray(width * height)
        source.getPixels(input, 0, width, 0, 0, width, height)

        val gray = IntArray(input.size) { index ->
            val color = input[index]
            if (OrangeTagDetector.isOrange(color)) {
                255
            } else {
                val luminance = (Color.red(color) * 0.299f +
                    Color.green(color) * 0.587f +
                    Color.blue(color) * 0.114f)
                // Invert the bright/white price glyphs and stretch antialiased edges.
                (((255f - luminance - 128f) * 1.85f) + 128f)
                    .roundToInt().coerceIn(0, 255)
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

        val radius = (minOf(width, height) / 5).coerceIn(3, 9)
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
                // Mild adaptive threshold: retain gray edge pixels only when local contrast supports ink.
                val threshold = (localMean - 9f).coerceIn(96f, 238f)
                val binary = if (value < threshold) 0 else 255
                output[y * width + x] = Color.rgb(binary, binary, binary)
            }
        }
        return grayBitmap(width, height, output)
    }

    private fun grayBitmap(width: Int, height: Int, pixels: IntArray): Bitmap =
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
            it.setPixels(pixels, 0, width, 0, 0, width, height)
        }

    /** Downscales oversized frames and enlarges tiny price tags for ML Kit character separation. */
    fun scaleForOcr(source: Bitmap, maxDimension: Int = 1400, minHeight: Int = 96): Bitmap {
        val largest = max(source.width, source.height)
        val scaleDown = if (largest > maxDimension) maxDimension.toFloat() / largest else 1f
        val scaleUp = if (source.height * scaleDown < minHeight) {
            minHeight.toFloat() / source.height
        } else 1f
        val ratio = scaleDown * scaleUp
        if (kotlin.math.abs(ratio - 1f) < 0.001f) return Bitmap.createBitmap(source)
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
            val luminance = (Color.red(c) * 0.299f + Color.green(c) * 0.587f + Color.blue(c) * 0.114f).roundToInt()
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
