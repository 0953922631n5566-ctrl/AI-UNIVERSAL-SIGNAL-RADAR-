package com.otcvision.radar.capture

import android.graphics.Bitmap
import android.os.Looper
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

data class FrameUploadResult(
    val signal: String, val status: String, val reason: String,
    val price: String?, val sequence: Int
)

/**
 * One-shot full-screen JPEG uploader.
 *
 * This method is deliberately synchronous so its caller can own the Bitmap
 * lifetime. It MUST only be invoked from Dispatchers.IO: both JPEG encoding
 * and every HttpURLConnection operation are blocking work.
 */
object FrameUploader {
    private const val MAX_JPEG_BYTES = 4 * 1024 * 1024
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 20_000

    fun upload(config: SecureServerConfig.Config, sessionId: String, sequence: Int,
        capturedAtMs: Long, bitmap: Bitmap): FrameUploadResult {
        check(Looper.myLooper() != Looper.getMainLooper()) {
            "FrameUploader.upload must never run on the Android main thread"
        }
        require(!bitmap.isRecycled && bitmap.width > 0 && bitmap.height > 0) {
            "Captured screen bitmap is invalid"
        }

        // Compression is CPU/memory intensive; caller guarantees Dispatchers.IO.
        val jpeg = encodeBoundedJpeg(bitmap)
        var connection: HttpURLConnection? = null
        try {
            val boundary = "OtcVision" + System.nanoTime()
            val endpoint = config.baseUrl.trimEnd('/') + "/v1/frame"
            val activeConnection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                doOutput = true
                useCaches = false
                setRequestProperty("Authorization", "Bearer ${config.token}")
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                setRequestProperty("Accept", "application/json")
                setChunkedStreamingMode(64 * 1024)
            }
            connection = activeConnection
            activeConnection.outputStream.use { output ->
                fun field(name: String, value: String) {
                    output.write("--$boundary\r\n".toByteArray())
                    output.write("Content-Disposition: form-data; name=\"$name\"\r\n\r\n".toByteArray())
                    output.write(value.toByteArray(Charsets.UTF_8))
                    output.write("\r\n".toByteArray())
                }
                field("session_id", sessionId)
                field("sequence", sequence.toString())
                field("captured_at_ms", capturedAtMs.toString())
                field("width", bitmap.width.toString())
                field("height", bitmap.height.toString())
                output.write("--$boundary\r\n".toByteArray())
                output.write("Content-Disposition: form-data; name=\"image\"; filename=\"screen.jpg\"\r\n".toByteArray())
                output.write("Content-Type: image/jpeg\r\n\r\n".toByteArray())
                output.write(jpeg)
                output.write("\r\n--$boundary--\r\n".toByteArray())
                output.flush()
            }
            val code = activeConnection.responseCode
            val stream = if (code in 200..299) activeConnection.inputStream else activeConnection.errorStream
            val responseText = stream?.use { input ->
                BufferedReader(InputStreamReader(input, Charsets.UTF_8)).readText()
            }.orEmpty()
            if (code !in 200..299) throw IllegalStateException(
                "Server HTTP $code: " + responseText.take(240))
            val json = JSONObject(responseText)
            return FrameUploadResult(
                signal = json.optString("signal", "STANDBY").uppercase(),
                status = json.optString("status", "UNKNOWN"),
                reason = json.optString("reason", "No server reason supplied"),
                price = json.optString("price").takeIf { it.isNotBlank() && it != "null" },
                sequence = json.optInt("sequence", sequence))
        } finally {
            connection?.disconnect()
            // Best-effort clearing of the temporary encoded image bytes.
            jpeg.fill(0)
        }
    }

    private fun encodeBoundedJpeg(bitmap: Bitmap): ByteArray {
        var quality = 82
        while (quality >= 52) {
            val output = ByteArrayOutputStream()
            check(bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                "Could not encode captured screen as JPEG"
            }
            val bytes = output.toByteArray()
            if (bytes.size <= MAX_JPEG_BYTES) return bytes
            bytes.fill(0)
            quality -= 10
        }
        throw IllegalStateException("Full-screen JPEG exceeds 4 MB upload limit")
    }
}
