import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { validateClientToken } from "./src/client-auth.js";
import { fetchCandles } from "./src/twelve-data.js";
import { createLiveCandlePreview } from "./src/live-candle-preview.js";
import { getStreamRetryReason } from "./src/stream-retry.js";
import { twelveDataKeyPool } from "./src/twelve-data-pool.js";
import { analyzeMarket } from "./src/analyzer.js";
import { analyzeBBPureScalper } from "./src/bb-pure-scalper.js";
import { analyzeTrendRider } from "./src/trend-rider.js";
import { analyzeEarlyEntryEngine4 } from "./src/engine-four.js";
import { applySignalReleaseGate, SIGNAL_RELEASE_VALIDATED } from "./src/signal-release-gate.js";
import { canDispatchEngine4Signal, canFinalizeSignal, isEngine4EntryWindow, isPrepareAlertWindow, isSignalFinalizeWindow, signalHoldExpiresAt } from "./src/signal-timing.js";
import { createRecoveryState, inspectRecoveryWindow, markRecoveryAttempt, settleRecoveryAttempt, armRecoveryAfterLoss, evaluateM1Outcome, selectRecoveryCandidate } from "./src/recovery.js";
import {
  SYMBOLS, DEFAULT_SYMBOL, INTERVAL, MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES,
  REST_SYNC_SECONDS, LIVE_PRICE_CHECK_SECONDS, LIVE_ANALYSIS_INTERVAL_SECONDS,
  MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS,
  SIGNAL_HOLD_SECONDS, resolveSymbol
} from "./src/config.js";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const CLIENT_TOKEN = process.env.ANDROID_CLIENT_TOKEN || "";
// TELEGRAM_BOT_TOKEN is intentionally optional; open Mini App sessions do not validate Telegram initData.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const telegramSessions = new Map();
const authRequests = new Map();
const SYSTEM_NAME = "V1 + BB PURE SCALPER + TREND RIDER AI + ENGINE 4 EARLY ENTRY";
const ARCHITECTURE_ID = "V1-BB-TREND-RIDER-PLUS-INDEPENDENT-ENGINE-4-EARLY-ENTRY";
const VERSION = "2026-11-19-engine4-pure-price-action-pullback-v6";
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function newFeed(symbol) {
  return {
    symbol, candles: [], lastTick: null, tickAt: 0, engine4TickStats: { candleEpoch: null, firstPrice: null, previousPrice: null, initialDirection: null, extremePrice: null, reversalSignal: null, reversalPrice: null, upTicks: 0, downTicks: 0, totalTicks: 0 }, streamApiKey: null, subscribeAt: 0,
    restStatus: "NOT_CHECKED", restMessage: "ยังไม่ได้ตรวจสอบ REST",
    streamStatus: "WAITING", streamMessage: "รอเชื่อมต่อ Streaming",
    lastRestSyncAt: 0, restSyncPromise: null,
    analysis: standby("กดเริ่มสแกนเพื่อเชื่อมต่อข้อมูล"),
    activeSignal: null, activeUntil: 0, signalCandle: null,
    signalSourceCandle: null, signalTriggeredAt: 0, preAlertStatus: null,
    lastPrepareLoggedCandle: null, lastFinalizeLoggedCandle: null,
    preAlertSignal: null, preAlertCandle: null,
    alertId: null, dataLocked: false,
    pendingForecast: null, forecastHistory: [], recoveryState: createRecoveryState(),
    enginePendingForecasts: { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null },
    engineForecastHistory: { V1: [], BB: [], TREND_RIDER: [], ENGINE_4: [] },
    engineRecoveryStates: { V1: createRecoveryState(), BB: createRecoveryState(), TREND_RIDER: createRecoveryState(), ENGINE_4: createRecoveryState() },
    engineActive: { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null },
    engineLastDispatchedCandle: { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null },
    engineLastDispatchedAlertId: { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null },
    lastDispatchedAt: 0, lastDispatchedCandle: null, lastDispatchedAlertId: null
  };
}

const feeds = new Map(SYMBOLS.map(symbol => [symbol, newFeed(symbol)]));
let selectedSymbol = DEFAULT_SYMBOL;
let monitoring = false;
let upstream = null;
let restTimer = null;
let watchdogTimer = null;
let retryTimer = null;
let heartbeatTimer = null;
let signalTimer = null;
let globalLockMessage = null;
const controlRequests = new Map();
const engineEnabled = { V1: true, BB: true, TREND_RIDER: true, ENGINE_4: true };
const ENGINE_KEYS = Object.keys(engineEnabled);

function standby(reason, extra = {}) {
  return {
    signal: "STANDBY", regime: "UNCLEAR", reason,
    evidence: [], metrics: null, analyzedAt: new Date().toISOString(), ...extra
  };
}

function feedStatus(feed) {
  if (feed.restStatus === "UNSUPPORTED") return "UNSUPPORTED";
  if (feed.dataLocked || globalLockMessage) return "LOCKED";
  if (feed.restStatus === "ERROR") return "DATA_ERROR";
  if (feed.restStatus !== "READY") return "CHECKING";
  const age = feed.tickAt ? (Date.now() - feed.tickAt) / 1000 : Infinity;
  if (age <= MAX_STREAM_AGE_SECONDS) return "SUPPORTED";
  if (feed.streamStatus === "UNSUPPORTED" || feed.streamStatus === "ERROR" ||
      feed.streamStatus === "TIMEOUT") return "REST_ONLY";
  return feed.tickAt ? "STALE" : "REST_ONLY";
}

function forecastStats(feed) {
  const rows = Array.isArray(feed.forecastHistory) ? feed.forecastHistory : [];
  const wins = rows.filter(x => x.outcome === "WIN").length;
  const losses = rows.filter(x => x.outcome === "LOSS").length;
  const neutral = rows.filter(x => x.outcome === "FLAT").length;
  const decided = wins + losses;
  return { sample: rows.length, wins, losses, neutral,
    winRate: decided ? Math.round(wins / decided * 1000) / 10 : null,
    note: "Observed next-M1 entry-to-close outcomes; not a guarantee or backtest" };
}

function publicFeed(feed) {
  const status = feedStatus(feed);
  const tickAge = feed.tickAt ? Math.max(0, (Date.now() - feed.tickAt) / 1000) : null;
  const analysis = feed.analysis || standby("รอข้อมูล");
  const freshTick = tickAge !== null && tickAge <= MAX_STREAM_AGE_SECONDS
    ? feed.lastTick : null;
  const latestClosedCandle = feed.candles.filter(candle => candle && candle.live !== true).at(-1);
  const restLastPrice = Number.isFinite(latestClosedCandle?.close) ? latestClosedCandle.close : null;
  const messages = {
    UNSUPPORTED: feed.restMessage,
    LOCKED: globalLockMessage || feed.restMessage,
    DATA_ERROR: feed.restMessage,
    SUPPORTED: "REST และ Streaming พร้อมรับข้อมูลสด",
    REST_ONLY: "REST พร้อม · ใช้แท่ง M1 ปิดล่าสุดวิเคราะห์ได้ แต่ยังไม่มีราคา Streaming สด",
    STALE: "ราคา Streaming เก่าเกินกำหนด — ปิด CALL/PUT",
    CHECKING: "กำลังตรวจสอบประวัติข้อมูลจาก Twelve Data"
  };
  return {
    ...analysis,
    // Display a verified recent tick when available; otherwise show the latest real REST candle close.
    // This is presentation/data availability only and does not relax streaming requirements for signals.
    price: freshTick ?? restLastPrice,
    lastPrice: restLastPrice,
    symbol: feed.symbol,
    selected: feed.symbol === selectedSymbol,
    supportStatus: status,
    restStatus: feed.restStatus,
    streamStatus: feed.streamStatus,
    statusMessage: messages[status] || feed.streamMessage,
    apiStatus: status === "SUPPORTED" || status === "REST_ONLY" ? "ONLINE"
      : ["LOCKED", "STALE", "DATA_ERROR", "UNSUPPORTED"].includes(status) ? "LOCKED"
      : monitoring ? "CONNECTING" : "OFFLINE",
    tickAgeSeconds: tickAge === null ? null : Math.round(tickAge),
    lastTickPrice: freshTick,
    candleCount: feed.candles.length,
    closedCandleCount: Math.min(feed.candles.filter(c => !c.live).length, MIN_CLOSED_CANDLES),
    requiredCandles: MIN_CLOSED_CANDLES,
    analysisWindow: { contextCandles: 50, entryCandles: 4, total: MIN_CLOSED_CANDLES },
    nextCandleAt: feed.candles.length
      ? (feed.candles.at(-1).live
        ? feed.candles.at(-1).epoch + 60
        : Math.max(feed.candles.at(-1).epoch + 60, Math.floor(Date.now() / 60000) * 60 + 60)) * 1000
      : null,
    signalExpiresAt: feed.activeUntil > Date.now()
      ? new Date(feed.activeUntil).toISOString() : null,
    alertId: feed.alertId,
    forecastStats: forecastStats(feed),
    recovery: { mode: Object.values(feed.engineRecoveryStates || {}).some(x => x.status === "ARMED" || x.status === "ATTEMPT_PENDING") ? "RECOVERY_ACTIVE" : "NORMAL",
      engines: Object.fromEntries(ENGINE_KEYS.map(engine => { const state = feed.engineRecoveryStates?.[engine] || createRecoveryState();
        return [engine, { status: state.status, mode: state.status === "ARMED" || state.status === "ATTEMPT_PENDING" ? "RECOVERY_ACTIVE" : "NORMAL",
          lastOutcome: state.lastOutcome, attempts: state.attempts || 0, pending: Boolean(feed.enginePendingForecasts?.[engine]) }]; })),
      martingale: false
    },
    preAlertSignal: feed.preAlertSignal,
    source: "Twelve Data REST + live-price Streaming"
  };
}

