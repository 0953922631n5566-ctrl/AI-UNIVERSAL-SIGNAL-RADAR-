import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("health metadata confirms recovery is disabled and original analyzers remain independent", () => {
  assert.match(server, /enabled: false, mode: "DISABLED"/);
  assert.match(server, /strategy: "EACH_ENGINE_USES_ITS_OWN_ORIGINAL_ANALYZER"/);
  assert.match(server, /status: "ORIGINAL_INDEPENDENT_ANALYZERS"/);
  assert.match(server, /altersMiniApp: false, badgeText: null, martingale: false/);
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
