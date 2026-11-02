import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { validateTelegramInitData } from "./src/telegram-auth.js";
import { fetchCandles } from "./src/twelve-data.js";
import { analyzeMarket } from "./src/analyzer.js";
import {
  SYMBOLS, DEFAULT_SYMBOL, INTERVAL, HISTORY_CANDLES, MAX_CANDLES,
  REST_SYNC_SECONDS, MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS,
  SIGNAL_HOLD_SECONDS, CLIENT_LEASE_SECONDS, resolveSymbol
} from "./src/config.js";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.TWELVE_DATA_API_KEY || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const sessions = new Map();
const authRequests = new Map();
const VERSION = "2026-11-02-v2-rewrite";
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
    alertId: null, dataLocked: false
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
let httpLeaseUntil = 0;
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
    REST_ONLY: "REST ใช้ได้ แต่ยังไม่มีราคา Streaming สด — ปิด CALL/PUT",
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
    requiredCandles: 200,
    nextCandleAt: feed.candles.length
      ? (feed.candles.at(-1).live
        ? feed.candles.at(-1).epoch + 60
        : Math.max(feed.candles.at(-1).epoch + 60, Math.floor(Date.now() / 60000) * 60 + 60)) * 1000
      : null,
    signalExpiresAt: feed.activeSignal
      ? new Date(feed.activeUntil).toISOString() : null,
    alertId: feed.alertId,
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
    version: VERSION
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

function evaluate(feed) {
  const tickAge = feed.tickAt ? (Date.now() - feed.tickAt) / 1000 : null;
  const result = analyzeMarket(feed.candles, {
    now: Date.now(),
    tickAgeSeconds: tickAge,
    maxAgeSeconds: MAX_CANDLE_AGE_SECONDS
  });
  const candleId = result.lastCandleEpoch ?? null;

  if (result.signal === "CALL" || result.signal === "PUT") {
    if (feed.activeSignal && Date.now() < feed.activeUntil) {
      if (feed.activeSignal !== result.signal) {
        feed.activeSignal = null;
        feed.activeUntil = 0;
        feed.signalCandle = candleId;
        feed.alertId = null;
        feed.analysis = standby("หลักฐานเปลี่ยนทิศทางระหว่างช่วงถือสัญญาณ — ยกเลิกเป็น STANDBY");
        return;
      }
      result.signal = feed.activeSignal;
    } else if (candleId !== null && feed.signalCandle !== candleId) {
      feed.activeSignal = result.signal;
      feed.activeUntil = Date.now() + SIGNAL_HOLD_SECONDS * 1000;
      feed.signalCandle = candleId;
      feed.alertId = `${candleId}:${result.signal}`;
    } else {
      result.signal = "STANDBY";
      result.reason = "ป้องกันการแจ้งซ้ำภายในแท่ง M1 เดียวกัน";
    }
  } else if (feed.activeSignal && Date.now() < feed.activeUntil) {
    const ema21 = result.metrics?.ema21;
    const close = feed.candles.filter(c => !c.live).at(-1)?.close;
    const invalid = finite(ema21) && finite(close) && (
      feed.activeSignal === "CALL"
        ? result.regime === "TRENDING_DOWN" || close < ema21
        : result.regime === "TRENDING_UP" || close > ema21
    );
    if (invalid || !feed.tickAt || Date.now() - feed.tickAt > MAX_STREAM_AGE_SECONDS * 1000) {
      feed.activeSignal = null;
      feed.activeUntil = 0;
      feed.signalCandle = candleId;
      feed.alertId = null;
      feed.analysis = standby(invalid
        ? "ยกเลิกสัญญาณเดิม: เงื่อนไขตลาดเปลี่ยน"
        : "ยกเลิกสัญญาณเดิม: ราคา Streaming ไม่สด");
      return;
    }
    result.signal = feed.activeSignal;
    result.reason = "ติดตามสัญญาณเดิมในช่วงถือสัญญาณ 40 วินาที";
  } else if (feed.activeSignal && Date.now() >= feed.activeUntil) {
    feed.activeSignal = null;
    feed.activeUntil = 0;
  }

  feed.analysis = {
    ...result,
    tickAgeSeconds: tickAge === null ? null : Math.round(tickAge),
    lastTickPrice: feed.lastTick,
    alertId: feed.alertId,
    signalExpiresAt: feed.activeSignal ? new Date(feed.activeUntil).toISOString() : null
  };
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
  evaluate(feed);
  publish();
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
        apiKey: API_KEY, symbol: selectedSymbol,
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
      evaluate(feed);
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

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (!monitoring) return;
    const feed = feeds.get(selectedSymbol);
    if (feed.tickAt && Date.now() - feed.tickAt > MAX_STREAM_AGE_SECONDS * 1000) {
      feed.activeSignal = null;
      feed.activeUntil = 0;
      feed.analysis = standby("ราคา Streaming ไม่อัปเดตเกิน 25 วินาที");
      if (feed.streamStatus !== "UNSUPPORTED") feed.streamStatus = "TIMEOUT";
    } else if (!feed.tickAt && feed.streamStatus === "SUBSCRIBING" &&
        Date.now() - feed.subscribeAt > 25000) {
      feed.streamStatus = "TIMEOUT";
      feed.streamMessage = "ยังไม่ได้รับราคา Streaming ภายใน 25 วินาที";
      feed.analysis = standby(feed.streamMessage);
    }
    publish();
  }, 5000);
}

