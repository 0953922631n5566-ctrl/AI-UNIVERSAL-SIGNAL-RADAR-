package com.otcvision.radar.vision

import android.graphics.Bitmap
import android.graphics.Rect
import android.graphics.Color
import kotlin.math.max

/** Finds the orange price-tag container inside the broad right-axis scan area. */
object OrangeTagDetector {
    fun isOrange(color: Int): Boolean {
        val hsv = FloatArray(3)
        Color.colorToHSV(color, hsv)
        return hsv[0] in 7f..48f && hsv[1] >= 0.42f && hsv[2] >= 0.38f
    }

    /**
     * Connected-component search tolerates the tag moving vertically. The returned rect
     * is relative to [source], padded slightly to preserve glyph edges.
     */
    fun findTag(source: Bitmap): Rect? {
        val width = source.width
        val height = source.height
        if (width < 24 || height < 16) return null

        val pixels = IntArray(width * height)
        source.getPixels(pixels, 0, width, 0, 0, width, height)
        val mask = BooleanArray(pixels.size)
        for (i in pixels.indices) mask[i] = isOrange(pixels[i])

        val visited = BooleanArray(mask.size)
        val queue = IntArray(mask.size)
        var best: Rect? = null
        var bestScore = 0.0

        for (start in mask.indices) {
            if (!mask[start] || visited[start]) continue
            var head = 0
            var tail = 0
            queue[tail++] = start
            visited[start] = true
            var minX = width
            var minY = height
            var maxX = -1
            var maxY = -1
            var orangeCount = 0

            while (head < tail) {
                val index = queue[head++]
                val x = index % width
                val y = index / width
                orangeCount++
                minX = minOf(minX, x)
                minY = minOf(minY, y)
                maxX = maxOf(maxX, x)
                maxY = maxOf(maxY, y)

                for (dy in -1..1) for (dx in -1..1) {
                    if (dx == 0 && dy == 0) continue
                    val nx = x + dx
                    val ny = y + dy
                    if (nx !in 0 until width || ny !in 0 until height) continue
                    val ni = ny * width + nx
                    if (mask[ni] && !visited[ni]) {
                        visited[ni] = true
                        queue[tail++] = ni
                    }
                }
            }

            val boxWidth = maxX - minX + 1
            val boxHeight = maxY - minY + 1
            val aspect = boxWidth.toFloat() / boxHeight.toFloat()
            if (orangeCount < 70 || boxWidth < 22 || boxHeight < 10 || aspect !in 1.15f..10f) continue

            // Prefer a substantial, compact, right-axis label over isolated orange pixels.
            val density = orangeCount.toDouble() / (boxWidth.toDouble() * boxHeight)
            val score = orangeCount * (0.5 + density) * (1.0 + minX.toDouble() / width)
            if (score > bestScore) {
                val padX = max(3, (boxWidth * 0.10f).toInt())
                val padY = max(3, (boxHeight * 0.22f).toInt())
                best = Rect(
                    (minX - padX).coerceAtLeast(0),
                    (minY - padY).coerceAtLeast(0),
                    (maxX + padX + 1).coerceAtMost(width),
                    (maxY + padY + 1).coerceAtMost(height)
                )
                bestScore = score
            }
        }
        return best
    }
}
