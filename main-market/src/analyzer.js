import {
  MIN_CLOSED_CANDLES, CONTEXT_CANDLES, ENTRY_CANDLES,
  MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS
} from "./config.js";
import { scoreMarket } from "./advanced-scoring.js";

export function sourceGate(candles, options = {}) {
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const closed=Array.isArray(candles)?candles.filter(c=>c&&c.live!==true&&Number.isFinite(c.epoch)&&c.epoch<Math.floor(now/60000)*60):[];
  const last=closed.at(-1)||null;
  const ageSeconds=last?Math.max(0,now/1000-(last.epoch+60)):Infinity;
  const stream=Number.isFinite(options.tickAgeSeconds)&&options.tickAgeSeconds>=0&&options.tickAgeSeconds<=MAX_STREAM_AGE_SECONDS;
  const rest=options.allowRestFallback===true&&ageSeconds<=MAX_CANDLE_AGE_SECONDS;
  const enough=closed.length>=MIN_CLOSED_CANDLES;
  const window=closed.slice(-MIN_CLOSED_CANDLES);
  const validOHLC=enough&&window.every(c=>[c.open,c.high,c.low,c.close].every(Number.isFinite)&&c.low>0&&c.close>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.high>=c.low);
  const ordered=window.every((c,i)=>i===0||c.epoch-window[i-1].epoch===60);
  const reason=!enough?`Insufficient closed M1 candles (${closed.length}/${MIN_CLOSED_CANDLES})`
    :!validOHLC?"Invalid OHLC candle data":!ordered?"Candle timestamps are not consecutive"
    :ageSeconds>MAX_CANDLE_AGE_SECONDS?"Latest closed candle is stale"
    :!stream&&!rest?"No fresh Twelve Data Streaming tick":null;
  return {ready:!reason,reason,mode:stream?"STREAMING":rest?"REST_FALLBACK":"UNAVAILABLE",
    ageSeconds:Number.isFinite(ageSeconds)?ageSeconds:null,lastCandleEpoch:last?.epoch??null,closed};
}

/** The legacy 65-point Partial Scoring model, adapted to provider-native Twelve Data indicators. */
export async function analyzeMarket(candles, options = {}) {
  const gate=sourceGate(candles,options);
  const base={lastCandleEpoch:gate.lastCandleEpoch,dataMode:gate.mode,ageSeconds:gate.ageSeconds,
    livePriceReady:gate.ready,closedCandleCount:gate.closed.length,requiredCandles:MIN_CLOSED_CANDLES,
    analysisWindow:{contextCandles:CONTEXT_CANDLES,entryCandles:ENTRY_CANDLES,total:MIN_CLOSED_CANDLES}};
  if(!gate.ready)return {signal:"STANDBY",reason:gate.reason,regime:"UNCLEAR",score:0,confidence:0,
    strategy:"SOURCE_QUALITY_GUARD",provider:"SYSTEM_GUARD",evidence:[],riskFlags:[gate.reason],...base};
  const scored=scoreMarket(gate.closed.slice(-MIN_CLOSED_CANDLES),options.indicators);
  return {...scored,...base,prepareSignal:scored.prepareSignal||null,
    analyzedAt:new Date(Number.isFinite(options.now)?options.now:Date.now()).toISOString(),
    signalReleaseValidated:false,
    signalValidationStatus:"TWELVE_DATA_NATIVE_SCORING_65_MANUAL_ONLY_NOT_OOS_VALIDATED",
    signalValidationNote:"All Analysis Threshold 65 · EMA5/EMA20/ATR14 จาก Twelve Data Native · ยังไม่มีผลประเมิน out-of-sample · ใช้ประกอบการตัดสินใจด้วยตนเองเท่านั้น"};
}
