import {
  MIN_CLOSED_CANDLES,
  HISTORY_CANDLES,
  MAX_CANDLE_AGE_SECONDS,
  MAX_STREAM_AGE_SECONDS,
  DIRECTIONAL_THRESHOLD
} from "./config.js";

const finite = Number.isFinite;
const mean = values => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const alpha = 2 / (period + 1);
  let result = mean(values.slice(0, period));
  for (const value of values.slice(period)) result = value * alpha + result * (1 - alpha);
  return result;
}

export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  if (gains === 0) return 0;
  return 100 - 100 / (1 + gains / losses);
}

function macd(values) {
  if (values.length < 43) return null;
  const signalValues = [];
  for (let end = 35; end <= values.length; end++) {
    const slice = values.slice(0, end);
    signalValues.push(ema(slice, 12) - ema(slice, 26));
  }
  const line = ema(values, 12) - ema(values, 26);
  const signal = ema(signalValues, 9);
  return finite(line) && finite(signal)
    ? { line, signal, histogram: line - signal }
    : null;
}

function trueRanges(candles) {
  const result = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i], previous = candles[i - 1];
    result.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  return result;
}

function atr(candles, period = 14) {
  const ranges = trueRanges(candles);
  return ranges.length < period ? null : mean(ranges.slice(-period));
}

function validateCandles(input, now) {
  if (!Array.isArray(input)) return { ok: false, reason: "ไม่มีข้อมูลแท่งเทียน" };
  const minuteStart = Math.floor(now / 60000) * 60;
  const closed = input.filter(candle =>
    candle && candle.live !== true && finite(candle.epoch) && candle.epoch < minuteStart
  );
  if (closed.length < MIN_CLOSED_CANDLES) {
    return {
      ok: false,
      reason: `ประวัติแท่ง M1 ที่ปิดแล้วไม่ครบ ${MIN_CLOSED_CANDLES} แท่ง (${closed.length}/${MIN_CLOSED_CANDLES})`,
      closedCandleCount: closed.length
    };
  }

  const ordered = closed.slice(-HISTORY_CANDLES);
  for (let i = 0; i < ordered.length; i++) {
    const candle = ordered[i];
    if (![candle.open, candle.high, candle.low, candle.close].every(finite)) {
      return { ok: false, reason: "ข้อมูล OHLC มีค่าที่ไม่ใช่ตัวเลข" };
    }
    if (candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close) ||
        candle.high < candle.low) {
      return { ok: false, reason: "โครงสร้าง OHLC ผิดปกติ" };
    }
    if (i > 0) {
      const delta = candle.epoch - ordered[i - 1].epoch;
      if (delta <= 0) return { ok: false, reason: "แท่งเทียนซ้ำหรือเวลาไม่เรียงตามลำดับ" };
      // Market closures can create historical gaps. The most recent five M1 bars
      // must nevertheless be consecutive before a directional decision is allowed.
      if (i >= ordered.length - 4 && delta !== 60) {
        return { ok: false, reason: "แท่ง M1 ล่าสุดมีช่องว่าง — รอข้อมูลต่อเนื่องก่อน" };
      }
    }
  }

  const last = ordered.at(-1);
  const ageSeconds = Math.max(0, now / 1000 - (last.epoch + 60));
  if (ageSeconds > MAX_CANDLE_AGE_SECONDS) {
    return { ok: false, reason: "แท่งเทียนล่าสุดเก่าเกินกำหนด", ageSeconds: Math.round(ageSeconds) };
  }
  return { ok: true, candles: ordered, ageSeconds, closedCandleCount: ordered.length };
}

