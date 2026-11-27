import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEma5Score } from "../src/ema5-two-phase-engine.js";

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
test("EMA5 aligned bullish candle reaches 80 points and emits CALL", () => {
  const closedCandles = history("up");
  const last = closedCandles.at(-1).close;
  const result = analyzeEma5Score({
    symbol: "EUR/USD", closedCandles,
    liveCandle: { epoch: 1440, live: true, open: last + 0.00002, close: last + 0.00010, high: last + 0.00013, low: last + 0.00008 },
    tickAgeSeconds: 1
  });
  assert.equal(result.signal, "CALL");
  assert.equal(result.callScore, 80);
  assert.equal(result.threshold, 80);
});
test("EMA5 aligned bearish candle reaches 80 points and emits PUT", () => {
  const closedCandles = history("down");
  const last = closedCandles.at(-1).close;
  const result = analyzeEma5Score({
    symbol: "EUR/USD", closedCandles,
    liveCandle: { epoch: 1440, live: true, open: last - 0.00002, close: last - 0.00010, high: last - 0.00008, low: last - 0.00013 },
    tickAgeSeconds: 1
  });
  assert.equal(result.signal, "PUT");
  assert.equal(result.putScore, 80);
});
test("EMA5 score below 80 remains WAIT", () => {
  const closedCandles = history("up");
  const last = closedCandles.at(-1).close;
  const result = analyzeEma5Score({
    symbol: "EUR/USD", closedCandles,
    liveCandle: { epoch: 1440, live: true, open: last + 0.00012, close: last + 0.00005, high: last + 0.00014, low: last + 0.00002 },
    tickAgeSeconds: 1
  });
  assert.equal(result.signal, "WAIT");
  assert.ok(result.callScore < 80);
});
test("stale live tick cannot emit an EMA5 signal", () => {
  const closedCandles = history("up");
  const last = closedCandles.at(-1).close;
  const result = analyzeEma5Score({
    symbol: "EUR/USD", closedCandles,
    liveCandle: { epoch: 1440, live: true, open: last, close: last + 0.0001, high: last + 0.00012, low: last - 0.00002 },
    tickAgeSeconds: 6
  });
  assert.equal(result.signal, "WAIT");
});
