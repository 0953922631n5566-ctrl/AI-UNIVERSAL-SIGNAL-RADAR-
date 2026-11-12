import test from "node:test";
import assert from "node:assert/strict";
import { calculateKamaDmiAdx, directionalConfirmation } from "./kama-dmi-adx.js";

function candlesFromCloses(closes) {
  return closes.map((close, index) => {
    const open = index ? closes[index - 1] : close - 0.0002;
    return { open, close, high: Math.max(open, close) + 0.00015, low: Math.min(open, close) - 0.00015, epoch: index * 60 };
  });
}

test("KAMA/DMI/ADX returns finite indicators for a directional M1 series", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 1.08 + i * 0.00025 + Math.sin(i / 3) * 0.00008);
  const result = calculateKamaDmiAdx(candlesFromCloses(closes));
  assert.equal(result.ready, true);
  for (const key of ["kama", "previousKama", "plusDI", "minusDI", "adx", "adxStrength"]) {
    assert.ok(Number.isFinite(result[key]), key);
  }
  assert.ok(result.adx >= 0 && result.adx <= 100);
  assert.ok(result.plusDI >= 0 && result.minusDI >= 0);
});

test("ADX scales DMI confirmation but does not select the direction", () => {
  const weak = { ready: true, callKamaAligned: true, putKamaAligned: false, callDmiAligned: true, putDmiAligned: false, adxStrength: 0 };
  const strong = { ...weak, adxStrength: 1 };
  assert.ok(directionalConfirmation(strong, "CALL").total > directionalConfirmation(weak, "CALL").total);
  assert.equal(directionalConfirmation(strong, "PUT").dmi, 0);
});

test("invalid or insufficient candle input fails closed", () => {
  assert.equal(calculateKamaDmiAdx([]).ready, false);
  assert.equal(calculateKamaDmiAdx([{ high: 1, low: 1, close: 1 }]).ready, false);
});
