import unittest

from vision_ocr import parse_price_candidates


class PriceParserTests(unittest.TestCase):
    def test_dot_decimal(self):
        self.assertEqual(parse_price_candidates("1.12345"), ("1.12345",))

    def test_comma_decimal_normalized(self):
        self.assertEqual(parse_price_candidates("1,123456"), ("1.123456",))

    def test_rejects_short_and_long_fraction(self):
        self.assertEqual(parse_price_candidates("1.12 1.1234567"), ())

    def test_ambiguous_multiple_prices_are_preserved(self):
        self.assertEqual(
            parse_price_candidates("1.12345 / 1.12346"),
            ("1.12345", "1.12346"),
        )

    def test_common_ocr_glyph_confusions(self):
        self.assertEqual(parse_price_candidates("I.12O45"), ("1.12045",))


if __name__ == "__main__":
    unittest.main()
