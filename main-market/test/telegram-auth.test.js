import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateTelegramWebAppInitData } from "../src/telegram-auth.js";

const botToken = "test-bot-token";
const now = Date.UTC(2026, 10, 9, 12, 0, 0);
function signedInitData(overrides = {}) {
  const values = new URLSearchParams({
    auth_date: String(Math.floor(now / 1000)), query_id: "AAExampleQuery",
    user: JSON.stringify({ id: 6451332748, first_name: "Test" }), ...overrides
  });
  const check = [...values.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  values.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return values.toString();
}
test("accepts valid Telegram Mini App initData and returns its signed user", () => {
  const result = validateTelegramWebAppInitData(signedInitData(), botToken, { now });
  assert.equal(result.user.id, 6451332748);
  assert.equal(result.user.first_name, "Test");
});
test("rejects altered, expired, missing and incorrectly signed Telegram initData", () => {
  const valid = signedInitData();
  assert.ok(validateTelegramWebAppInitData(valid, botToken, { now }));
  const altered = new URLSearchParams(valid); altered.set("user", JSON.stringify({ id: 7 }));
  assert.equal(validateTelegramWebAppInitData(altered.toString(), botToken, { now }), null);
  assert.equal(validateTelegramWebAppInitData(valid, "wrong-token", { now }), null);
  assert.equal(validateTelegramWebAppInitData(valid, botToken, { now: now + 90000 * 1000 }), null);
  assert.equal(validateTelegramWebAppInitData("", botToken, { now }), null);
});
