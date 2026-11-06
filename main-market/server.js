import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { validateClientToken } from "./src/client-auth.js";
import { fetchCandles } from "./src/twelve-data.js";
import { twelveDataKeyPool } from "./src/twelve-data-pool.js";
import { analyzeMarket } from "./src/analyzer.js";
import { applySignalReleaseGate, SIGNAL_RELEASE_VALIDATED } from "./src/signal-release-gate.js";
import { sendSignalPush, firebaseAdminStatus } from "./src/push-notifications-v2.js";
import { canDispatchSignal } from "./src/signal-timing.js";
import {
  SYMBOLS, DEFAULT_SYMBOL, INTERVAL, MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES,
  REST_SYNC_SECONDS, MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS,
  SIGNAL_HOLD_SECONDS, resolveSymbol
} from "./src/config.js";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const CLIENT_TOKEN = process.env.ANDROID_CLIENT_TOKEN || "";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const authRequests = new Map();
const VERSION = "2026-11-06-multi-engine-v1";
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function newFeed(symbol) {
  return {
    symbol, candles: [], lastTick: null, tickAt: 0,
    restStatus: "NOT_CHECKED", restMessage: "ยังไม่ได้ตรวจสอบ REST",
    streamStatus: "WAITING", streamMessage: "รอเชื่อมต่อ Streaming",
    lastRestSyncAt: 0, restSyncPromise: null,
    analysis: standby("กดเริ่มสแกนเพื่อเชื่อมต่อข้อมูล"),
    activeSignal: null, activeUntil: 0, signalCandle: null,
    preAlertSignal: null, preAlertCandle: null,
    alertId: null, dataLocked: false,
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

function publicFeed(feed) {
  const status = feedStatus(feed);
  const tickAge = feed.tickAt ? Math.max(0, (Date.now() - feed.tickAt) / 1000) : null;
  const analysis = feed.analysis || standby("รอข้อมูล");
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
    lastTickPrice: feed.lastTick,
    candleCount: feed.candles.length,
    closedCandleCount: feed.candles.filter(c => !c.live).length,
    requiredCandles: MIN_CLOSED_CANDLES,
    nextCandleAt: feed.candles.length
      ? (feed.candles.at(-1).live
        ? feed.candles.at(-1).epoch + 60
        : Math.max(feed.candles.at(-1).epoch + 60, Math.floor(Date.now() / 60000) * 60 + 60)) * 1000
      : null,
    signalExpiresAt: feed.activeSignal
      ? new Date(feed.activeUntil).toISOString() : null,
    alertId: feed.alertId,
    preAlertSignal: feed.preAlertSignal,
    source: "Twelve Data REST + live-price Streaming"
  };
}

function snapshot() {
  const feed = feeds.get(selectedSymbol);
  const data = publicFeed(feed);
  return {
    ...data,
    symbols: SYMBOLS,
    selectedSymbol,
    selectedSymbols: [selectedSymbol],
    pairs: { [selectedSymbol]: data },
    monitoring,
    connected: data.apiStatus === "ONLINE",
    serverOnline: true,
    apiStatus: data.apiStatus,
    apiMessage: globalLockMessage || data.statusMessage,
    onlineCount: data.apiStatus === "ONLINE" ? 1 : 0,
    unsupportedCount: data.supportStatus === "UNSUPPORTED" ? 1 : 0,
    version: VERSION,
    signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
    signalReleaseStatus: "RULE_BASED_MANUAL_ONLY_NOT_OOS_VALIDATED",
    apiPool: twelveDataKeyPool.publicStatus()
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
 const restFallback = feed.restStatus === "READY" &&
   (!feed.tickAt || tickAge === null || tickAge > MAX_STREAM_AGE_SECONDS);
 const rawResult = await analyzeMarket(feed.candles, {
   now, tickAgeSeconds: tickAge, allowRestFallback: restFallback
 });
 const result = applySignalReleaseGate(rawResult);
 const currentCandle = feed.candles.at(-1);
 const triggerCandleEpoch = currentCandle?.live === true ? currentCandle.epoch : null;
 const timingEligible = triggerCandleEpoch !== null && canDispatchSignal({
   candleEpoch: triggerCandleEpoch, tickAt: feed.tickAt, now,
   lastDispatchedAt: feed.lastDispatchedAt,
   lastDispatchedCandle: feed.lastDispatchedCandle
 });
 const analysisCandleId = result.lastCandleEpoch ?? null;
 if (feed.preAlertCandle !== analysisCandleId) {
   feed.preAlertCandle = analysisCandleId;
   feed.preAlertSignal = null;
 }

 if (result.signal === "CALL" || result.signal === "PUT") {
   if (feed.activeSignal && now < feed.activeUntil) {
     result.signal = feed.activeSignal;
     result.reason = "ติดตามสัญญาณเดิมในช่วงถือสัญญาณ 40 วินาที";
   } else if (timingEligible && feed.signalCandle !== triggerCandleEpoch) {
     feed.activeSignal = result.signal;
     feed.activeUntil = now + SIGNAL_HOLD_SECONDS * 1000;
     feed.signalCandle = triggerCandleEpoch;
     feed.alertId = `${triggerCandleEpoch}:${result.signal}`;
   } else {
     result.signal = "STANDBY";
     result.reason = triggerCandleEpoch === null
       ? "รอแท่ง M1 ปัจจุบันและราคา Streaming สด"
       : tickAge === null || tickAge > 5
         ? "ข้ามสัญญาณ: ราคา Streaming ต้องสดไม่เกิน 5 วินาทีในหน้าต่างก่อนปิดแท่ง"
         : feed.signalCandle === triggerCandleEpoch
           ? "ป้องกันการแจ้งซ้ำภายในแท่ง M1 เดียวกัน"
           : "รอหน้าต่างส่งสัญญาณ 3–5 วินาทีก่อนปิดแท่ง M1";
   }
 } else if (feed.activeSignal && now < feed.activeUntil) {
   const restFresh = restFallback && Number.isFinite(result.ageSeconds) &&
     result.ageSeconds <= MAX_CANDLE_AGE_SECONDS;
   const streamFresh = feed.tickAt && now - feed.tickAt <= MAX_STREAM_AGE_SECONDS * 1000;
   if (!restFresh && !streamFresh) {
     feed.activeSignal = null;
     feed.activeUntil = 0;
     feed.signalCandle = triggerCandleEpoch;
     feed.preAlertSignal = null;
     feed.alertId = null;
     feed.analysis = standby("ยกเลิกสัญญาณเดิม: แหล่งข้อมูลราคาไม่สดหรือไม่ผ่าน Data Quality Gate");
     return;
   }
   result.signal = feed.activeSignal;
   result.reason = "ติดตามสัญญาณเดิมในช่วงถือสัญญาณ 40 วินาที";
 } else if (feed.activeSignal && now >= feed.activeUntil) {
   feed.activeSignal = null;
   feed.activeUntil = 0;
 }

 if (result.signal === "CALL" || result.signal === "PUT") feed.preAlertSignal = result.signal;
 else if (!(feed.activeSignal && now < feed.activeUntil)) feed.preAlertSignal = null;

 feed.analysis = {
   ...result,
   tickAgeSeconds: tickAge === null ? null : Math.round(tickAge),
   lastTickPrice: feed.lastTick,
   alertId: feed.alertId,
   signalExpiresAt: feed.activeSignal ? new Date(feed.activeUntil).toISOString() : null,
   signalTimingWindowSeconds: [5, 3]
 };
}

function dispatchSignalIfReady(feed) {
 const signal = feed.activeSignal;
 const candleEpoch = feed.signalCandle;
 if (!signal || !["CALL", "PUT"].includes(signal) || !feed.alertId) return;
 const now = Date.now();
 if (!canDispatchSignal({
   candleEpoch, tickAt: feed.tickAt, now,
   lastDispatchedAt: feed.lastDispatchedAt,
   lastDispatchedCandle: feed.lastDispatchedCandle
 })) return;
 if (feed.lastDispatchedAlertId === feed.alertId) return;

 // Claim the candle and 55-second cooldown before the asynchronous FCM call.
 feed.lastDispatchedAt = now;
 feed.lastDispatchedCandle = candleEpoch;
 feed.lastDispatchedAlertId = feed.alertId;
 const alertId = feed.alertId;
 const payload = {
   symbol: feed.symbol, signal, alertId,
   price: feed.lastTick, reason: feed.analysis?.reason || "M1 pre-close signal"
 };
 console.info("[signal] pre-close dispatch claimed", {
   alertId, candleEpoch, secondsBeforeClose: ((candleEpoch + 60) * 1000 - now) / 1000
 });
 void sendSignalPush(payload).then(result => {
   if (result.sent) console.info("[push] signal notification sent", alertId);
   else console.warn("[push] signal notification not sent", alertId, result.reason || "UNKNOWN");
 }).catch(error => console.warn("[push] delivery failed", alertId, error.message));
}

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
  void evaluate(feed).then(publish).catch(error => console.error("[radar] tick analysis failed", error.message));
}

async function syncSelected({ force = false } = {}) {
  const feed = feeds.get(selectedSymbol);
  if (feed.restSyncPromise) return feed.restSyncPromise;
  if (!force && feed.restStatus === "READY" && feed.lastRestSyncAt &&
      Date.now() - feed.lastRestSyncAt < REST_SYNC_SECONDS * 1000) return;

  feed.lastRestSyncAt = Date.now();
  feed.restSyncPromise = (async () => {
    try {
      const response = await fetchCandles({
        keyPool: twelveDataKeyPool, symbol: selectedSymbol,
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
        symbol: selectedSymbol, candles: response.candles.length,
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
      console.error("[radar] REST error", selectedSymbol, error.message);
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
  // 250ms cadence keeps dispatch inside the 3–5s pre-close window; actual
  // eligibility also requires a Streaming tick no older than five seconds.
  let evaluationBusy = false;
  signalTimer = setInterval(async () => {
    if (!monitoring || evaluationBusy) return;
    const feed = feeds.get(selectedSymbol);
    const current = feed?.candles.at(-1);
    if (!current?.live) return;
    const remainingMs = (current.epoch + 60) * 1000 - Date.now();
    if (remainingMs < 3000 || remainingMs > 5000) return;
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
    if (feed.tickAt && Date.now() - feed.tickAt > MAX_STREAM_AGE_SECONDS * 1000) {
      feed.activeSignal = null;
      feed.activeUntil = 0;
      feed.analysis = standby("ราคา Streaming ไม่อัปเดตเกิน 25 วินาที");
      if (feed.streamStatus !== "UNSUPPORTED") feed.streamStatus = "TIMEOUT";
      await evaluate(feed);
    } else if (!feed.tickAt && feed.streamStatus === "SUBSCRIBING" &&
        Date.now() - feed.subscribeAt > 25000) {
      feed.streamStatus = "TIMEOUT";
      feed.streamMessage = "ยังไม่ได้รับราคา Streaming ภายใน 25 วินาที";
      await evaluate(feed);
    } else if (["UNSUPPORTED", "ERROR", "TIMEOUT"].includes(feed.streamStatus)) {
      // REST fallback has no tick events; keep the 40-second signal hold and expiry accurate.
      await evaluate(feed);
    }
    publish();
  }, 5000);
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
        twelveDataKeyPool.markSuccess(apiKey);
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
        feed.streamStatus = "UNSUPPORTED";
        feed.streamMessage = text || "Twelve Data ปฏิเสธการสมัคร Streaming";
        void evaluate(feed).then(publish).catch(error => console.error("[radar] subscription analysis failed", error.message));
      } else if (status === "success" || succeeded.length) {
        feed.streamStatus = "SUBSCRIBED";
        feed.streamMessage = "สมัครรับ Streaming แล้ว — รอ tick แรก";
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
        void evaluate(feed).then(publish).catch(error => console.error("[radar] stream analysis failed", error.message));
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
  feed.streamStatus = "WAITING";
  feed.streamMessage = "รอสมัครรับราคา Streaming";
  feed.dataLocked = false;
  resetSignal(feed, "กำลังเริ่มสแกน " + symbol);
  startRestTimer();
  startWatchdog();
  startSignalTimer();
  publish();
  await syncSelected({ force: true });
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
  feed.streamStatus = "WAITING";
  feed.streamMessage = "รอสมัครรับราคา Streaming";
  feed.dataLocked = false;
  resetSignal(feed, "เปลี่ยนคู่เงินเป็น " + symbol);
  publish();
  if (wasMonitoring) {
    await syncSelected({ force: true });
    if (monitoring) startStream();
  }
  return true;
}

function stop(clearSignal = true) {
  monitoring = false;
  clearTimers();
  closeUpstream();
  const feed = feeds.get(selectedSymbol);
  feed.tickAt = 0;
  feed.lastTick = null;
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

function rateLimitAuth(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (authRequests.get(key) || []).filter(time => now - time < 5 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ ok: false, error: "ยืนยันตัวตนถี่เกินไป กรุณารอสักครู่" });
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
app.get("/control", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "control.html")); });
app.get("/signal", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "signal.html")); });
app.get("/", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "index.html")); });
app.get("/app.js", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "app.js")); });
app.get("/styles.css", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "styles.css")); });
app.get("/health", (_req, res) => {
  noCache(res);
  res.json({
    ok: true, service: "main-market", version: VERSION,
    symbols: SYMBOLS, interval: INTERVAL,
    authentication: { mode: "ANDROID_CLIENT", configured: Boolean(CLIENT_TOKEN) },
    architecture: { decisionEngine: "TEN_ENGINE_MULTI_STRATEGY", engines: 10, dispatcher: "PROMISE_ALL_SETTLED", safetyNoiseGuardVeto: true, historicalAnalogueWorker: "BYPASSED", signalDecisionPath: "SOURCE_GATE_TO_TEN_ENGINES_TO_ORIGINAL_AI_SAFETY_GATE" },
    configuration: {
      androidClientAuthConfigured: Boolean(CLIENT_TOKEN),
      ...firebaseAdminStatus(),
      twelveDataApiKey: twelveDataKeyPool.keyCount > 0,
      twelveDataApiPool: twelveDataKeyPool.publicStatus(),
      minimumClosedCandles: MIN_CLOSED_CANDLES,
      historyCandles: HISTORY_CANDLES,
      restRefreshSeconds: REST_SYNC_SECONDS,
      streamingRequiredForSignals: false,
      restFallbackEnabled: true,
      signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
      signalRuntimeLock: false,
      signalReleaseStatus: "RULE_BASED_MANUAL_ONLY_NOT_OOS_VALIDATED"
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
  console.log(`MAIN MARKET v2 listening on ${PORT}`);
  console.info("[radar] Android client credential configured", Boolean(CLIENT_TOKEN));
  console.info("[radar] startup configuration", {
    androidClientAuthConfigured: Boolean(CLIENT_TOKEN),
    twelveDataApiKeysConfigured: twelveDataKeyPool.keyCount > 0,
    twelveDataApiKeyCount: twelveDataKeyPool.keyCount,
    firebaseAdminConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
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
}, 5 * 60 * 1000).unref();
