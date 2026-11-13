import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCandleColorMomentum,
  applyCandleConfirmation
} from "../src/advanced-scoring.js";

function candles(colors) {
  return colors.map((color, i) => {
    const open = 1 + i;
    const close = color === "GREEN" ? open + 0.6 : color === "RED" ? open - 0.6 : open + 0.001;
    return {
      open, close,
      high: Math.max(open, close) + 0.05,
      low: Math.min(open, close) - 0.05
    };
  });
}

test("Candle confirmation recognizes bullish color and close momentum", () => {
  const result = analyzeCandleColorMomentum(candles(["GREEN", "RED", "GREEN"]), "CALL");
  assert.equal(result.confirmed, true);
  assert.deepEqual(result.colors, ["GREEN", "RED", "GREEN"]);
});

test("Candle confirmation recognizes bearish color and close momentum symmetrically", () => {
  const result = analyzeCandleColorMomentum(candles(["RED", "GREEN", "RED"]), "PUT");
  assert.equal(result.confirmed, true);
  assert.deepEqual(result.colors, ["RED", "GREEN", "RED"]);
});

test("Three opposing candles do not confirm a CALL", () => {
  const result = analyzeCandleColorMomentum(candles(["RED", "RED", "RED"]), "CALL");
  assert.equal(result.confirmed, false);
  assert.equal(result.opposingCount, 3);
});

test("A failed candle confirmation downgrades only a final directional signal to PREPARE", () => {
  const base = {
    signal: "CALL", status: "SIGNAL", direction: "CALL", score: 72,
    scores: { CALL: 72, PUT: 30 }, riskFlags: [], evidence: [],
    thresholds: { signal: 70, prepare: 45, standbyBelow: 45 }
  };
  const result = applyCandleConfirmation(base, candles(["RED", "RED", "RED"]));
  assert.equal(result.signal, "PREPARE");
  assert.equal(result.prepareSignal, "CALL");
  assert.equal(result.score, 72);
  assert.deepEqual(result.scores, base.scores);
  assert.ok(result.riskFlags.includes("CANDLE_CONFIRMATION_PENDING"));
});

test("Candle confirmation does not change PREPARE or STANDBY decisions", () => {
  const prepare = { signal: "PREPARE", direction: "CALL", score: 55, evidence: [], riskFlags: [] };
  const standby = { signal: "STANDBY", direction: null, score: 20 };
  assert.equal(applyCandleConfirmation(prepare, candles(["RED", "RED", "RED"])).signal, "PREPARE");
  assert.equal(applyCandleConfirmation(standby, candles(["RED", "RED", "RED"])).signal, "STANDBY");
});

test("Very small bodies are classified as Doji and do not confirm direction alone", () => {
  const result = analyzeCandleColorMomentum(candles(["DOJI", "DOJI", "DOJI"]), "CALL");
  assert.deepEqual(result.colors, ["DOJI", "DOJI", "DOJI"]);
  assert.equal(result.dojiCount, 3);
  assert.equal(result.confirmed, false);
});

test("Experimental entry threshold is 70 for both CALL and PUT", async () => {
  const { scoreMarket } = await import("../src/advanced-scoring.js");
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/advanced-scoring.js", import.meta.url), "utf8"));
  assert.match(source, /if\(top>=70\)\{signal=direction;status="SIGNAL";\}/);
  assert.match(source, /thresholds:\{signal:70,prepare:45,standbyBelow:45\}/);
});
