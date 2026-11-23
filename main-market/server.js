import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { validateClientToken } from "./src/client-auth.js";
import { fetchCandles, fetchTrendEma5, fetchEma20, fetchAtr14 } from "./src/twelve-data.js";
import { createLiveCandlePreview } from "./src/live-candle-preview.js";
import { getStreamRetryReason } from "./src/stream-retry.js";
import { twelveDataKeyPool } from "./src/twelve-data-pool.js";
import { analyzeTrendRider } from "./src/trend-rider.js";
const SIGNAL_RELEASE_VALIDATED = false;
import { canFinalizeSignal, isPrepareAlertWindow, isSignalFinalizeWindow, signalHoldExpiresAt } from "./src/signal-timing.js";
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
const SYSTEM_NAME = "ENGINE 3 TREND RIDER · TWELVE DATA NATIVE EMA5 EMA20 ATR14";
const ARCHITECTURE_ID = "ENGINE_3_ONLY_TWELVE_DATA_NATIVE_INDICATORS";
const VERSION = "2026-11-23-engine3-twelvedata-native-indicators-v1";
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
    activeSignal: null, activeUntil: 0, signalCandle: null,
    signalSourceCandle: null, signalTriggeredAt: 0, preAlertStatus: null,
    lastPrepareLoggedCandle: null, lastFinalizeLoggedCandle: null,
    preAlertSignal: null, preAlertCandle: null,
    alertId: null, dataLocked: false,
    forecastHistory: [],
    engine3Indicators: { status: "WAITING", ema5: [], ema20: [], atr14: [], receivedAt: 0, lastFetchedMinute: null, nextAttemptAt: null, lastError: null, message: "รอ EMA5 / EMA20 / ATR14 จาก Twelve Data" },
    engine3IndicatorsPromise: null,
    engineActive: { TREND_RIDER: null },
    engineLastDispatchedCandle: { TREND_RIDER: null },
    engineLastDispatchedAlertId: { TREND_RIDER: null },
    lastDispatchedAt: 0, lastDispatchedCandle: null, lastDispatchedAlertId: null
  };
}

const feeds = new Map(SYMBOLS.map(symbol => [symbol, newFeed(symbol)]));
let selectedSymbol = DEFAULT_SYMBOL;
let monitoring = false;
let upstream = null;
let restTimer = null;
let emaTimer = null;
let watchdogTimer = null;
let retryTimer = null;
let heartbeatTimer = null;
let signalTimer = null;
let liveAnalysisTimer = null;
let liveAnalysisBusy = false;
let liveAnalysisPending = false;
let lastLiveAnalysisAt = 0;
let globalLockMessage = null;
const controlRequests = new Map();
const engineEnabled = { TREND_RIDER: true };
const ENGINE_KEYS = ["TREND_RIDER"];

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
    recovery: { enabled: false, mode: "DISABLED", martingale: false },
    preAlertSignal: feed.preAlertSignal,
    indicators: { status: feed.engine3Indicators?.status || "WAITING", ema5: feed.engine3Indicators?.ema5?.at(-1) || null, ema20: feed.engine3Indicators?.ema20?.at(-1) || null, atr14: feed.engine3Indicators?.atr14?.at(-1) || null, sources: feed.engine3Indicators?.sources || null, periods: feed.engine3Indicators?.periods || { ema5: 5, ema20: 20, atr14: 14 }, message: feed.engine3Indicators?.message || "รอข้อมูล Indicator จาก Twelve Data" },
    source: "Twelve Data native EMA5/EMA20/ATR14 + M1 OHLC + live-price Streaming"
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
    signalReleaseStatus: "ENGINE3_TWELVE_DATA_NATIVE_INDICATORS_NOT_OOS_VALIDATED_MANUAL_ONLY",
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
  clearInterval(emaTimer); emaTimer = null;
  clearInterval(watchdogTimer); watchdogTimer = null;
  clearInterval(heartbeatTimer); heartbeatTimer = null;
  clearInterval(signalTimer); signalTimer = null;
  clearTimeout(liveAnalysisTimer); liveAnalysisTimer = null;
  liveAnalysisPending = false;
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

