import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SYMBOLS } from "../src/config.js";
import { fetchCandles } from "../src/twelve-data.js";
import { TwelveDataKeyPool } from "../src/twelve-data-pool.js";

const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("selecting any configured pair always loads that pair's own REST history", () => {
  const start = serverSource.indexOf("async function select(symbolValue) {");
  const end = serverSource.indexOf("\nfunction stop(", start);
  assert.ok(start >= 0 && end > start, "select() must exist");
  const selectBody = serverSource.slice(start, end);
  const syncAt = selectBody.indexOf("await syncSelected({ force: true, symbol });");
  const streamAt = selectBody.indexOf("if (wasMonitoring && monitoring) startStream();");
  assert.ok(syncAt >= 0, "pair selection must always fetch its own REST history");
  assert.ok(streamAt > syncAt, "Streaming must restart only after REST sync and only when monitoring");
  assert.doesNotMatch(selectBody, /if\s*\(wasMonitoring\)\s*\{\s*await syncSelected/);
});

test("public pair snapshot falls back to the latest closed REST price without relaxing signal guards", () => {
  assert.match(serverSource, /const freshTick = tickAge !== null && tickAge <= MAX_STREAM_AGE_SECONDS/);
  assert.match(serverSource, /const latestClosedCandle = feed\.candles\.filter\(candle => candle && candle\.live !== true\)\.at\(-1\)/);
  assert.match(serverSource, /price: freshTick \?\? restLastPrice/);
  assert.match(serverSource, /lastTickPrice: freshTick/);
  assert.match(serverSource, /streamingRequiredForSignals: true/);
});

test("Twelve Data REST request is correctly formed for all six configured pairs", async () => {
  const now = Date.UTC(2026, 10, 11, 12, 0, 0);
  const values = Array.from({ length: 100 }, (_, index) => {
    const time = new Date(now - (100 - index) * 60_000).toISOString().slice(0, 16).replace("T", " ");
    return { datetime: time, open: "1.1000", high: "1.1010", low: "1.0990", close: "1.1005" };
  });

  for (const symbol of SYMBOLS) {
    const pool = new TwelveDataKeyPool(["test-key"]);
    let requestedSymbol = null;
    const result = await fetchCandles({
      keyPool: pool,
      symbol,
      now,
      fetchImpl: async (url, options) => {
        requestedSymbol = new URL(url).searchParams.get("symbol");
        assert.equal(options.headers.Authorization, "apikey test-key");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            meta: { symbol, interval: "1min" },
            values
          })
        };
      }
    });
    assert.equal(requestedSymbol, symbol);
    assert.equal(result.symbol, symbol);
    assert.equal(result.candles.length, 100);
  }
});
