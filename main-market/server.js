import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import { fetchCandles } from "./src/twelve-data.js";
import { getStreamRetryReason } from "./src/stream-retry.js";
import { twelveDataKeyPool } from "./src/twelve-data-pool.js";
import { analyzeCandleLines } from "./src/custom-candle-lines-engine.js";
const SIGNAL_RELEASE_VALIDATED = false;

import {
  SYMBOLS, DEFAULT_SYMBOL, INTERVAL, MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES,
  REST_SYNC_SECONDS, LIVE_PRICE_CHECK_SECONDS, MAX_STREAM_AGE_SECONDS,
  resolveSymbol
} from "./src/config.js";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// TELEGRAM_BOT_TOKEN is intentionally optional; open Mini App sessions do not validate Telegram initData.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const telegramSessions = new Map();
const authRequests = new Map();
const SYSTEM_NAME = "EURUSD CUSTOM CANDLE LINES M1 SIGNAL RADAR";
const ARCHITECTURE_ID = "EURUSD_CUSTOM_CANDLE_LINES_M1";
const VERSION = "2026-11-27-custom-candle-lines-no-indicators-watch10-order30-v1";
const app = express();
const server = http.createServer(app);

function newFeed(symbol) {
  return {
    symbol, candles: [], lastTick: null, tickAt: 0, streamApiKey: null, subscribeAt: 0,
    restStatus: "NOT_CHECKED", restMessage: "ยังไม่ได้ตรวจสอบ REST",
    streamStatus: "WAITING", streamMessage: "รอเชื่อมต่อ Streaming",
    lastRestSyncAt: 0, restSyncPromise: null,
    analysis: standby("กดเริ่มสแกนเพื่อเชื่อมต่อข้อมูล"),
    activeSignal: null, activeUntil: 0, pendingSignal: null, signalCandle: null,
    signalSourceCandle: null, signalTriggeredAt: 0, preAlertStatus: null,
    lastPrepareLoggedCandle: null, lastFinalizeLoggedCandle: null, lastDiagnosticLoggedCandle: null,
    preAlertSignal: null, preAlertCandle: null,
    alertId: null, dataLocked: false,
    engine3Indicators: { status: "WAITING", ema5: [], ema20: [], atr14: [], receivedAt: 0, lastFetchedMinute: null, nextAttemptAt: null, lastError: null, message: "รอ EMA5 / EMA20 / ATR14 จาก Twelve Data" },
    engine3IndicatorsPromise: null,
    engineActive: { TREND_RIDER: null },
    engineLastDispatchedCandle: { TREND_RIDER: null },
    engineLastDispatchedAlertId: { TREND_RIDER: null },
    lastDispatchedAt: 0, lastDispatchedCandle: null, lastDispatchedAlertId: null,
    nextEngine: { activeSignal: null, activeUntil: 0, sourceEpoch: null, targetEpoch: null, alertId: null, lastSignalSourceEpoch: null },
    candleLineState: { phase:"WAIT", minuteEpoch:null, signal:"WAIT", reason:"รอเริ่มสแกน", watchSignal:null, watchReason:null, watchUntil:0, orderSignal:null, orderUntil:0, orderAlertId:null, orderTargetEpoch:null, lastWatchMinuteEpoch:null, lastOrderMinuteEpoch:null, sampledAt:null, lastAnalysis:null }
  };
}


const feeds = new Map(SYMBOLS.map(symbol => [symbol, newFeed(symbol)]));
let selectedSymbol = DEFAULT_SYMBOL;
let monitoring = false;
let monitoringStartedAt = 0;
let upstream = null;
let candleLineTimer = null;
let watchdogTimer = null;
let retryTimer = null;
let heartbeatTimer = null;
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


