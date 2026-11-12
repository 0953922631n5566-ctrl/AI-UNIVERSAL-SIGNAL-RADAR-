import express from "express";
import {
  STRATEGY_NAMES, candidateSignals, outcomeFor, buildReport
} from "./strategy.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SOURCE_URL = process.env.MARKET_SOURCE_URL ||
  "https://ai-signal-radar-main-market.onrender.com/api/public/signal";
const DURATION_MS = 5 * 60 * 1000;
const POLL_MS = 2000;
const MAX_TICK_AGE_SECONDS = 10;

const startedAt = Date.now();
const state = {
  service: "signal-radar-shadow-5m-test",
  status: "RUNNING",
  startedAt: new Date(startedAt).toISOString(),
  endsAt: new Date(startedAt + DURATION_MS).toISOString(),
  durationMs: DURATION_MS,
  sourceUrl: SOURCE_URL,
  symbol: "EUR/USD",
  interval: "M1",
  polls: 0, validPolls: 0, errors: 0, stalePolls: 0,
  lastSourceAt: null, lastError: null,
  currentMinute: null, currentCandle: null, currentMetrics: null,
  pending: [], records: [], skippedCandles: [],
  finishedAt: null, report: null
};

function validMarket(market) {
  const price = Number(market?.price ?? market?.lastTickPrice ?? market?.lastPrice);
  const tickAge = market?.tickAgeSeconds;
  return market?.symbol === "EUR/USD" &&
    Number.isFinite(price) && price > 0 &&
    market?.apiStatus === "ONLINE" &&
    (tickAge == null || (Number.isFinite(Number(tickAge)) && Number(tickAge) <= MAX_TICK_AGE_SECONDS));
}
function beginCandle(minute, price, now) {
  return { minute, open: price, high: price, low: price, close: price,
    firstSeenAt: now, lastSeenAt: now, samples: 1 };
}
function candleQuality(candle, now) {
  const firstOffset = candle.firstSeenAt - candle.minute * 60000;
  return firstOffset <= 10000 && candle.samples >= 15 && now - candle.lastSeenAt <= 10000;
}
function settleTarget(closedCandle) {
  const keep = [];
  for (const item of state.pending) {
    if (item.targetMinute !== closedCandle.minute) { keep.push(item); continue; }
    const outcome = outcomeFor(item.direction, item.entryPrice, closedCandle.close);
    state.records.push({ ...item, exitPrice: closedCandle.close,
      exitAt: new Date(closedCandle.lastSeenAt).toISOString(), outcome,
      priceChange: closedCandle.close - item.entryPrice });
  }
  state.pending = keep;
}
function createCandidates(closedCandle, metrics, liveSignal, nextMinute, entryPrice) {
  const candidates = candidateSignals(closedCandle, metrics, liveSignal);
  for (const [strategy, direction] of Object.entries(candidates)) {
    if (!STRATEGY_NAMES.includes(strategy)) continue;
    state.pending.push({
      strategy, direction, sourceMinute: closedCandle.minute, targetMinute: nextMinute,
      signalAt: new Date(closedCandle.lastSeenAt).toISOString(),
      entryAt: new Date(nextMinute * 60000).toISOString(), entryPrice,
      entryPriceBasis: "FIRST_OBSERVED_TWELVE_DATA_TICK_IN_TARGET_M1",
      sourceClose: closedCandle.close
    });
  }
}
function finishIfReady(now) {
  if (now < startedAt + DURATION_MS) return;
  if (state.status === "RUNNING") state.status = "SETTLING";
  if (state.pending.length && now < startedAt + DURATION_MS + 65000) return;
  if (state.pending.length) {
    state.skippedCandles.push({ reason: "PENDING_TARGET_CANDLE_DID_NOT_CLOSE_BEFORE_SETTLEMENT_DEADLINE",
      count: state.pending.length });
    state.pending = [];
  }
  state.status = "COMPLETED";
  state.finishedAt = new Date(now).toISOString();
  state.report = buildReport(state.records);
  state.report.window = { startedAt: state.startedAt, finishedAt: state.finishedAt, durationMs: DURATION_MS };
  state.report.dataQuality = { polls: state.polls, validPolls: state.validPolls,
    errors: state.errors, stalePolls: state.stalePolls, skippedCandles: state.skippedCandles.length };
  console.info("[shadow-test-5m] completed", JSON.stringify({
    status: state.status, targetAchieved: state.report.targetAchieved,
    consensus: state.report.strategies.CONSENSUS_3_OF_4
  }));
}
async function pollMarket() {
  if (state.status === "COMPLETED") return;
  const now = Date.now();
  state.polls++;
  try {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Market source HTTP " + response.status);
    const payload = await response.json();
    const market = payload.market || payload;
    state.lastSourceAt = payload.updatedAt || new Date(now).toISOString();
    if (!validMarket(market)) {
      state.stalePolls++;
      state.lastError = market?.statusMessage || "Source price is stale or market feed is offline";
      finishIfReady(now); return;
    }
    const price = Number(market.price ?? market.lastTickPrice ?? market.lastPrice);
    const minute = Math.floor(now / 60000);
    state.validPolls++;
    state.lastError = null;
    if (!state.currentCandle) {
      state.currentMinute = minute;
      state.currentCandle = beginCandle(minute, price, now);
      state.currentMetrics = market.metrics || {};
      state.currentLiveSignal = market.signal || "STANDBY";
      finishIfReady(now); return;
    }
    if (minute === state.currentMinute) {
      const c = state.currentCandle;
      c.high = Math.max(c.high, price); c.low = Math.min(c.low, price);
      c.close = price; c.lastSeenAt = now; c.samples++;
      state.currentMetrics = market.metrics || state.currentMetrics;
      state.currentLiveSignal = market.signal || state.currentLiveSignal;
      finishIfReady(now); return;
    }
    const closed = state.currentCandle;
    if (candleQuality(closed, now)) {
      settleTarget(closed);
      if (now < startedAt + DURATION_MS) {
        createCandidates(closed, state.currentMetrics || {},
          state.currentLiveSignal || "STANDBY", minute, price);
      }
    } else {
      state.pending = state.pending.filter(item => item.targetMinute !== closed.minute);
      state.skippedCandles.push({ minute: closed.minute, samples: closed.samples,
        reason: "INCOMPLETE_OR_STALE_2_SECOND_PRICE_SAMPLING" });
    }
    state.currentMinute = minute;
    state.currentCandle = beginCandle(minute, price, now);
    state.currentMetrics = market.metrics || {};
    state.currentLiveSignal = market.signal || "STANDBY";
    finishIfReady(now);
  } catch (error) {
    state.errors++; state.lastError = error?.message || String(error);
    finishIfReady(now);
  }
}
app.get("/health", (_req, res) => res.json({
  ok: true, service: state.service, status: state.status, source: SOURCE_URL,
  symbol: state.symbol, interval: state.interval, startedAt: state.startedAt,
  endsAt: state.endsAt, polls: state.polls, validPolls: state.validPolls,
  errors: state.errors, lastError: state.lastError
}));
app.get("/results", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, status: state.status, startedAt: state.startedAt,
    endsAt: state.endsAt, finishedAt: state.finishedAt, report: state.report,
    liveProgress: state.status === "COMPLETED" ? undefined : {
      polls: state.polls, validPolls: state.validPolls, errors: state.errors,
      stalePolls: state.stalePolls, pendingTrades: state.pending.length,
      completedTrades: state.records.length, lastError: state.lastError,
      consensusCandidates: state.pending.filter(x => x.strategy === "CONSENSUS_3_OF_4").length
    } });
});
app.get("/", (_req, res) => res.redirect("/results"));
app.listen(PORT, () => {
  console.log("[shadow-test-5m] started", { port: PORT, source: SOURCE_URL, durationMs: DURATION_MS });
  pollMarket();
  const timer = setInterval(pollMarket, POLL_MS);
  timer.unref?.();
});
