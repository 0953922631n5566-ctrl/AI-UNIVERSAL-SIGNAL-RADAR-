import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEma5Score, calculateRsi14 } from "../src/ema5-two-phase-engine.js";

function history(direction) {
  return Array.from({ length: 24 }, (_, i) => {
    const close = direction === "up" ? 1.1000 + i * 0.0002 : 1.1048 - i * 0.0002;
    return {
      epoch: i * 60, live: false,
      open: close - (direction === "up" ? 0.00005 : -0.00005),
      high: close + 0.00005, low: close - 0.00005, close
    };
  });
}
test("EMA5 and bullish RSI14 alignment reaches 80 points and emits CALL", () => {
  const closedCandles = history("up"), last = closedCandles.at(-1).close;
  const result = analyzeEma5Score({symbol:"EUR/USD",closedCandles,
    liveCandle:{epoch:1440,live:true,open:last+0.00002,close:last+0.00010,high:last+0.00013,low:last+0.00008},
    tickAgeSeconds:1});
  assert.equal(result.signal,"CALL");assert.equal(result.callScore,80);assert.equal(result.threshold,80);
  assert.ok(result.rsi14>50);assert.equal(result.scoreParts.rsi14Direction,20);
});
test("EMA5 and bearish RSI14 alignment reaches 80 points and emits PUT", () => {
  const closedCandles = history("down"), last = closedCandles.at(-1).close;
  const result = analyzeEma5Score({symbol:"EUR/USD",closedCandles,
    liveCandle:{epoch:1440,live:true,open:last-0.00002,close:last-0.00010,high:last-0.00008,low:last-0.00013},
    tickAgeSeconds:1});
  assert.equal(result.signal,"PUT");assert.equal(result.putScore,80);assert.equal(result.threshold,80);
  assert.ok(result.rsi14<50);assert.equal(result.scoreParts.rsi14Direction,20);
});
test("EMA5 score below 80 remains WAIT", () => {
  const closedCandles=history("up"),last=closedCandles.at(-1).close;
  const result=analyzeEma5Score({symbol:"EUR/USD",closedCandles,
    liveCandle:{epoch:1440,live:true,open:last+0.00012,close:last+0.00005,high:last+0.00014,low:last+0.00002},
    tickAgeSeconds:1});
  assert.equal(result.signal,"WAIT");assert.ok(result.callScore<80);
});
test("RSI14 is calculated with Wilder smoothing and returns null for insufficient data",()=>{
  assert.equal(calculateRsi14([1,2,3]),null);
  const up=calculateRsi14(Array.from({length:20},(_,i)=>1+i*0.001));
  const down=calculateRsi14(Array.from({length:20},(_,i)=>1.02-i*0.001));
  assert.equal(up.current,100);assert.equal(down.current,0);
});
test("stale live tick cannot emit an EMA5 RSI14 signal", () => {
  const closedCandles=history("up"),last=closedCandles.at(-1).close;
  const result=analyzeEma5Score({symbol:"EUR/USD",closedCandles,
    liveCandle:{epoch:1440,live:true,open:last,close:last+0.0001,high:last+0.00012,low:last-0.00002},
    tickAgeSeconds:6});
  assert.equal(result.signal,"WAIT");
});
