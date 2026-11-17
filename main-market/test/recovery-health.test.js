import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("health metadata reports unlimited independent next-M1 recovery until win", () => {
  assert.match(server, /mode: "INDEPENDENT_NEXT_M1_UNTIL_WIN"/);
  assert.match(server, /minimumSignalScore: 60, maxAttemptsPerLoss: null, maxWaitCandles: null/);
  assert.match(server, /waitsWhenNoCandidate: true, resetsToOriginalAnalyzerAfterWin: true/);
  assert.match(server, /martingale: false, altersMiniApp: true, badgeText: "กำลังแก้มือ"/);
  assert.match(server, /independentEngines: ENGINE_KEYS/);
});

test("public signal API exposes the per-engine recovery status used by Mini App", () => {
  assert.match(server, /recovery: state\.recovery \|\| null/);
  assert.match(server, /engines: Object\.fromEntries\(ENGINE_KEYS\.map/);
});

test("health metadata matches the shared Engine 4 alert implementation", () => {
  assert.match(server, /participatesInAggregate: true/);
  assert.match(server, /alertPipeline: "SHARED_ENGINE_ALERT_PIPELINE"/);
});
