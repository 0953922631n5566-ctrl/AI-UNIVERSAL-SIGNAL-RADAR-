package com.otcvision.radar.vision

data class PriceParseResult(val value: String?, val candidates: List<String>, val isAmbiguous: Boolean)

object PriceTextParser {
    // Accept 1–3 integer digits and 5–6 fractional digits, including 1.135475.
    private val numericToken = Regex("""(?<![\d.])\d{1,3}[.,]\d{5,6}(?![\d.])""")

    fun parse(text: String): PriceParseResult {
        val normalized = text.replace('O', '0').replace('o', '0')
            .replace('I', '1').replace('l', '1').replace(',', '.')
        val candidates = numericToken.findAll(normalized)
            .map { it.value.replace(',', '.') }.distinct().toList()
        return when (candidates.size) {
            1 -> PriceParseResult(candidates.first(), candidates, false)
            0 -> PriceParseResult(null, emptyList(), false)
            else -> PriceParseResult(null, candidates, true)
        }
    }
}