function snapshot() {
  const feed = feeds.get(selectedSymbol);
  const data = publicFeed(feed);
  const pairs = Object.fromEntries(SYMBOLS.map(symbol => [
    symbol, publicFeed(feeds.get(symbol))
  ]));
  return {
    ...data,
    symbols: SYMBOLS,
    selectedSymbol,
    selectedSymbols: [selectedSymbol],
    pairs,
    monitoring,
    connected: data.apiStatus === "ONLINE",
    serverOnline: true,
    apiStatus: data.apiStatus,
    apiMessage: globalLockMessage || data.statusMessage,
    onlineCount: data.apiStatus === "ONLINE" ? 1 : 0,
    unsupportedCount: data.supportStatus === "UNSUPPORTED" ? 1 : 0,
    version: VERSION,
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseStatus: "PARTIAL_SCORING_55_EARLY_ENTRY_MANUAL_ONLY_NOT_OOS_VALIDATED",
    apiPool: twelveDataKeyPool.publicStatus(),
    engineEnabled: { ...engineEnabled },
  };
}

function publish() {
  const message = JSON.stringify({ type: "market_state", data: snapshot() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function clearTimers() {
  clearInterval(restTimer); restTimer = null;
  clearInterval(watchdogTimer); watchdogTimer = null;
  clearInterval(heartbeatTimer); heartbeatTimer = null;
  clearInterval(signalTimer); signalTimer = null;
  clearTimeout(retryTimer); retryTimer = null;
}

function closeUpstream() {
  const socket = upstream;
  upstream = null;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    try { socket.close(); } catch {}
  }
}

function resetSignal(feed, reason = "รีเซ็ตบริบทสัญญาณ") {
  feed.activeSignal = null;
  feed.engineActive = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
  feed.engineLastDispatchedCandle = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
  feed.engineLastDispatchedAlertId = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
  feed.activeUntil = 0;
  feed.signalCandle = null;
  feed.signalSourceCandle = null;
  feed.signalTriggeredAt = 0;
  feed.preAlertStatus = null;
  feed.preAlertSignal = null;
  feed.preAlertCandle = null;
  feed.alertId = null;
  feed.analysis = standby(reason);
}

function lockFeed(feed, reason) {
  feed.dataLocked = true;
  feed.activeSignal = null;
  feed.engineActive = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
  feed.activeUntil = 0;
  feed.analysis = standby(reason);
  feed.streamMessage = reason;
  publish();
}

function classifyError(error) {
  if (error?.kind === "RATE_LIMIT" || error?.kind === "AUTH_OR_PERMISSION") return "GLOBAL_LOCK";
  if (error?.kind === "PAIR_UNAVAILABLE" || error?.kind === "INSUFFICIENT_HISTORY") return "PAIR_UNAVAILABLE";
  if (error?.kind === "NETWORK_ERROR" || error?.kind === "INVALID_RESPONSE") return "TRANSIENT";
  return "TRANSIENT";
}

async function evaluate(feed) {
 const now = Date.now();
 const tickAge = feed.tickAt ? (now - feed.tickAt) / 1000 : null;
 const currentCandle = feed.candles.at(-1);
 const sourceCandleEpoch = currentCandle?.live === true ? currentCandle.epoch : null;
 const targetCandleEpoch = sourceCandleEpoch === null ? null : sourceCandleEpoch + 60;

 const restFallback = feed.restStatus === "READY" &&
   (!feed.tickAt || tickAge === null || tickAge > MAX_STREAM_AGE_SECONDS);
 const closedCandles = feed.candles.filter(c => c && c.live !== true &&
   Number.isFinite(c.epoch) && c.epoch < Math.floor(now / 60000) * 60).slice(-54);
 const livePreview = createLiveCandlePreview(currentCandle, {
   now, tickAt: feed.tickAt, maxAgeMs: MAX_STREAM_AGE_SECONDS * 1000
 });
 const analysisCandles = livePreview ? [...closedCandles, livePreview] : closedCandles;

 // Shared source-quality gate; after it passes, all four engines receive the same
 // closed history plus the same validated provisional M1 candle (when available).
 const v1Raw = engineEnabled.V1 ? await analyzeMarket(feed.candles, {
   now, symbol: feed.symbol, tickAgeSeconds: tickAge, allowRestFallback: restFallback,
   liveCandle: livePreview
 }) : standby("V1 ปิดการทำงานจาก Mini App");
 const v1Result = applySignalReleaseGate(v1Raw);
 const latestClosed = closedCandles.at(-1);
 const latestClosedAge = latestClosed ? now / 1000 - (latestClosed.epoch + 60) : Infinity;
 const bbOhlcValid = closedCandles.slice(-21).length === 21 &&
   closedCandles.slice(-21).every(c => [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
     c.low > 0 && c.high >= Math.max(c.open, c.close) &&
     c.low <= Math.min(c.open, c.close) && c.high >= c.low);
 const bbSourceReady = bbOhlcValid && latestClosedAge <= MAX_CANDLE_AGE_SECONDS &&
   ((Number.isFinite(tickAge) && tickAge >= 0 && tickAge <= MAX_STREAM_AGE_SECONDS) || restFallback);
 const bbRaw = !engineEnabled.BB
   ? { ready: false, signal: null, score: 0, status: "DISABLED", reason: "BB ปิดการทำงานจาก Mini App" }
   : bbSourceReady
     ? analyzeBBPureScalper(analysisCandles)
     : { ready: false, signal: null, score: 0, status: "SOURCE_LOCKED",
         reason: "BB ต้องมีแท่ง M1 ปิดอย่างน้อย 21 แท่งและข้อมูลราคาต้องสด" };
 const trendSourceReady = closedCandles.length >= 30 && latestClosedAge <= MAX_CANDLE_AGE_SECONDS &&
   ((Number.isFinite(tickAge) && tickAge >= 0 && tickAge <= MAX_STREAM_AGE_SECONDS) || restFallback);
 const trendRaw = !engineEnabled.TREND_RIDER
   ? { ready: false, signal: null, score: 0, status: "DISABLED", reason: "Trend Rider ปิดการทำงานจาก Mini App" }
   : trendSourceReady
     ? analyzeTrendRider(analysisCandles)
     : { ready: false, signal: null, score: 0, status: "SOURCE_LOCKED",
         reason: "Trend Rider ต้องมีแท่ง M1 ปิดอย่างน้อย 30 แท่งและข้อมูลราคาต้องสด" };
 const engine4SourceReady = Boolean(livePreview) && Number.isFinite(tickAge) &&
   tickAge >= 0 && tickAge <= MAX_STREAM_AGE_SECONDS;
 const engine4Raw = !engineEnabled.ENGINE_4
   ? { ready: false, signal: null, candidateSignal: null, score: 0, status: "DISABLED", reason: "Engine 4 ปิดการทำงานจาก Mini App" }
   : engine4SourceReady
     ? analyzeEarlyEntryEngine4(analysisCandles, { livePreview: Boolean(livePreview), now, tickStats: feed.engine4TickStats, currentPrice: feed.lastTick })
     : { ready: false, signal: null, candidateSignal: null, score: 0, status: "SOURCE_LOCKED",
         reason: "Engine 4 ต้องมีแท่ง M1 ปัจจุบันที่กำลังวิ่งและ Streaming สด" };
 const engine4Result = engine4Raw.ready && ["CALL", "PUT"].includes(engine4Raw.signal)
   ? { ...engine4Raw, engine: "ENGINE_4", active: true,
       analysisMode: livePreview ? "LIVE_M1_PREVIEW" : "CLOSED_M1_ONLY",
       targetCandleAt: engine4Raw.targetCandleAt || new Date((engine4Raw.candleEpoch + (livePreview ? 60 : 120)) * 1000).toISOString(),
       signal: engine4Raw.signal }
   : { ...engine4Raw, engine: "ENGINE_4", active: false, signal: "STANDBY", status: engine4Raw.status || "SOURCE_LOCKED" };
 const candidates = {
   V1: v1Result,
   BB: { ...bbRaw, provider: "LOCAL_BB_PURE_SCALPER", strategy: bbRaw.strategy || "BB20_2_INDEPENDENT_EARLY_TOUCH_REVERSAL" },
   TREND_RIDER: { ...trendRaw, provider: "LOCAL_TREND_RIDER_AI" },
   ENGINE_4: { ...engine4Raw, provider: "LOCAL_EARLY_ENTRY_ENGINE_4", engine: "ENGINE_4", signal: engine4Raw.ready ? engine4Raw.signal : null }
 };

 const finalizeWindow = sourceCandleEpoch !== null && isSignalFinalizeWindow(sourceCandleEpoch, now);
 const engine4EntryWindow = sourceCandleEpoch !== null && isEngine4EntryWindow(sourceCandleEpoch, now);
 const prepareWindow = sourceCandleEpoch !== null && isPrepareAlertWindow(sourceCandleEpoch, now);
 if (!feed.engineActive) feed.engineActive = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
 if (!feed.engineLastDispatchedCandle) feed.engineLastDispatchedCandle = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
 if (!feed.engineLastDispatchedAlertId) feed.engineLastDispatchedAlertId = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
 if (!feed.engineRecoveryStates) feed.engineRecoveryStates = { V1: createRecoveryState(), BB: createRecoveryState(), TREND_RIDER: createRecoveryState(), ENGINE_4: createRecoveryState() };
 if (!feed.enginePendingForecasts) feed.enginePendingForecasts = { V1: null, BB: null, TREND_RIDER: null, ENGINE_4: null };
 if (!feed.engineForecastHistory) feed.engineForecastHistory = { V1: [], BB: [], TREND_RIDER: [], ENGINE_4: [] };

 const engineResults = {};
 for (const engine of ENGINE_KEYS) {
   const candidate = candidates[engine];
   const recoveryWindow = inspectRecoveryWindow(feed.engineRecoveryStates[engine], sourceCandleEpoch);
   feed.engineRecoveryStates[engine] = recoveryWindow.state;
   const recoveryMode = recoveryWindow.mode;
   if (!engineEnabled[engine]) {
     feed.engineActive[engine] = null;
     engineResults[engine] = {
       ...candidate, engine, candidateSignal: null, candidateScore: 0,
       direction: null, signal: "STANDBY", status: "DISABLED", active: false,
       reason: `${engine} ปิดการทำงานจาก Mini App`, alertId: null,
       signalExpiresAt: null, signalTargetCandleAt: null
     };
     continue;
   }
   // Normal mode uses this engine's original analyzer. During recovery, select the
   // clearest available CALL/PUT candidate from the independent analyzer pool.
   const finalSignal = ["CALL", "PUT"].includes(candidate.signal) ? candidate.signal : null;
   const candidateSignal = finalSignal ||
     (engine === "V1" && candidate.signal === "PREPARE" &&
       ["CALL", "PUT"].includes(candidate.prepareSignal) ? candidate.prepareSignal : null);
   const recoveryCandidate = engine === "ENGINE_4" ? null : selectRecoveryCandidate(
     candidates, engine, recoveryMode,
     ENGINE_KEYS.filter(key => engineEnabled[key]), null
   );
   const selectedCandidate = recoveryCandidate || candidate;
   const selectedFinalSignal = recoveryMode === "RECOVERY_ACTIVE"
     ? (recoveryCandidate?.signal || null)
     : finalSignal;
   let active = feed.engineActive[engine];
   if (active && now >= active.expiresAt) {
     active = null;
     feed.engineActive[engine] = null;
   }
   const activeForCurrentOrNext = Boolean(active && now < active.expiresAt &&
     (active.targetCandleEpoch === sourceCandleEpoch || active.targetCandleEpoch === targetCandleEpoch));
   const engineWindow = engine === "ENGINE_4" ? engine4EntryWindow : finalizeWindow;
   const timingReady = engine === "ENGINE_4"
     ? canDispatchEngine4Signal({ candleEpoch: sourceCandleEpoch, tickAt: feed.tickAt, now,
         lastDispatchedCandle: feed.engineLastDispatchedCandle[engine] })
     : canFinalizeSignal({ candleEpoch: sourceCandleEpoch, tickAt: feed.tickAt, now,
         lastDispatchedCandle: feed.engineLastDispatchedCandle[engine] });
   if (!activeForCurrentOrNext && engineWindow && selectedFinalSignal && timingReady) {
     const engine4Entry = engine === "ENGINE_4";
     const signalTargetEpoch = engine4Entry ? sourceCandleEpoch : targetCandleEpoch;
     active = {
       engine, signal: selectedFinalSignal, sourceCandleEpoch, targetCandleEpoch: signalTargetEpoch,
       triggeredAt: now, expiresAt: signalHoldExpiresAt(signalTargetEpoch),
       score: selectedCandidate.score ?? 0, sourceReason: selectedCandidate.reason || null,
       sourceEngine: engine, mode: "NORMAL",
       entryPrice: engine4Entry ? (Number.isFinite(selectedCandidate.entryPrice) ? selectedCandidate.entryPrice : Number.isFinite(feed.lastTick) ? feed.lastTick : null) : null,
       entryPriceBasis: engine4Entry ? "CURRENT_M1_TICK_SEQUENCE_ONLY" : "TARGET_M1_CANDLE_OPEN",
       alertId: engine4Entry ? `${engine}:${sourceCandleEpoch}:${selectedFinalSignal}:EARLY` : `${engine}:${targetCandleEpoch}:${selectedFinalSignal}:NORMAL`
     };
     if (engine4Entry) active.expiresAt = now + SIGNAL_HOLD_SECONDS * 1000;
     feed.engineActive[engine] = active;
     console.info("[signal] independent engine candidate finalized", {
       engine, symbol: feed.symbol, signal: selectedFinalSignal,
       sourceCandleEpoch, targetCandleEpoch, score: selectedCandidate.score ?? null,
       expiresAt: new Date(active.expiresAt).toISOString()
     });
   }
   const currentActive = activeForCurrentOrNext || Boolean(active && active.targetCandleEpoch === targetCandleEpoch);
   const isActive = Boolean(currentActive && active);
   const activeReason = isActive
     ? `ACTIVE ${active.signal} · hold 30s · ${selectedFinalSignal && selectedFinalSignal !== active.signal ? `latest scan sees ${selectedFinalSignal}, but the active signal is held until expiry` : (active.sourceReason || "T-5 confirmed")}`
     : recoveryMode === "RECOVERY_ACTIVE" ? "กำลังแก้มือ · รอสัญญาณใหม่จากสูตรวิเคราะห์เดิม" : selectedCandidate.reason;
   engineResults[engine] = {
     ...selectedCandidate,
     engine,
     analysisMode: livePreview ? "LIVE_M1_PREVIEW" : "CLOSED_M1_ONLY",
     candidateSignal: recoveryMode === "RECOVERY_ACTIVE" ? selectedFinalSignal : candidateSignal,
     candidateScore: selectedCandidate.score ?? 0,
     candidateReason: selectedCandidate.reason || null,
     direction: isActive ? active.signal : (recoveryMode === "RECOVERY_ACTIVE" ? selectedFinalSignal : (selectedCandidate.direction || selectedFinalSignal || candidateSignal || null)),
     score: isActive ? active.score : (selectedCandidate.score ?? 0),
     confidence: isActive ? active.score : (selectedCandidate.confidence ?? selectedCandidate.score ?? 0),
     reason: activeReason,
     signal: isActive ? active.signal : "STANDBY",
     status: isActive ? "SIGNAL" : (recoveryMode === "RECOVERY_ACTIVE" ? selectedFinalSignal : candidateSignal) ? "WATCH" : "STANDBY",
     active: isActive,
     activeSignalScore: isActive ? active.score : null,
     alertId: isActive ? active.alertId : null,
     signalExpiresAt: isActive ? new Date(active.expiresAt).toISOString() : null,
     signalTargetCandleAt: isActive ? new Date(active.targetCandleEpoch * 1000).toISOString() : null,
      entryPrice: isActive ? active.entryPrice : selectedCandidate.entryPrice ?? null,
      entryPriceBasis: isActive ? active.entryPriceBasis : "M1_OPEN_TO_CURRENT_PRICE_AND_TICK_CONFIRM"
   };
 }

 const activeSignals = Object.values(engineResults)
   .filter(engine => engine.active)
   .map(engine => ({
     engine: engine.engine, signal: engine.signal, score: engine.activeSignalScore,
     reason: engine.reason, alertId: engine.alertId,
     expiresAt: engine.signalExpiresAt, targetCandleAt: engine.signalTargetCandleAt,
     targetCandleEpoch: feed.engineActive[engine.engine]?.targetCandleEpoch
   }));
 const activeDirections = [...new Set(activeSignals.map(item => item.signal))];
 const aggregateSignal = activeDirections.length === 1 ? activeDirections[0] : "STANDBY";
 const conflicting = activeDirections.length > 1;
 const activeEngineNames = activeSignals.map(item => item.engine);
 const v1Candidate = engineResults.V1.candidateSignal;
 const bbCandidate = engineResults.BB.candidateSignal;
 const trendCandidate = engineResults.TREND_RIDER.candidateSignal;
 const engine4Candidate = engineResults.ENGINE_4.candidateSignal;
 feed.preAlertStatus = !activeSignals.length && prepareWindow &&
   Boolean(v1Candidate || bbCandidate || trendCandidate || engine4Candidate) ? "PREPARE_ALERT" : null;
 feed.preAlertCandle = feed.preAlertStatus ? targetCandleEpoch : null;
 feed.preAlertSignal = null;

 if (feed.preAlertStatus === "PREPARE_ALERT" &&
     feed.lastPrepareLoggedCandle !== sourceCandleEpoch) {
   feed.lastPrepareLoggedCandle = sourceCandleEpoch;
   console.info("[timing] T-10 independent engine watch window entered", {
     symbol: feed.symbol, sourceCandleEpoch, targetCandleEpoch,
     v1Candidate, bbCandidate, trendCandidate, engine4Candidate
   });
 }

 // Keep legacy aggregate fields for existing UI/forecast consumers while exposing each engine separately.
 feed.activeSignal = aggregateSignal === "STANDBY" ? null : aggregateSignal;
 const activeStates = activeSignals.map(item => feed.engineActive[item.engine]).filter(Boolean);
 feed.signalCandle = activeStates.length ? activeStates[0].targetCandleEpoch : null;
 feed.signalSourceCandle = activeStates.length ? activeStates[0].sourceCandleEpoch : null;
 feed.signalTriggeredAt = activeStates.length
   ? Math.min(...activeStates.map(x => x.triggeredAt)) : 0;
 feed.activeUntil = activeSignals.length
   ? Math.min(...Object.values(feed.engineActive).filter(Boolean).map(x => x.expiresAt)) : 0;
 feed.alertId = activeSignals.length === 1 ? activeSignals[0].alertId
   : activeSignals.length ? activeSignals.map(x => x.alertId).join("|") : null;

 for (const item of activeSignals) {
    const engine = item.engine, existing = feed.enginePendingForecasts[engine];
    if (existing?.targetCandleEpoch === item.targetCandleEpoch) continue;
    const liveActive = feed.engineActive[engine];
    const pending = { engine, alertId: item.alertId, symbol: feed.symbol, signal: item.signal,
      targetCandleEpoch: item.targetCandleEpoch, signalAt: now,
      entryAt: liveActive?.entryPrice !== null && liveActive?.entryPrice !== undefined ? liveActive.triggeredAt : null,
      entryPrice: liveActive?.entryPrice ?? null,
      mode: liveActive?.mode || "NORMAL",
      entryPriceBasis: liveActive?.entryPriceBasis || "TARGET_M1_CANDLE_OPEN" };
    feed.enginePendingForecasts[engine] = pending;
    if (pending.mode === "RECOVERY_ACTIVE") feed.engineRecoveryStates[engine] =
      markRecoveryAttempt(feed.engineRecoveryStates[engine], pending);
  }

let reason;
 if (conflicting) {
   reason = "V1 และ BB ออกสัญญาณคนละทิศทาง · แสดงผลแยกแต่ไม่รวมเป็นคำสั่งเดียว";
 } else if (activeSignals.length) {
   reason = `สัญญาณ ${aggregateSignal} จาก ${activeEngineNames.join(" + ")} · แสดงผลแยกตามเครื่องยนต์`;
 } else if (feed.preAlertStatus === "PREPARE_ALERT") {
   reason = `PREPARE T-10 · V1: ${v1Candidate || "รอ"} · BB: ${bbCandidate || "รอ"} · Trend Rider: ${trendCandidate || "รอ"} · รอยืนยัน T-5`;
 } else {
   reason = `V1: ${v1Result.reason || "STANDBY"} · BB: ${bbRaw.reason || "STANDBY"} · Trend Rider: ${trendRaw.reason || "STANDBY"}`;
 }
 const primary = activeSignals.length
   ? (engineResults.V1.active ? engineResults.V1 : engineResults.BB.active ? engineResults.BB :
     engineResults.TREND_RIDER.active ? engineResults.TREND_RIDER : engineResults.ENGINE_4)
   : v1Result;
 feed.analysis = {
   ...v1Result,
   signal: aggregateSignal,
   direction: aggregateSignal === "STANDBY" ? null : aggregateSignal,
   status: aggregateSignal === "STANDBY" ? (feed.preAlertStatus ? "PREPARE" : "STANDBY") : "SIGNAL",
   prepareSignal: feed.preAlertStatus ? (v1Candidate || bbCandidate) : null,
   reason,
   summary: reason,
   score: primary.score ?? v1Result.score ?? 0,
   confidence: primary.confidence ?? primary.score ?? v1Result.confidence ?? 0,
   engineResults,
   activeSignals,
   bbPureScalper: bbRaw,
   trendRider: trendRaw,
   engine4: engineResults.ENGINE_4,
   preAlertStatus: feed.preAlertStatus,
   preAlertCandle: feed.preAlertCandle,
   preAlertSignal: null,
   tickAgeSeconds: tickAge === null ? null : Math.round(tickAge),
   lastTickPrice: feed.lastTick,
   alertId: feed.alertId,
   signalTriggeredAt: feed.signalTriggeredAt ? new Date(feed.signalTriggeredAt).toISOString() : null,
   signalExpiresAt: feed.activeUntil ? new Date(feed.activeUntil).toISOString() : null,
   signalTargetCandleAt: feed.signalCandle ? new Date(feed.signalCandle * 1000).toISOString() : null,
   signalTimingWindowSeconds: [5, 0],
   engine4DecisionMode: "PURE_PRICE_ACTION_CURRENT_M1_TICK_REVERSAL_IMMEDIATE",
    engine4UsesOlderHistoricalCandles: false,
    engine4UsesPreviousClosedCandleContext: false,
    engine4PreviousCandleContextWeightPct: 0,
    engine4DirectionSource: "CURRENT_M1_FIRST_PRICE_MOVE_THEN_FIRST_OPPOSITE_TICK",
   analysisMode: livePreview ? "LIVE_M1_PREVIEW" : "CLOSED_M1_ONLY",
   livePreviewCandleEpoch: livePreview?.epoch ?? null,
   liveAnalysisIntervalSeconds: LIVE_ANALYSIS_INTERVAL_SECONDS,
   signalValidationNote: "V1, BB และ Trend Rider ไม่เปลี่ยนแปลง · Engine 4 อ่านเฉพาะลำดับราคา Streaming ของแท่ง M1 ปัจจุบันตั้งแต่วินาทีแรก · หากราคาเริ่มขยับขึ้นแล้วเกิด Tick ลงครั้งแรกจะส่ง CALL ทันที · หากราคาเริ่มขยับลงแล้วเกิด Tick ขึ้นครั้งแรกจะส่ง PUT ทันที · ไม่ใช้ EMA, RSI, อินดิเคเตอร์ หรือแท่งก่อนหน้า · ตรวจจับภายในช่วง [0,23) วินาที · หนึ่งสัญญาณต่อแท่งและคงสัญญาณ 30 วินาที · ใช้ระบบเสียงและสั่นเดิม · เป็นสัญญาณแจ้งเตือนสำหรับผู้ใช้ตัดสินใจเอง ไม่มีการส่งคำสั่งซื้อขายไปยังโบรกเกอร์"
 };
}

function dispatchSignalIfReady(feed) {
 const now = Date.now();
 for (const engine of ENGINE_KEYS) {
   if (!engineEnabled[engine]) continue;
   const active = feed.engineActive?.[engine];
   if (!active || !["CALL", "PUT"].includes(active.signal) || !active.alertId) continue;
   const dispatchReady = engine === "ENGINE_4"
     ? canDispatchEngine4Signal({ candleEpoch: active.sourceCandleEpoch, tickAt: feed.tickAt, now,
         lastDispatchedCandle: feed.engineLastDispatchedCandle?.[engine] })
     : canFinalizeSignal({ candleEpoch: active.sourceCandleEpoch, tickAt: feed.tickAt, now,
         lastDispatchedCandle: feed.engineLastDispatchedCandle?.[engine] });
   if (!dispatchReady) continue;
   if (feed.engineLastDispatchedAlertId?.[engine] === active.alertId) continue;
   feed.engineLastDispatchedAt = feed.engineLastDispatchedAt || {};
   feed.engineLastDispatchedAt[engine] = now;
   feed.engineLastDispatchedCandle[engine] = active.sourceCandleEpoch;
   feed.engineLastDispatchedAlertId[engine] = active.alertId;
   console.info("[signal] T-5 independent signal available to Telegram Mini App polling", {
     engine, alertId: active.alertId, signal: active.signal,
     symbol: feed.symbol, sourceCandleEpoch: active.sourceCandleEpoch,
     targetCandleEpoch: active.targetCandleEpoch,
     expiresAt: new Date(active.expiresAt).toISOString()
   });
 }
}

function applyTick(feed, price, epoch) {
  const minute = Math.floor(epoch / 60) * 60;
  const current = feed.candles.at(-1);
  if (!current || current.epoch < minute) {
    if (current) {
      current.live = false;
      for (const engine of ENGINE_KEYS) {
        const pending = feed.enginePendingForecasts?.[engine];
        if (!pending || pending.targetCandleEpoch !== current.epoch) continue;
        const evaluated = evaluateM1Outcome(pending.signal, current, pending.entryPrice);
        const record = { ...pending, entryAt: pending.entryAt ?? current.epoch * 1000, entryPrice: evaluated.entryPrice,
          exitAt: Date.now(), exitPrice: evaluated.exitPrice, outcome: evaluated.outcome,
          outcomeReason: evaluated.reason, entryPriceBasis: pending.entryPriceBasis || "TWELVE_DATA_STREAM_M1_OPEN",
          exitPriceBasis: "TWELVE_DATA_STREAM_M1_CLOSE",
          priceChange: Number.isFinite(evaluated.entryPrice) && Number.isFinite(evaluated.exitPrice)
            ? evaluated.exitPrice - evaluated.entryPrice : null };
        feed.forecastHistory.push(record); feed.forecastHistory = feed.forecastHistory.slice(-100);
        feed.engineForecastHistory[engine].push(record);
        feed.engineForecastHistory[engine] = feed.engineForecastHistory[engine].slice(-100);
        feed.enginePendingForecasts[engine] = null;
        if (pending.mode === "RECOVERY_ACTIVE") feed.engineRecoveryStates[engine] =
          settleRecoveryAttempt(feed.engineRecoveryStates[engine], record);
        else if (record.outcome === "LOSS") feed.engineRecoveryStates[engine] =
          armRecoveryAfterLoss(feed.engineRecoveryStates[engine], record);
        console.info("[recovery] independent engine outcome", { engine, symbol: feed.symbol,
          outcome: record.outcome, mode: pending.mode, state: feed.engineRecoveryStates[engine].status,
          next: feed.engineRecoveryStates[engine].status === "ARMED" ? "REANALYZE_NEXT_M1" : "NORMAL_MODE" });
      }
    }
    feed.candles.push({
      time: new Date(minute * 1000).toISOString().slice(0, 16).replace("T", " "),
      epoch: minute, open: price, high: price, low: price, close: price, live: true
    });
    feed.candles = feed.candles.slice(-MAX_CANDLES);
  } else if (current.epoch === minute) {
    current.high = Math.max(current.high, price);
    current.low = Math.min(current.low, price);
    current.close = price;
  } else {
    return;
  }

  // Engine 4 records only the current candle tick path. The first price movement sets
  // the initial impulse; its first opposite tick triggers an immediate counter-move signal.
  const elapsedInMinute = epoch - minute;
  let tickStats = feed.engine4TickStats;
  if (!tickStats || tickStats.candleEpoch !== minute) {
    tickStats = { candleEpoch: minute, firstPrice: null, previousPrice: null, initialDirection: null, extremePrice: null, reversalSignal: null, reversalPrice: null, upTicks: 0, downTicks: 0, totalTicks: 0 };
    feed.engine4TickStats = tickStats;
  }
  if (elapsedInMinute >= 0 && elapsedInMinute < 23) {
    if (!Number.isFinite(tickStats.firstPrice)) {
      tickStats.firstPrice = price;
      tickStats.previousPrice = price;
      tickStats.extremePrice = price;
      tickStats.totalTicks += 1;
    } else {
      const previous = tickStats.previousPrice;
      if (price > previous) tickStats.upTicks += 1;
      else if (price < previous) tickStats.downTicks += 1;
      if (!tickStats.initialDirection && price !== previous) {
        tickStats.initialDirection = price > previous ? "UP" : "DOWN";
        tickStats.extremePrice = price;
      } else if (!tickStats.reversalSignal && tickStats.initialDirection === "UP") {
        if (price > tickStats.extremePrice) tickStats.extremePrice = price;
        else if (price < previous && price < tickStats.extremePrice) {
          tickStats.reversalSignal = "CALL";
          tickStats.reversalPrice = price;
        }
      } else if (!tickStats.reversalSignal && tickStats.initialDirection === "DOWN") {
        if (price < tickStats.extremePrice) tickStats.extremePrice = price;
        else if (price > previous && price > tickStats.extremePrice) {
          tickStats.reversalSignal = "PUT";
          tickStats.reversalPrice = price;
        }
      }
      tickStats.previousPrice = price;
      tickStats.totalTicks += 1;
    }
  }

  feed.lastTick = price;
  feed.tickAt = Date.now();
  feed.streamStatus = "READY";
  feed.streamMessage = "ได้รับราคา Streaming สด";
  feed.dataLocked = false;
  globalLockMessage = null;
  // Tick events update the in-memory M1 OHLC immediately. The analyzer consumes
  // the latest snapshot on the one-second local timer; no REST request is made here.
}

async function syncSelected({ force = false, symbol = selectedSymbol } = {}) {
  const feed = feeds.get(symbol);
  if (!feed) return;
  if (feed.restSyncPromise) return feed.restSyncPromise;
  if (!force && feed.restStatus === "READY" && feed.lastRestSyncAt &&
      Date.now() - feed.lastRestSyncAt < REST_SYNC_SECONDS * 1000) return;

  feed.lastRestSyncAt = Date.now();
  feed.restSyncPromise = (async () => {
    try {
      const response = await fetchCandles({
        keyPool: twelveDataKeyPool, symbol,
        interval: INTERVAL, outputsize: HISTORY_CANDLES
      });
      const live = feed.candles.at(-1);
      const keepLive = live?.live && live.epoch === Math.floor(Date.now() / 60000) * 60 &&
        feed.tickAt && Date.now() - feed.tickAt <= MAX_STREAM_AGE_SECONDS * 1000;
      feed.candles = keepLive
        ? [...response.candles.filter(c => c.epoch < live.epoch), live].slice(-MAX_CANDLES)
        : response.candles.slice(-MAX_CANDLES);
      feed.restStatus = "READY";
      feed.restMessage = `REST พร้อม · ${response.candles.length} แท่งปิด`;
      feed.dataLocked = false;
      globalLockMessage = null;
      await evaluate(feed);
      console.info("[radar] REST ready", {
        symbol, candles: response.candles.length,
        liveTick: Boolean(feed.tickAt)
      });
    } catch (error) {
      const kind = classifyError(error);
      feed.restMessage = error.message;
      if (kind === "GLOBAL_LOCK") {
        globalLockMessage = "Twelve Data ถูกจำกัดหรือ API Key ไม่มีสิทธิ์: " + error.message;
        lockFeed(feed, globalLockMessage);
      } else if (kind === "PAIR_UNAVAILABLE") {
        feed.restStatus = error.kind === "INSUFFICIENT_HISTORY" ? "ERROR" : "UNSUPPORTED";
        feed.streamStatus = "UNSUPPORTED";
        lockFeed(feed, error.message);
      } else {
        feed.restStatus = "ERROR";
        lockFeed(feed, "โหลด REST ไม่สำเร็จ: " + error.message);
      }
      console.error("[radar] REST error", symbol, error.message);
    } finally {
      feed.restSyncPromise = null;
      publish();
    }
  })();
  return feed.restSyncPromise;
}

function startRestTimer() {
  if (restTimer) return;
  restTimer = setInterval(() => {
    syncSelected().catch(error => console.error("[radar] REST sync", error.message));
  }, REST_SYNC_SECONDS * 1000);
}

function startSignalTimer() {
  if (signalTimer) clearInterval(signalTimer);
  // Re-evaluate the latest forming M1 candle every second using the existing local WebSocket data.
  // This timer never calls Twelve Data REST; T-10/T-5 gates and the 30-second signal hold remain unchanged.
  let evaluationBusy = false;
  signalTimer = setInterval(async () => {
    if (!monitoring || evaluationBusy) return;
    const feed = feeds.get(selectedSymbol);
    const current = feed?.candles.at(-1);
    if (!current?.live) return;
    const elapsedMs = Date.now() - current.epoch * 1000;
    if (elapsedMs < 0 || elapsedMs > 60000) return;
    evaluationBusy = true;
    try {
      await evaluate(feed);
      dispatchSignalIfReady(feed);
      publish();
    } catch (error) {
      console.error("[radar] timed analysis failed", error.message);
    } finally { evaluationBusy = false; }
  }, LIVE_ANALYSIS_INTERVAL_SECONDS * 1000);
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(async () => {
    if (!monitoring) return;
    const feed = feeds.get(selectedSymbol);
    const retryReason = getStreamRetryReason({
      monitoring, selectedSymbol, feedSymbol: feed?.symbol,
      tickAt: feed?.tickAt, streamStatus: feed?.streamStatus,
      subscribeAt: feed?.subscribeAt, now: Date.now(),
      maxStreamAgeMs: MAX_STREAM_AGE_SECONDS * 1000,
      firstTickTimeoutMs: 25_000
    });
    if (retryReason) {
      retrySelectedStream(feed, retryReason);
    } else if (feed && ["UNSUPPORTED", "ERROR", "TIMEOUT"].includes(feed.streamStatus)) {
      await evaluate(feed);
    }
    publish();
  }, LIVE_PRICE_CHECK_SECONDS * 1000);
}

function retrySelectedStream(feed, reason) {
  if (!monitoring || !feed || selectedSymbol !== feed.symbol) return;
  const socket = upstream;
  upstream = null;
  clearInterval(heartbeatTimer); heartbeatTimer = null;
  if (feed.streamApiKey) {
    twelveDataKeyPool.markFailure(feed.streamApiKey, {
      kind: "TRANSIENT", message: "Streaming feed stalled: " + reason
    });
    feed.streamApiKey = null;
  }
  if (socket && socket.readyState < WebSocket.CLOSING) {
    try { socket.close(); } catch {}
  }
  feed.tickAt = 0;
  feed.lastTick = null;
  feed.activeSignal = null;
  feed.engineActive = { V1: null, BB: null, TREND_RIDER: null };
  feed.activeUntil = 0;
  feed.streamStatus = "TIMEOUT";
  feed.streamMessage = reason === "FIRST_TICK_TIMEOUT"
    ? "สมัคร Streaming แล้วแต่ยังไม่ได้รับ Tick แรก · กำลังสลับ API Key และเชื่อมต่อใหม่"
    : "ราคา Streaming ค้างเกินกำหนด · กำลังสลับ API Key และเชื่อมต่อใหม่";
  console.warn("[radar] Streaming stalled; rotating API key and reconnecting", {
    symbol: feed.symbol, reason
  });
  void evaluate(feed).then(publish).catch(error => console.error("[radar] reconnect analysis failed", error.message));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (monitoring && selectedSymbol === feed.symbol) {
      feed.streamStatus = "WAITING";
      startStream();
    }
  }, 1000);
}

function startStream() {
  if (!monitoring || upstream) return;
  const apiKey = twelveDataKeyPool.getActiveKey();
  if (!apiKey) {
    const feed = feeds.get(selectedSymbol);
    lockFeed(feed, "ยังไม่มี Twelve Data Key ที่พร้อมใช้งานใน Render Environment");
    retryTimer = setTimeout(startStream, Math.min(twelveDataKeyPool.nextAvailableInMs() || 60000, 15 * 60 * 1000));
    return;
  }

  const symbol = selectedSymbol;
  const feed = feeds.get(symbol);
  feed.streamStatus = "SUBSCRIBING";
  feed.subscribeAt = Date.now();
  feed.streamApiKey = apiKey;
  feed.streamMessage = "กำลังสมัครรับราคา Streaming";
  let socket;
  try {
    const url = "wss://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(apiKey);
    socket = new WebSocket(url);
    upstream = socket;
  } catch (error) {
    feed.streamStatus = "ERROR";
    feed.streamMessage = error.message;
    void evaluate(feed).then(publish).catch(error => console.error("[radar] stream analysis failed", error.message));
    retryTimer = setTimeout(startStream, 8000);
    return;
  }

  socket.on("open", () => {
    if (upstream !== socket) return;
    console.info("[radar] Streaming socket opened; subscription sent", { symbol });
    socket.send(JSON.stringify({ action: "subscribe", params: { symbols: symbol } }));
    heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "heartbeat" }));
      }
    }, 10000);
    publish();
  });

  socket.on("message", raw => {
    if (upstream !== socket) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }

    if (message.event === "price" && resolveSymbol(message.symbol) === symbol) {
      const price = Number(message.price);
      const timestamp = Number(message.timestamp);
      if (finite(price) && price > 0 && finite(timestamp) && timestamp > 0) {
        const firstTick = !feed.tickAt;
        twelveDataKeyPool.markSuccess(apiKey);
        if (firstTick) console.info("[radar] First live Streaming tick received", { symbol, price, timestamp });
        applyTick(feed, price, timestamp);
      }
      return;
    }

    if (message.event === "subscribe-status") {
      const status = String(message.status || "").toLowerCase();
      const text = String(message.message || message.code || "");
      const failed = Array.isArray(message.fails) ? message.fails : [];
      const succeeded = Array.isArray(message.success) ? message.success : [];
      const failedSymbol = failed.some(item =>
        resolveSymbol(typeof item === "string" ? item : item?.symbol) === symbol
      );
      if ((failedSymbol || status === "error" || status === "failed") &&
          /401|403|429|quota|credit|rate.?limit|unauthori[sz]ed|api.?key/i.test(text)) {
        const keyError = { kind: /429|quota|credit|rate.?limit/i.test(text) ? "RATE_LIMIT" : "AUTH_OR_PERMISSION", message: text };
        twelveDataKeyPool.markFailure(apiKey, keyError);
        feed.streamStatus = "ERROR";
        feed.streamMessage = "Key ปัจจุบันใช้ Streaming ไม่ได้ — กำลังสลับ Key";
        if (upstream === socket) upstream = null;
        clearInterval(heartbeatTimer); heartbeatTimer = null;
        try { socket.close(); } catch {}
        retryTimer = setTimeout(startStream, 1000);
        void evaluate(feed).then(publish).catch(error => console.error("[radar] key-rotation analysis failed", error.message));
      } else if (failedSymbol || status === "error" || status === "failed") {
        feed.streamStatus = "ERROR";
        feed.streamMessage = text || "Twelve Data ปฏิเสธการสมัคร Streaming";
        twelveDataKeyPool.markFailure(apiKey, { kind: "TRANSIENT", message: text || "Streaming subscription rejected" });
        feed.streamApiKey = null;
        if (upstream === socket) upstream = null;
        clearInterval(heartbeatTimer); heartbeatTimer = null;
        try { socket.close(); } catch {}
        console.warn("[radar] Streaming subscription rejected; trying next API key", {
          symbol, status, message: text, failedCount: failed.length
        });
        void evaluate(feed).then(publish).catch(error => console.error("[radar] subscription analysis failed", error.message));
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (monitoring && selectedSymbol === symbol) startStream();
        }, 1000);
      } else if (status === "success" || succeeded.length) {
        feed.streamStatus = "SUBSCRIBED";
        feed.streamMessage = "สมัครรับ Streaming แล้ว — รอ tick แรก";
        console.info("[radar] Streaming subscription accepted; waiting for first tick", { symbol });
      }
      publish();
      return;
    }

    if (message.status === "error" || message.event === "error") {
      const text = String(message.message || message.code || "Streaming error");
      if (/\b401\b|\b429\b|quota|credit|rate.?limit|unauthori[sz]ed|api.?key/i.test(text)) {
        const keyError = { kind: /429|quota|credit|rate.?limit/i.test(text) ? "RATE_LIMIT" : "AUTH_OR_PERMISSION", message: text };
        twelveDataKeyPool.markFailure(apiKey, keyError);
        globalLockMessage = "Twelve Data Key ปัจจุบันถูกจำกัด — กำลังสลับ Key อัตโนมัติ";
        if (upstream === socket) upstream = null;
        clearInterval(heartbeatTimer); heartbeatTimer = null;
        try { socket.close(); } catch {}
        publish();
        retryTimer = setTimeout(startStream, 1000);
      } else {
        feed.streamStatus = "ERROR";
        feed.streamMessage = text;
        twelveDataKeyPool.markFailure(apiKey, { kind: "TRANSIENT", message: text });
        feed.streamApiKey = null;
        if (upstream === socket) upstream = null;
        clearInterval(heartbeatTimer); heartbeatTimer = null;
        try { socket.close(); } catch {}
        console.warn("[radar] Streaming provider error; retrying with next API key", { symbol, message: text });
        void evaluate(feed).then(publish).catch(error => console.error("[radar] stream analysis failed", error.message));
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (monitoring && selectedSymbol === symbol) startStream();
        }, 1000);
      }
    }
  });

  socket.on("error", error => {
    if (upstream !== socket) return;
    feed.streamStatus = "ERROR";
    feed.streamMessage = error.message;
    twelveDataKeyPool.markFailure(apiKey, { kind: "TRANSIENT", message: error.message });
    upstream = null;
    clearInterval(heartbeatTimer); heartbeatTimer = null;
    try { socket.close(); } catch {}
    feed.activeSignal = null;
    feed.engineActive = { V1: null, BB: null, TREND_RIDER: null };
    feed.activeUntil = 0;
    void evaluate(feed).then(publish).catch(error => console.error("[radar] stream analysis failed", error.message));
    if (monitoring) retryTimer = setTimeout(startStream, 1000);
  });

  socket.on("close", () => {
    if (upstream !== socket) return;
    upstream = null;
    clearInterval(heartbeatTimer); heartbeatTimer = null;
    feed.tickAt = 0;
    feed.activeSignal = null;
    feed.engineActive = { V1: null, BB: null, TREND_RIDER: null };
    feed.activeUntil = 0;
    if (feed.streamStatus !== "UNSUPPORTED") {
      feed.streamStatus = "ERROR";
      feed.streamMessage = "Streaming หลุด — กำลังเชื่อมต่อใหม่";
    }
    void evaluate(feed).then(publish).catch(error => console.error("[radar] close analysis failed", error.message));
    if (monitoring) retryTimer = setTimeout(startStream, 8000);
  });
}