function classifyRegime({ candles, ema9, ema21, ema50, rsi14, macdData, atr14, atr20 }) {
  const last = candles.at(-1);
  const recent = candles.slice(-20);
  const rangeHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
  const rangeLow = Math.min(...recent.slice(0, -1).map(c => c.low));
  const atrRatio = atr20 > 0 ? atr14 / atr20 : 1;
  const candleRange = last.high - last.low;
  const rangePercent = (rangeHigh - rangeLow) / last.close * 100;
  const trendSpread = Math.abs(ema9 - ema21) / last.close * 100;
  const rising = ema9 > ema21 && ema21 > ema50;
  const falling = ema9 < ema21 && ema21 < ema50;
  const volatilityShock = atrRatio >= 1.8 && candleRange >= atr14 * 1.6;
  const ranging = trendSpread < 0.015 && rangePercent < 0.12;
  const previous = candles.at(-2);
  const reversalUp = ema9 < ema21 && previous.close < ema21 && last.close > ema21 && rsi14 > 52 && macdData.histogram > 0;
  const reversalDown = ema9 > ema21 && previous.close > ema21 && last.close < ema21 && rsi14 < 48 && macdData.histogram < 0;

  let regime = "UNCLEAR";
  if (volatilityShock) regime = "HIGH_VOLATILITY";
  else if (reversalUp || reversalDown) regime = "REVERSAL";
  else if (ranging) regime = "RANGING";
  else if (rising && macdData.histogram > 0) regime = "TRENDING_UP";
  else if (falling && macdData.histogram < 0) regime = "TRENDING_DOWN";

  return { regime, rangeHigh, rangeLow, atrRatio, rising, falling };
}

