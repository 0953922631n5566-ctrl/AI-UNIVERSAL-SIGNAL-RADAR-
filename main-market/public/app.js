const $ = id => document.getElementById(id);
const PAIRS = ["AUD/USD", "EUR/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY", "GBP/USD"];
const getTelegram = () => window.Telegram?.WebApp;
let selectedSymbol = readSavedPair();
let monitoring = false;
let socket = null;
let socketTimeout = null;
let reconnectTimer = null;
let pollTimer = null;
let leaseTimer = null;
let wsHeartbeat = null;
let countdownTimer = null;
let audioContext = null;
let latestState = null;
let lastApiAlert = "";
const signalAlerts = new Set();
const preAlerts = new Set();

function readSavedPair() {
  try {
    const value = localStorage.getItem("mainMarketSelectedPair");
    return PAIRS.includes(value) ? value : "EUR/USD";
  } catch { return "EUR/USD"; }
}
function savePair(value) {
  selectedSymbol = PAIRS.includes(value) ? value : "EUR/USD";
  try { localStorage.setItem("mainMarketSelectedPair", selectedSymbol); } catch {}
  document.querySelectorAll("[data-pair-select]").forEach(input => {
    input.checked = input.value === selectedSymbol;
  });
  $("selectedPairLabel").textContent = selectedSymbol;
}
function openPairModal() {
  $("pairModal").classList.add("open");
  $("pairModal").setAttribute("aria-hidden", "false");
}
function closePairModal() {
  $("pairModal").classList.remove("open");
  $("pairModal").setAttribute("aria-hidden", "true");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function number(value, digits = 5) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
function regimeLabel(value) {
  return ({
    TRENDING_UP: "TRENDING · ขาขึ้น",
    TRENDING_DOWN: "TRENDING · ขาลง",
    RANGING: "RANGING · ออกข้าง",
    HIGH_VOLATILITY: "HIGH VOLATILITY · ผันผวนสูง",
    REVERSAL: "REVERSAL · เฝ้าระวังกลับตัว",
    UNCLEAR: "UNCLEAR · ยังไม่ชัดเจน"
  })[value] || "รอข้อมูลตลาด";
}
function setConnection(status, message, idle = false) {
  const pill = $("connection");
  pill.className = "pill " + (idle ? "online" :
    status === "ONLINE" ? "online" :
    status === "LOCKED" ? "locked" :
    status === "CONNECTING" ? "connecting" : "offline");
  pill.textContent = idle ? "● SERVER ONLINE" :
    status === "ONLINE" ? "● API LIVE" :
    status === "LOCKED" ? "● API LOCKED" :
    status === "CONNECTING" ? "● CONNECTING" : "● OFFLINE";
  $("apiMessage").textContent = message || "รอข้อมูลจาก Twelve Data";
  $("feedStatus").className = "feed-status " +
    (status === "ONLINE" ? "live" : status === "LOCKED" ? "locked" : "");
}
function render(state) {
  if (!state.monitoring && state.selectedSymbol && state.selectedSymbol !== selectedSymbol) return;
  latestState = state;
  monitoring = Boolean(state.monitoring);
  if (monitoring && PAIRS.includes(state.selectedSymbol)) savePair(state.selectedSymbol);
  $("start").disabled = monitoring;
  $("stop").disabled = !monitoring;

  const idle = !monitoring && state.serverOnline;
  setConnection(state.apiStatus || "OFFLINE", state.apiMessage || state.statusMessage, idle);

  const feed = state.pairs?.[state.selectedSymbol] || state;
  const status = feed.supportStatus || "CHECKING";
  $("feedTitle").textContent = status === "SUPPORTED" ? "รับราคา Streaming สด" :
    status === "REST_ONLY" ? "REST พร้อม · รอราคา LIVE" :
    status === "LOCKED" ? "API ถูกล็อก · STANDBY" :
    status === "UNSUPPORTED" ? "คู่เงินนี้ไม่รองรับ REST" :
    monitoring ? "กำลังตรวจสอบข้อมูลตลาด" : "รอเริ่มสแกน";

  const signal = ["CALL", "PUT", "STANDBY"].includes(feed.signal) ? feed.signal : "STANDBY";
  $("signalDisplay").className = "signal-display " + signal.toLowerCase();
  $("signalValue").textContent = signal;
  $("signalSub").textContent = signal === "CALL" ? "สัญญาณทิศทางขึ้น" :
    signal === "PUT" ? "สัญญาณทิศทางลง" : "รอหลักฐานที่ชัดเจน";
  $("signalAction").textContent = signal === "CALL" ? "พิจารณา CALL ด้วยตนเอง" :
    signal === "PUT" ? "พิจารณา PUT ด้วยตนเอง" : "ยังไม่เข้าออเดอร์";
  $("regimeValue").textContent = regimeLabel(feed.regime);
  $("regimeValue").className = /TRENDING/.test(feed.regime) ? "up" :
    /VOLATILITY|REVERSAL|RANGING/.test(feed.regime) ? "caution" : "";

  const livePrice = Number.isFinite(feed.lastTickPrice) ? feed.lastTickPrice : null;
  $("livePrice").textContent = number(livePrice);
  $("closePrice").textContent = number(feed.lastPrice);
  $("rsiValue").textContent = number(feed.metrics?.rsi14, 1);
  $("emaValue").textContent = [
    number(feed.metrics?.ema9), number(feed.metrics?.ema21), number(feed.metrics?.ema50)
  ].join(" / ");
  $("reasonText").textContent = feed.reason || feed.statusMessage || "รอข้อมูล";
  $("evidenceList").innerHTML = (Array.isArray(feed.evidence) ? feed.evidence : [])
    .slice(0, 5).map(item => "<li>" + escapeHtml(item) + "</li>").join("");
  $("signalTime").textContent = feed.analyzedAt
    ? new Date(feed.analyzedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";
  $("dataAge").textContent = Number.isFinite(feed.tickAgeSeconds)
    ? "LIVE AGE " + feed.tickAgeSeconds + "s"
    : "REST · ไม่มี LIVE";

  if (feed.nextCandleAt) {
    $("candleCountdown").dataset.target = String(feed.nextCandleAt);
  } else {
    delete $("candleCountdown").dataset.target;
    $("candleCountdown").textContent = "--:--";
  }
  if (feed.signalExpiresAt) {
    $("signalExpiry").dataset.target = String(Date.parse(feed.signalExpiresAt));
  } else {
    delete $("signalExpiry").dataset.target;
    $("signalExpiry").textContent = "—";
  }

  if (monitoring && state.apiStatus === "ONLINE" &&
      (signal === "CALL" || signal === "PUT") && feed.alertId &&
      !signalAlerts.has(feed.alertId)) {
    signalAlerts.add(feed.alertId);
    playTone("signal");
    vibrate("signal");
  }
  if (state.apiStatus === "LOCKED" && state.apiMessage &&
      lastApiAlert !== state.apiMessage && monitoring) {
    lastApiAlert = state.apiMessage;
    notify(state.apiMessage);
  }
  if (state.apiStatus !== "LOCKED") lastApiAlert = "";
  updateTimers();
}
function updateTimers() {
  const now = Date.now();
  const target = Number($("candleCountdown").dataset.target);
  if (Number.isFinite(target) && target > 0) {
    const remaining = Math.max(0, Math.ceil((target - now) / 1000));
    $("candleCountdown").textContent =
      String(Math.floor(remaining / 60)).padStart(2, "0") + ":" +
      String(remaining % 60).padStart(2, "0");
    checkPreAlerts(target, remaining);
  }
  const expiry = Number($("signalExpiry").dataset.target);
  if (Number.isFinite(expiry) && expiry > 0) {
    const remaining = Math.max(0, Math.ceil((expiry - now) / 1000));
    $("signalExpiry").textContent = remaining ? remaining + "s" : "หมดอายุ";
  }
}
function checkPreAlerts(target, remaining) {
  if (!monitoring || !latestState || latestState.apiStatus !== "ONLINE") return;
  const feed = latestState.pairs?.[selectedSymbol] || latestState;
  if (!["CALL", "PUT"].includes(feed.signal)) return;
  const key = selectedSymbol + ":" + target;
  if (remaining <= 10 && remaining > 3 && !preAlerts.has(key + ":10")) {
    preAlerts.add(key + ":10");
    playTone("watch");
    vibrate("watch");
  }
  if (remaining <= 3 && remaining > 0 && !preAlerts.has(key + ":3")) {
    preAlerts.add(key + ":3");
    playTone("entry");
    vibrate("entry");
  }
  if (preAlerts.size > 80) {
    const keep = [...preAlerts].slice(-40);
    preAlerts.clear();
    keep.forEach(value => preAlerts.add(value));
  }
}
function notify(message) {
  try {
    const telegram = getTelegram();
    if (typeof telegram?.showAlert === "function") telegram.showAlert(message);
    else if (typeof window.alert === "function") window.alert(message);
  } catch (error) { console.warn("[radar] alert unavailable", error); }
}
function getAudioContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error("อุปกรณ์ไม่รองรับ Web Audio");
  if (!audioContext || audioContext.state === "closed") audioContext = new Context();
  return audioContext;
}
async function unlockAudio() {
  const context = getAudioContext();
  if (context.state !== "running") await context.resume();
  if (context.state !== "running") throw new Error("เบราว์เซอร์ยังไม่อนุญาตเสียง");
  return context;
}
async function playTone(kind, force = false) {
  if (!$("sound").checked && !force) return;
  const context = await unlockAudio();
  const notes = kind === "signal" ? [880, 1175, 1480] :
    kind === "watch" ? [660] : [980, 1250];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime + index * 0.16;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.38, startAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.29);
  });
}
function vibrate(kind = "signal", force = false) {
  if (!$("vibration").checked && !force) return { ok: false, reason: "ปิดการสั่นไว้" };
  try {
    const haptic = getTelegram()?.HapticFeedback;
    if (typeof haptic?.notificationOccurred === "function") {
      haptic.notificationOccurred(kind === "signal" ? "success" : "warning");
      return { ok: true, method: "Telegram HapticFeedback" };
    }
    if (typeof navigator.vibrate === "function") {
      const accepted = navigator.vibrate(kind === "signal" ? [180, 90, 180] : [100, 70, 100]);
      return accepted ? { ok: true, method: "Browser Vibration" } :
        { ok: false, reason: "ระบบปฏิเสธคำสั่งสั่น" };
    }
    return { ok: false, reason: "อุปกรณ์หรือ WebView ไม่รองรับ HapticFeedback" };
  } catch (error) { return { ok: false, reason: error.message || "สั่งสั่นไม่สำเร็จ" }; }
}
async function control(action, extra = {}, keepalive = false) {
  const response = await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    keepalive,
    body: JSON.stringify({ action, ...extra })
  });
  const result = await response.json().catch(() => ({ ok: false, error: "ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง" }));
  if (!response.ok || !result.ok) throw new Error(result.error || "คำสั่งไม่สำเร็จ");
  if (result.state) render(result.state);
  return result;
}
async function pollState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const state = await response.json();
    if (!state.monitoring && state.selectedSymbol !== selectedSymbol) {
      await control("select", { symbol: selectedSymbol });
      return;
    }
    render(state);
  } catch (error) {
    setConnection("OFFLINE", "ติดต่อเซิร์ฟเวอร์ไม่ได้: " + (error.message || "ตรวจสอบอินเทอร์เน็ต"));
  }
}
function startPolling() {
  if (!pollTimer) {
    pollState();
    pollTimer = setInterval(pollState, 2000);
  }
  if (!leaseTimer) {
    control("heartbeat").catch(() => {});
    leaseTimer = setInterval(() => {
      if (monitoring) control("heartbeat").catch(() => {});
    }, 5000);
  }
}
function stopPolling() {
  clearInterval(pollTimer); pollTimer = null;
  clearInterval(leaseTimer); leaseTimer = null;
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 4000);
}
function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  try {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(protocol + "//" + location.host + "/live");
    socket = current;
    socketTimeout = setTimeout(() => {
      if (current.readyState === WebSocket.CONNECTING) current.close();
    }, 8000);
    current.onopen = () => {
      clearTimeout(socketTimeout); socketTimeout = null;
      stopPolling();
      clearInterval(wsHeartbeat);
      wsHeartbeat = setInterval(() => {
        if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ action: "heartbeat" }));
      }, 5000);
    };
    current.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "market_state") render(message.data);
    };
    current.onclose = () => {
      clearTimeout(socketTimeout); socketTimeout = null;
      clearInterval(wsHeartbeat); wsHeartbeat = null;
      if (socket === current) socket = null;
      startPolling();
      scheduleReconnect();
    };
    current.onerror = () => { try { current.close(); } catch { startPolling(); scheduleReconnect(); } };
  } catch (error) {
    console.warn("[radar] WebSocket unavailable", error);
    startPolling();
    scheduleReconnect();
  }
}
function startScan() {
  if (monitoring) return;
  monitoring = true;
  $("start").disabled = true;
  $("stop").disabled = false;
  unlockAudio().catch(() => {});
  connect();
  control("start", { symbol: selectedSymbol }).catch(error => {
    monitoring = false;
    $("start").disabled = false;
    $("stop").disabled = true;
    $("apiMessage").textContent = "เริ่มสแกนไม่สำเร็จ: " + error.message;
    startPolling();
  });
}
function stopScan(keepalive = false) {
  monitoring = false;
  $("start").disabled = false;
  $("stop").disabled = true;
  control("stop", {}, keepalive).catch(error => {
    $("apiMessage").textContent = "หยุดสแกนไม่สำเร็จ: " + error.message;
  });
}
function selectPair(value) {
  if (!PAIRS.includes(value)) return;
  savePair(value);
  closePairModal();
  $("feedTitle").textContent = monitoring ? "กำลังเปลี่ยนคู่เงิน" : "รอเริ่มสแกน";
  $("reasonText").textContent = "เลือก " + value + " แล้ว";
  $("signalValue").textContent = "STANDBY";
  $("signalDisplay").className = "signal-display standby";
  $("regimeValue").textContent = "รอข้อมูลตลาด";
  $("livePrice").textContent = "—";
  $("closePrice").textContent = "—";
  $("rsiValue").textContent = "—";
  $("emaValue").textContent = "—";
  $("evidenceList").innerHTML = "";
  control("select", { symbol: value }).catch(error => {
    $("apiMessage").textContent = "เปลี่ยนคู่เงินไม่สำเร็จ: " + error.message;
  });
}
function initialize() {
  try { getTelegram()?.ready?.(); getTelegram()?.expand?.(); } catch {}
  savePair(selectedSymbol);
  $("openPairModal").addEventListener("click", openPairModal);
  $("closePairModal").addEventListener("click", closePairModal);
  $("pairModal").addEventListener("click", event => {
    if (event.target === $("pairModal")) closePairModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closePairModal();
  });
  document.querySelectorAll("[data-pair-select]").forEach(input => {
    input.addEventListener("change", () => selectPair(input.value));
  });
  $("start").addEventListener("click", startScan);
  $("stop").addEventListener("click", () => stopScan());
  $("sound").addEventListener("change", () => {
    if ($("sound").checked) unlockAudio().catch(() => {});
  });
  $("testSound").addEventListener("click", async () => {
    $("testStatus").textContent = "กำลังทดสอบเสียง…";
    try {
      await playTone("signal", true);
      $("testStatus").textContent = "ส่งเสียงทดสอบแล้ว · ตรวจระดับเสียงสื่อของโทรศัพท์";
    } catch (error) {
      $("testStatus").textContent = "เสียงไม่พร้อม: " + error.message;
    }
  });
  $("testVibration").addEventListener("click", () => {
    const result = vibrate("signal", true);
    $("testStatus").textContent = result.ok
      ? "ส่งคำสั่ง " + result.method + " แล้ว · โปรดตรวจการตอบสนองที่ตัวเครื่อง"
      : "สั่นไม่ได้: " + result.reason;
  });
  document.addEventListener("pointerdown", event => {
    if (event.target?.closest?.("#start,#testSound")) unlockAudio().catch(() => {});
  }, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && monitoring) stopScan(true);
  });
  window.addEventListener("pagehide", () => {
    if (monitoring) stopScan(true);
  });
  window.addEventListener("error", event => {
    $("apiMessage").textContent = "หน้าแอปเกิดข้อผิดพลาด: " + (event.message || "JavaScript error");
  });
  window.addEventListener("unhandledrejection", event => {
    $("apiMessage").textContent = "คำสั่งผิดพลาด: " + (event.reason?.message || String(event.reason || "unknown"));
  });
  countdownTimer = setInterval(updateTimers, 200);
  pollState();
  connect();
}
initialize();
