import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ANALYZER_CONTROL, normalizeAnalyzerControl, getAnalyzerTuning } from "../src/analyzer-control.js";

test("default analyzer control preserves the original four analyzer thresholds", () => {
  const tuning = getAnalyzerTuning(DEFAULT_ANALYZER_CONTROL);
  assert.equal(tuning.mode, "ORIGINAL");
  assert.equal(tuning.v1SignalThreshold, 55);
  assert.equal(tuning.v1PrepareThreshold, 40);
  assert.equal(tuning.bbWickThreshold, 0.18);
  assert.equal(tuning.trendSignalThreshold, 65);
  assert.equal(tuning.engine4SignalThreshold, 40);
});

test("custom analyzer score is clamped to the supported 5..100 range", () => {
  assert.deepEqual(normalizeAnalyzerControl({ mode: "CUSTOM", minScore: 5 }), { mode: "CUSTOM", minScore: 5 });
  assert.deepEqual(normalizeAnalyzerControl({ mode: "CUSTOM", minScore: 100 }), { mode: "CUSTOM", minScore: 100 });
  assert.deepEqual(normalizeAnalyzerControl({ mode: "CUSTOM", minScore: 4 }), { mode: "CUSTOM", minScore: 25 });
  assert.deepEqual(normalizeAnalyzerControl({ mode: "CUSTOM", minScore: 101 }), { mode: "CUSTOM", minScore: 25 });
});

test("lower custom score relaxes all four analyzers and higher score tightens them", () => {
  const relaxed = getAnalyzerTuning({ mode: "CUSTOM", minScore: 5 });
  const strict = getAnalyzerTuning({ mode: "CUSTOM", minScore: 100 });
  for (const key of ["v1SignalThreshold", "trendSignalThreshold", "engine4SignalThreshold"]) {
    assert.ok(relaxed[key] < strict[key], key);
  }
  assert.ok(relaxed.bbWickThreshold < strict.bbWickThreshold);
  assert.ok(relaxed.trendDirectionalMargin < strict.trendDirectionalMargin);
  assert.ok(relaxed.engine4MinPullbackAtr < strict.engine4MinPullbackAtr);
  assert.ok(relaxed.engine4CloseLocation < strict.engine4CloseLocation);
});
