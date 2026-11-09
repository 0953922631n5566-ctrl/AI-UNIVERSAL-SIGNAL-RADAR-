const ALERT_DEDUPE_MS = 5 * 60 * 1000;

function parseBudget(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function createGeminiQuotaMonitor({ dailyBudget = null, clock = () => Date.now() } = {}) {
  const budget = parseBudget(dailyBudget);
  let day = "";
  let state;
  let sequence = 0;
  const notifiedThresholds = new Set();
  let last429AlertAt = 0;

  function resetIfNeeded() {
    const now = clock();
    const nextDay = new Date(now).toISOString().slice(0, 10);
    if (nextDay !== day) {
      day = nextDay;
      sequence = 0;
      notifiedThresholds.clear();
      last429AlertAt = 0;
      state = {
        dayUtc: day, requestAttempts: 0, httpSuccesses: 0,
        rateLimited429: 0, httpErrors: 0, transportErrors: 0,
        lastRequestAt: null, lastHttpStatus: null, latestAlert: null
      };
    }
    return now;
  }

  function emitAlert(type, title, message, now) {
    sequence += 1;
    state.latestAlert = {
      id: day + ":" + sequence, type, title, message,
      createdAt: new Date(now).toISOString(),
      observedRequests: state.requestAttempts,
      dailyBudget: budget,
      usagePercent: budget ? Math.round(state.requestAttempts / budget * 1000) / 10 : null
    };
  }

  function checkThreshold(now) {
    if (!budget) return;
    const percent = state.requestAttempts / budget * 100;
    if (percent >= 95 && !notifiedThresholds.has(95)) {
      notifiedThresholds.add(95);
      notifiedThresholds.add(80);
      emitAlert("DAILY_BUDGET_95", "Gemini API ใช้งบอ้างอิงถึง 95%", `นับได้ ${state.requestAttempts.toLocaleString("en-US")} จากงบอ้างอิง ${budget.toLocaleString("en-US")} requests วันนี้ (UTC)`, now);
    } else if (percent >= 80 && !notifiedThresholds.has(80)) {
      notifiedThresholds.add(80);
      emitAlert("DAILY_BUDGET_80", "Gemini API ใช้งบอ้างอิงถึง 80%", `นับได้ ${state.requestAttempts.toLocaleString("en-US")} จากงบอ้างอิง ${budget.toLocaleString("en-US")} requests วันนี้ (UTC)`, now);
    }
  }

  function recordStarted({ model } = {}) {
    const now = resetIfNeeded();
    state.requestAttempts += 1;
    state.lastRequestAt = new Date(now).toISOString();
    state.lastModel = String(model || "unknown");
    checkThreshold(now);
    return state.requestAttempts;
  }

  function recordFinished({ status = 0, model } = {}) {
    const now = resetIfNeeded();
    const code = Number(status) || 0;
    state.lastHttpStatus = code || null;
    if (code >= 200 && code < 300) state.httpSuccesses += 1;
    else if (code === 429) {
      state.rateLimited429 += 1;
      if (now - last429AlertAt >= ALERT_DEDUPE_MS) {
        last429AlertAt = now;
        emitAlert("HTTP_429", "Gemini API ถูกจำกัดคำขอ (HTTP 429)", "Gemini ปฏิเสธคำขอเนื่องจากข้อจำกัดอัตราการใช้งานหรือโควต้า · ระบบจะไม่ส่งคำขอซ้ำในแท่ง M1 เดิม", now);
      }
    } else if (code > 0) state.httpErrors += 1;
    else state.transportErrors += 1;
    if (model) state.lastModel = String(model);
  }

  function getStatus() {
    resetIfNeeded();
    const usagePercent = budget ? Math.round(state.requestAttempts / budget * 1000) / 10 : null;
    return {
      ...state,
      dailyBudget: budget,
      budgetConfigured: Boolean(budget),
      budgetSource: budget ? "GEMINI_DAILY_REQUEST_BUDGET_ENV" : "NOT_CONFIGURED",
      usagePercent,
      window: "UTC_CALENDAR_DAY",
      quotaSource: "SERVER_OBSERVED_REQUESTS_NOT_GOOGLE_REMAINING_QUOTA"
    };
  }

  return { recordStarted, recordFinished, getStatus };
}

const monitor = createGeminiQuotaMonitor({ dailyBudget: process.env.GEMINI_DAILY_REQUEST_BUDGET });
export const recordGeminiRequestStarted = details => monitor.recordStarted(details);
export const recordGeminiRequestFinished = details => monitor.recordFinished(details);
export const getGeminiQuotaStatus = () => monitor.getStatus();
