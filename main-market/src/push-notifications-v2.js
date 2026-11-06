import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const TOPIC = "main-market-signals";
const EXPECTED_FIREBASE_PROJECT_ID = "ai-universal-signal-radar";
const SIGNAL_PRESENTATION = {
  CALL: { color: "#16A34A", badge: "CALL", title: "CALL · สัญญาณขาขึ้น" },
  PUT: { color: "#DC2626", badge: "PUT", title: "PUT · สัญญาณขาลง" },
  STANDBY: { color: "#6B7280", badge: "STANDBY", title: "STANDBY · รอจังหวะตลาด" }
};
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
    if (account.type !== "service_account" || account.project_id !== EXPECTED_FIREBASE_PROJECT_ID ||
        !account.client_email || !account.private_key) {
      console.error("[push] Firebase service account is invalid or belongs to a different Firebase project");
      return null;
    }
    const app = getApps()[0] || initializeApp({ credential: cert(account), projectId: EXPECTED_FIREBASE_PROJECT_ID });
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    console.error("[push] Firebase Admin initialization failed:", error.message);
    return null;
  }
}

export function firebaseAdminStatus() {
  const sender = client();
  return {
    firebaseAdminConfigured: Boolean(sender),
    credentialPresent: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    topic: TOPIC
  };
}

export async function sendSignalPush({ symbol, signal, alertId, price, reason }) {
  // STANDBY remains a silent local foreground-service state, never a push alert.
  if (!["CALL", "PUT"].includes(signal) || !alertId) return { sent: false, reason: "INVALID_SIGNAL" };
  const sender = client();
  if (!sender) return { sent: false, reason: "NOT_CONFIGURED" };

  const presentation = SIGNAL_PRESENTATION[signal];
  const body = [symbol, Number.isFinite(Number(price)) ? String(price) : null, reason]
    .filter(Boolean).join(" · ").slice(0, 180);
  const safeAlertId = String(alertId);

  try {
    const messageId = await sender.send({
      topic: TOPIC,
      data: {
        type: "market_signal",
        signal: String(signal),
        signalBadge: presentation.badge,
        signalColor: presentation.color,
        notificationTag: safeAlertId,
        title: presentation.title,
        body,
        symbol: String(symbol),
        alertId: safeAlertId,
        price: Number.isFinite(Number(price)) ? String(price) : "",
        reason: String(reason || "").slice(0, 300)
      },
      // Keep this a data-only FCM message so RadarPushService receives it
      // in the background and can honor the app's sound/vibration settings.
      android: { priority: "high" }
    });
    console.info("[push] signal data message sent", {
      signal,
      alertId: safeAlertId,
      color: presentation.color
    });
    return { sent: true, messageId };
  } catch (error) {
    console.warn("[push] Firebase message send failed:", error.message);
    return { sent: false, reason: "SEND_FAILED" };
  }
}
