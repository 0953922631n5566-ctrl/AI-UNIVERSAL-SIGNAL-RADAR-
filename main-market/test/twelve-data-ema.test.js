import test from "node:test";
import assert from "node:assert/strict";
import { fetchEma5 } from "../src/twelve-data.js";
import { TwelveDataKeyPool } from "../src/twelve-data-pool.js";

const now = Date.parse("2026-11-23T12:02:30Z");
const response = {
  status: "ok",
  meta: { symbol: "EUR/USD", interval: "1min", indicator: { name: "EMA", time_period: 5, series_type: "close" } },
  values: [
    { datetime: "2026-11-23 12:02:00", ema: "1.10030" },
    { datetime: "2026-11-23 12:01:00", ema: "1.10020" },
    { datetime: "2026-11-23 12:00:00", ema: "1.10010" },
    { datetime: "2026-11-23 11:59:00", ema: "1.10000" }
  ]
};

test("fetchEma5 calls Twelve Data /ema with period 5 and returns two closed M1 values", async () => {
  let requestUrl, authHeader, rotated = null;
  const keyPool = {
    getRestCandidates: () => ["test-key"],
    markRestSuccess: key => { rotated = key; },
    markFailure: () => assert.fail("unexpected key failure")
  };
  const result = await fetchEma5({
    keyPool, symbol: "EUR/USD", now,
    fetchImpl: async (url, options) => {
      requestUrl = new URL(url); authHeader = options.headers.Authorization;
      return { ok: true, status: 200, json: async () => response };
    }
  });
  assert.equal(requestUrl.pathname, "/ema");
  assert.equal(requestUrl.searchParams.get("time_period"), "5");
  assert.equal(requestUrl.searchParams.get("series_type"), "close");
  assert.equal(requestUrl.searchParams.get("interval"), "1min");
  assert.equal(requestUrl.searchParams.get("outputsize"), "4");
  assert.equal(authHeader, "apikey test-key");
  assert.equal(rotated, "test-key");
  assert.equal(result.values.length, 2);
  assert.deepEqual(result.values.map(x => x.epoch), [
    Date.parse("2026-11-23T12:00:00Z") / 1000,
    Date.parse("2026-11-23T12:01:00Z") / 1000
  ]);
  assert.deepEqual(result.values.map(x => x.ema), [1.1001, 1.1002]);
  assert.equal(result.period, 5);
  assert.equal(result.source, "Twelve Data /ema");
});

test("fetchEma5 rejects insufficient completed EMA values", async () => {
  const keyPool = { getRestCandidates: () => ["test-key"], markRestSuccess: () => {}, markFailure: () => {} };
  await assert.rejects(() => fetchEma5({
    keyPool, symbol: "EUR/USD", now,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({
      status: "ok", values: [{ datetime: "2026-11-23 12:01:00", ema: "1.1" }]
    }) })
  }), /two consecutive completed M1 values/);
});

test("fetchEma5 rotates across a ten-key pool after quota exhaustion and continues round-robin", async () => {
  const keys = Array.from({ length: 10 }, (_, index) => `ema-key-${index + 1}`);
  const keyPool = new TwelveDataKeyPool(keys);
  const attempted = [];
  const fetchImpl = async (_url, options) => {
    const key = options.headers.Authorization.replace("apikey ", "");
    attempted.push(key);
    if (key === "ema-key-1") {
      return { ok: false, status: 429, json: async () => ({ status: "error", message: "rate limit exceeded" }) };
    }
    return { ok: true, status: 200, json: async () => response };
  };
  await fetchEma5({ keyPool, symbol: "EUR/USD", now, fetchImpl });
  assert.deepEqual(attempted, ["ema-key-1", "ema-key-2"]);
  assert.equal(keyPool.publicStatus().configuredCount, 10);
  assert.equal(keyPool.publicStatus().keyStates[0].status, "COOLDOWN");
  assert.equal(keyPool.publicStatus().nextRestKeyNumber, 3);

  attempted.length = 0;
  await fetchEma5({ keyPool, symbol: "EUR/USD", now: now + 60000, fetchImpl });
  assert.deepEqual(attempted, ["ema-key-3"]);
  assert.equal(keyPool.publicStatus().nextRestKeyNumber, 4);
});
