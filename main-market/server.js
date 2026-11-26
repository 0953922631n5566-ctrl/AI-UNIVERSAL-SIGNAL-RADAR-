import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import { fetchCandles } from "./src/twelve-data.js";
import { getStreamRetryReason } from "./src/stream-retry.js";
import { analyzeMarket } from "./src/analyzer.js";
import { NEXT_SIGNAL_THRESHOLD, NEXT_PREPARE_THRESHOLD, NEXT_SIGNAL_HOLD_MS, NEXT_SIGNAL_MAX_TICK_AGE_MS } from "./src/streaming-entry-engine.js";
import { canFinalizeSignal, isPrepareAlertWindow, isSignalFinalizeWindow, signalHoldExpiresAt } from "./src/signal-timing.js";
import { twelveDataKeyPool } from "./src/twelve-data-pool.js";
import { analyzeEma5Pullback, enterPreparedSignal, samplingPhase } from "./src/ema5-two-phase-engine.js";
const SIGNAL_RELEASE_VALIDATED = false;

import {
  SYMBOLS, DEFAULT_SYMBOL, INTERVAL, MIN_CLOSED_CANDLES, HISTORY_CANDLES, MAX_CANDLES,
  REST_SYNC_SECONDS, LIVE_PRICE_CHECK_SECONDS, LIVE_ANALYSIS_INTERVAL_SECONDS,
  MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS, SIGNAL_HOLD_SECONDS,
  resolveSymbol
} from "./src/config.js";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// TELEGRAM_BOT_TOKEN is intentionally optional; open Mini App sessions do not validate Telegram initData.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const telegramSessions = new Map();
const authRequests = new Map();
const SYSTEM_NAME = "TWELVE DATA EMA5 TWO-PHASE M1 RADAR";
const ARCHITECTURE_ID = "TWELVE_DATA_EMA5_TWO_PHASE_M1";
const VERSION = "2026-11-26-ema5-two-phase-4pairs-v1";
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
    ema5State: { phase:"WAIT", minuteEpoch:null, openPrice:null, ema5:null, previousEma5:null, slope:"WAIT", signal:"WAIT", reason:"รอเริ่มสแกน", preparedSignal:null, preparedForEpoch:null, sourceEpoch:null, enteredEpoch:null, alertId:null, history:[], lastOpenSampleEpoch:null, lastPrepareSampleEpoch:null, sampledAt:null, lastAnalysis:null }
  };
}


const feeds = new Map(SYMBOLS.map(symbol => [symbol, newFeed(symbol)]));
let selectedSymbol = DEFAULT_SYMBOL;
let monitoring = false;
let monitoringStartedAt = 0;
let upstream = null;
let restTimer = null;
let emaTimer = null;
let ema5Timer = null;
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
    candles: feed.candles.filter(candle => candle).slice(-60),
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
    preAlertSignal: feed.preAlertSignal,
    indicators: { status: feed.engine3Indicators?.status || "WAITING", ema5: feed.engine3Indicators?.ema5?.at(-1) || null, ema20: feed.engine3Indicators?.ema20?.at(-1) || null, atr14: feed.engine3Indicators?.atr14?.at(-1) || null, sources: feed.engine3Indicators?.sources || null, periods: feed.engine3Indicators?.periods || { ema5: 5, ema20: 20, atr14: 14 }, message: feed.engine3Indicators?.message || "รอข้อมูล Indicator จาก Twelve Data" },
    source: "Twelve Data native EMA5/EMA20/ATR14 + M1 OHLC + Streaming · All Analysis Threshold 55"
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
    signalReleaseStatus: "TWELVE_DATA_NATIVE_SCORING_55_MANUAL_ONLY_NOT_OOS_VALIDATED",
    apiPool: twelveDataKeyPool.publicStatus(),
  };
}

function publish() {
  // Telegram Mini App uses authenticated HTTP polling; there is no browser WebSocket server.
}

