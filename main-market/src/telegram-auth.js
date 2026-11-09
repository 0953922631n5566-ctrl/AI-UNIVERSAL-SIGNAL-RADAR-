import { createHmac, timingSafeEqual } from "node:crypto";

export function validateTelegramWebAppInitData(initData, botToken, options = {}) {
  if (typeof initData !== "string" || !initData || typeof botToken !== "string" || !botToken) return null;
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get("hash") || "";
  const authDate = Number(params.get("auth_date"));
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeSeconds = Number.isFinite(options.maxAgeSeconds) ? options.maxAgeSeconds : 86400;
  if (!/^[a-f0-9]{64}$/i.test(suppliedHash) || !Number.isInteger(authDate)) return null;
  const ageSeconds = Math.floor(now / 1000) - authDate;
  if (ageSeconds < -60 || ageSeconds > maxAgeSeconds) return null;
  const dataCheckString = [...params.entries()].filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(suppliedHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) return null;
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch { return null; }
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) return null;
  return { user, authDate };
}