async function start(symbolValue) {
  const symbol = resolveSymbol(symbolValue) || DEFAULT_SYMBOL;
  stop(false);
  selectedSymbol = symbol;
  monitoring = true;
  globalLockMessage = null;
  const feed = feeds.get(symbol);
  feed.tickAt = 0;
  feed.lastTick = null;
  feed.streamApiKey = null;
  feed.streamStatus = "WAITING";
  feed.streamMessage = "รอสมัครรับราคา Streaming";
  feed.dataLocked = false;
  resetSignal(feed, "กำลังเริ่มสแกน " + symbol);
  startRestTimer();
  startWatchdog();
  startSignalTimer();
  publish();
  await syncSelected({ force: true, symbol });
  if (monitoring) startStream();
  publish();
}

async function select(symbolValue) {
  const symbol = resolveSymbol(symbolValue);
  if (!symbol) return false;
  const wasMonitoring = monitoring;
  closeUpstream();
  clearInterval(heartbeatTimer); heartbeatTimer = null;
  clearTimeout(retryTimer); retryTimer = null;
  selectedSymbol = symbol;
  const feed = feeds.get(symbol);
  feed.tickAt = 0;
  feed.lastTick = null;
  feed.streamApiKey = null;
  feed.streamStatus = "WAITING";
  feed.streamMessage = "รอสมัครรับราคา Streaming";
  feed.dataLocked = false;
  resetSignal(feed, "เปลี่ยนคู่เงินเป็น " + symbol);
  publish();
  // Always load the newly selected pair's own REST history, even if monitoring is stopped.
  // When monitoring is active, subscribe to Streaming only after the selected pair's history sync.
  await syncSelected({ force: true, symbol });
  if (wasMonitoring && monitoring) startStream();
  return true;
}

