package com.otcvision.radar.vision

data class PriceParseResult(val value: String?, val candidates: List<String>, val isAmbiguous: Boolean)

object PriceTextParser {
    // Final strict whitelist after OCR: only numeric characters and a decimal point remain.
    private val allowedNumericRun = Regex("""[0-9.]+""")
    private val numericToken = Regex("""(?<![\d.])\d{1,3}\.\d{5,6}(?![\d.])""")

    /**
     * ML Kit Text Recognition does not expose a character-whitelist option.
     * Normalize common OCR confusions and strip everything except digits/dot before validation.
     */
    fun sanitizeOcrText(text: String): String {
        val normalized = text
            .replace(',', '.')
            .replace('O', '0').replace('o', '0')
            .replace('I', '1').replace('l', '1')
        val numericOnly = buildString(normalized.length) {
            for (char in normalized) append(if (char.isDigit() || char == '.') char else ' ')
        }
        return allowedNumericRun.findAll(numericOnly).joinToString(" ") { it.value }
    }

    fun parse(text: String): PriceParseResult {
        val sanitized = sanitizeOcrText(text)
        val candidates = numericToken.findAll(sanitized).map { it.value }.distinct().toList()
        return when (candidates.size) {
            1 -> PriceParseResult(candidates.first(), candidates, false)
            0 -> PriceParseResult(null, emptyList(), false)
            else -> PriceParseResult(null, candidates, true)
        }
    }
}
