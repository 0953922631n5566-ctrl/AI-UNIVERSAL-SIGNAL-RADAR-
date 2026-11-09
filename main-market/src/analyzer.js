import {
  MIN_CLOSED_CANDLES, CONTEXT_CANDLES, ENTRY_CANDLES,
  MAX_CANDLE_AGE_SECONDS, MAX_STREAM_AGE_SECONDS
} from "./config.js";

/**
 * Next-M1 Forecast Engine.
 * Market-data transport, authentication, sessions and UI remain owned by the
 * existing application. This module receives the already-connected candle feed.
 */
export class NextM1Analyzer {
  constructor() { this.timeframe = "M1"; }

  calculateWMA(data, period, key = "close") {
    const values = data.map(item => Number(item?.[key]));
    return this.calculateWMAValues(values, period);
  }

  calculateWMAValues(values, period) {
    const result = Array(values.length).fill(null);
    if (!Number.isInteger(period) || period < 1) return result;
    const denominator = period * (period + 1) / 2;
    for (let i = period - 1; i < values.length; i++) {
      let weighted = 0;
      let valid = true;
      for (let j = 0; j < period; j++) {
        const value = values[i - j];
        if (!Number.isFinite(value)) { valid = false; break; }
        weighted += value * (period - j);
      }
      if (valid) result[i] = weighted / denominator;
    }
    return result;
  }

  calculateHMA(data, period) {
    const halfLength = Math.max(1, Math.floor(period / 2));
    const sqrtLength = Math.max(1, Math.floor(Math.sqrt(period)));
    const half = this.calculateWMA(data, halfLength, "close");
    const full = this.calculateWMA(data, period, "close");
    const raw = half.map((value, i) =>
      Number.isFinite(value) && Number.isFinite(full[i]) ? 2 * value - full[i] : null
    );
    return this.calculateWMAValues(raw, sqrtLength);
  }

  calculateRSI(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length <= period ||
        closes.some(value => !Number.isFinite(value))) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    if (avgGain === 0) return 0;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  analyzeCandle(currentCandle, previousCandle) {
    const body = Math.abs(currentCandle.close - currentCandle.open);
    const range = currentCandle.high - currentCandle.low;
    const isBullish = currentCandle.close > currentCandle.open;
    const bodyRatio = range > 0 ? body / range : 0;
    return { isBullish, body, range, bodyRatio, isValidBody: bodyRatio >= 0.40,
      previousClose: previousCandle?.close ?? null };
  }

  evaluateSignal(candles) {
    if (!Array.isArray(candles) || candles.length < 56) {
      return { signal: "STANDBY", reason: "HMA 50 warm-up requires 56 closed M1 candles",
        confidence: null, price: candles?.at(-1)?.close ?? null, strategy: "NEXT_M1_HMA_RSI_TREND" };
    }
    const closes = candles.map(c => c.close);
    if (closes.some(value => !Number.isFinite(value))) {
      return { signal: "STANDBY", reason: "Invalid close price in analysis window", strategy: "NEXT_M1_HMA_RSI_TREND" };
    }

    const current = candles.at(-1);
    const previous = candles.at(-2);
    const hmaFast = this.calculateHMA(candles, 7).at(-1);
    const hmaMid = this.calculateHMA(candles, 21).at(-1);
    const hmaSlow = this.calculateHMA(candles, 50).at(-1);
    const rsi = this.calculateRSI(closes, 14);
    if (![hmaFast, hmaMid, hmaSlow, rsi].every(Number.isFinite)) {
      return { signal: "STANDBY", reason: "Indicators are not warmed up",
        price: current.close, indicators: { hmaFast, hmaMid, hmaSlow, rsi } };
    }

    const candle = this.analyzeCandle(current, previous);
    const isUptrend = hmaFast > hmaMid && hmaMid > hmaSlow;
    const isDowntrend = hmaFast < hmaMid && hmaMid < hmaSlow;
    const callTrigger = isUptrend && rsi > 50 && rsi < 75 &&
      candle.isBullish && candle.isValidBody && current.close > hmaFast;
    const putTrigger = isDowntrend && rsi < 50 && rsi > 25 &&
      !candle.isBullish && candle.isValidBody && current.close < hmaFast;
    const indicators = { hmaFast, hmaMid, hmaSlow, rsi,
      candleBodyRatio: candle.bodyRatio, trend: isUptrend ? "UPTREND" :
        isDowntrend ? "DOWNTREND" : "UNALIGNED" };

    if (callTrigger) return { signal: "CALL", confidence: "HIGH",
      reason: "Uptrend HMA aligned, Strong Bullish Candle, RSI Momentum OK",
      price: current.close, indicators, strategy: "NEXT_M1_HMA_RSI_TREND" };
    if (putTrigger) return { signal: "PUT", confidence: "HIGH",
      reason: "Downtrend HMA aligned, Strong Bearish Candle, RSI Momentum OK",
      price: current.close, indicators, strategy: "NEXT_M1_HMA_RSI_TREND" };
    return { signal: "STANDBY",
      reason: "Market consolidating or conditions not met",
      price: current.close, indicators, strategy: "NEXT_M1_HMA_RSI_TREND" };
  }
}

