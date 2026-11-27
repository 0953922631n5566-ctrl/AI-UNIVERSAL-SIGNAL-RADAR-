// Immediate false-signal guard based on the source candle's own body midpoint.
export function isFalseSignalInvalidated({ signal, price, invalidationPrice, buffer = 0 }) {
  if (!["CALL", "PUT"].includes(signal) ||
      !Number.isFinite(price) ||
      !Number.isFinite(invalidationPrice) ||
      !Number.isFinite(buffer) || buffer < 0) return false;
  if (signal === "CALL") return price < invalidationPrice - buffer;
  return price > invalidationPrice + buffer;
}
