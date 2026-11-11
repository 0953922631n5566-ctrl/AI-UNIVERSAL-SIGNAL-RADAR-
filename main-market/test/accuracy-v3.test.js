import test from "node:test";
import assert from "node:assert/strict";
import { scoreMarket } from "../src/advanced-scoring.js";

function makeCandles(closes, spread = 0.00001) {
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return {
      epoch: 1_800_000_000 + i * 60,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      live: false
    };
  });
}

test("Accuracy V3 exposes continuation scoring while retaining 65/45 thresholds", () => {
  const closes = Array.from({ length: 54 }, (_, i) =>
    1.1 + i * 0.00004 + Math.sin(i * 0.5) * 0.000008
  );
  const result = scoreMarket(makeCandles(closes));
  assert.equal(result.strategy, "PARTIAL_SCORING_65_AGILE_ACCURACY_V3");
  assert.equal(result.thresholds.signal, 65);
  assert.equal(result.thresholds.prepare, 45);
  assert.ok(Number.isFinite(result.metrics.trendContinuation));
  assert.equal(typeof result.metrics.pullbackResume, "boolean");
  assert.equal(typeof result.metrics.trendExhaustion, "boolean");
  assert.ok(Number.isFinite(result.componentScores.CALL.trendContinuation));
  assert.ok(Number.isFinite(result.componentScores.PUT.trendContinuation));
});

test("Accuracy V3 recognizes a pullback followed by renewed bullish continuation", () => {
  const closes = Array.from({ length: 54 }, (_, i) => 1.1 + i * 0.00003);
  closes[52] = closes[51] - 0.000025;
  closes[53] = closes[52] + 0.00005;
  const result = scoreMarket(makeCandles(closes));
  assert.equal(result.metrics.pullbackResume, true);
  assert.ok(result.componentScores.CALL.trendContinuation > 10);
});

test("Accuracy V3 continuation scoring is directionally symmetric for bearish trends", () => {
  const bullish = Array.from({ length: 54 }, (_, i) => 1.1 + i * 0.00003);
  const bearish = bullish.map(value => 2.2 - value);
  const up = scoreMarket(makeCandles(bullish));
  const down = scoreMarket(makeCandles(bearish));
  assert.ok(up.componentScores.CALL.trendContinuation > up.componentScores.PUT.trendContinuation);
  assert.ok(down.componentScores.PUT.trendContinuation > down.componentScores.CALL.trendContinuation);
});

test("Accuracy V3 flags an overextended, decelerating trend as exhaustion risk", () => {
  const closes = Array.from({ length: 54 }, (_, i) => {
    if (i < 50) return 1.1 + i * 0.000025;
    return 1.1 + 50 * 0.000025 + (i - 50) * 0.00009;
  });
  closes[53] += 0.00035;
  const result = scoreMarket(makeCandles(closes, 0.000008));
  assert.ok(
    result.riskFlags.includes("TREND_EXHAUSTION_GUARD") ||
    result.riskFlags.includes("OVEREXTENDED_ENTRY") ||
    result.riskFlags.includes("HIGH_ATR_SPIKE_KILL_SWITCH")
  );
});