const nextM1Analyzer = new NextM1Analyzer();

function sourceGate(candles, options) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const closed = Array.isArray(candles)
    ? candles.filter(c => c && c.live !== true && Number.isFinite(c.epoch) &&
        c.epoch < Math.floor(now / 60000) * 60)
    : [];
  const last = closed.at(-1) || null;
  const ageSeconds = last ? Math.max(0, now / 1000 - (last.epoch + 60)) : Infinity;
  const stream = Number.isFinite(options.tickAgeSeconds) &&
    options.tickAgeSeconds >= 0 && options.tickAgeSeconds <= MAX_STREAM_AGE_SECONDS;
  const rest = options.allowRestFallback === true && ageSeconds <= MAX_CANDLE_AGE_SECONDS;
  const enough = closed.length >= MIN_CLOSED_CANDLES;
  const window = closed.slice(-MIN_CLOSED_CANDLES);
  const validOHLC = enough && window.every(c =>
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.low > 0 && c.close > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low
  );
  const ordered = window.every((c, i) => i === 0 || c.epoch > window[i - 1].epoch);
  const reason = !enough ? `Insufficient closed M1 candles (${closed.length}/${MIN_CLOSED_CANDLES})`
    : !validOHLC ? "Invalid OHLC candle data"
    : !ordered ? "Candle timestamps are not strictly increasing"
    : ageSeconds > MAX_CANDLE_AGE_SECONDS ? "Latest closed candle is stale"
    : !stream && !rest ? "No fresh Streaming tick or permitted fresh REST fallback"
    : null;
  return { ready: !reason, reason, mode: stream ? "STREAMING" :
    rest ? "REST_FALLBACK" : "UNAVAILABLE", ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
    lastCandleEpoch: last?.epoch ?? null, closed };
}

/** Keep source-quality checks; replace only the directional analysis brain. */
export async function analyzeMarket(candles, options = {}) {
  const gate = sourceGate(candles, options);
  const base = {
    lastCandleEpoch: gate.lastCandleEpoch,
    dataMode: gate.mode,
    ageSeconds: gate.ageSeconds,
    livePriceReady: gate.ready,
    closedCandleCount: gate.closed.length,
    requiredCandles: MIN_CLOSED_CANDLES,
    analysisWindow: { contextCandles: CONTEXT_CANDLES, entryCandles: ENTRY_CANDLES,
      total: MIN_CLOSED_CANDLES }
  };
  if (!gate.ready) return {
    signal: "STANDBY", reason: gate.reason, regime: "UNCLEAR", score: 0,
    strategy: "NONE", indicators: null, ...base
  };

  const decision = nextM1Analyzer.evaluateSignal(gate.closed);
  const score = decision.signal === "CALL" || decision.signal === "PUT" ? 100 : 0;
  return {
    ...decision, ...base, regime: decision.indicators?.trend ?? "UNCLEAR",
    score, evidence: decision.indicators ? [
      `HMA 7/21/50: ${decision.indicators.hmaFast.toFixed(6)} / ${decision.indicators.hmaMid.toFixed(6)} / ${decision.indicators.hmaSlow.toFixed(6)}`,
      `RSI 14: ${decision.indicators.rsi.toFixed(2)}`,
      `Candle body ratio: ${(decision.indicators.candleBodyRatio * 100).toFixed(1)}%`
    ] : [], metrics: decision.indicators ?? null,
    analyzedAt: new Date(Number.isFinite(options.now) ? options.now : Date.now()).toISOString(),
    confidenceMeaning: "RULE_CONDITION_MATCH_NOT_WIN_PROBABILITY"
  };
}
