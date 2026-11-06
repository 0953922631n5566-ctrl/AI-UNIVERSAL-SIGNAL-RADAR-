import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const TOPIC = "main-market-signals";
let messaging = null;
let attempted = false;

function client() {
  if (messaging) return messaging;
  if (attempted) return null;
  attempted = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const account = JSON.parse(raw);
    const app = getApps()[0] || initializeApp({ credential: cert(account) });
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    console.error("[push] Firebase Admin initialization failed:", error.message);
    return null;
  }
}

export async function sendSignalPush({ symbol, signal, alertId, price, reason }) {
  if (!["CALL", "PUT"].includes(signal) || !alertId) return { sent: false, reason: "INVALID_SIGNAL" };
  const sender = client();
  if (!sender) return { sent: false, reason: "NOT_CONFIGURED" };
  const title = signal === "CALL" ? "CALL · สัญญาณขาขึ้น" : "PUT · สัญญาณขาลง";
  const body = [symbol, Number.isFinite(Number(price)) ? String(price) : null, reason].filter(Boolean).join(" · ").slice(0, 180);
  try {
    const messageId = await sender.send({
      topic: TOPIC,
      data: {
        type: "market_signal",
        signal: String(signal),
        title,
        body,
        symbol: String(symbol),
        alertId: String(alertId),
        price: Number.isFinite(Number(price)) ? String(price) : "",
        reason: String(reason || "").slice(0, 300)
      },
      android: { priority: "high" }
    });
    console.info("[push] signal data message sent", { signal, alertId });
    return { sent: true, messageId };
  } catch (error) {
    console.warn("[push] Firebase message send failed:", error.message);
    return { sent: false, reason: "SEND_FAILED" };
  }
}
