import { timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function validateClientToken(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (!TOKEN_PATTERN.test(provided) || !TOKEN_PATTERN.test(expected)) return false;
  const supplied = Buffer.from(provided, "ascii");
  const configured = Buffer.from(expected, "ascii");
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