function stop(clearSignal = true) {
  monitoring = false;
  clearTimers();
  closeUpstream();
  const feed = feeds.get(selectedSymbol);
  feed.tickAt = 0;
  feed.lastTick = null;
  feed.streamApiKey = null;
  feed.dataLocked = false;
  if (feed.streamStatus !== "UNSUPPORTED") feed.streamStatus = "WAITING";
  if (clearSignal) resetSignal(feed, "หยุดสแกนแล้ว");
  globalLockMessage = null;
  publish();
}

function finite(value) { return Number.isFinite(value); }

function sessionForRequest(req) {
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.match(/^Bearer\\s+([a-f0-9]{64})$/i)?.[1] || "";
  const session = bearer ? sessions.get(bearer) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(bearer);
    return null;
  }
  return session;
}

function requireDeviceSession(req, res, next) {
  const session = sessionForRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: "อุปกรณ์ยังไม่ได้เชื่อมต่อหรือ Session หมดอายุ กรุณาเชื่อมต่อใหม่" });
  req.deviceId = session.deviceId;
  next();
}

function telegramSessionForRequest(req) {
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const session = /^[a-f0-9]{64}$/i.test(bearer) ? telegramSessions.get(bearer) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    telegramSessions.delete(bearer);
    return null;
  }
  return session;
}

