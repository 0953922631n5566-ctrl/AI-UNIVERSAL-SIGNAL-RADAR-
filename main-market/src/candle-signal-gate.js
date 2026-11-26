/**
 * Analyze each completed M1 candle once and bind any directional result to
 * the immediately following live M1 candle. Polling/refreshes reuse the same
 * cached result and cannot dispatch a second signal for the same source candle.
 */
export const CANDLE_ENTRY_WINDOW_MS = 10_000;
export const CANDLE_SIGNAL_MAX_TICK_AGE_SECONDS = 5;

export function resolveClosedCandleSignal({
  state,
  closedCandles,
  liveCandle,
  monitoring,
  monitoringStartedAt,
  tickAgeSeconds,
  now = Date.now(),
  predict
}) {
  const latestClosed = closedCandles?.at(-1);
  const standby = (reason, extra = {}) => ({
    signal: "STANDBY",
    reason,
    sourceCandleEpoch: latestClosed?.epoch ?? null,
    targetCandleEpoch: latestClosed ? latestClosed.epoch + 60 : null,
    oneSignalPerClosedCandle: true,
    ...extra
  });

  if (!latestClosed || !Number.isFinite(latestClosed.epoch)) {
    return standby("รอแท่ง M1 ปิดล่าสุดจาก Twelve Data");
  }

  const targetEpoch = latestClosed.epoch + 60;
  if (!monitoring) return standby("ระบบเฝ้าระวังยังไม่เริ่มรับราคาตลาดสด");

  // Once evaluated, later polls reuse the cached result. If monitoring was
  // stopped and restarted after the target candle opened, never re-show it.
  if (state?.sourceEpoch === latestClosed.epoch && state.result) {
    if (monitoringStartedAt > targetEpoch * 1000) {
      return standby("แท่งนี้ถูกประมวลผลไปแล้ว · ไม่ส่งสัญญาณซ้ำ", {
        targetCandleEpoch: targetEpoch,
        alreadyIssued: true
      });
    }
    return state.result;
  }
  if (!liveCandle?.live || liveCandle.epoch !== targetEpoch) {
    return standby("รอแท่ง M1 ถัดไปเริ่มต้น เพื่อส่งสัญญาณทันที");
  }

  const elapsedMs = now - targetEpoch * 1000;
  if (targetEpoch * 1000 < monitoringStartedAt) {
    return standby("เริ่มเฝ้าระวังกลางแท่งแล้ว · รอแท่งใหม่ถัดไปเพื่อไม่ส่งสัญญาณย้อนหลัง");
  }

  if (elapsedMs < 0) return standby("รอแท่ง M1 เป้าหมายเปิด");
  if (elapsedMs > CANDLE_ENTRY_WINDOW_MS) {
    const result = standby("พ้นช่วงเข้าแท่งใหม่ 10 วินาทีแล้ว · ข้ามเพื่อไม่ส่งสัญญาณล่าช้า", {
      targetCandleEpoch: targetEpoch,
      entryWindowExpired: true
    });
    state.sourceEpoch = latestClosed.epoch;
    state.result = result;
    return result;
  }

  if (!Number.isFinite(tickAgeSeconds) || tickAgeSeconds > CANDLE_SIGNAL_MAX_TICK_AGE_SECONDS) {
    return standby("รอราคา Streaming สดไม่เกิน 5 วินาที ก่อนยืนยันสัญญาณ", {
      targetCandleEpoch: targetEpoch
    });
  }

  const prediction = predict(closedCandles);
  const directional = ["CALL", "PUT"].includes(prediction?.signal);
  const result = {
    ...prediction,
    signal: directional ? prediction.signal : "STANDBY",
    sourceCandleEpoch: latestClosed.epoch,
    targetCandleEpoch: targetEpoch,
    signalTargetCandleAt: new Date(targetEpoch * 1000).toISOString(),
    issuedAt: new Date(now).toISOString(),
    alertId: directional ? `${latestClosed.epoch}:${targetEpoch}:${prediction.signal}:CANDLE200K` : null,
    oneSignalPerClosedCandle: true,
    entryWindowSeconds: CANDLE_ENTRY_WINDOW_MS / 1000,
    reason: directional
      ? `${prediction.reason} · สัญญาณสำหรับแท่งถัดไปทันที · ออกได้ครั้งเดียวต่อแท่ง`
      : `${prediction.reason || "ไม่มีรูปแบบที่ผ่านเกณฑ์"} · ประมวลผลแท่งปิดนี้แล้ว ไม่วิเคราะห์ซ้ำ`
  };

  state.sourceEpoch = latestClosed.epoch;
  state.result = result;
  return result;
}
