import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("REST provides historical context but cannot authorize a signal without fresh live Streaming", () => {
  assert.match(server, /const freshTick = Number\.isFinite\(tickAgeMs\)/);
  assert.match(server, /const sourceReady = closed\.length >= MIN_CLOSED_CANDLES && freshTick/);
  assert.match(server, /current\?\.live === true && remainingMs > 0/);
  assert.match(server, /streamingRequiredForSignals: true/);
  assert.match(server, /restFallbackEnabled: false/);
});
