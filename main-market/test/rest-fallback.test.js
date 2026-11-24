import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
test("REST provides market history only and cannot create any signal", () => {
  assert.match(server, /const latestClosedCandle = feed\.candles\.filter/);
  assert.match(server, /price: freshTick \?\? restLastPrice/);
  assert.match(server, /signal: "STANDBY"/);
  assert.match(server, /status: "DISABLED"/);
  assert.match(server, /signalGeneration: false/);
  assert.match(server, /restFallbackEnabled: false/);
});