async function evaluate(feed) {
 const now=Date.now();
 const tickAge=feed.tickAt?(now-feed.tickAt)/1000:null;
 const current=feed.candles.at(-1);
 const sourceEpoch=current?.live===true?current.epoch:null;
 const targetEpoch=sourceEpoch===null?null:sourceEpoch+60;
 const closed=feed.candles.filter(c=>c&&c.live!==true&&Number.isFinite(c.epoch)&&c.epoch<Math.floor(now/60000)*60).slice(-54);
 const latest=closed.at(-1);
 const latestAge=latest?now/1000-(latest.epoch+60):Infinity;
 const freshTick=Number.isFinite(tickAge)&&tickAge>=0&&tickAge<=MAX_STREAM_AGE_SECONDS;
 const restFallback=feed.restStatus==="READY"&&!freshTick;
 const sourceReady=closed.length>=30&&latestAge<=MAX_CANDLE_AGE_SECONDS&&(freshTick||restFallback);
 const raw=sourceReady
  ? analyzeTrendRider(closed,{ema5Values:feed.engine3Indicators?.ema5,ema20Values:feed.engine3Indicators?.ema20,atrValues:feed.engine3Indicators?.atr14})
  : {ready:false,signal:null,score:0,status:"SOURCE_LOCKED",reason:"Trend Rider ต้องมีแท่ง M1 ปิดอย่างน้อย 30 แท่งและข้อมูลราคาต้องสด"};
 const candidate=["CALL","PUT"].includes(raw.signal)?raw.signal:null;
 const prepare=sourceEpoch!==null&&isPrepareAlertWindow(sourceEpoch,now)&&Boolean(candidate);
 feed.preAlertStatus=prepare?"PREPARE_ALERT":null;
 feed.preAlertCandle=prepare?targetEpoch:null;
 feed.preAlertSignal=null;
 if(prepare&&feed.lastPrepareLoggedCandle!==sourceEpoch){
  feed.lastPrepareLoggedCandle=sourceEpoch;
  console.info("[timing] Engine 3 T-10 prepare",{symbol:feed.symbol,sourceCandleEpoch:sourceEpoch,targetCandleEpoch:targetEpoch,candidate});
 }
 let active=feed.engineActive?.TREND_RIDER||null;
 if(active&&now>=active.expiresAt){active=null;feed.engineActive.TREND_RIDER=null;}
 const timingReady=sourceEpoch!==null&&canFinalizeSignal({candleEpoch:sourceEpoch,tickAt:feed.tickAt,now,lastDispatchedCandle:feed.engineLastDispatchedCandle?.TREND_RIDER});
 if(!active&&sourceEpoch!==null&&isSignalFinalizeWindow(sourceEpoch,now)&&candidate&&timingReady){
  active={engine:"TREND_RIDER",signal:candidate,sourceCandleEpoch:sourceEpoch,targetCandleEpoch:targetEpoch,
   triggeredAt:now,expiresAt:signalHoldExpiresAt(targetEpoch),score:raw.score??0,sourceReason:raw.reason||null,
   alertId:"TREND_RIDER:"+targetEpoch+":"+candidate,entryPrice:null,entryPriceBasis:"TARGET_M1_CANDLE_OPEN"};
  feed.engineActive.TREND_RIDER=active;
  console.info("[signal] Engine 3 finalized",{symbol:feed.symbol,signal:candidate,sourceCandleEpoch:sourceEpoch,targetCandleEpoch:targetEpoch,expiresAt:new Date(active.expiresAt).toISOString()});
 }
 const isActive=Boolean(active&&now<active.expiresAt);
 const signal=isActive?active.signal:"STANDBY";
 const reason=isActive?("สัญญาณ "+active.signal+" · Trend Rider · แสดง 30 วินาที"):prepare?("PREPARE T-10 · Trend Rider "+candidate+" · รอยืนยัน T-5"):(raw.reason||"Engine 3 กำลังรอข้อมูล Twelve Data");
 const engineResult={...raw,engine:"TREND_RIDER",candidateSignal:candidate,active:isActive,signal,
  status:isActive?"SIGNAL":candidate?"WATCH":raw.status,reason:isActive?reason:raw.reason,
  alertId:isActive?active.alertId:null,signalExpiresAt:isActive?new Date(active.expiresAt).toISOString():null,
  signalTargetCandleAt:isActive?new Date(active.targetCandleEpoch*1000).toISOString():null};
 const activeSignals=isActive?[{engine:"TREND_RIDER",signal:active.signal,score:active.score,reason,
  alertId:active.alertId,expiresAt:new Date(active.expiresAt).toISOString(),
  targetCandleAt:new Date(active.targetCandleEpoch*1000).toISOString(),targetCandleEpoch:active.targetCandleEpoch}]:[];
 feed.activeSignal=isActive?active.signal:null;
 feed.signalCandle=isActive?active.targetCandleEpoch:null;
 feed.signalSourceCandle=isActive?active.sourceCandleEpoch:null;
 feed.signalTriggeredAt=isActive?active.triggeredAt:0;
 feed.activeUntil=isActive?active.expiresAt:0;
 feed.alertId=isActive?active.alertId:null;
 feed.analysis={...raw,signal,direction:isActive?signal:null,status:isActive?"SIGNAL":prepare?"PREPARE":"STANDBY",
  prepareSignal:prepare?candidate:null,reason,summary:reason,active:isActive,engine:"TREND_RIDER",
  engineResults:{TREND_RIDER:engineResult},activeSignals,trendRider:raw,
  preAlertStatus:feed.preAlertStatus,preAlertCandle:feed.preAlertCandle,preAlertSignal:null,
  tickAgeSeconds:tickAge===null?null:Math.round(tickAge),lastTickPrice:feed.lastTick,alertId:feed.alertId,
  signalTriggeredAt:isActive?new Date(active.triggeredAt).toISOString():null,
  signalExpiresAt:isActive?new Date(active.expiresAt).toISOString():null,
  signalTargetCandleAt:isActive?new Date(active.targetCandleEpoch*1000).toISOString():null,
  signalTimingWindowSeconds:[5,0],indicatorSource:"TWELVE_DATA_NATIVE_EMA5_EMA20_ATR14",
  analysisMode:"CLOSED_M1_NATIVE_INDICATORS",liveAnalysisIntervalSeconds:LIVE_ANALYSIS_INTERVAL_SECONDS,
  signalValidationNote:"Engine 3 เท่านั้น · EMA5 / EMA20 / ATR14 ใช้ค่าจาก Twelve Data native endpoints · สูตร Trend Rider ของเรา · Manual only · No broker execution"};
}