function publicFeed(feed) {
  const status = feedStatus(feed);
  const tickAge = feed.tickAt ? Math.max(0, (Date.now() - feed.tickAt) / 1000) : null;
  const analysis = feed.analysis || standby("รอข้อมูล");
  const lineState = feed.candleLineState || {};
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
    signal: lineState.orderUntil > Date.now() && ["CALL","PUT"].includes(lineState.orderSignal) ? lineState.orderSignal : "STANDBY",
    direction: lineState.orderUntil > Date.now() && ["CALL","PUT"].includes(lineState.orderSignal) ? lineState.orderSignal : null,
    reason: lineState.reason || analysis.reason,
    phase: lineState.phase || "WAIT",
    watchSignal: lineState.watchUntil > Date.now() ? lineState.watchSignal : null,
    watchReason: lineState.watchReason || null,
    watchActive: lineState.watchUntil > Date.now() && ["CALL","PUT"].includes(lineState.watchSignal),
    orderSignal: lineState.orderUntil > Date.now() ? lineState.orderSignal : null,
    orderActive: lineState.orderUntil > Date.now() && ["CALL","PUT"].includes(lineState.orderSignal),
    orderAlertId: lineState.orderAlertId || null,
    orderExpiresAt: lineState.orderUntil > Date.now() ? new Date(lineState.orderUntil).toISOString() : null,
    sourceCandleEpoch: lineState.minuteEpoch ?? null,
    targetCandleEpoch: lineState.orderTargetEpoch ?? null,
    analysisMode: "EURUSD_CUSTOM_CANDLE_LINES_M1",
    indicatorSource: "NONE · Twelve Data real M1 OHLC + custom candle geometry lines",
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
    candles: feed.candles.filter(candle => candle).slice(-MAX_CANDLES),
    candleCount: feed.candles.length,
    closedCandleCount: Math.min(feed.candles.filter(c => !c.live).length, MIN_CLOSED_CANDLES),
    requiredCandles: MIN_CLOSED_CANDLES,
    analysisWindow: { historyCandles: HISTORY_CANDLES, lineModel: "CUSTOM_CANDLE_GEOMETRY", indicators: [] },
    ema5: lineState.lastAnalysis?.ema5 ?? null, ema5SlopePips: lineState.lastAnalysis?.ema5SlopePips ?? null,
    rsi14: lineState.lastAnalysis?.rsi14 ?? null, previousRsi14: lineState.lastAnalysis?.previousRsi14 ?? null, rsiSignal: lineState.lastAnalysis?.rsiSignal ?? "WAIT",
    score: lineState.lastAnalysis?.score ?? 0, callScore: lineState.lastAnalysis?.callScore ?? 0, putScore: lineState.lastAnalysis?.putScore ?? 0, scoreThreshold: 80, regime: lineState.lastAnalysis?.regime ?? null,
    nextCandleAt: feed.candles.length
      ? (feed.candles.at(-1).live
        ? feed.candles.at(-1).epoch + 60
        : Math.max(feed.candles.at(-1).epoch + 60, Math.floor(Date.now() / 60000) * 60 + 60)) * 1000
      : null,
    signalExpiresAt: lineState.orderUntil > Date.now() ? new Date(lineState.orderUntil).toISOString() : null,
    alertId: lineState.orderAlertId || null,
    preAlertSignal: lineState.watchUntil > Date.now() ? lineState.watchSignal : null,
    preAlertStatus: lineState.watchUntil > Date.now() && ["CALL","PUT"].includes(lineState.watchSignal) ? "PREPARE_ALERT" : null,
    indicators: { status: lineState.lastAnalysis ? "READY" : "WAITING", lines: lineState.lastAnalysis?.lines ?? null, lineEvents: lineState.lastAnalysis?.lineEvents ?? null, candleShape: lineState.lastAnalysis?.candleShape ?? null, score: lineState.lastAnalysis?.score ?? 0, callScore: lineState.lastAnalysis?.callScore ?? 0, putScore: lineState.lastAnalysis?.putScore ?? 0, threshold: 80, message: "รอ OHLC จาก Twelve Data เพื่อคำนวณเส้นดักจับแท่งเทียนแบบกำหนดเอง" },
    source: "Twelve Data real M1 OHLC + custom candle lines · 10s watch / 5s order / 30s lamp"
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
    signalReleaseStatus: "EURUSD_CUSTOM_CANDLE_LINES_M1_MANUAL_ONLY_NOT_OOS_VALIDATED",
    apiPool: twelveDataKeyPool.publicStatus(),
  };
}

function publish() {
  // Telegram Mini App uses authenticated HTTP polling; there is no browser WebSocket server.
}

