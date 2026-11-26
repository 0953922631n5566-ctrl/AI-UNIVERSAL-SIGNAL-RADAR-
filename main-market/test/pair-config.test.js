import test from "node:test";
import assert from "node:assert/strict";
import { SYMBOLS, DEFAULT_SYMBOL, resolveSymbol, HISTORY_CANDLES, MIN_CLOSED_CANDLES, MAX_CANDLES, LIVE_PRICE_CHECK_SECONDS } from "../src/config.js";
test("Main Market exposes the four selected major forex pairs",()=>{
 assert.deepEqual(SYMBOLS,["EUR/USD","EUR/JPY","GBP/USD","USD/JPY"]);
 assert.equal(DEFAULT_SYMBOL,"EUR/USD");
});
test("pair selection normalizes case and slash formatting but rejects unknown pairs",()=>{
 assert.equal(resolveSymbol("eur/usd"),"EUR/USD");
 assert.equal(resolveSymbol(" EUR/JPY "),"EUR/JPY");
 assert.equal(resolveSymbol("USD/JPY"),"USD/JPY");
 assert.equal(resolveSymbol("AUD/USD"),null);
});
test("100 candle history is retained for EMA5 and sampling is not a continuous REST poll",()=>{
 assert.equal(HISTORY_CANDLES,100);
 assert.equal(MIN_CLOSED_CANDLES,20);
 assert.equal(MAX_CANDLES,110);
 assert.equal(LIVE_PRICE_CHECK_SECONDS,5);
});
