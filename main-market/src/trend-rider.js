/**
 * Engine 3 — Trend First / Instant Entry.
 * EMA(5), EMA(20), and ATR(14) are provider-calculated by Twelve Data.
 * Raw OHLC and the current live M1 candle are used only for price-action triggers.
 * No locally calculated technical indicators, score voting, or delayed candle-close trigger.
 */
export function analyzeTrendRider(candles, options = {}) {
  const minimum = Number.isInteger(options.minimumCandles) ? options.minimumCandles : 54;
  const validCandles = Array.isArray(candles) && candles.length >= minimum &&
    candles.every(c => c && [c.open, c.high, c.low, c.close, c.epoch].every(Number.isFinite) &&
      c.low > 0 && c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close) && c.high >= c.low);
  if (!validCandles) {
    return { ready: false, signal: null, status: "NOT_READY",
      reason: `Engine 3 ต้องมีแท่ง M1 OHLC จาก Twelve Data อย่างน้อย ${minimum} แท่ง`,
      strategy: "TWELVE_DATA_EMA5_EMA20_ATR14_TREND_FIRST_INSTANT_ENTRY" };
  }

  const { ema5Values = [], ema20Values = [], atrValues = [] } = options;
  const aligned = (rows, key) => Array.isArray(rows) && rows.length >= 4 &&
    rows.slice(-4).every((value, index, values) =>
      Number.isFinite(value?.[key]) && Number.isFinite(value?.epoch) &&
      (index === 0 || value.epoch - values[index - 1].epoch === 60));
  const ema5Ready = aligned(ema5Values, "ema");
  const ema20Ready = aligned(ema20Values, "ema");
  const atrReady = aligned(atrValues, "atr");
  if (!ema5Ready || !ema20Ready || !atrReady) {
    return { ready: false, signal: null, status: "TWELVE_DATA_INDICATORS_NOT_READY",
      reason: "รอ EMA5, EMA20 และ ATR14 จาก Twelve Data ให้ครบและต่อเนื่อง",
      indicatorStatus: { ema5: ema5Ready ? "READY" : "WAITING",
        ema20: ema20Ready ? "READY" : "WAITING", atr14: atrReady ? "READY" : "WAITING" },
      strategy: "TWELVE_DATA_EMA5_EMA20_ATR14_TREND_FIRST_INSTANT_ENTRY" };
  }

  const last = candles.at(-1);
  const fastNow = ema5Values.at(-1).ema;
  const fastPrevious = ema5Values.at(-2).ema;
  const slowNow = ema20Values.at(-1).ema;
  const volatility = atrValues.at(-1).atr;
  const indicatorEpochs = [ema5Values.at(-1).epoch, ema20Values.at(-1).epoch, atrValues.at(-1).epoch];
  const indicatorEpoch = indicatorEpochs[0];
  const indicatorLagSeconds = last.epoch - indicatorEpoch;
  const indicatorLagCandles = indicatorLagSeconds / 60;

  // Native indicator responses may lag the latest completed M1 candle by one candle.
  if (!Number.isFinite(volatility) || volatility <= 0 ||
      indicatorEpochs.some(epoch => epoch !== indicatorEpoch) ||
      indicatorLagSeconds < 0 || !Number.isInteger(indicatorLagCandles) || indicatorLagCandles > 1) {
    return { ready: false, signal: null, status: "TWELVE_DATA_INDICATORS_STALE",
      reason: "ค่า EMA/ATR จาก Twelve Data ล่าช้าหรือเวลาไม่ตรงกัน · งดสัญญาณ",
      indicatorStatus: { ema5: "STALE", ema20: "STALE", atr14: "STALE" },
      metrics: { indicatorEpoch, sourceCandleEpoch: last.epoch,
        indicatorLagCandles: Number.isFinite(indicatorLagCandles) ? indicatorLagCandles : null },
      strategy: "TWELVE_DATA_EMA5_EMA20_ATR14_TREND_FIRST_INSTANT_ENTRY" };
  }

  const live = options.liveCandle;
  const liveValid = Boolean(live && live.live === true && live.epoch === last.epoch + 60 &&
    [live.open, live.high, live.low, live.close].every(Number.isFinite) &&
    live.low > 0 && live.high >= Math.max(live.open, live.close) &&
    live.low <= Math.min(live.open, live.close) && live.high >= live.low);
  if (!liveValid) {
    return { ready: true, signal: null, status: "WAITING_LIVE_CANDLE",
      reason: "รอราคา Streaming สดของแท่ง M1 ปัจจุบันจาก Twelve Data",
      provider: "TWELVE_DATA_NATIVE_INDICATORS",
      indicatorStatus: { ema5: "READY", ema20: "READY", atr14: "READY" },
      strategy: "TWELVE_DATA_EMA5_EMA20_ATR14_TREND_FIRST_INSTANT_ENTRY" };
  }

  const upTrend = fastNow > slowNow && fastNow > fastPrevious;
  const downTrend = fastNow < slowNow && fastNow < fastPrevious;
  const emaGapAtr = Math.abs(fastNow - slowNow) / volatility;
  const liveRange = live.high - live.low;
  const liveBodyAtr = Math.abs(live.close - live.open) / volatility;
  const extensionAtr = Math.abs(live.close - fastNow) / volatility;
  const bullishLive = live.close > live.open && live.close > fastNow && liveBodyAtr >= 0.03;
  const bearishLive = live.close < live.open && live.close < fastNow && liveBodyAtr >= 0.03;
  const sideways = emaGapAtr < 0.05;
  const lateExtension = extensionAtr > 1.5;
  const abnormalRange = liveRange > volatility * 2.8;

  let signal = null;
  let status = "WAITING_ENTRY_TRIGGER";
  let reason = upTrend
    ? "แนวโน้มขึ้นแล้ว · รอราคา Streaming ยืนเหนือ EMA5"
    : downTrend
      ? "แนวโน้มลงแล้ว · รอราคา Streaming ยืนใต้ EMA5"
      : "EMA5 ยังไม่แสดงแนวโน้มที่ชัดเจน";

  if (sideways) {
    status = "SIDEWAYS_BLOCK";
    reason = "EMA5 และ EMA20 ใกล้กันเกินไป · งดเข้าในตลาดออกข้าง";
  } else if (lateExtension) {
    status = "LATE_ENTRY_BLOCK";
    reason = "ราคาออกห่าง EMA5 เกิน 1.5 ATR · ไม่ไล่ตามราคา";
  } else if (abnormalRange) {
    status = "VOLATILITY_BLOCK";
    reason = "ช่วงแกว่งของแท่งสดกว้างผิดปกติเมื่อเทียบกับ ATR14";
  } else if (upTrend && bullishLive) {
    signal = "CALL";
    status = "INSTANT_UPTREND_ENTRY";
    reason = "EMA5 อยู่เหนือ EMA20 และราคา Streaming ยืนยันแรงซื้อเหนือ EMA5";
  } else if (downTrend && bearishLive) {
    signal = "PUT";
    status = "INSTANT_DOWNTREND_ENTRY";
    reason = "EMA5 อยู่ใต้ EMA20 และราคา Streaming ยืนยันแรงขายใต้ EMA5";
  }

  const blockers = [];
  if (!upTrend && !downTrend) blockers.push("EMA_TREND_NOT_ALIGNED");
  if (sideways) blockers.push("SIDEWAYS");
  if (lateExtension) blockers.push("LATE_ENTRY");
  if (abnormalRange) blockers.push("ABNORMAL_RANGE");
  if (upTrend && !bullishLive) blockers.push("CALL_LIVE_TRIGGER_NOT_MET");
  if (downTrend && !bearishLive) blockers.push("PUT_LIVE_TRIGGER_NOT_MET");

  return {
    ready: true, signal, direction: signal, status, reason, blockers,
    strategy: "TWELVE_DATA_EMA5_EMA20_ATR14_TREND_FIRST_INSTANT_ENTRY",
    provider: "TWELVE_DATA_NATIVE_INDICATORS",
    regime: upTrend ? "UPTREND" : downTrend ? "DOWNTREND" : "UNCLEAR",
    metrics: {
      ema5: fastNow, ema20: slowNow, atr14: volatility,
      emaGapAtr: Number(emaGapAtr.toFixed(3)),
      extensionAtr: Number(extensionAtr.toFixed(3)),
      liveBodyAtr: Number(liveBodyAtr.toFixed(3)),
      liveRangeAtr: Number((liveRange / volatility).toFixed(3)),
      indicatorEpoch, sourceCandleEpoch: last.epoch, indicatorLagCandles,
      upTrend, downTrend, bullishLive, bearishLive,
      ema5Source: "Twelve Data /ema time_period=5",
      ema20Source: "Twelve Data /ema time_period=20",
      atr14Source: "Twelve Data /atr time_period=14"
    },
    indicatorStatus: { ema5: "READY", ema20: "READY", atr14: "READY" },
    evidence: [
      upTrend || downTrend ? "EMA5/EMA20 native trend alignment confirmed" : "EMA trend not aligned",
      bullishLive || bearishLive ? "Live M1 price action confirms entry side of EMA5" : "Waiting for live price trigger",
      sideways ? "Sideways guard active" : "EMA separation acceptable",
      lateExtension ? "Late-extension guard active" : "Price not excessively extended",
      abnormalRange ? "Abnormal-range guard active" : "Live range within ATR guard"
    ]
  };
}
