import test from "node:test";
import assert from "node:assert/strict";
import { scoreMarket } from "../src/advanced-scoring.js";

function candlesFromCloses(closes, spread = 0.00002) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60;
  return closes.map((close, i) => {
    const previous = i ? closes[i - 1] : close;
    const open = previous;
    return {
      epoch: minuteStart - (closes.length - i) * 60,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      live: false
    };
  });
}

test("Accuracy V2 reports independent regime and entry-quality diagnostics", () => {
  const closes = Array.from({ length: 54 }, (_, i) =>
    1.1 + i * 0.00004 + Math.sin(i * 0.6) * 0.000015
  );
  const result = scoreMarket(candlesFromCloses(closes));
  assert.ok(Number.isFinite(result.metrics.efficiencyRatio10));
  assert.ok(Number.isFinite(result.metrics.adx14));
  assert.ok(Number.isFinite(result.metrics.entryExtensionAtr));
  assert.ok(Number.isFinite(result.metrics.entryCloseLocation));
  assert.ok(result.entryQuality.CALL && result.entryQuality.PUT);
  assert.equal(result.thresholds.signal, 65);
  assert.equal(result.thresholds.prepare, 45);
  assert.equal(result.strategy, "PARTIAL_SCORING_65_AGILE_ACCURACY_V2");
});

test("Accuracy V2 blocks compressed alternating M1 noise as SIDEWAY", () => {
  const closes = Array.from({ length: 54 }, (_, i) => 1.1 + (i % 2 ? 0.000002 : -0.000002));
  const result = scoreMarket(candlesFromCloses(closes, 0.000003));
  assert.equal(result.signal, "STANDBY");
  assert.ok(result.riskFlags.includes("CHOPPY_MARKET_KILL_SWITCH"));
  assert.equal(result.regime, "SIDEWAY");
});

test("Accuracy V2 rejects a late, overextended entry rather than chasing the candle", () => {
  const closes = Array.from({ length: 53 }, (_, i) => 1.1 + i * 0.00002);
  closes.push(closes.at(-1) + 0.0005);
  const result = scoreMarket(candlesFromCloses(closes, 0.00001));
  assert.equal(result.signal, "STANDBY");
  assert.ok(
    result.riskFlags.includes("OVEREXTENDED_ENTRY") ||
    result.riskFlags.includes("HIGH_ATR_SPIKE_KILL_SWITCH")
  );
});

test("Accuracy V2 keeps CALL and PUT scoring symmetric", () => {
  const bullish = Array.from({ length: 54 }, (_, i) =>
    1.1 + i * 0.000025 + Math.sin(i * 0.7) * 0.000008
  );
  const bearish = bullish.map(value => 2.2 - value);
  const call = scoreMarket(candlesFromCloses(bullish));
  const put = scoreMarket(candlesFromCloses(bearish));
  assert.ok(call.scores.CALL > call.scores.PUT);
  assert.ok(put.scores.PUT > put.scores.CALL);
});