function requireTelegramSession(req, res, next) {
  const session = telegramSessionForRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: "Telegram Mini App session หมดอายุ กรุณาเปิดแอปใหม่" });
  req.telegramUserId = session.userId;
  next();
}

function rateLimitAuth(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (authRequests.get(key) || []).filter(time => now - time < 5 * 60 * 1000);
  if (recent.length >= 30) { res.setHeader("Retry-After", "60"); return res.status(429).json({ ok: false, error: "ยืนยันตัวตนถี่เกินไป กรุณารอสักครู่ 60 วินาที" }); }
  recent.push(now);
  authRequests.set(key, recent);
  next();
}

function rateLimitControl(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (controlRequests.get(key) || []).filter(time => now - time < 60000);
  if (recent.length >= 90) return res.status(429).json({ ok: false, error: "คำสั่งถี่เกินไป กรุณารอสักครู่" });
  recent.push(now);
  controlRequests.set(key, recent);
  next();
}

const allowedOrigins = new Set(["https://ai-signal-radar-main-market.onrender.com"]);
app.use((req, res, next) => {
  res.setHeader("X-System-Name", SYSTEM_NAME);
  res.setHeader("X-System-Architecture", ARCHITECTURE_ID);
  res.setHeader("X-System-Version", VERSION);
  const origin = req.headers.origin;
  const sameOrigin = Boolean(origin && origin === `https://${req.headers.host}`);
  const originAllowed = Boolean(origin && (allowedOrigins.has(origin) || sameOrigin));
  if (originAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(originAllowed ? 204 : 403);
  next();
});
app.use(express.json({ limit: "8kb" }));

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
}
app.get("/api/public/signal", (_req, res) => {
  noCache(res);
  const state = snapshot();
  res.json({
    ok: true,
    service: "main-market",
    updatedAt: new Date().toISOString(),
    market: {
      symbol: state.symbol, signal: state.signal, regime: state.regime,
      reason: state.reason, evidence: state.evidence, metrics: state.metrics,
      score: state.score, strategy: state.strategy, indicators: state.indicators,
      higherTimeframe: state.higherTimeframe || null,
      price: state.lastTickPrice, analyzedAt: state.analyzedAt,
      apiStatus: state.apiStatus, supportStatus: state.supportStatus,
      statusMessage: state.statusMessage, dataMode: state.dataMode,
      ageSeconds: state.ageSeconds, tickAgeSeconds: state.tickAgeSeconds,
      closedCandleCount: state.closedCandleCount, requiredCandles: state.requiredCandles,
      analysisWindow: state.analysisWindow,
      analysisMode: state.analysisMode || "CLOSED_M1_ONLY",
      livePreviewCandleEpoch: state.livePreviewCandleEpoch || null,
      liveAnalysisIntervalSeconds: state.liveAnalysisIntervalSeconds || LIVE_ANALYSIS_INTERVAL_SECONDS,
      nextCandleAt: state.nextCandleAt, signalExpiresAt: state.signalExpiresAt,
      signalTimingWindowSeconds: state.signalTimingWindowSeconds || [5, 3],
      engineResults: state.engineResults || null,
      recovery: state.recovery || null,
      engineSummary: state.engineSummary || null,
      signalReleaseValidated: state.signalReleaseValidated,
      signalReleaseStatus: state.signalReleaseStatus,
      signalValidationNote: state.signalValidationNote,
      lastPrice: state.lastPrice,
      lastTickPrice: state.lastTickPrice,
      monitoring: state.monitoring,
      apiPool: state.apiPool
    }
  });
});
app.post("/api/telegram/session", rateLimitAuth, (req, res) => {
  // Open Mini App access: issue a short-lived server session without requiring Telegram initData or BotFather token.
  // Access control is intentionally left to the app owner.
  const token = randomBytes(32).toString("hex");
  const userId = "open-mini-app";
  telegramSessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  noCache(res);
  console.info("[mini-app] open session created");
  res.json({ ok: true, sessionToken: token, expiresIn: Math.floor(SESSION_TTL_MS / 1000),
    user: { id: userId, firstName: "Guest" } });
});
app.post("/api/telegram/select", requireTelegramSession, rateLimitControl, async (req, res) => {
  const symbol = resolveSymbol(req.body?.symbol);
  if (!symbol) return res.status(400).json({ ok: false, error: "ไม่รองรับคู่เงินนี้", symbols: SYMBOLS });
  try {
    await select(symbol);
    noCache(res);
    res.json({ ok: true, market: snapshot(), channel: "TELEGRAM_MINI_APP_POLLING" });
  } catch (error) {
    console.error("[mini-app] pair selection failed", symbol, error.message);
    res.status(500).json({ ok: false, error: error.message || "เปลี่ยนคู่เงินไม่สำเร็จ" });
  }
});
app.get("/api/telegram/signal", requireTelegramSession, (_req, res) => {
  noCache(res);
  res.json({ ok: true, market: snapshot(), channel: "TELEGRAM_MINI_APP_POLLING" });
});
app.post("/api/telegram/engines", requireTelegramSession, rateLimitControl, async (req, res) => {
  const requested = req.body?.engines;
  if (!requested || typeof requested !== "object" || Array.isArray(requested) ||
      ENGINE_KEYS.some(key => typeof requested[key] !== "boolean")) {
    return res.status(400).json({ ok: false, error: "ต้องระบุสถานะเปิด/ปิดของเครื่องยนต์ทั้ง 4 ตัว" });
  }
  for (const key of ENGINE_KEYS) {
    engineEnabled[key] = requested[key];
    if (!engineEnabled[key] && key !== "ENGINE_4") {
      for (const feed of feeds.values()) {
        if (feed.engineActive) feed.engineActive[key] = null;
      }
    }
  }
  const feed = feeds.get(selectedSymbol);
  if (feed) await evaluate(feed);
  publish();
  noCache(res);
  res.json({ ok: true, engineEnabled: { ...engineEnabled }, market: snapshot() });
});
app.get("/control", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "control.html")); });
app.get("/signal", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "signal.html")); });
app.get("/", (_req, res) => { noCache(res); res.redirect(302, "/signal"); });
app.get("/app.js", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "app.js")); });
app.get("/styles.css", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "styles.css")); });
app.get("/health", (_req, res) => {
  noCache(res);
  res.json({
    ok: true, service: "main-market", systemName: SYSTEM_NAME, version: VERSION,
    symbols: SYMBOLS, interval: INTERVAL,
    authentication: { mode: "OPEN_MINI_APP_SESSION", configured: true },
    architecture: {
      name: SYSTEM_NAME, id: ARCHITECTURE_ID, deploymentModel: "SINGLE_RENDER_SERVICE",
      decisionEngine: "V1_BB_TREND_RIDER_PLUS_ENGINE_4_INDEPENDENT", engines: 4,
      decisionAuthority: "INDEPENDENT_DIRECTIONAL_ANALYSTS_WITH_SHARED_DATA_AND_TIMING_GUARDS",
      bbPureScalper: { period: 20, standardDeviation: 2, role: "INDEPENDENT_SIGNAL_ENGINE", mayCreateSignalAlone: true, entryMode: "EARLY_TOUCH_ONE_SOFT_CUE", wickThreshold: 0.18, conflictPolicy: "SHOW_BOTH_SEPARATELY" },
      safetyLayer: "SYSTEM_DATA_QUALITY_AND_TIMING_GUARDS",
      historicalAnalogueWorker: "BYPASSED",
      trendRider: { independent: true, emaFast: 5, emaTrend: 20, scoreThreshold: 65, minimumClosedCandles: 30, guards: ["SIDEWAYS", "LATE_EXTENSION_1_5_ATR", "ABNORMAL_RANGE_2_8_ATR"] },
      engine4: { independent: true, copiedFrom: null, strategy: "M1_PURE_PRICE_ACTION_INTRABAR_PULLBACK", minimumClosedCandles: 0, cadence: "EVALUATE_CURRENT_M1_TICK_SEQUENCE_AND_DISPATCH_ON_FIRST_OPPOSITE_TICK", input: "TWELVE_DATA_LIVE_M1_TICK_SEQUENCE_ONLY", countWindow: "[0,23)", decisionRule: "UP_MOVE_THEN_FIRST_DOWN_TICK_CALL; DOWN_MOVE_THEN_FIRST_UP_TICK_PUT", previousClosedCandleContext: "NOT_USED", dispatchDeadlineSecondsExclusive: 23, historicalCandlesRequired: false, indicatorsUsed: [], target: "CURRENT_FORMING_M1_CANDLE", oneSignalPerCandle: true, signalHoldSeconds: 30, participatesInAggregate: true, sound: true, vibration: true, alertPipeline: "SHARED_ENGINE_ALERT_PIPELINE", colors: { CALL: "RED", PUT: "GREEN" }, confidenceCalibration: "RULE_BASED_STRENGTH_NOT_CALIBRATED_PROBABILITY" },
      independentEngineToggles: { supported: true, keys: ENGINE_KEYS, disabledMeansAnalysisAndSignalsStopped: true },
      signalDecisionPath: "V1_BB_TREND_RIDER_T5_PLUS_ENGINE_4_LIVE_SINGLE_CANDLE_ANALYSIS"
    },
    analyzer: {
      provider: "LOCAL_V1_BB_TREND_RIDER_PLUS_ENGINE_4", model: null, configured: true,
      role: "THREE_EXISTING_ANALYSTS_PLUS_ONE_INDEPENDENT_EVERY_CANDLE_ANALYST", externalAiCalls: false,
      closedCandlesOnly: false, liveCandlePreview: true,
      liveAnalysisIntervalSeconds: LIVE_ANALYSIS_INTERVAL_SECONDS, localDirectionalFallback: true,
      componentWeights: { ema5SlopeReversal: 30, srFakeout: 30, proximityMomentum: 20, trendContext: 20 },
      bbPureScalper: { period: 20, standardDeviation: 2, independent: true, mayCreateSignalAlone: true, wickThreshold: 0.18, confirmationMode: "ONE_SOFT_CUE" },
      trendRider: { independent: true, emaFast: 5, emaTrend: 20, scoreThreshold: 65, minimumClosedCandles: 30, continuationOnly: true },
      thresholds: { callPut: 55, prepare: 40, standbyBelow: 40 },
      priceActionEvidence: { marketStructure: "BOS_CHOCH_CLOSED_CANDLE_SWINGS", candleConfirmation: "BODY_WICKS_CLOSE_LOCATION", momentumExhaustion: "EMA5_ATR_EXTENSION_BODY_CONTRACTION_DIRECTIONAL_RUN" },
    },
    recovery: {
      enabled: false, mode: "DISABLED", status: "ORIGINAL_INDEPENDENT_ANALYZERS",
      strategy: "EACH_ENGINE_USES_ITS_OWN_ORIGINAL_ANALYZER",
      altersMiniApp: false, badgeText: null, martingale: false,
      independentEngines: ENGINE_KEYS
    },
    configuration: {
      telegramMiniAppAuthConfigured: false,
      miniAppOpenAccess: true,
      androidClientAuthConfigured: Boolean(CLIENT_TOKEN),
      twelveDataApiKey: twelveDataKeyPool.keyCount > 0,
      twelveDataApiPool: twelveDataKeyPool.publicStatus(),
      minimumClosedCandles: MIN_CLOSED_CANDLES,
      historyCandles: HISTORY_CANDLES,
      livePriceCheckSeconds: LIVE_PRICE_CHECK_SECONDS,
      liveAnalysisIntervalSeconds: LIVE_ANALYSIS_INTERVAL_SECONDS,
      estimatedRestCreditsPerDay: Math.ceil(86400 / REST_SYNC_SECONDS),
      restKeyRotation: "ROUND_ROBIN_WITH_FAILOVER",
      contextCandles: 50,
      entryCandles: 4,
      restRefreshSeconds: REST_SYNC_SECONDS,
      streamingRequiredForSignals: true,
      restFallbackEnabled: true,
      signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
      signalRuntimeLock: false,
      signalReleaseStatus: "PARTIAL_SCORING_55_EARLY_ENTRY_MANUAL_ONLY_NOT_OOS_VALIDATED",
      emaTrendFlow: {
        emaFast: 5, emaTrend: 20, emaTrendRole: "CHOPPY_KILL_SWITCH_ONLY",
        touchRule: "PARTIAL_SCORE_WITHIN_0_35_ATR",
        proximityRule: "0_35_ATR_PARTIAL_WEIGHT",
        trendFlowRule: "FOUR_COMPONENT_PARTIAL_SCORING_100_POINT_MODEL",
        directionalSource: "LOCAL_PARTIAL_SCORING_ON_54_CLOSED_M1_PLUS_LIVE_FORMING_CANDLE_PREVIEW",
        externalAi: false,
        componentWeights: { ema5SlopeReversal: 30, srFakeout: 30, proximityMomentum: 20, trendContext: 20 },
        thresholds: { callPut: 55, prepare: 40, standbyBelow: 40 },
        slopeReversal: "GRADUAL_EMA5_SLOPE_PARTIAL_POINTS",
        supportResistanceFakeout: "FULL_POINTS_ONLY_ON_CONFIRMED_SWEEP_CLOSE_RECLAIM",
        sidewayPolicy: "EMA5_EMA20_TANGLED_AND_FLAT_KILL_SWITCH",
        volatilityPolicy: "ABNORMAL_ATR_SPIKE_KILL_SWITCH"
      }
    }
  });
});
app.post("/api/auth", rateLimitAuth, (req, res) => {
  if (!CLIENT_TOKEN) {
    console.error("[auth] blocked: ANDROID_CLIENT_TOKEN is not configured");
    return res.status(503).json({ ok: false, error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่ารหัสเชื่อมต่ออุปกรณ์" });
  }
  if (!validateClientToken(req.body?.clientToken, CLIENT_TOKEN)) {
    console.warn("[auth] rejected Android client credential");
    return res.status(401).json({ ok: false, error: "รหัสเชื่อมต่ออุปกรณ์ไม่ถูกต้อง" });
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { deviceId: "android-client", expiresAt });
  noCache(res);
  console.info("[auth] Android client session created");
  res.json({ ok: true, sessionToken: token, expiresIn: Math.floor(SESSION_TTL_MS / 1000) });
});
app.get("/api/state", requireDeviceSession, (_req, res) => { noCache(res); res.json(snapshot()); });
app.post("/api/control", requireDeviceSession, rateLimitControl, async (req, res) => {
  const body = req.body || {};
  try {
    if (body.action === "start") {
      console.info("[radar] start requested", resolveSymbol(body.symbol || body.symbols?.[0] || DEFAULT_SYMBOL) || DEFAULT_SYMBOL);
      await start(body.symbol || body.symbols?.[0] || DEFAULT_SYMBOL);
    } else if (body.action === "select") {
      if (!await select(body.symbol)) return res.status(400).json({ ok: false, error: "ไม่รองรับคู่เงินนี้" });
    } else if (body.action === "heartbeat") {
    } else if (body.action === "stop") stop();
    else return res.status(400).json({ ok: false, error: "ไม่รองรับคำสั่งนี้" });
    noCache(res);
    res.json({ ok: true, state: snapshot() });
  } catch (error) {
    console.error("[radar] control action failed", error);
    res.status(500).json({ ok: false, error: error.message || "คำสั่งไม่สำเร็จ" });
  }
});

server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin) && origin !== `https://${req.headers.host}`) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname !== "/live") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const session = sessionForRequest(req);
  if (!session) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, client => {
    wss.emit("connection", client, req);
  });
});