function startStream() {
  if (!monitoring || upstream) return;
  if (!API_KEY) {
    const feed = feeds.get(selectedSymbol);
    lockFeed(feed, "ยังไม่ได้ตั้ง TWELVE_DATA_API_KEY ใน Render Environment");
    return;
  }

  const symbol = selectedSymbol;
  const feed = feeds.get(symbol);
  feed.streamStatus = "SUBSCRIBING";
  feed.subscribeAt = Date.now();
  feed.streamMessage = "กำลังสมัครรับราคา Streaming";
  let socket;
  try {
    const url = "wss://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(API_KEY);
    socket = new WebSocket(url);
    upstream = socket;
  } catch (error) {
    feed.streamStatus = "ERROR";
    feed.streamMessage = error.message;
    publish();
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
      if (failedSymbol || status === "error" || status === "failed") {
        feed.streamStatus = "UNSUPPORTED";
        feed.streamMessage = text || "Twelve Data ปฏิเสธการสมัคร Streaming";
        feed.analysis = standby("ไม่มีสิทธิ์ Streaming สำหรับ " + symbol + ": " + feed.streamMessage);
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
        globalLockMessage = "Twelve Data Streaming: " + text;
        lockFeed(feed, globalLockMessage);
      } else {
        feed.streamStatus = "ERROR";
        feed.streamMessage = text;
        feed.analysis = standby("Streaming ผิดพลาด: " + text);
        publish();
      }
    }
  });

  socket.on("error", error => {
    if (upstream !== socket) return;
    feed.streamStatus = "ERROR";
    feed.streamMessage = error.message;
    feed.activeSignal = null;
    feed.activeUntil = 0;
    feed.analysis = standby("เชื่อมต่อ Streaming ไม่สำเร็จ: " + error.message);
    publish();
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
    feed.analysis = standby(feed.streamMessage);
    publish();
    if (monitoring) retryTimer = setTimeout(startStream, 8000);
  });
}

async function start(symbolValue) {
  const symbol = resolveSymbol(symbolValue) || DEFAULT_SYMBOL;
  stop(false);
  selectedSymbol = symbol;
  monitoring = true;
  httpLeaseUntil = Date.now() + CLIENT_LEASE_SECONDS * 1000;
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
  httpLeaseUntil = wasMonitoring ? Date.now() + CLIENT_LEASE_SECONDS * 1000 : 0;
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
  httpLeaseUntil = 0;
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

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

function sessionForRequest(req) {
  const token = cookieValue(req.headers.cookie, "radar_session");
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireTelegramSession(req, res, next) {
  const session = sessionForRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: "กรุณาเปิด Mini App ผ่าน Telegram ใหม่อีกครั้ง" });
  req.telegramUserId = session.userId;
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

const allowedOrigins = new Set([
  "https://ai-universal-signal-radar.onrender.com",
  "https://ai-signal-radar-main-market.onrender.com"
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.has(origin) || origin === `https://${req.headers.host}`)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
  next();
});
app.use(express.json({ limit: "8kb" }));

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
}
app.get("/", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "index.html")); });
app.get("/app.js", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "app.js")); });
app.get("/styles.css", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "styles.css")); });
app.get("/health", (_req, res) => {
  noCache(res);
  res.json({
    ok: true, service: "main-market", version: VERSION,
    symbols: SYMBOLS, interval: INTERVAL
  });
});
app.post("/api/auth", rateLimitAuth, (req, res) => {
  if (!BOT_TOKEN) return res.status(503).json({ ok: false, error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Telegram Bot Token" });
  const validation = validateTelegramInitData(req.body?.initData, BOT_TOKEN);
  if (!validation.ok) return res.status(401).json({ ok: false, error: "ยืนยัน Telegram ไม่สำเร็จ กรุณาเปิด Mini App ใหม่" });
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { userId: validation.userId, expiresAt });
  res.setHeader("Set-Cookie", `radar_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  noCache(res);
  res.json({ ok: true, expiresIn: Math.floor(SESSION_TTL_MS / 1000) });
});
app.get("/api/state", requireTelegramSession, (_req, res) => { noCache(res); res.json(snapshot()); });
app.post("/api/control", requireTelegramSession, rateLimitControl, async (req, res) => {
  const body = req.body || {};
  try {
    if (body.action === "start") await start(body.symbol || body.symbols?.[0] || DEFAULT_SYMBOL);
    else if (body.action === "select") {
      if (!await select(body.symbol)) return res.status(400).json({ ok: false, error: "ไม่รองรับคู่เงินนี้" });
    } else if (body.action === "heartbeat") {
      if (monitoring) httpLeaseUntil = Date.now() + CLIENT_LEASE_SECONDS * 1000;
    } else if (body.action === "stop") stop();
    else return res.status(400).json({ ok: false, error: "ไม่รองรับคำสั่งนี้" });
    noCache(res);
    res.json({ ok: true, state: snapshot() });
  } catch (error) {
    console.error("[radar] control action failed", error);
    res.status(500).json({ ok: false, error: error.message || "คำสั่งไม่สำเร็จ" });
  }
});

setInterval(() => {
  if (monitoring && wss.clients.size === 0 && httpLeaseUntil &&
      Date.now() > httpLeaseUntil) {
    console.warn("[radar] Mini App lease expired; stopping scanner");
    stop();
  }
}, 5000);

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
    client.telegramUserId = session.userId;
    wss.emit("connection", client, req);
  });
});

wss.on("connection", socket => {
  socket.send(JSON.stringify({ type: "market_state", data: snapshot() }));
  socket.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.action === "heartbeat" && monitoring) {
      httpLeaseUntil = Date.now() + CLIENT_LEASE_SECONDS * 1000;
    }
  });
  socket.on("close", () => {
    setTimeout(() => {
      if (monitoring && wss.clients.size === 0 && Date.now() > httpLeaseUntil) stop();
    }, CLIENT_LEASE_SECONDS * 1000 + 1000);
  });
});

server.listen(PORT, () => console.log(`MAIN MARKET v2 listening on ${PORT}`));

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}, 5 * 60 * 1000).unref();
