import test from "node:test";
import assert from "node:assert/strict";
import { SYMBOLS, DEFAULT_SYMBOL, resolveSymbol, HISTORY_CANDLES, MIN_CLOSED_CANDLES, MAX_CANDLES, LIVE_PRICE_CHECK_SECONDS, REST_SYNC_SECONDS, ADAPTIVE_EMA_WARMUP_CANDLES } from "../src/config.js";

test("Main Market is locked to EUR/USD only", () => {
  assert.deepEqual(SYMBOLS, ["EUR/USD"]);
  assert.equal(DEFAULT_SYMBOL, "EUR/USD");
});

test("pair normalization accepts EUR/USD only and rejects all other pairs", () => {
  assert.equal(resolveSymbol(" eur/usd "), "EUR/USD");
  assert.equal(resolveSymbol("EURUSD"), "EUR/USD");
  assert.equal(resolveSymbol("GBP/JPY"), null);
  assert.equal(resolveSymbol("USD/JPY"), null);
});

test("100 candles are retained for Adaptive EMA warm-up while timing/API cadence remain bounded", () => {
  assert.equal(HISTORY_CANDLES, 100);
  assert.equal(ADAPTIVE_EMA_WARMUP_CANDLES, 100);
  assert.equal(MIN_CLOSED_CANDLES, 54);
  assert.equal(MAX_CANDLES, 110);
  assert.equal(LIVE_PRICE_CHECK_SECONDS, 5);
  assert.equal(REST_SYNC_SECONDS, 180);
});
