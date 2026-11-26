import test from "node:test";
import assert from "node:assert/strict";
import { SYMBOLS, DEFAULT_SYMBOL, resolveSymbol, HISTORY_CANDLES, MIN_CLOSED_CANDLES, MAX_CANDLES, LIVE_PRICE_CHECK_SECONDS, REST_SYNC_SECONDS } from "../src/config.js";

test("65 experiment exposes EUR/USD only", () => {
  assert.deepEqual(SYMBOLS, ["EUR/USD"]);
  assert.equal(DEFAULT_SYMBOL, "EUR/USD");
});

test("pair selection normalizes case and slash formatting but rejects unknown pairs", () => {
  assert.equal(resolveSymbol("eur/usd"), "EUR/USD");
  assert.equal(resolveSymbol(" EUR/USD "), "EUR/USD");
  assert.equal(resolveSymbol("USD/JPY"), null);
});

test("100 candles are retained while the scoring window and API cadence remain bounded", () => {
  assert.equal(HISTORY_CANDLES, 100);
  assert.equal(MIN_CLOSED_CANDLES, 54);
  assert.equal(MAX_CANDLES, 110);
  assert.equal(LIVE_PRICE_CHECK_SECONDS, 5);
  assert.equal(REST_SYNC_SECONDS, 180);
});
