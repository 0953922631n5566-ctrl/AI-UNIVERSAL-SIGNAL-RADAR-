import test from "node:test";
import assert from "node:assert/strict";
import { fetchCandles } from "../src/twelve-data.js";
import { TwelveDataKeyPool } from "../src/twelve-data-pool.js";

test("REST fetch automatically fails over from a quota-limited key", async () => {
  const pool = new TwelveDataKeyPool(["first-key", "second-key"]);
  const now = Date.UTC(2026, 10, 6, 8, 0, 0);
  const values = Array.from({ length: 200 }, (_, index) => {
    const time = new Date(now - (200 - index) * 60_000).toISOString().slice(0, 16).replace("T", " ");
    return { datetime: time, open: "1.1000", high: "1.1010", low: "1.0990", close: "1.1005" };
  });
  const attempted = [];
  const result = await fetchCandles({
    keyPool,
    symbol: "EUR/USD",
    now,
    fetchImpl: async (_url, options) => {
      const key = options.headers.Authorization.replace("apikey ", "");
      attempted.push(key);
      if (key === "first-key") {
        return { ok: false, status: 429, json: async () => ({ status: "error", message: "quota exceeded" }) };
      }
      return { ok: true, status: 200, json: async () => ({ meta: { symbol: "EUR/USD", interval: "1min" }, values }) };
    }
  });
  assert.deepEqual(attempted, ["first-key", "second-key"]);
  assert.equal(result.candles.length, 200);
  assert.equal(pool.publicStatus().activeKeyNumber, 2);
  assert.equal(pool.publicStatus().availableCount, 1);
});
