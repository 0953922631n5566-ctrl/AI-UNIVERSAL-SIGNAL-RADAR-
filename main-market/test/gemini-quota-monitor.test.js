import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiQuotaMonitor } from "../src/gemini-quota-monitor.js";

test("counts outbound attempts and makes an unconfigured budget explicit", () => {
  let now = Date.UTC(2026, 10, 9, 12);
  const monitor = createGeminiQuotaMonitor({ clock: () => now });
  monitor.recordStarted({ model: "gemini-3.5-flash-lite" });
  monitor.recordFinished({ status: 200 });
  const status = monitor.getStatus();
  assert.equal(status.requestAttempts, 1);
  assert.equal(status.httpSuccesses, 1);
  assert.equal(status.budgetConfigured, false);
  assert.equal(status.usagePercent, null);
  assert.equal(status.quotaSource, "SERVER_OBSERVED_REQUESTS_NOT_GOOGLE_REMAINING_QUOTA");
});

test("emits 80 percent and 95 percent threshold alerts once per UTC day", () => {
  let now = Date.UTC(2026, 10, 9, 12);
  const monitor = createGeminiQuotaMonitor({ dailyBudget: 10, clock: () => now });
  for (let i = 0; i < 8; i++) monitor.recordStarted();
  assert.equal(monitor.getStatus().latestAlert.type, "DAILY_BUDGET_80");
  monitor.recordStarted();
  assert.equal(monitor.getStatus().latestAlert.type, "DAILY_BUDGET_80");
  monitor.recordStarted();
  assert.equal(monitor.getStatus().latestAlert.type, "DAILY_BUDGET_95");
  assert.equal(monitor.getStatus().usagePercent, 100);
});

test("records HTTP 429 and resets daily counters at UTC midnight", () => {
  let now = Date.UTC(2026, 10, 9, 23, 59);
  const monitor = createGeminiQuotaMonitor({ dailyBudget: 20, clock: () => now });
  monitor.recordStarted();
  monitor.recordFinished({ status: 429 });
  assert.equal(monitor.getStatus().rateLimited429, 1);
  assert.equal(monitor.getStatus().latestAlert.type, "HTTP_429");
  now += 2 * 60 * 1000;
  const nextDay = monitor.getStatus();
  assert.equal(nextDay.requestAttempts, 0);
  assert.equal(nextDay.rateLimited429, 0);
  assert.equal(nextDay.latestAlert, null);
});
