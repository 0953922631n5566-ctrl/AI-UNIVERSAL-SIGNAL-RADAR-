package com.otcvision.radar.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PriceTextParserTest {
    @Test fun parsesFiveDecimalTradingPrice() {
        assertEquals("1.08452", PriceTextParser.parse("EUR/USD 1.08452").value)
    }

    @Test fun parsesSixDecimalTradingPrice() {
        assertEquals("1.135203", PriceTextParser.parse("1.135203").value)
    }

    @Test fun parsesRequestedSixDigitFraction() {
        assertEquals("1.135475", PriceTextParser.parse("EUR/USD 1.135475").value)
    }

    @Test fun acceptsCommaDecimalSeparator() {
        assertEquals("1.135475", PriceTextParser.parse("1,135475").value)
    }

    @Test fun rejectsShortChartDecimals() {
        val result = PriceTextParser.parse("RSI 45.23 · 1.0845")
        assertEquals(null, result.value)
        assertTrue(result.candidates.isEmpty())
    }

    @Test fun rejectsMultiplePriceCandidates() {
        val result = PriceTextParser.parse("1.08452 1.08461")
        assertEquals(null, result.value)
        assertTrue(result.isAmbiguous)
    }

    @Test fun rejectsMoreThanSixFractionDigits() {
        assertEquals(null, PriceTextParser.parse("1.1234567").value)
    }

    @Test fun returnsNoPriceForUnrelatedText() {
        val result = PriceTextParser.parse("BUY SELL OTC")
        assertEquals(null, result.value)
        assertFalse(result.isAmbiguous)
    }
}
