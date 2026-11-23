import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("health metadata confirms recovery is disabled and only BB and Trend Rider remain active", () => {
  assert.match(server, /enabled: false, mode: "DISABLED"/);
  assert.match(server, /strategy: "EACH_ENGINE_USES_ITS_OWN_ORIGINAL_ANALYZER"/);
  assert.match(server, /status: "ORIGINAL_INDEPENDENT_ANALYZERS"/);
  assert.match(server, /altersMiniApp: false, badgeText: null, martingale: false/);
  assert.match(server, /independentEngines: \["BB", "TREND_RIDER"\]/);
  assert.match(server, /const engineEnabled = \{ V1: false, BB: true, TREND_RIDER: true, ENGINE_4: false \}/);
});

test("public signal API exposes the per-engine recovery status used by Mini App", () => {
  assert.match(server, /recovery: state\.recovery \|\| null/);
  assert.match(server, /engines: Object\.fromEntries\(ENGINE_KEYS\.map/);
});

test("health metadata explicitly marks Engine 4 disabled and out of the active signal path", () => {
  assert.match(server, /engine4: \{ enabled: false, role: "DISABLED_NOT_IN_ACTIVE_SIGNAL_PATH" \}/);
  assert.match(server, /signalDecisionPath: "BB_AND_TREND_RIDER_INDEPENDENT_SIGNALS_ONLY"/);
  assert.match(server, /keys: \["BB", "TREND_RIDER"\]/);
});
