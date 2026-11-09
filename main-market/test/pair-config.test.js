import test from "node:test";
import assert from "node:assert/strict";
import { SYMBOLS, DEFAULT_SYMBOL, resolveSymbol } from "../src/config.js";

test("Main Market exposes exactly the six requested selectable pairs", () => {
  assert.deepEqual(SYMBOLS, [
    "AUD/USD", "EUR/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"
  ]);
  assert.equal(DEFAULT_SYMBOL, "EUR/USD");
});

test("pair selection normalizes case and slash formatting but rejects unknown pairs", () => {
  assert.equal(resolveSymbol("gbp/jpy"), "GBP/JPY");
  assert.equal(resolveSymbol(" EUR/GBP "), "EUR/GBP");
  assert.equal(resolveSymbol("USD/JPY"), null);
});
