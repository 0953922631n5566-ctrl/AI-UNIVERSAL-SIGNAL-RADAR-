import { createHmac, timingSafeEqual } from "node:crypto";

export function inspectTelegramWebAppInitData(initData, botToken, options = {}) {
  if (typeof initData !== "string" || !initData.trim()) return { ok: false, reason: "missing_init_data" };
  if (typeof botToken !== "string" || !botToken) return { ok: false, reason: "missing_bot_token" };
  let params;
  try { params = new URLSearchParams(initData); } catch { return { ok: false, reason: "malformed_query" }; }
  const suppliedHash = params.get("hash") || "";
  const authDate = Number(params.get("auth_date"));
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeSeconds = Number.isFinite(options.maxAgeSeconds) ? options.maxAgeSeconds : 86400;
  if (!/^[a-f0-9]{64}$/i.test(suppliedHash)) return { ok: false, reason: "missing_or_malformed_hash" };
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: "invalid_auth_date" };
  const ageSeconds = Math.floor(now / 1000) - authDate;
  if (ageSeconds < -60) return { ok: false, reason: "auth_date_in_future", ageSeconds };
  if (ageSeconds > maxAgeSeconds) return { ok: false, reason: "expired_init_data", ageSeconds };
  const dataCheckString = [...params.entries()].filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(suppliedHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    return { ok: false, reason: "signature_mismatch", ageSeconds };
  }
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch { return { ok: false, reason: "invalid_user_json" }; }
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) {
    return { ok: false, reason: "missing_or_invalid_user" };
  }
  return { ok: true, data: { user, authDate, ageSeconds } };
}

export function validateTelegramWebAppInitData(initData, botToken, options = {}) {
  const result = inspectTelegramWebAppInitData(initData, botToken, options);
  return result.ok ? result.data : null;
}