function dispatchSignalIfReady(feed) {
 const active=feed.engineActive?.TREND_RIDER;
 if(!active||!["CALL","PUT"].includes(active.signal)||!active.alertId)return;
 if(feed.engineLastDispatchedAlertId?.TREND_RIDER===active.alertId)return;
 const now=Date.now();
 if(!canFinalizeSignal({candleEpoch:active.sourceCandleEpoch,tickAt:feed.tickAt,now,
  lastDispatchedCandle:feed.engineLastDispatchedCandle?.TREND_RIDER}))return;
 feed.engineLastDispatchedAt=now;
 feed.engineLastDispatchedCandle.TREND_RIDER=active.sourceCandleEpoch;
 feed.engineLastDispatchedAlertId.TREND_RIDER=active.alertId;
 console.info("[signal] Engine 3 signal available to Telegram Mini App",{engine:"TREND_RIDER",alertId:active.alertId,signal:active.signal,symbol:feed.symbol,targetCandleEpoch:active.targetCandleEpoch,expiresAt:new Date(active.expiresAt).toISOString()});
}

function applyTick(feed, price, epoch) {
  const minute = Math.floor(epoch / 60) * 60;
  const current = feed.candles.at(-1);
  if (!current || current.epoch < minute) {
    if (current) current.live = false;

    }
    // Each engine signal targets the immediately following M1 candle.
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

  // Engine 3 uses the confirmed M1 candle and the shared T-5 timing window.
  feed.lastTick = price;
  feed.tickAt = Date.now();
  feed.streamStatus = "READY";
  feed.streamMessage = "ได้รับราคา Streaming สด";
  feed.dataLocked = false;
  globalLockMessage = null;
  // Re-evaluate the single Trend Rider engine when a fresh Streaming Tick arrives.
  // A shared 250ms throttle coalesces bursts and never creates a REST request.
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

async function syncEngine3Indicators(feed,{force=false}={}) {
 if(!feed||!monitoring||selectedSymbol!==feed.symbol||!engineEnabled.TREND_RIDER)return;
 if(feed.engine3IndicatorsPromise)return feed.engine3IndicatorsPromise;
 const now=Date.now(),minute=Math.floor(now/60000)*60;
 if(!force&&feed.engine3Indicators?.lastFetchedMinute===minute)return;
 if(!force&&Number.isFinite(feed.engine3Indicators?.nextAttemptAt)&&now<feed.engine3Indicators.nextAttemptAt)return;
 feed.engine3IndicatorsPromise=(async()=>{
  try{
   const [ema5,ema20,atr14]=await Promise.all([
    fetchTrendEma5({keyPool:twelveDataKeyPool,symbol:feed.symbol,interval:INTERVAL,now:Date.now()}),
    fetchEma20({keyPool:twelveDataKeyPool,symbol:feed.symbol,interval:INTERVAL,now:Date.now()}),
    fetchAtr14({keyPool:twelveDataKeyPool,symbol:feed.symbol,interval:INTERVAL,now:Date.now()})
   ]);
   feed.engine3Indicators={status:"READY",ema5:ema5.values,ema20:ema20.values,atr14:atr14.values,
    receivedAt:Date.now(),lastFetchedMinute:minute,nextAttemptAt:null,lastError:null,
    sources:{ema5:ema5.source,ema20:ema20.source,atr14:atr14.source},
    periods:{ema5:5,ema20:20,atr14:14},message:"Twelve Data EMA5 / EMA20 / ATR14 พร้อม"};
  }catch(error){
   const retry=error?.kind==="RATE_LIMIT"?15*60*1000:30000;
   feed.engine3Indicators={...(feed.engine3Indicators||{}),status:"ERROR",lastError:error.message,
    nextAttemptAt:Date.now()+retry,message:"Twelve Data Indicator ขัดข้อง: "+error.message};
   console.error("[engine3] native indicator request failed",feed.symbol,{kind:error?.kind||"UNKNOWN",retryInMs:retry,message:error.message});
  }finally{feed.engine3IndicatorsPromise=null;}
  await evaluate(feed);dispatchSignalIfReady(feed);publish();
 })();
 return feed.engine3IndicatorsPromise;
}
function startEngine3IndicatorTimer() {
 if(emaTimer)clearInterval(emaTimer);
 emaTimer=setInterval(()=>{
  const feed=feeds.get(selectedSymbol);
  if(feed)syncEngine3Indicators(feed).catch(error=>console.error("[engine3] refresh loop failed",error.message));
 },5000);
}

function startRestTimer() {
  if (restTimer) return;
  restTimer = setInterval(() => {
    syncSelected().catch(error => console.error("[radar] REST sync", error.message));
  }, REST_SYNC_SECONDS * 1000);
}

function scheduleLiveAnalysis(feed) {
  if (!monitoring || !feed || selectedSymbol !== feed.symbol) return;
  const current = feed.candles.at(-1);
  if (!current?.live) return;
  const elapsedMs = Date.now() - current.epoch * 1000;
  if (elapsedMs < 0 || elapsedMs > 60000) return;
  liveAnalysisPending = true;
  if (liveAnalysisBusy || liveAnalysisTimer) return;
  const cadenceMs = LIVE_ANALYSIS_INTERVAL_SECONDS * 1000;
  const delayMs = Math.max(0, cadenceMs - (Date.now() - lastLiveAnalysisAt));
  liveAnalysisTimer = setTimeout(async () => {
    liveAnalysisTimer = null;
    if (!monitoring || selectedSymbol !== feed.symbol) {
      liveAnalysisPending = false;
      return;
    }
    liveAnalysisPending = false;
    const latest = feed.candles.at(-1);
    const latestElapsedMs = latest?.live ? Date.now() - latest.epoch * 1000 : Infinity;
    if (!latest?.live || latestElapsedMs < 0 || latestElapsedMs > 60000) return;
    liveAnalysisBusy = true;
    lastLiveAnalysisAt = Date.now();
    try {
      await evaluate(feed);
      dispatchSignalIfReady(feed);
      publish();
    } catch (error) {
      console.error("[radar] live tick analysis failed", error.message);
    } finally {
      liveAnalysisBusy = false;
      if (liveAnalysisPending) scheduleLiveAnalysis(feed);
    }
  }, delayMs);
}

function startSignalTimer() {
  if (signalTimer) clearInterval(signalTimer);
  // Local safety cadence supports the same live-candle T-5 finalization for all engines.
  signalTimer = setInterval(() => {
    if (!monitoring) return;
    const feed = feeds.get(selectedSymbol);
    if (feed?.candles.at(-1)?.live) scheduleLiveAnalysis(feed);
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
  startEngine3IndicatorTimer();
  startWatchdog();
  startSignalTimer();
  publish();
  await syncSelected({ force: true, symbol });
  await syncEngine3Indicators(feed, { force: true });
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
  if (wasMonitoring && monitoring) await syncEngine3Indicators(feed, { force: true });
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
      decisionEngine: "ENGINE_3_TREND_RIDER_ONLY", engines: 1,
      decisionAuthority: "OUR_TREND_RIDER_FORMULA_USING_TWELVE_DATA_NATIVE_INDICATORS",

      safetyLayer: "SYSTEM_DATA_QUALITY_AND_TIMING_GUARDS",
      historicalAnalogueWorker: "BYPASSED",
      trendRider: { soleEngine: true, emaFast: 5, emaTrend: 20, atrPeriod: 14, scoreThreshold: 65, minimumClosedCandles: 30, localTechnicalIndicatorCalculations: false, guards: ["SIDEWAYS", "LATE_EXTENSION_1_5_ATR", "ABNORMAL_RANGE_2_8_ATR"] },
      engine3: { soleEngine: true, strategy: "OUR_TREND_RIDER_FORMULA", provider: "TWELVE_DATA_NATIVE_INDICATORS_PLUS_M1_OHLC", indicatorEndpoints: ["EMA time_period=5", "EMA time_period=20", "ATR time_period=14"], derivedIndicators: [], refreshSeconds: 60, estimatedIndicatorCreditsPerDay: 4320, keyRotation: "TEN_KEY_ROUND_ROBIN_WITH_FAILOVER", minimumClosedCandles: 30, scoreThreshold: 65, guards: ["SIDEWAYS", "LATE_EXTENSION_1_5_ATR", "ABNORMAL_RANGE_2_8_ATR"], signalTiming: "T_MINUS_5_NEXT_M1", signalHoldSeconds: 30, manualOnly: true },
      engineToggles: { supported: false, fixedEngine: "TREND_RIDER" },
      signalDecisionPath: "ENGINE_3_TREND_RIDER_ONLY_WITH_TWELVE_DATA_NATIVE_EMA5_EMA20_ATR14"
    },
    analyzer: {
      provider: "TWELVE_DATA_NATIVE_INDICATORS_AND_M1_OHLC",
      model: null, configured: true,
      role: "ONE_TREND_RIDER_ENGINE_WITH_OUR_OWN_DECISION_FORMULA",
      externalAiCalls: false, localTechnicalIndicatorCalculations: false,
      indicators: { EMA5: "/ema?time_period=5", EMA20: "/ema?time_period=20", ATR14: "/atr?time_period=14" },
      priceAction: "RAW_TWELVE_DATA_OHLC_SWING_STRUCTURE_AND_CANDLE_CONFIRMATION",
      scoreThreshold: 65, minimumClosedCandles: 30,
      guards: ["SIDEWAYS", "LATE_EXTENSION_1_5_ATR", "ABNORMAL_RANGE_2_8_ATR"]
    },
    recovery: { enabled: false, mode: "DISABLED", strategy: "NONE", martingale: false },
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
      engine3IndicatorRefreshSeconds: 60,
      estimatedEngine3IndicatorCreditsPerDay: 4320,
      engine3IndicatorKeyRotation: "TEN_KEY_ROUND_ROBIN_WITH_FAILOVER",
      restKeyRotation: "ROUND_ROBIN_WITH_FAILOVER",
      contextCandles: 50,
      entryCandles: 4,
      restRefreshSeconds: REST_SYNC_SECONDS,
      streamingRequiredForSignals: true,
      restFallbackEnabled: true,
      signalReleaseValidated: SIGNAL_RELEASE_VALIDATED,
      signalRuntimeLock: false,
      signalReleaseStatus: "ENGINE3_TWELVE_DATA_NATIVE_INDICATORS_NOT_OOS_VALIDATED_MANUAL_ONLY",
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