/** Transparent rule-based evidence engine; it is not a trained ML model. */
export function analyzeMarket(input, { now = Date.now(), tickAgeSeconds = null, allowRestFallback = false } = {}) {
  const validated = validateCandles(input, now);
  if (!validated.ok) return standby(validated.reason, {
    closedCandleCount: validated.closedCandleCount ?? 0,
    requiredCandles: MIN_CLOSED_CANDLES,
    ageSeconds: validated.ageSeconds ?? null
  });

  const candles = validated.candles;
  const closes = candles.map(c => c.close);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const atr14 = atr(candles, 14);
  const atr20 = atr(candles, 20);
  if ([ema9, ema21, ema50, rsi14, atr14, atr20].some(value => !finite(value)) || !macdData) {
    return standby("คำนวณตัวชี้วัดไม่ครบหรือข้อมูลไม่เพียงพอ");
  }

  const context = classifyRegime({ candles, ema9, ema21, ema50, rsi14, macdData, atr14, atr20 });
  const { regime, rangeHigh, rangeLow, atrRatio } = context;
  const nearResistance = rangeHigh >= last.close && rangeHigh - last.close <= atr14 * 0.4;
  const nearSupport = rangeLow <= last.close && last.close - rangeLow <= atr14 * 0.4;
  const momentum3 = last.close - candles.at(-4).close;
  const momentum5 = last.close - candles.at(-6).close;
  const lastThree = candles.slice(-4);
  const upBars = lastThree.slice(1).filter((candle, index) => candle.close > lastThree[index].close).length;
  const downBars = 3 - upBars;
  const bodyAtr = Math.abs(last.close - last.open) / atr14;
  const streamReady = finite(tickAgeSeconds) && tickAgeSeconds >= 0 &&
    tickAgeSeconds <= MAX_STREAM_AGE_SECONDS;
  const restFallbackReady = allowRestFallback && finite(validated.ageSeconds) &&
    validated.ageSeconds <= MAX_CANDLE_AGE_SECONDS;
  const liveReady = streamReady || restFallbackReady;

  const evidence = [
    `EMA 9/21/50: ${ema9.toFixed(5)} / ${ema21.toFixed(5)} / ${ema50.toFixed(5)}`,
    `RSI 14: ${rsi14.toFixed(1)} · MACD histogram: ${macdData.histogram.toFixed(7)}`,
    `ATR14: ${atr14.toFixed(6)} · volatility ratio: ${atrRatio.toFixed(2)}`,
    `3/5-bar momentum: ${momentum3.toFixed(5)} / ${momentum5.toFixed(5)} · last 3 bars: ${upBars} up / ${downBars} down · body: ${bodyAtr.toFixed(2)} ATR`,
    `Support: ${rangeLow.toFixed(5)} · Resistance: ${rangeHigh.toFixed(5)}`
  ];

  // Directional evidence score (0-100), NOT a calibrated win probability.
  // Hard data-integrity and freshness checks remain above this point.
  const bullishScore =
    (context.rising ? 20 : 0) +
    (last.close > ema9 ? 15 : 0) +
    (momentum3 > 0 ? 15 : 0) +
    (momentum5 > 0 ? 15 : 0) +
    (upBars >= 2 ? 15 : 0) +
    (macdData.histogram > 0 ? 10 : 0) +
    (rsi14 >= 50 && rsi14 <= 75 ? 10 : 0);
  const bearishScore =
    (context.falling ? 20 : 0) +
    (last.close < ema9 ? 15 : 0) +
    (momentum3 < 0 ? 15 : 0) +
    (momentum5 < 0 ? 15 : 0) +
    (downBars >= 2 ? 15 : 0) +
    (macdData.histogram < 0 ? 10 : 0) +
    (rsi14 >= 25 && rsi14 <= 50 ? 10 : 0);

  let signal = "STANDBY";
  let reason = "คะแนนสนับสนุนทิศทางยังไม่ถึงเกณฑ์ 53/100";
  if (!liveReady) {
    reason = allowRestFallback
      ? "ข้อมูล REST fallback เก่าเกินกำหนด — ล็อกสัญญาณไว้ที่ STANDBY"
      : tickAgeSeconds === null
        ? "ข้อมูล REST ใช้คำนวณบริบทได้ แต่ยังไม่มีราคา Streaming สด — งด CALL/PUT"
        : "ราคา Streaming เก่าหรือผิดปกติ — ล็อกสัญญาณไว้ที่ STANDBY";
  } else if (bullishScore >= DIRECTIONAL_THRESHOLD && bullishScore > bearishScore) {
    signal = "CALL";
    reason = `คะแนนสนับสนุน CALL ${bullishScore}/100 ถึงเกณฑ์ ${DIRECTIONAL_THRESHOLD}; ไม่ใช้แนวต้านหรือ volatility เป็น hard veto`;
  } else if (bearishScore >= DIRECTIONAL_THRESHOLD && bearishScore > bullishScore) {
    signal = "PUT";
    reason = `คะแนนสนับสนุน PUT ${bearishScore}/100 ถึงเกณฑ์ ${DIRECTIONAL_THRESHOLD}; ไม่ใช้แนวรับหรือ volatility เป็น hard veto`;
  }

  if (signal !== "STANDBY" && restFallbackReady) {
    reason = "REST FALLBACK · วิเคราะห์จากแท่ง M1 ที่ปิดแล้ว: " + reason;
  }

  return {
    signal, regime, reason, evidence,
    dataMode: streamReady ? "STREAMING" : restFallbackReady ? "REST_FALLBACK" : "UNAVAILABLE",
    metrics: {
      ema9, ema21, ema50, rsi14,
      macdLine: macdData.line,
      macdSignal: macdData.signal,
      macdHistogram: macdData.histogram,
      atr14, atr20, volatilityRatio: atrRatio,
      support: rangeLow, resistance: rangeHigh,
      momentum3, momentum5, upBars, downBars, bodyAtr
    },
    lastPrice: last.close,
    lastCandleTime: last.time,
    lastCandleEpoch: last.epoch,
    ageSeconds: Math.round(validated.ageSeconds),
    candleCount: candles.length,
    closedCandleCount: validated.closedCandleCount,
    requiredCandles: MIN_CLOSED_CANDLES,
    livePriceReady: liveReady,
    tickAgeSeconds: liveReady ? Math.round(tickAgeSeconds) : null,
    analyzedAt: new Date(now).toISOString()
  };
}

function standby(reason, extra = {}) {
  return {
    signal: "STANDBY",
    regime: "UNCLEAR",
    reason,
    evidence: [],
    metrics: null,
    analyzedAt: new Date().toISOString(),
    ...extra
  };
}
