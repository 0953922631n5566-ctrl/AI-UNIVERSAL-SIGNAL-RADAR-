import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const TOPIC = "main-market-signals";
let messagingInstance = null;
let initializationAttempted = false;

function getFirebaseMessaging() {
  if (messagingInstance) return messagingInstance;
  if (initializationAttempted) return null;
  initializationAttempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const serviceAccount = JSON.parse(raw);
    const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (error) {
    console.error("[push] Firebase Admin initialization failed:", error.message);
    return null;
  }
}

export async function sendSignalPush({ symbol, signal, alertId, price, reason }) {
  if (!["CALL", "PUT"].includes(signal) || !alertId) {
    return { sent: false, reason: "INVALID_SIGNAL" };
  }

  const messaging = getFirebaseMessaging();
  if (!messaging) return { sent: false, reason: "NOT_CONFIGURED" };

  const isCall = signal === "CALL";
  const color = isCall ? "#16A34A" : "#DC2626";
  const title = isCall ? "CALL · สัญญาณขาขึ้น" : "PUT · สัญญาณขาลง";
  const body = [symbol, Number.isFinite(Number(price)) ? String(price) : null, reason]
    .filter(Boolean).join(" · ").slice(0, 180);

  try {
    const messageId = await messaging.send({
      topic: TOPIC,
      notification: { title, body },
      data: {
        type: "market_signal",
        signal,
        symbol: String(symbol),
        alertId: String(alertId),
        price: Number.isFinite(Number(price)) ? String(price) : "",
        reason: String(reason || "").slice(0, 300)
      },
      android: {
        priority: "high",
        notification: {
          channelId: "signal_sv_v3",
          icon: "ic_stat_signal",
          color,
          tag: String(alertId),
          sound: "default",
          priority: "high"
        }
      }
    });
    return { sent: true, messageId };
  } catch (error) {
    console.warn("[push] Firebase message send failed:", error.message);
    return { sent: false, reason: "SEND_FAILED" };
  }
}