wss.on("connection", socket => {
  socket.send(JSON.stringify({ type: "market_state", data: snapshot() }));
  socket.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
  });
  socket.on("close", () => {});
});

server.listen(PORT, () => {
  console.log(`[${SYSTEM_NAME}] MAIN MARKET v2 listening on ${PORT}`);
  console.info("[radar] Android client credential configured", Boolean(CLIENT_TOKEN));
  console.info("[radar] startup configuration", {
    androidClientAuthConfigured: Boolean(CLIENT_TOKEN),
    twelveDataApiKeysConfigured: twelveDataKeyPool.keyCount > 0,
    twelveDataApiKeyCount: twelveDataKeyPool.keyCount,
    miniAppOpenAccess: true,
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    autoStartMonitoring: process.env.AUTO_START_MONITORING !== "false",
    minimumClosedCandles: MIN_CLOSED_CANDLES,
    historyCandles: HISTORY_CANDLES,
    restRefreshSeconds: REST_SYNC_SECONDS
  });
  if (process.env.AUTO_START_MONITORING !== "false") {
    setTimeout(() => {
      start(DEFAULT_SYMBOL).catch(error => console.error("[radar] startup scanner failed", error.message));
    }, 1000);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
  for (const [token, session] of telegramSessions) {
    if (session.expiresAt <= now) telegramSessions.delete(token);
  }
}, 5 * 60 * 1000).unref();