function clearTimers() {
  clearInterval(restTimer); restTimer = null;
  clearInterval(emaTimer); emaTimer = null;
  clearInterval(ema5Timer); ema5Timer = null;
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

async function evaluate(feed) { return feed.ema5State; }

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
      // EMA5 decisions are made only at the two scheduled M1 sampling points.
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

function scheduleLiveAnalysis(_feed) {
  // Disabled: EMA5 decisions are made only at the two scheduled M1 sampling points.
}

function resetEma5State(feed,reason="รอเริ่มสแกน"){
 feed.ema5State={phase:"WAIT",minuteEpoch:null,openPrice:null,ema5:null,previousEma5:null,slope:"WAIT",signal:"WAIT",reason,preparedSignal:null,preparedForEpoch:null,sourceEpoch:null,enteredEpoch:null,alertId:null,history:[],lastOpenSampleEpoch:null,lastPrepareSampleEpoch:null,sampledAt:null,lastAnalysis:null};
}
function mergeSampleCandles(feed,response){
 const byEpoch=new Map((feed.candles||[]).filter(c=>c&&Number.isFinite(c.epoch)).map(c=>[c.epoch,c]));
 for(const candle of response.candles||[])byEpoch.set(candle.epoch,{...candle,live:false});
 const minute=Math.floor(Date.now()/60000)*60;
 const oldLive=feed.candles.at(-1)?.live&&feed.candles.at(-1).epoch===minute?feed.candles.at(-1):null;
 const live=response.liveCandle?.epoch===minute?response.liveCandle:oldLive;
 if(live)byEpoch.set(live.epoch,{...live,live:true});
 feed.candles=[...byEpoch.values()].sort((a,b)=>a.epoch-b.epoch).slice(-MAX_CANDLES);
 return live;
}
async function sampleEma5(feed,phase,minuteEpoch){
 const state=feed.ema5State,marker=phase==="OPEN"?"lastOpenSampleEpoch":"lastPrepareSampleEpoch";
 if(state[marker]===minuteEpoch)return;
 state[marker]=minuteEpoch;
 try{
  const response=await fetchCandles({keyPool:twelveDataKeyPool,symbol:feed.symbol,interval:INTERVAL,outputsize:80,includeCurrent:true});
  const live=mergeSampleCandles(feed,response);
  feed.restStatus="READY";feed.restMessage=`Twelve Data REST พร้อม · ${response.candles.length} แท่งปิด`;
  if(phase==="OPEN"){
   state.minuteEpoch=minuteEpoch;
   state.openPrice=live?.epoch===minuteEpoch?live.open:(feed.lastTick??state.openPrice??null);
   if(state.enteredEpoch!==minuteEpoch){state.phase="ACCUMULATING";state.reason=state.openPrice==null?"รอราคาเปิดจาก Streaming":"สะสมข้อมูลแท่ง M1 · รอประเมินวินาที 55";}
   state.sampledAt=new Date().toISOString();
   console.info("[ema5] OPEN sample",{symbol:feed.symbol,minuteEpoch,openPrice:state.openPrice});
  }else{
   const now=Date.now(),second=Math.floor(now/1000)%60;
   if(Math.floor(now/60000)*60!==minuteEpoch||second<55){state.phase="WAIT";state.signal="WAIT";state.reason="ผลดึงข้อมูลมาช้าเกินช่วงวินาที 55 · ข้ามรอบ";return;}
   const current=live?.epoch===minuteEpoch?live:null,tickAge=feed.tickAt?(now-feed.tickAt)/1000:null;
   const result=analyzeEma5Pullback({symbol:feed.symbol,closedCandles:feed.candles.filter(c=>c&&!c.live),liveCandle:current,tickAgeSeconds:tickAge});
   Object.assign(state,{lastAnalysis:result,ema5:result.ema5??null,previousEma5:result.previousEma5??null,slope:result.slope||"WAIT",
    closePrice:result.closePrice??current?.close??null,highPrice:result.highPrice??current?.high??null,lowPrice:result.lowPrice??current?.low??null,
    sourceEpoch:minuteEpoch,preparedForEpoch:null,preparedSignal:null,alertId:null,sampledAt:new Date().toISOString()});
   if(["CALL","PUT"].includes(result.signal)){
    state.phase="PREPARE";state.signal=result.signal;state.preparedSignal=result.signal;state.preparedForEpoch=minuteEpoch+60;
    state.reason=`PREPARE ${result.signal} · เตรียมเข้าแท่งถัดไป`;
    state.alertId=`${minuteEpoch}:${minuteEpoch+60}:${result.signal}:PREPARE:EMA5`;
   }else{state.phase=result.regime==="SIDEWAY"?"SIDEWAY":"WAIT";state.signal="WAIT";state.reason=result.reason;}
   console.info("[ema5] PREPARE sample",{symbol:feed.symbol,minuteEpoch,signal:state.signal,slope:state.slope,ema5:state.ema5});
  }
 }catch(error){state.phase="ERROR";state.signal="WAIT";state.reason=`Twelve Data sample error: ${error.message}`;console.error("[ema5] sample failed",{symbol:feed.symbol,phase,message:error.message});}
 publish();
}
function tickEma5Clock(){
 if(!monitoring)return;
 const feed=feeds.get(selectedSymbol);if(!feed)return;
 const now=Date.now(),minute=Math.floor(now/60000)*60,second=Math.floor(now/1000)%60,state=feed.ema5State;
 const live=feed.candles.at(-1)?.live&&feed.candles.at(-1).epoch===minute?feed.candles.at(-1):null;
 if(state.preparedForEpoch===minute&&state.enteredEpoch!==minute){
  if(second<=5&&live&&feed.tickAt&&now-feed.tickAt<=5000){
   const entered=enterPreparedSignal(state,minute);
   if(entered){state.reason=`ENTER ${entered.signal} NOW · สัญญาณครั้งเดียวสำหรับแท่งนี้`;state.openPrice=live.open;console.info("[ema5] ENTER",{symbol:feed.symbol,...entered});publish();}
  }else if(second>5){state.phase="WAIT";state.signal="WAIT";state.reason="พ้น 5 วินาทีแรกหรือราคาไม่สด · ข้ามสัญญาณย้อนหลัง";state.preparedSignal=null;state.preparedForEpoch=null;}
 }
 if(state.phase==="ENTER"&&state.enteredEpoch===minute&&second>5){state.phase="ACCUMULATING";state.signal="WAIT";state.reason="แท่งนี้เข้าไปแล้ว · รอประเมินรอบถัดไปที่วินาที 55";}
 const phase=samplingPhase(now/1000);
 if(phase==="OPEN"&&state.lastOpenSampleEpoch!==minute)void sampleEma5(feed,"OPEN",minute);
 else if(phase==="PREPARE"&&state.lastPrepareSampleEpoch!==minute)void sampleEma5(feed,"PREPARE",minute);
}
function startEma5Sampler(){clearInterval(ema5Timer);ema5Timer=setInterval(tickEma5Clock,200);tickEma5Clock();}

function startIndicatorTimer() {
  if(emaTimer)clearInterval(emaTimer);
  // Check locally every 5s, but request each native indicator only once per new M1 minute.
  emaTimer=setInterval(()=>{
    if(!monitoring)return;
    const feed=feeds.get(selectedSymbol);
    if(feed)void refreshNativeIndicators(feed);
  },5000);
}

function startSignalTimer() {
  if (signalTimer) clearInterval(signalTimer);
  // Local safety cadence keeps the single Trend Rider analysis aligned to M1 timing.
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
  startWatchdog();
  startEma5Sampler();
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
  resetEma5State(feed, "เปลี่ยนคู่เงิน · รอข้อมูลใหม่");
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
  clearInterval(ema5Timer); ema5Timer = null;
  const activeFeed = feeds.get(selectedSymbol);
  if (activeFeed) resetEma5State(activeFeed, "หยุดสแกนแล้ว");
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
      price: state.lastTickPrice, analyzedAt: state.analyzedAt,
      apiStatus: state.apiStatus, supportStatus: state.supportStatus,
      statusMessage: state.statusMessage, dataMode: state.dataMode,
      ageSeconds: state.ageSeconds, tickAgeSeconds: state.tickAgeSeconds,
      closedCandleCount: state.closedCandleCount, requiredCandles: state.requiredCandles,
      analysisWindow: state.analysisWindow,
      analysisMode: state.analysisMode || "TWELVE_DATA_NATIVE_SCORING_55_ALL_ANALYSIS",
      liveAnalysisIntervalSeconds: state.liveAnalysisIntervalSeconds || LIVE_ANALYSIS_INTERVAL_SECONDS,
      nextCandleAt: state.nextCandleAt, signalExpiresAt: state.signalExpiresAt,
      signalTimingWindowSeconds: state.signalTimingWindowSeconds || [55, 60],
      prepareTimingWindowSeconds: state.prepareTimingWindowSeconds || [50, 55],
      signalTimingMode: state.signalTimingMode || "NEXT_M1_TARGET_PREOPEN_HOLD_30S",
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
app.get("/api/telegram/ema5/status",requireTelegramSession,(_req,res)=>{
 noCache(res);const feed=feeds.get(selectedSymbol),state=feed.ema5State,tickAge=feed.tickAt?Math.max(0,(Date.now()-feed.tickAt)/1000):null;
 res.json({ok:true,monitoring,symbol:selectedSymbol,symbols:SYMBOLS,price:tickAge!==null&&tickAge<=5?feed.lastTick:null,tickAgeSeconds:tickAge,
  openPrice:state.openPrice,ema5:state.ema5,previousEma5:state.previousEma5,slope:state.slope,phase:state.phase,signal:state.signal,reason:state.reason,
  closePrice:state.closePrice??null,highPrice:state.highPrice??null,lowPrice:state.lowPrice??null,sourceEpoch:state.sourceEpoch,targetEpoch:state.preparedForEpoch??state.enteredEpoch,
  alertId:state.alertId,sampledAt:state.sampledAt,history:state.history||[],candles:feed.candles.slice(-20),apiPool:twelveDataKeyPool.publicStatus(),
  sampling:{openSeconds:[0,2],prepareSeconds:[55,59],entrySeconds:[0,5],restCallsPerMinute:2},manualOnly:true,brokerExecution:false,strategy:"EMA5_PULLBACK_TWO_PHASE_M1"});
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

// The Telegram Mini App primary URL serves the EMA5 two-phase M1 system.
app.get("/signal", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "candle-lab.html")); });
app.get("/signal-next", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "candle-lab.html")); });
app.get("/signal-legacy", (_req, res) => { noCache(res); res.sendFile(path.join(APP_DIR, "public", "signal.html")); });
app.get("/", (_req, res) => { noCache(res); res.redirect(302, "/signal"); });
app.get("/health",(_req,res)=>{
 noCache(res);
 res.json({ok:true,service:"main-market",systemName:SYSTEM_NAME,version:VERSION,symbols:SYMBOLS,interval:INTERVAL,
 architecture:{name:SYSTEM_NAME,id:ARCHITECTURE_ID,deploymentModel:"SINGLE_RENDER_SERVICE",decisionEngine:"EMA5_PULLBACK_TWO_PHASE_M1",
 primaryDecisionEngine:"EMA5_ONLY",indicators:["EMA5"],externalAiCalls:false,dataProvider:"TWELVE_DATA_REAL_M1_OHLC_AND_STREAMING",
 sampling:{openSeconds:[0,2],prepareSeconds:[55,59],entrySeconds:[0,5],restCallsPerMinute:2},
 primaryMiniApp:{route:"/signal",api:"/api/telegram/ema5/status",timeframe:"M1",pairs:SYMBOLS,manualOnly:true},
 signalPolicy:"ONE_PREPARE_AND_ONE_ENTER_PER_SOURCE_CANDLE"},
 configuration:{twelveDataApiKeyPool:twelveDataKeyPool.publicStatus(),configuredApiKeys:twelveDataKeyPool.keyCount,
 restKeyRotation:"ROUND_ROBIN_WITH_FAILOVER",historyCandles:HISTORY_CANDLES,manualOnly:true,brokerExecution:false}});
});

server.listen(PORT, () => {
  console.log(`[${SYSTEM_NAME}] EMA5 MAIN MARKET listening on ${PORT}`);
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