package com.otcvision.radar.capture

import android.content.Context
import android.os.Environment
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Local-only 100-frame OCR run recorder. Exact-match accuracy is intentionally unknown without labels. */
class OcrBenchmarkRecorder(context: Context) {
    companion object { const val TARGET_SAMPLES = 100 }

    data class Sample(
        val status: String,
        val price: String?,
        val ocrMs: Long,
        val frameMs: Long,
        val heapKb: Long,
        val thermalStatus: Int,
        val batteryTempC: Float?
    )

    data class Summary(
        val samples: Int,
        val extracted: Int,
        val extractionRate: Float,
        val meanOcrMs: Long,
        val maxOcrMs: Long,
        val peakHeapKb: Long,
        val maxThermalStatus: Int,
        val maxBatteryTempC: Float?,
        val csvFile: File
    )

    private val output = File(context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: context.filesDir, "benchmark")
    private val startedAt = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
    private val csvFile = File(output, "ocr-100-$startedAt.csv")
    private val samples = mutableListOf<Sample>()
    private var completed: Summary? = null

    @Synchronized fun reset() {
        output.mkdirs()
        samples.clear()
        completed = null
        csvFile.writeText("index,status,price,ocr_ms,frame_ms,heap_kb,thermal_status,battery_temp_c,exact_match\n")
    }

    @Synchronized fun record(sample: Sample): Summary? {
        if (completed != null || samples.size >= TARGET_SAMPLES) return completed
        samples += sample
        csvFile.appendText(
            listOf(
                samples.size, sample.status, sample.price.orEmpty(), sample.ocrMs,
                sample.frameMs, sample.heapKb, sample.thermalStatus,
                sample.batteryTempC?.toString().orEmpty(), ""
            ).joinToString(",") + "\n"
        )
        if (samples.size < TARGET_SAMPLES) return null
        val successful = samples.count { it.price != null }
        val latencies = samples.mapNotNull { it.ocrMs.takeIf { value -> value >= 0 } }.sorted()
        val summary = Summary(
            samples = samples.size,
            extracted = successful,
            extractionRate = successful * 100f / samples.size,
            meanOcrMs = if (latencies.isEmpty()) -1 else latencies.average().toLong(),
            maxOcrMs = latencies.maxOrNull() ?: -1,
            peakHeapKb = samples.maxOfOrNull { it.heapKb } ?: -1,
            maxThermalStatus = samples.maxOfOrNull { it.thermalStatus } ?: -1,
            maxBatteryTempC = samples.mapNotNull { it.batteryTempC }.maxOrNull(),
            csvFile = csvFile
        )
        completed = summary
        return summary
    }

    @Synchronized fun currentCount(): Int = samples.size
}
