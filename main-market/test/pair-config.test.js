import test from "node:test";
import assert from "node:assert/strict";
import { SYMBOLS, DEFAULT_SYMBOL, resolveSymbol, HISTORY_CANDLES, MIN_CLOSED_CANDLES, MAX_CANDLES, LIVE_PRICE_CHECK_SECONDS } from "../src/config.js";
test("Main Market is locked to EUR/USD only",()=>{assert.deepEqual(SYMBOLS,["EUR/USD"]);assert.equal(DEFAULT_SYMBOL,"EUR/USD");});
test("pair resolver normalizes EUR/USD and rejects all other pairs",()=>{assert.equal(resolveSymbol("eur/usd"),"EUR/USD");assert.equal(resolveSymbol(" EUR/USD "),"EUR/USD");for(const pair of ["EUR/JPY","USD/JPY","GBP/USD","AUD/USD"])assert.equal(resolveSymbol(pair),null);});
test("M1 history is sufficient and streaming watchdog is local",()=>{assert.equal(HISTORY_CANDLES,100);assert.equal(MIN_CLOSED_CANDLES,20);assert.equal(MAX_CANDLES,110);assert.equal(LIVE_PRICE_CHECK_SECONDS,5);});
