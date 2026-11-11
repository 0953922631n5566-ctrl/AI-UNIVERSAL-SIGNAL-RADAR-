import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { validateClientToken } from "./src/client-auth.js";
import { fetchCandles } from "./src/twelve-data.js";
import { getStreamRetryReason } from "./src/stream-retry.js";
import { twelveDataKeyPool } from "./src/twelve-data-pool.js";
import { analyzeMarket } from "./src/analyzer.js";
import { detectReversalRadar } from "./src/accuracy-lab/reversal-radar.js";
import { applySignalReleaseGate, SIGNAL_RELEASE_VALIDATED } from "./src/signal-release-gate.js";
import { canFinalizeSignal, isPrepareAlertWindow, isSignalFinalizeWindow, signalHoldExpiresAt } from "./src/signal-timing.js";
import { createRecoveryState, inspectRecoveryWindow, markRecoveryAttempt, settleRecoveryAttempt, armRecoveryAfterLoss, evaluateM1Outcome } from "./src/recovery.js";
import {
  SYMBOLS, DEFAULT_SYMBOL, INTERVAL, MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES,
  REST_SYNC_SECONDS, LIVE_PRICE_CHECK_SECONDS, MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS,
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
const SYSTEM_NAME = "PARTIAL SCORING 65 AGILE ANALYZER";
const ARCHITECTURE_ID = "PARTIAL-SCORING-65-45-CHOPPY-ATR-KILL-SWITCH";
const VERSION = "2026-11-11-streaming-reconnect-v1";
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function newFeed(symbol) {
  return {
    symbol, candles: [], lastTick: null, tickAt: 0, streamApiKey: null, subscribeAt: 0,
    restStatus: "NOT_CHECKED", restMessage: "ยังไม่ได้ตรวจสอบ REST",
    streamStatus: "WAITING", streamMessage: "รอเชื่อมต่อ Streaming",
    lastRestSyncAt: 0, restSyncPromise: null,
    analysis: standby("กดเริ่มสแกนเพื่อเชื่อมต่อข้อมูล"),
    reversalRadar: null,
    activeSignal: null, activeUntil: 0, signalCandle: null,
    signalSourceCandle: null, signalTriggeredAt: 0, preAlertStatus: null,
    lastPrepareLoggedCandle: null, lastFinalizeLoggedCandle: null,
    preAlertSignal: null, preAlertCandle: null,
    alertId: null, dataLocked: false,
    pendingForecast: null, forecastHistory: [], recoveryState: createRecoveryState(),
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
    signalExpiresAt: feed.activeSignal
      ? new Date(feed.activeUntil).toISOString() : null,
    alertId: feed.alertId,
    forecastStats: forecastStats(feed),
    recovery: {
      mode: feed.pendingForecast?.mode === "RECOVERY_ACTIVE" ? "RECOVERY_ACTIVE"
        : feed.recoveryState.status === "ARMED" ? "ARMED" : feed.recoveryState.status,
      lastOutcome: feed.recoveryState.lastOutcome,
      maxAttemptsPerLoss: 1, martingale: false
    },
    preAlertSignal: feed.preAlertSignal,
    reversalRadar: feed.reversalRadar,
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
    signalReleaseStatus: "PARTIAL_SCORING_65_AGILE_MANUAL_ONLY_NOT_OOS_VALIDATED",
    apiPool: twelveDataKeyPool.publicStatus(),
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
 const recoveryWindow = inspectRecoveryWindow(feed.recoveryState, sourceCandleEpoch);
 feed.recoveryState = recoveryWindow.state;
 const restFallback = feed.restStatus === "READY" &&
   (!feed.tickAt || tickAge === null || tickAge > MAX_STREAM_AGE_SECONDS);
 // Gemini is the sole directional analyst; EMA5 and reversal stages are deterministic guard context.
 const rawResult = await analyzeMarket(feed.candles, {
   now, symbol: feed.symbol, tickAgeSeconds: tickAge, allowRestFallback: restFallback
 });
 const result = applySignalReleaseGate(rawResult);
 // Shadow-only diagnostic: closed M1 candles only; never mutates result or signal timing.
 feed.reversalRadar = detectReversalRadar(feed.candles.filter(candle => candle && candle.live !== true).slice(-50));


 if (feed.activeSignal && now >= feed.activeUntil) {
   feed.activeSignal = null;
   feed.activeUntil = 0;
   feed.signalCandle = null;
   feed.signalSourceCandle = null;
   feed.signalTriggeredAt = 0;
   feed.alertId = null;
 }
 const activeForCurrentOrNext = Boolean(feed.activeSignal && now < feed.activeUntil &&
   (feed.signalCandle === sourceCandleEpoch || feed.signalCandle === targetCandleEpoch));

 feed.preAlertStatus = !activeForCurrentOrNext && sourceCandleEpoch !== null &&
   ["PREPARE","CALL","PUT"].includes(result.signal) && isPrepareAlertWindow(sourceCandleEpoch, now) ? "PREPARE_ALERT" : null;
 feed.preAlertCandle = feed.preAlertStatus ? targetCandleEpoch : null;
 feed.preAlertSignal = null;

 if (feed.preAlertStatus === "PREPARE_ALERT" &&
     feed.lastPrepareLoggedCandle !== sourceCandleEpoch) {
   feed.lastPrepareLoggedCandle = sourceCandleEpoch;
   console.info("[timing] T-10 PREPARE window entered", {
     symbol: feed.symbol, sourceCandleEpoch, targetCandleEpoch,
     secondsBeforeClose: ((sourceCandleEpoch + 60) * 1000 - now) / 1000,
     directionalSignal: null, preAlertStatus: "PREPARE_ALERT"
   });
 }
 const finalizeWindow = sourceCandleEpoch !== null &&
   isSignalFinalizeWindow(sourceCandleEpoch, now);
 const finalizeEligible = finalizeWindow &&
   (result.signal === "CALL" || result.signal === "PUT") &&
   canFinalizeSignal({ candleEpoch: sourceCandleEpoch, tickAt: feed.tickAt, now,
     lastDispatchedCandle: feed.lastDispatchedCandle });
 if (finalizeWindow && feed.lastFinalizeLoggedCandle !== sourceCandleEpoch) {
   feed.lastFinalizeLoggedCandle = sourceCandleEpoch;
   console.info("[timing] T-5 FINALIZE window entered", {
     symbol: feed.symbol, sourceCandleEpoch, targetCandleEpoch,
     candidateSignal: result.signal, eligible: finalizeEligible,
     tickAgeSeconds: tickAge, requiredMaxTickAgeSeconds: 5,
     reason: finalizeEligible ? "FRESH_TICK_AND_DIRECTION_READY"
       : tickAge === null || tickAge > 5 ? "STREAMING_TICK_STALE_OR_MISSING"
       : result.signal === "STANDBY" ? "EMA_TREND_FLOW_RETURNED_STANDBY"
       : "CANDLE_ALREADY_FINALIZED"
   });
 }

 if (activeForCurrentOrNext) {
   result.signal = feed.activeSignal;
   result.reason = "สัญญาณสำหรับแท่ง M1 เป้าหมาย · คงสถานะถึง 30 วินาทีหลังแท่งใหม่เปิด";
 } else if (finalizeWindow &&
     (result.signal === "CALL" || result.signal === "PUT")) {
   const canFinalize = canFinalizeSignal({
     candleEpoch: sourceCandleEpoch, tickAt: feed.tickAt, now,
     lastDispatchedCandle: feed.lastDispatchedCandle
   });
   if (canFinalize) {
     feed.activeSignal = result.signal;
     feed.signalCandle = targetCandleEpoch;
     feed.signalSourceCandle = sourceCandleEpoch;
     feed.signalTriggeredAt = now;
     feed.activeUntil = signalHoldExpiresAt(targetCandleEpoch);
     feed.alertId = `${targetCandleEpoch}:${result.signal}`;
     feed.pendingForecast = {
       alertId: feed.alertId, symbol: feed.symbol, signal: result.signal,
       targetCandleEpoch, signalAt: now, entryAt: null, entryPrice: null,
       mode: recoveryWindow.mode, entryPriceBasis: "TARGET_M1_CANDLE_OPEN"
     };
     if (recoveryWindow.mode === "RECOVERY_ACTIVE") {
       feed.recoveryState = markRecoveryAttempt(feed.recoveryState, feed.pendingForecast);
       console.info("[recovery] active_attempt", {
         symbol: feed.symbol, alertId: feed.alertId, signal: result.signal,
         targetCandleEpoch, score: result.score ?? null,
         mode: "ACTIVE_EXISTING_SIGNAL_FLOW_ONLY_NO_EXTRA_SIGNAL_OR_UI_CHANGE"
       });
     }
     result.reason = "ยืนยันสัญญาณ T-5 สำหรับเข้าแท่ง M1 ถัดไป";
   } else {
     result.signal = "STANDBY";
     result.reason = tickAge === null || tickAge > 5
       ? "ไม่ยืนยันสัญญาณ: ราคา Streaming ต้องสดไม่เกิน 5 วินาทีในช่วง T-5"
       : "ข้ามสัญญาณ: แท่งนี้ผ่านการยืนยันไปแล้ว";
   }
 } else if (feed.activeSignal && now < feed.activeUntil) {
   result.signal = "STANDBY";
   result.reason = "รอแท่ง M1 เป้าหมาย";
 } else if (feed.preAlertStatus === "PREPARE_ALERT") {
   result.signal = "STANDBY";
   result.reason = "PREPARE_ALERT · เฝ้าระวัง ไม่แสดงทิศทางก่อน T-5";
 } else {
   result.signal = "STANDBY";
   if (sourceCandleEpoch !== null && now < sourceCandleEpoch * 1000 + 50_000) {
     result.reason = "รอช่วง PREPARE T-10 และยืนยัน CALL/PUT ที่ T-5";
   } else if (sourceCandleEpoch !== null && now >= sourceCandleEpoch * 1000 + 60_000) {
     result.reason = "รอแท่ง M1 ใหม่และข้อมูล Streaming";
   }
 }

 feed.analysis = {
   ...result,
   preAlertStatus: feed.preAlertStatus,
   preAlertCandle: feed.preAlertCandle,
   tickAgeSeconds: tickAge === null ? null : Math.round(tickAge),
   lastTickPrice: feed.lastTick,
   alertId: feed.alertId,
   signalTriggeredAt: feed.signalTriggeredAt ? new Date(feed.signalTriggeredAt).toISOString() : null,
   signalExpiresAt: feed.activeSignal ? new Date(feed.activeUntil).toISOString() : null,
   signalTargetCandleAt: feed.signalCandle ? new Date(feed.signalCandle * 1000).toISOString() : null,
   signalTimingWindowSeconds: [5, 0]
 };
}

function dispatchSignalIfReady(feed) {
 const signal = feed.activeSignal;
 const sourceCandleEpoch = feed.signalSourceCandle;
 if (!signal || !["CALL", "PUT"].includes(signal) || !feed.alertId ||
     !Number.isFinite(sourceCandleEpoch)) return;
 const now = Date.now();
 if (!canFinalizeSignal({
   candleEpoch: sourceCandleEpoch, tickAt: feed.tickAt, now,
   lastDispatchedCandle: feed.lastDispatchedCandle
 })) return;
 if (feed.lastDispatchedAlertId === feed.alertId) return;

 feed.lastDispatchedAt = now;
 feed.lastDispatchedCandle = sourceCandleEpoch;
 feed.lastDispatchedAlertId = feed.alertId;
 console.info("[signal] T-5 next-candle signal is available to authenticated Telegram Mini App polling", {
   alertId: feed.alertId, signal, sourceCandleEpoch,
   targetCandleEpoch: feed.signalCandle,
   secondsBeforeClose: ((sourceCandleEpoch + 60) * 1000 - now) / 1000,
   expiresAt: new Date(feed.activeUntil).toISOString()
 });
}

function applyTick(feed, price, epoch) {
  const minute = Math.floor(epoch / 60) * 60;
  const current = feed.candles.at(-1);
  if (!current || current.epoch < minute) {
    if (current) {
      current.live = false;
      const pending = feed.pendingForecast;
      if (pending && pending.targetCandleEpoch === current.epoch) {
        const evaluated = evaluateM1Outcome(pending.signal, current);
        const record = {
          ...pending,
          entryAt: current.epoch * 1000,
          entryPrice: evaluated.entryPrice,
          exitAt: Date.now(),
          exitPrice: evaluated.exitPrice,
          outcome: evaluated.outcome,
          outcomeReason: evaluated.reason,
          entryPriceBasis: "TWELVE_DATA_STREAM_M1_OPEN",
          exitPriceBasis: "TWELVE_DATA_STREAM_M1_CLOSE",
          priceChange: Number.isFinite(evaluated.entryPrice) && Number.isFinite(evaluated.exitPrice)
            ? evaluated.exitPrice - evaluated.entryPrice : null
        };
        feed.forecastHistory.push(record);
        feed.forecastHistory = feed.forecastHistory.slice(-100);
        feed.pendingForecast = null;
        if (pending.mode === "RECOVERY_ACTIVE") {
          feed.recoveryState = settleRecoveryAttempt(feed.recoveryState, record);
          console.info("[recovery] active_result", {
            symbol: feed.symbol, alertId: pending.alertId, outcome: record.outcome,
            recoveryState: feed.recoveryState.status,
            note: "ACTIVE_NO_MARTINGALE_NO_EXTRA_SIGNAL"
          });
        } else if (record.outcome === "LOSS") {
          feed.recoveryState = armRecoveryAfterLoss(feed.recoveryState, record);
          console.info("[recovery] armed", {
            symbol: feed.symbol, lossAlertId: pending.alertId,
            armedUntilCandleEpoch: feed.recoveryState.expiresAtCandleEpoch,
            maxAttempts: 1
          });
        }
        console.info("[forecast] next-M1 open-to-close result", record);
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

  feed.lastTick = price;
  feed.tickAt = Date.now();
  feed.streamStatus = "READY";
  feed.streamMessage = "ได้รับราคา Streaming สด";
  feed.dataLocked = false;
  globalLockMessage = null;
  void evaluate(feed).then(publish).catch(error => console.error("[radar] tick analysis failed", error.message));
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
  // Re-evaluate during the full newly opened target M1 candle.
  // The direction uses only the latest fully closed M1 candle.
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
  }, 250);
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
      nextCandleAt: state.nextCandleAt, signalExpiresAt: state.signalExpiresAt,
      signalTimingWindowSeconds: state.signalTimingWindowSeconds || [5, 3],
      engineResults: state.engineResults || null,
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
      decisionEngine: "PARTIAL_SCORING_65_AGILE", engines: 1,
      decisionAuthority: "DETERMINISTIC_PARTIAL_SCORING_WITH_CHOPPY_AND_ATR_KILL_SWITCHES",
      safetyLayer: "SYSTEM_DATA_QUALITY_AND_TIMING_GUARDS",
      historicalAnalogueWorker: "BYPASSED",
      signalDecisionPath: "SOURCE_GATE_TO_PARTIAL_SCORING_65_45_TO_CHOPPY_ATR_KILL_SWITCH_TO_TIMING_GUARD"
    },
    analyzer: {
      provider: "LOCAL_PARTIAL_SCORING", model: null, configured: true,
      role: "SOLE_DETERMINISTIC_DIRECTIONAL_ANALYST", externalAiCalls: false,
      closedCandlesOnly: true, localDirectionalFallback: true,
      componentWeights: { ema5SlopeReversal: 30, srFakeout: 30, proximityMomentum: 20, trendContext: 20 },
      thresholds: { callPut: 65, prepare: 45, standbyBelow: 45 }
    },
    recovery: {
      enabled: true, mode: "ACTIVE", status: "LIVE_BACKEND_ONLY",
      resultBasis: "TARGET_M1_CANDLE_OPEN_TO_CLOSE", expiryMinutes: 1,
      minimumSignalScore: 65, maxAttemptsPerLoss: 1, maxWaitCandles: 3,
      martingale: false, altersMiniApp: false, emitsAdditionalSignals: false,
      usesExistingSignalPipeline: true,
      stateStorage: "IN_MEMORY_PER_PAIR_RESETS_ON_PROCESS_RESTART"
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
      estimatedRestCreditsPerDay: Math.ceil(86400 / REST_SYNC_SECONDS),
      restKeyRotation: "ROUND_ROBIN_WITH_FAILOVER",
      contextCandles: 50,
      entryCandles: 4,
      restRefreshSeconds: REST_SYNC_SECONDS,
      streamingRequiredForSignals: true,
      restFallbackEnabled: true,
      signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
      signalRuntimeLock: false,
      signalReleaseStatus: "PARTIAL_SCORING_65_AGILE_MANUAL_ONLY_NOT_OOS_VALIDATED",
      emaTrendFlow: {
        emaFast: 5, emaTrend: 20, emaTrendRole: "CHOPPY_KILL_SWITCH_ONLY",
        touchRule: "PARTIAL_SCORE_WITHIN_0_35_ATR",
        proximityRule: "0_35_ATR_PARTIAL_WEIGHT",
        trendFlowRule: "FOUR_COMPONENT_PARTIAL_SCORING_100_POINT_MODEL",
        directionalSource: "LOCAL_PARTIAL_SCORING_ON_CLOSED_M1_CANDLES_ONLY",
        externalAi: false,
        componentWeights: { ema5SlopeReversal: 30, srFakeout: 30, proximityMomentum: 20, trendContext: 20 },
        thresholds: { callPut: 65, prepare: 45, standbyBelow: 45 },
        slopeReversal: "GRADUAL_EMA5_SLOPE_PARTIAL_POINTS",
        supportResistanceFakeout: "PARTIAL_SWEEP_WICK_REJECTION_AND_RECLAIM_POINTS",
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