function clearTimers() {
  clearInterval(candleLineTimer); candleLineTimer = null;
  clearInterval(watchdogTimer); watchdogTimer = null;
  clearInterval(heartbeatTimer); heartbeatTimer = null;
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
  feed.pendingSignal = null;
  feed.engineActive = { TREND_RIDER: null };
  feed.engineLastDispatchedCandle = { TREND_RIDER: null };
  feed.engineLastDispatchedAlertId = { TREND_RIDER: null };
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
  feed.pendingSignal = null;
  feed.activeSignal = null;
  feed.engineActive = { TREND_RIDER: null };
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

async function evaluate(feed) { return feed.candleLineState; }

function applyTick(feed, price, epoch) {
  const minute = Math.floor(epoch / 60) * 60;
  const current = feed.candles.at(-1);
  if (!current || current.epoch < minute) {
    if (current) current.live = false;
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
  scheduleLiveAnalysis(feed);
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
      // EMA5 score checks run from local Twelve Data M1 candles; no extra REST polling.
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

function scheduleLiveAnalysis(_feed) {
  // Disabled: MA5 + BB(20,2) checks run from live Twelve Data M1 candles.
}

function resetCandleLineState(feed, reason = "รอเริ่มสแกน") {
  feed.candleLineState = {
    phase: "WAIT", minuteEpoch: null, signal: "WAIT", reason,
    watchSignal: null, watchReason: null, watchUntil: 0,
    orderSignal: null, orderUntil: 0, orderAlertId: null, orderTargetEpoch: null,
    lastWatchMinuteEpoch: null, lastOrderMinuteEpoch: null,
    sampledAt: null, lastAnalysis: null
  };
}
function runCandleLineCheck(feed, minuteEpoch, phase) {
  const state = feed.candleLineState;
  const now = Date.now();
  const live = feed.candles.at(-1)?.live && feed.candles.at(-1).epoch === minuteEpoch
    ? feed.candles.at(-1) : null;
  const tickAge = feed.tickAt ? (now - feed.tickAt) / 1000 : null;
  const result = analyzeCandleLines({
    symbol: feed.symbol,
    closedCandles: feed.candles.filter(c => c && !c.live),
    liveCandle: live,
    tickAgeSeconds: tickAge
  });
  state.lastAnalysis = result;
  state.minuteEpoch = minuteEpoch;
  state.sampledAt = new Date().toISOString();
  if (phase === "WATCH") {
    state.lastWatchMinuteEpoch = minuteEpoch;
    state.watchSignal = ["CALL", "PUT"].includes(result.signal) ? result.signal : null;
    state.watchReason = result.reason;
    state.watchUntil = state.watchSignal ? (minuteEpoch + 60) * 1000 : 0;
    state.phase = state.watchSignal ? "WATCH" : "WAIT";
    state.signal = "WAIT";
    state.reason = state.watchSignal
      ? `เฝ้าระวัง ${state.watchSignal} · เหลือ 10 วินาทีสุดท้าย รอยืนยัน ORDER ที่ 5 วินาที`
      : result.reason;
    console.info("[candle-lines] WATCH", { symbol: feed.symbol, minuteEpoch, signal: state.watchSignal, reason: result.reason });
    return;
  }
  if (phase === "ORDER") {
    state.lastOrderMinuteEpoch = minuteEpoch;
    state.watchSignal = null;
    state.watchUntil = 0;
    state.orderTargetEpoch = minuteEpoch + 60;
    if (["CALL", "PUT"].includes(result.signal) && live && tickAge !== null && tickAge <= 5) {
      state.orderSignal = result.signal;
      state.orderUntil = now + 30000;
      state.orderAlertId = `${minuteEpoch}:${result.signal}:ORDER:EMA5_SCORE_80`;
      state.phase = "ORDER";
      state.signal = result.signal;
      state.reason = `ORDER ${result.signal} · ยืนยันเงื่อนไข ณ 5 วินาทีสุดท้าย · ไฟค้าง 30 วินาที`;
      console.info("[candle-lines] ORDER", { symbol: feed.symbol, minuteEpoch, signal: result.signal, orderAlertId: state.orderAlertId, reason: result.reason });
    } else {
      state.orderSignal = null;
      state.orderUntil = 0;
      state.phase = "WAIT";
      state.signal = "WAIT";
      state.reason = result.reason || "ไม่ผ่านเงื่อนไขยืนยัน ORDER";
      console.info("[candle-lines] ORDER skipped", { symbol: feed.symbol, minuteEpoch, reason: result.reason });
    }
  }
}
function tickCandleLineClock() {
  if (!monitoring) return;
  const feed = feeds.get(selectedSymbol);
  if (!feed) return;
  const now = Date.now();
  const minute = Math.floor(now / 60000) * 60;
  const second = Math.floor(now / 1000) % 60;
  const state = feed.candleLineState;
  if (state.orderUntil && now >= state.orderUntil) {
    state.orderSignal = null;
    state.orderUntil = 0;
    state.phase = "WAIT";
    state.signal = "WAIT";
    state.reason = "หมดเวลาแสดงไฟ ORDER 30 วินาที · รอรอบถัดไป";
    publish();
  }
  if (second >= 50 && second < 55 && state.lastWatchMinuteEpoch !== minute) {
    runCandleLineCheck(feed, minute, "WATCH");
    publish();
  } else if (second >= 55 && state.lastOrderMinuteEpoch !== minute) {
    runCandleLineCheck(feed, minute, "ORDER");
    publish();
  }
}
function startCandleLineSampler(){clearInterval(candleLineTimer);candleLineTimer=setInterval(tickCandleLineClock,200);tickCandleLineClock();}

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
  feed.pendingSignal = null;
  feed.activeSignal = null;
  feed.engineActive = { TREND_RIDER: null };
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
    feed.pendingSignal = null;
    feed.activeSignal = null;
    feed.engineActive = { TREND_RIDER: null };
    feed.activeUntil = 0;
    void evaluate(feed).then(publish).catch(error => console.error("[radar] stream analysis failed", error.message));
    if (monitoring) retryTimer = setTimeout(startStream, 1000);
  });

  socket.on("close", () => {
    if (upstream !== socket) return;
    upstream = null;
    clearInterval(heartbeatTimer); heartbeatTimer = null;
    feed.tickAt = 0;
    feed.pendingSignal = null;
    feed.activeSignal = null;
    feed.engineActive = { TREND_RIDER: null };
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
  monitoringStartedAt = Date.now();
  globalLockMessage = null;
  const feed = feeds.get(symbol);
  feed.tickAt = 0;
  feed.lastTick = null;
  feed.streamApiKey = null;
  feed.streamStatus = "WAITING";
  feed.streamMessage = "รอสมัครรับราคา Streaming";
  feed.dataLocked = false;
  resetSignal(feed, "กำลังเริ่มสแกน " + symbol);
  resetCandleLineState(feed, "กำลังเริ่มสแกน " + symbol);
  startWatchdog();
  publish();
  await syncSelected({ force: true, symbol });
  if (monitoring) startStream();
  startCandleLineSampler();
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
  resetCandleLineState(feed, "เปลี่ยนคู่เงิน · รอข้อมูลใหม่");
  publish();
  // Always load the newly selected pair's own REST history, even if monitoring is stopped.
  // When monitoring is active, subscribe to Streaming only after the selected pair's history sync.
  await syncSelected({ force: true, symbol });
  if (wasMonitoring && monitoring) startStream();
  return true;
}

function stop(clearSignal = true) {
  monitoring = false;
  monitoringStartedAt = 0;
  clearTimers();
  closeUpstream();
  const feed = feeds.get(selectedSymbol);
  feed.tickAt = 0;
  feed.lastTick = null;
  feed.streamApiKey = null;
  feed.dataLocked = false;
  if (feed.streamStatus !== "UNSUPPORTED") feed.streamStatus = "WAITING";
  if (clearSignal) resetSignal(feed, "หยุดสแกนแล้ว");
  clearInterval(candleLineTimer); candleLineTimer = null;
  const activeFeed = feeds.get(selectedSymbol);
  if (activeFeed) resetCandleLineState(activeFeed, "หยุดสแกนแล้ว");
  globalLockMessage = null;
  publish();
}

function finite(value) { return Number.isFinite(value); }


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
      score: state.score, scores: state.scores || null, components: state.components || null,
      componentScores: state.componentScores || null, thresholds: state.thresholds || null,
      direction: state.direction || null, provider: state.provider || null, strategy: state.strategy,
      killSwitch: state.killSwitch ?? null, indicatorSource: state.indicatorSource || null,
      indicators: state.indicators,
      higherTimeframe: state.higherTimeframe || null,
      preAlertStatus: state.preAlertStatus || null, preAlertCandle: state.preAlertCandle || null,
      alertId: state.alertId || null,
      price: state.lastTickPrice, openPrice: state.openPrice ?? null, closePrice: state.closePrice ?? null, support: state.support ?? null, resistance: state.resistance ?? null, supportDistancePips: state.supportDistancePips ?? null, resistanceDistancePips: state.resistanceDistancePips ?? null, analyzedAt: state.analyzedAt,
      apiStatus: state.apiStatus, supportStatus: state.supportStatus,
      statusMessage: state.statusMessage, dataMode: state.dataMode,
      ageSeconds: state.ageSeconds, tickAgeSeconds: state.tickAgeSeconds,
      closedCandleCount: state.closedCandleCount, requiredCandles: state.requiredCandles,
      analysisWindow: state.analysisWindow,
      analysisMode: state.analysisMode || "TWELVE_DATA_NATIVE_SCORING_55_ALL_ANALYSIS",
      liveAnalysisIntervalSeconds: state.liveAnalysisIntervalSeconds ?? null,
      nextCandleAt: state.nextCandleAt, signalExpiresAt: state.signalExpiresAt,
      signalTimingWindowSeconds: [0, 5],
      prepareTimingWindowSeconds: [55, 60],
      signalTimingMode: "NEXT_M1_OPEN_00_05_AFTER_PREPARE_55_59",
      sourceCandleEpoch: state.sourceCandleEpoch ?? null,
      targetCandleEpoch: state.targetCandleEpoch ?? null,
      signalTargetCandleAt: state.signalTargetCandleAt ?? null,
      engineResults: state.engineResults || null,
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
  if (!symbol) return res.status(400).json({ ok: false, error: "ระบบนี้รองรับเฉพาะ EUR/USD เท่านั้น", symbols: SYMBOLS });
  try {
    await select(symbol);
    noCache(res);
    res.json({ ok: true, market: snapshot(), channel: "TELEGRAM_MINI_APP_POLLING" });
  } catch (error) {
    console.error("[mini-app] pair selection failed", symbol, error.message);
    res.status(500).json({ ok: false, error: error.message || "เปลี่ยนคู่เงินไม่สำเร็จ" });
  }
});
app.get("/api/telegram/ema5/status",requireTelegramSession,(_req,res)=>{
 noCache(res);const feed=feeds.get(selectedSymbol),state=feed.candleLineState,tickAge=feed.tickAt?Math.max(0,(Date.now()-feed.tickAt)/1000):null;
 res.json({ok:true,monitoring,symbol:"EUR/USD",symbols:["EUR/USD"],price:tickAge!==null&&tickAge<=5?feed.lastTick:null,tickAgeSeconds:tickAge,
  phase:state.phase,signal:state.orderUntil>Date.now()?state.orderSignal:"WAIT",watchSignal:state.watchUntil>Date.now()?state.watchSignal:null,watchActive:state.watchUntil>Date.now()&&!!state.watchSignal,
  orderSignal:state.orderUntil>Date.now()?state.orderSignal:null,orderActive:state.orderUntil>Date.now()&&!!state.orderSignal,orderExpiresAt:state.orderUntil?new Date(state.orderUntil).toISOString():null,reason:state.reason,
  ema5:state.lastAnalysis?.ema5??null,ema5SlopePips:state.lastAnalysis?.ema5SlopePips??null,rsi14:state.lastAnalysis?.rsi14??null,previousRsi14:state.lastAnalysis?.previousRsi14??null,rsiSignal:state.lastAnalysis?.rsiSignal??"WAIT",score:state.lastAnalysis?.score??0,callScore:state.lastAnalysis?.callScore??0,putScore:state.lastAnalysis?.putScore??0,scoreThreshold:80,regime:state.lastAnalysis?.regime??null,
  alertId:state.orderAlertId,sampledAt:state.sampledAt,candles:feed.candles.slice(-60),apiPool:twelveDataKeyPool.publicStatus(),
  sampling:{watchSeconds:[50,54],orderSeconds:[55,59],orderLightSeconds:30},manualOnly:true,brokerExecution:false,strategy:"EURUSD_CUSTOM_CANDLE_LINES_M1"});
});
app.get("/api/telegram/signal", requireTelegramSession, (_req, res) => {
  noCache(res);
  res.json({ ok: true, market: snapshot(), channel: "TELEGRAM_MINI_APP_POLLING" });
});
app.post("/api/telegram/control", requireTelegramSession, rateLimitControl, async (req, res) => {
  const action = req.body?.action;
  try {
    if (action === "start") {
      if (!monitoring) await start(selectedSymbol);
    } else if (action === "stop") {
      if (monitoring) stop();
    } else {
      return res.status(400).json({ ok: false, error: "รองรับ start และ stop" });
    }
    noCache(res);
    res.json({ ok: true, market: snapshot() });
  } catch (error) {
    console.error("[mini-app] monitoring control failed", error.message);
    res.status(500).json({ ok: false, error: error.message || "ควบคุมระบบไม่สำเร็จ" });
  }
});


