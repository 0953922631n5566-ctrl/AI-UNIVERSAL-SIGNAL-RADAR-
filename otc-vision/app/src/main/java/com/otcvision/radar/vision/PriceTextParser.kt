package com.otcvision.radar.vision

data class PriceParseResult(val value: String?, val candidates: List<String>, val isAmbiguous: Boolean)

object PriceTextParser {
    private val numericToken = Regex("""(?<![\d])(?:\d{1,5}[.,]\d{2,6})(?![\d])""")

    fun parse(text: String): PriceParseResult {
        val normalized = text.replace('O', '0').replace('o', '0')
            .replace('I', '1').replace('l', '1').replace(',', '.')
        val candidates = numericToken.findAll(normalized).map { it.value }.distinct().toList()
        return when (candidates.size) {
            1 -> PriceParseResult(candidates.first(), candidates, false)
            0 -> PriceParseResult(null, emptyList(), false)
            else -> PriceParseResult(null, candidates, true)
        }
    }
}
