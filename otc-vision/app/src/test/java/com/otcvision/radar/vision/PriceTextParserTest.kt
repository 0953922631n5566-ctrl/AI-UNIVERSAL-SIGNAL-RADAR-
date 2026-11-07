package com.otcvision.radar.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PriceTextParserTest {
    @Test fun parsesSingleDecimalPrice() {
        val result = PriceTextParser.parse("EUR/USD 1.08452")
        assertEquals("1.08452", result.value)
        assertFalse(result.isAmbiguous)
    }

    @Test fun rejectsMultiplePriceCandidates() {
        val result = PriceTextParser.parse("1.08452 1.08461")
        assertEquals(null, result.value)
        assertTrue(result.isAmbiguous)
    }

    @Test fun returnsNoPriceForUnrelatedText() {
        val result = PriceTextParser.parse("BUY SELL OTC")
        assertEquals(null, result.value)
        assertTrue(result.candidates.isEmpty())
    }
}