app.get("/candle-lab", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "candle-lab.html")); });

// The Telegram Mini App primary URL serves the EMA5-only score-80 M1 system.
app.get("/signal", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "signal.html")); });
app.get("/signal-next", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "candle-lab.html")); });
app.get("/signal-legacy", (_req, res) => { noCache(res); res.redirect(302, "/signal"); });
app.get("/", (_req, res) => { noCache(res); res.redirect(302, "/signal"); });
app.get("/health",(_req,res)=>{
 noCache(res);
 res.json({ok:true,service:"main-market",systemName:SYSTEM_NAME,version:VERSION,symbols:SYMBOLS,interval:INTERVAL,
 architecture:{name:SYSTEM_NAME,id:ARCHITECTURE_ID,deploymentModel:"SINGLE_RENDER_SERVICE",decisionEngine:"EURUSD_EURUSD_CUSTOM_CANDLE_LINES_M1",
 primaryDecisionEngine:"CUSTOM_CANDLE_GEOMETRY_LINES_THRESHOLD_80",indicators:[],lineModel:"CUSTOM_CANDLE_GEOMETRY",externalAiCalls:false,dataProvider:"TWELVE_DATA_REAL_M1_OHLC_AND_STREAMING",
 sampling:{watchSeconds:[50,54],orderSeconds:[55,59],orderLightSeconds:30,source:"LIVE_STREAM_LOCAL_OHLC"},
 primaryMiniApp:{route:"/signal",api:"/api/telegram/ema5/status",timeframe:"M1",pairs:["EUR/USD"],manualOnly:true},
 signalPolicy:"CUSTOM_CANDLE_LINES_SCORE_80_OF_100_ONE_WATCH_AND_ONE_ORDER_PER_M1_CANDLE"},
 configuration:{twelveDataApiKeyPool:twelveDataKeyPool.publicStatus(),configuredApiKeys:twelveDataKeyPool.keyCount,
 restKeyRotation:"ROUND_ROBIN_WITH_FAILOVER",historyCandles:HISTORY_CANDLES,manualOnly:true,brokerExecution:false}});
});

server.listen(PORT, () => {
  console.log(`[${SYSTEM_NAME}] CUSTOM CANDLE LINES MAIN MARKET listening on ${PORT}`);
  console.info("[radar] startup configuration", {
    twelveDataApiKeysConfigured: twelveDataKeyPool.keyCount > 0,
    twelveDataApiKeyCount: twelveDataKeyPool.keyCount,
    miniAppOpenAccess: true,
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    supportedPairs: SYMBOLS,
    historyCandles: HISTORY_CANDLES,
    samplingPointsPerMinute: 2
  });
  console.info("[radar] monitoring starts only after Telegram Mini App user action");
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of telegramSessions) {
    if (session.expiresAt <= now) telegramSessions.delete(token);
  }
}, 5 * 60 * 1000).unref();