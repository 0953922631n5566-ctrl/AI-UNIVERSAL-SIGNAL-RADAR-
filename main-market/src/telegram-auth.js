import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_FUTURE_SECONDS = 60;

export function validateTelegramInitData(initData, botToken, nowMs = Date.now()) {
  if (typeof botToken !== "string" || botToken.length < 20) {
    return { ok: false, reason: "TELEGRAM_BOT_TOKEN is not configured" };
  }
  if (typeof initData !== "string" || initData.length < 20 || initData.length > 4096) {
    return { ok: false, reason: "Invalid Telegram initData" };
  }

  let params;
  try { params = new URLSearchParams(initData); }
  catch { return { ok: false, reason: "Invalid Telegram initData" }; }

  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    return { ok: false, reason: "Duplicate Telegram initData fields" };
  }
  const suppliedHash = params.get("hash") || "";
  const authDate = Number(params.get("auth_date"));
  const userRaw = params.get("user");
  if (!/^[a-f0-9]{64}$/i.test(suppliedHash) ||
      !Number.isSafeInteger(authDate) || !userRaw) {
    return { ok: false, reason: "Missing Telegram authentication fields" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const age = nowSeconds - authDate;
  if (age > MAX_AGE_SECONDS || age < -MAX_FUTURE_SECONDS) {
    return { ok: false, reason: "Telegram initData expired or from the future" };
  }

  let user;
  try { user = JSON.parse(userRaw); }
  catch { return { ok: false, reason: "Invalid Telegram user data" }; }
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) {
    return { ok: false, reason: "Telegram user ID is missing" };
  }

  const dataCheckString = entries
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const receivedHash = Buffer.from(suppliedHash, "hex");
  if (receivedHash.length !== expectedHash.length ||
      !timingSafeEqual(receivedHash, expectedHash)) {
    return { ok: false, reason: "Telegram initData signature mismatch" };
  }

  return { ok: true, userId: Number(user.id), authDate };
}
