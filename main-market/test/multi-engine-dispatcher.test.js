import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engines = require("../original-ai/engine/multi-engine-dispatcher.js");

function sidewayFixture() {
  const start = Math.floor(Date.now() / 60000) * 60 - 200 * 60;
  const candles = Array.from({ length: 200 }, (_, n) => {
    const open = 1.10000 + Math.sin(n * 0.8) * 0.000015;
    const close = open + (n % 2 ? 0.000006 : -0.000006);
    return { epoch: start + n * 60, open, close,
      high: Math.max(open, close) + 0.00005,
      low: Math.min(open, close) - 0.00005, live: false };
  });
  candles[198] = { ...candles[198], open: 1.10005, close: 1.09995, high: 1.10008, low: 1.09992 };
  candles[199] = { ...candles[199], open: 1.09990, close: 1.10010, high: 1.10012, low: 1.09985 };
  return { candles, regime: "SIDEWAY", indicators: {
    adx: 13, plusDI: 20, minusDI: 15, macdHistogram: 0.000001, rsi: 40,
    volatilityRatio: 1, nearSupport: true, nearResistance: false,
    ema9: 1.1000, ema21: 1.1000, ema50: 1.1000
  }, tickAgeSeconds: 2, allowRestFallback: false, ageSeconds: 1, now: Date.now() };
}

test("all ten engines return the strict common result contract", async () => {
  const out = await engines.evaluateAllEngines(sidewayFixture());
  assert.equal(out.engineResults.length, 10);
  for (const item of out.engineResults) {
    assert.equal(typeof item.direction, "string");
    assert.ok(["CALL", "PUT", "NO_SIGNAL"].includes(item.direction));
    assert.equal(typeof item.score, "number");
    assert.equal(typeof item.confidence, "number");
    assert.equal(typeof item.reason, "string");
    assert.equal(typeof item.validity, "boolean");
  }
  assert.equal(out.engineSummary.total, 10);
  assert.equal(out.engineSummary.failed, 0);
});

test("Range-Bound Swing can produce a guarded SIDEWAY CALL with independent pattern support", async () => {
  const out = await engines.evaluateAllEngines(sidewayFixture());
  const range = out.engineResults.find(x => x.engine === "range_bound_swing");
  const candle = out.engineResults.find(x => x.engine === "candlestick_pattern");
  assert.equal(range.direction, "CALL");
  assert.equal(candle.direction, "CALL");
  assert.equal(out.signal, "CALL", JSON.stringify(out.engineResults));
  assert.equal(out.strategy, "RANGE_BOUND_SWING");
});

test("Safety Noise Guard tolerates an older isolated M1 gap but vetoes a gap in the latest three candles", () => {
  const historicalGap = sidewayFixture();
  historicalGap.candles[150].epoch += 60;
  for (let n = 151; n < historicalGap.candles.length; n++) historicalGap.candles[n].epoch += 60;
  const tolerated = engines.runSafetyNoiseGuard(historicalGap);
  assert.equal(tolerated.validity, true, tolerated.reason);

  const recentGap = sidewayFixture();
  recentGap.candles[199].epoch += 60;
  const blocked = engines.runSafetyNoiseGuard(recentGap);
  assert.equal(blocked.validity, false);
  assert.match(blocked.reason, /^VETO: missing M1 candle gap/);
});

test("Safety Noise Guard has VETO authority when live data is stale", async () => {
  const market = sidewayFixture();
  market.tickAgeSeconds = 40;
  market.allowRestFallback = false;
  const out = await engines.evaluateAllEngines(market);
  const safety = out.engineResults.find(x => x.engine === "safety_noise_guard");
  assert.equal(safety.validity, false);
  assert.match(safety.reason, /^VETO:/);
  assert.equal(out.signal, "STANDBY");
  assert.equal(out.engineSummary.safetyVeto, true);
});

test("Volume engine refuses to invent missing FX volume", () => {
  const out = engines.runVolumeOrderFlowEngine(sidewayFixture());
  assert.equal(out.direction, "NO_SIGNAL");
  assert.equal(out.validity, false);
  assert.match(out.reason, /no synthetic volume/i);
});

test("Central dispatcher holds when the Safety Noise Guard result is absent", () => {
  const out = engines.centralDispatcher([
    { engine: "trend_breakout", direction: "CALL", score: 90, confidence: 90, reason: "breakout", validity: true }
  ], "UPTREND");
  assert.equal(out.signal, "STANDBY");
  assert.match(out.reason, /VETO:/);
});

test("Promise.allSettled isolates one failed engine and preserves successful results", async () => {
  const engineList = [
    Object.assign(() => ({ engine: "healthy_a", direction: "NO_SIGNAL", score: 0, confidence: 0, reason: "none", validity: true }), { engineName: "healthy_a" }),
    Object.assign(() => { throw new Error("simulated strategy failure"); }, { engineName: "broken_engine" }),
    Object.assign(() => ({ engine: "healthy_b", direction: "NO_SIGNAL", score: 0, confidence: 0, reason: "none", validity: true }), { engineName: "healthy_b" })
  ];
  const batch = await engines.evaluateEngineBatch(sidewayFixture(), engineList);
  assert.equal(batch.results.length, 3);
  assert.equal(batch.fulfilled, 2);
  assert.equal(batch.failed, 1);
  assert.equal(batch.results[1].direction, "NO_SIGNAL");
  assert.equal(batch.results[1].validity, false);
  assert.match(batch.results[1].reason, /simulated strategy failure/);
});
