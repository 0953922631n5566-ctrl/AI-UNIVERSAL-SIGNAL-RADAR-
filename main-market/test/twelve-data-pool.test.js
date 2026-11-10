import test from "node:test";
import assert from "node:assert/strict";
import { TwelveDataKeyPool } from "../src/twelve-data-pool.js";

test("key pool rotates after a failed key and does not expose key material", () => {
  const pool = new TwelveDataKeyPool(["key-one", "key-two", "key-three"]);
  assert.equal(pool.getActiveKey(), "key-one");
  pool.markFailure("key-one", { kind: "RATE_LIMIT", message: "quota exceeded" });
  assert.equal(pool.getActiveKey(), "key-two");
  const status = pool.publicStatus();
  assert.equal(status.configuredCount, 3);
  assert.equal(status.activeKeyNumber, 2);
  assert.equal(JSON.stringify(status).includes("key-two"), false);
});

test("successful key is promoted and its cooldown is cleared", () => {
  const pool = new TwelveDataKeyPool(["first", "second"]);
  pool.markFailure("first", { kind: "AUTH_OR_PERMISSION" });
  assert.equal(pool.getActiveKey(), "second");
  pool.markSuccess("first");
  assert.equal(pool.getActiveKey(), "first");
});

test("ten configured keys are represented individually and cooldown keys are unavailable", () => {
  const keys = Array.from({ length: 10 }, (_, index) => `secret-key-${index + 1}`);
  const pool = new TwelveDataKeyPool(keys);
  pool.markFailure(keys[2], { kind: "RATE_LIMIT", message: "quota exceeded" });
  const status = pool.publicStatus();
  assert.equal(status.configuredCount, 10);
  assert.equal(status.keyStates.length, 10);
  assert.equal(status.keyStates[0].available, true);
  assert.equal(status.keyStates[2].status, "COOLDOWN");
  assert.equal(status.keyStates[2].available, false);
  assert.equal(JSON.stringify(status).includes("secret-key"), false);
});

test("REST requests rotate fairly across healthy configured keys", () => {
  const pool = new TwelveDataKeyPool(["rest-one", "rest-two", "rest-three"]);
  assert.deepEqual(pool.getRestCandidates(), ["rest-one", "rest-two", "rest-three"]);
  pool.markRestSuccess("rest-one");
  assert.deepEqual(pool.getRestCandidates(), ["rest-two", "rest-three", "rest-one"]);
  pool.markRestSuccess("rest-two");
  assert.deepEqual(pool.getRestCandidates(), ["rest-three", "rest-one", "rest-two"]);
  assert.equal(pool.publicStatus().restRotation, "ROUND_ROBIN");
  assert.equal(pool.publicStatus().nextRestKeyNumber, 3);
  assert.equal(JSON.stringify(pool.publicStatus()).includes("rest-one"), false);
});
