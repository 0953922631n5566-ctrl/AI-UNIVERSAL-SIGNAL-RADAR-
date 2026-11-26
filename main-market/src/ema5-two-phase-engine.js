export const EMA5_STRATEGY_ID = "EMA5_PULLBACK_TWO_PHASE_M1";
const EMA_PERIOD = 5;
const EMA_ALPHA = 2 / (EMA_PERIOD + 1);
const MIN_HISTORY = 20;
const PIP = Object.freeze({ "EUR/USD": 0.0001, "EUR/JPY": 0.01, "GBP/USD": 0.0001, "USD/JPY": 0.01 });

export function samplingPhase(epochSeconds) {
  const second = ((Math.floor(epochSeconds) % 60) + 60) % 60;
  if (second <= 2) return "OPEN";
  if (second >= 55) return "PREPARE";
  return "COLLECT";
}

export function calculateEma5(closes) {
  const values = closes.map(Number).filter(Number.isFinite);
  if (values.length < EMA_PERIOD + 1) return null;
  const seed = values.slice(0, EMA_PERIOD).reduce((sum, value) => sum + value, 0) / EMA_PERIOD;
  let ema = seed;
  const result = [ema];
  for (let i = EMA_PERIOD; i < values.length; i++) {
    ema = values[i] * EMA_ALPHA + ema * (1 - EMA_ALPHA);
    result.push(ema);
  }
  return { current: result.at(-1), previous: result.at(-2) };
}

export function analyzeEma5Pullback({ symbol, closedCandles, liveCandle, tickAgeSeconds }) {
  const pip = PIP[symbol];
  if (!pip) return { signal: "WAIT", slope: "WAIT", reason: "คู่เงินนี้ยังไม่รองรับ" };
  if (!liveCandle || liveCandle.live !== true) return { signal: "WAIT", slope: "WAIT", reason: "รอแท่ง M1 ปัจจุบัน" };
  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > 5) {
    return { signal: "WAIT", slope: "WAIT", reason: "รอราคา Streaming สดไม่เกิน 5 วินาที" };
  }
  const closed = [...(closedCandles || [])]
    .filter(c => c && c.live !== true && Number.isFinite(c.epoch))
    .sort((a, b) => a.epoch - b.epoch);
  if (closed.length < MIN_HISTORY) return { signal: "WAIT", slope: "WAIT", reason: `ประวัติแท่งปิดไม่พอ (${closed.length}/${MIN_HISTORY})` };
  const closes = [...closed.map(c => Number(c.close)), Number(liveCandle.close)];
  if (closes.some(v => !Number.isFinite(v)) ||
      ![liveCandle.open, liveCandle.high, liveCandle.low, liveCandle.close].every(Number.isFinite)) {
    return { signal: "WAIT", slope: "WAIT", reason: "OHLC ไม่สมบูรณ์" };
  }
  const ema = calculateEma5(closes);
  if (!ema) return { signal: "WAIT", slope: "WAIT", reason: "คำนวณ EMA5 ไม่สำเร็จ" };
  const delta = ema.current - ema.previous;
  const slopePips = delta / pip;
  const slope = Math.abs(slopePips) < 0.1 ? "FLAT" : delta > 0 ? "UP" : "DOWN";
  const common = {
    ema5: ema.current, previousEma5: ema.previous,
    slope, slopePips: Number(slopePips.toFixed(3)),
    openPrice: liveCandle.open, closePrice: liveCandle.close,
    highPrice: liveCandle.high, lowPrice: liveCandle.low,
    sourceCandleEpoch: liveCandle.epoch, targetCandleEpoch: liveCandle.epoch + 60,
    tickAgeSeconds: Number(tickAgeSeconds.toFixed(2)),
    indicator: "EMA5", source: "Twelve Data M1 OHLC + local EMA5"
  };
  if (slope === "FLAT") return { ...common, signal: "WAIT", regime: "SIDEWAY", reason: "EMA5 แบนราบ · SIDEWAY · งดส่งสัญญาณ" };
  if (slope === "UP" && liveCandle.low <= ema.current &&
      liveCandle.close > liveCandle.open && liveCandle.close > ema.current) {
    return { ...common, signal: "CALL", regime: "UPTREND", reason: "EMA5 ชันขึ้น · ไส้เทียนย่อลงทดสอบ EMA5 และปิดฟื้นเหนือเส้น" };
  }
  if (slope === "DOWN" && liveCandle.high >= ema.current &&
      liveCandle.close < liveCandle.open && liveCandle.close < ema.current) {
    return { ...common, signal: "PUT", regime: "DOWNTREND", reason: "EMA5 ชันลง · ราคาเด้งทดสอบ EMA5 และถูกกดปิดใต้เส้น" };
  }
  return { ...common, signal: "WAIT", regime: "WAIT", reason: "ยังไม่ครบเงื่อนไข EMA5 Pullback" };
}

export function enterPreparedSignal(state, targetEpoch) {
  if (!state || !Number.isFinite(targetEpoch) ||
      state.preparedForEpoch !== targetEpoch ||
      !["CALL", "PUT"].includes(state.preparedSignal) ||
      state.enteredEpoch === targetEpoch) return null;
  state.enteredEpoch = targetEpoch;
  state.phase = "ENTER";
  state.signal = state.preparedSignal;
  state.alertId = `${state.sourceEpoch}:${targetEpoch}:${state.preparedSignal}:EMA5`;
  state.enteredAt = new Date(targetEpoch * 1000).toISOString();
  state.history = [{
    id: state.alertId, signal: state.signal,
    sourceEpoch: state.sourceEpoch, targetEpoch,
    issuedAt: state.enteredAt, status: "ENTER"
  }, ...(state.history || [])].slice(0, 10);
  return { signal: state.signal, alertId: state.alertId, targetEpoch };
}

export const EMA5_MIN_HISTORY = MIN_HISTORY;
