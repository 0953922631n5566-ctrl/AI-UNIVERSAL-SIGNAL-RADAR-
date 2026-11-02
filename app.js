const API_ORIGIN="https://ai-signal-radar-main-market.onrender.com";
const $=id=>document.getElementById(id),getTelegram=()=>window.Telegram?.WebApp;try{const app=getTelegram();app?.ready?.();app?.expand?.()}catch(e){console.warn("[radar] Telegram WebApp bootstrap:",e?.message||e)}
window.addEventListener("error",e=>{const el=$("apiMessage");if(el)el.textContent="หน้าแอปเกิดข้อผิดพลาด: "+(e.message||"JavaScript error")});window.addEventListener("unhandledrejection",e=>{const el=$("apiMessage");if(el)el.textContent="คำสั่งในหน้าแอปผิดพลาด: "+(e.reason?.message||String(e.reason||"unknown error"))});
const SYMBOLS=["AUD/USD","EUR/USD","EUR/GBP","GBP/JPY","EUR/JPY","GBP/USD"];
let socket=null,monitoring=false,lastApiAlert="",audioContext=null,pollingTimer=null,leaseTimer=null,reconnectTimer=null,socketTimeout=null;
const alerts=new Set(),announcedIssues=new Set(),lastSignalAlerts=new Map(),countdowns=new Map();
const saved=(()=>{try{const one=localStorage.getItem("mainMarketSelectedPair");if(SYMBOLS.includes(one))return one;const x=JSON.parse(localStorage.getItem("mainMarketSelectedPairs")||"null");return Array.isArray(x)&&x.some(s=>SYMBOLS.includes(s))?x.find(s=>SYMBOLS.includes(s)):"EUR/USD"}catch{return"EUR/USD"}})();
function selectedSymbols(){return [document.querySelector("[data-pair-select]:checked")?.value||"EUR/USD"]}
function setSelected(values){const one=values.find(s=>SYMBOLS.includes(s))||"EUR/USD";document.querySelectorAll("[data-pair-select]").forEach(x=>x.checked=x.value===one);const label=$("selectedPairLabel");if(label)label.textContent=one;const summary=$("pairSummary");if(summary&&!monitoring)summary.textContent=one+" · รอเริ่มสแกน";try{localStorage.setItem("mainMarketSelectedPair",one)}catch{}} 
function openPairModal(){const modal=$("pairModal");modal?.classList.add("open");modal?.setAttribute("aria-hidden","false")}
function closePairModal(){const modal=$("pairModal");modal?.classList.remove("open");modal?.setAttribute("aria-hidden","true")}
function getAudioContext(){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw new Error("เบราว์เซอร์นี้ไม่รองรับ Web Audio");if(!audioContext||audioContext.state==="closed")audioContext=new C();return audioContext}
async function unlockAudio(){const ctx=getAudioContext();if(ctx.state!=="running")await ctx.resume();if(ctx.state!=="running")throw new Error("ระบบยังไม่อนุญาตให้เล่นเสียง กรุณาเปิดเสียงสื่อของโทรศัพท์");return ctx}
async function tone(k,force=false){if(!$("sound").checked&&!force)return false;const ctx=await unlockAudio();const notes=k==="signal"?[880,1175]:k==="watch"?[740,988]:[k==="entry"?980:660];for(let i=0;i<notes.length;i++){const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+i*.19;o.type="sine";o.frequency.setValueAtTime(notes[i],t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.48,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+.32);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+.33)}return true}
function playAlertTone(kind){tone(kind).catch(e=>{const status=$("testStatus");if(status)status.textContent="เสียงแจ้งเตือนไม่พร้อม: "+(e.message||"ตรวจสอบเสียงสื่อของโทรศัพท์")})}
function playAlertVibration(kind="signal"){if(!$("vibration").checked)return;const result=vibrate(false,kind);if(!result.ok){const status=$("testStatus");if(status)status.textContent="สั่นแจ้งเตือนไม่ได้: "+result.reason}}
function vibrate(force=false,kind="signal"){if(!$("vibration").checked&&!force)return{ok:false,reason:"ปิดการสั่นไว้"};try{const app=getTelegram(),haptic=app?.HapticFeedback;if(typeof haptic?.notificationOccurred==="function"){haptic.notificationOccurred(kind==="signal"?"success":"warning");return{ok:true,method:"telegram-notification"}}if(typeof haptic?.impactOccurred==="function"){haptic.impactOccurred(kind==="signal"?"heavy":"medium");return{ok:true,method:"telegram-impact"}}if(typeof navigator.vibrate==="function"){const accepted=navigator.vibrate(kind==="signal"?[180,90,180]:[120,70,120]);return accepted?{ok:true,method:"browser"}:{ok:false,reason:"ระบบปฏิเสธคำสั่งสั่น"}}return{ok:false,reason:"อุปกรณ์หรือ Telegram WebView ไม่รองรับ HapticFeedback / Vibration"}}catch(e){return{ok:false,reason:e.message||"ส่งคำสั่งสั่นไม่สำเร็จ"}}}
function notify(message){const app=getTelegram();if(typeof app?.showAlert==="function")app.showAlert(message);else window.alert(message)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function statusLabel(p){
 const labels={SUPPORTED:"รองรับ · LIVE",UNSUPPORTED:"ไม่รองรับ",LOCKED:"API ถูกล็อก",DATA_ERROR:"โหลดข้อมูลผิดพลาด",STREAM_ERROR:"Streaming ผิดพลาด",STREAM_TIMEOUT:"ไม่พบราคา Streaming",STALE:"ราคาเก่า",WAITING_PRICE:"รอราคา Streaming",CHECKING:"กำลังตรวจสอบ",OFFLINE:"หยุด"};
 return labels[p.supportStatus]||p.supportStatus||"กำลังตรวจสอบ";
}
function regimeLabel(value){
 const labels={TRENDING_UP:"TRENDING · ขาขึ้น",TRENDING_DOWN:"TRENDING · ขาลง",TRENDING:"TRENDING · มีแนวโน้ม",RANGING:"RANGING · ออกข้าง",HIGH_VOLATILITY:"HIGH VOLATILITY · ผันผวนสูง",REVERSAL:"REVERSAL · เฝ้าระวังกลับตัว",UNCLEAR:"UNCLEAR · ยังไม่ชัดเจน",UNKNOWN:"รอข้อมูลตลาด"};
 return labels[value]||labels.UNKNOWN;
}
function updatePairCards(s){
 const pairs=s.pairs||{},chosen=new Set(selectedSymbols()),entries=Object.entries(pairs).filter(([symbol])=>chosen.has(symbol));
 $("pairCards").innerHTML=entries.map(([symbol,p])=>{
  const sig=p.signal||"STANDBY",status=p.supportStatus||"CHECKING",price=Number.isFinite(p.lastTickPrice)?p.lastTickPrice.toFixed(5):Number.isFinite(p.lastPrice)?p.lastPrice.toFixed(5):"—";
  const rsi=Number.isFinite(p.metrics?.rsi14)?p.metrics.rsi14.toFixed(1):"—",age=Number.isFinite(p.tickAgeSeconds)?p.tickAgeSeconds+"s":"—";
  return `<article class="pair-card ${status==="UNSUPPORTED"?"unsupported":status==="SUPPORTED"?"supported":""}">
   <div class="pair-head"><strong>${escapeHtml(symbol)}</strong><span class="pair-status ${status.toLowerCase()}">${escapeHtml(statusLabel(p))}</span></div>
   <div class="signal-display ${sig.toLowerCase()}" role="status" aria-live="polite" aria-label="สัญญาณ ${escapeHtml(sig)}">
    <div class="signal-lamp" aria-hidden="true"><span></span></div>
    <div class="signal-copy"><small>${sig==="CALL"?"สัญญาณขาขึ้น":sig==="PUT"?"สัญญาณขาลง":"รอสัญญาณที่ชัดเจน"}</small><strong>${escapeHtml(sig)}</strong><em>${sig==="CALL"?"พิจารณาเข้า CALL":sig==="PUT"?"พิจารณาเข้า PUT":"ยังไม่เข้าออเดอร์"}</em></div>
   </div>
   <div class="regime-row"><span>MARKET REGIME</span><strong class="regime-badge regime-${String(p.regime||"UNKNOWN").toLowerCase().replace(/[^a-z0-9_-]/g,"-")}">${escapeHtml(regimeLabel(p.regime))}</strong></div>
   <div class="pair-metrics"><span>ราคา <b>${price}</b></span><span>RSI <b>${rsi}</b></span><span>DATA AGE <b>${age}</b></span></div>
   <div class="reason-panel"><div class="reason-heading">✦ AI REASONING</div><p class="pair-reason">${escapeHtml(p.reason||p.statusMessage||"รอข้อมูล")}</p></div>
   <p class="pair-status-message">${escapeHtml(p.statusMessage||"")}</p>
   <div class="pair-countdown" id="countdown-${symbol.replace("/","-")}">แท่งถัดไป --:--</div>
  </article>`;
 }).join("");
 $("pairSummary").textContent=`${entries.length} คู่ที่เลือก · ${s.onlineCount||0} คู่รับราคา LIVE · ${s.unsupportedCount||0} คู่ไม่รองรับ`;
}
function countdown(symbol,next,signal,apiStatus,isMonitoring){
 const target=Number(next),candleStart=target-60000;if(!Number.isFinite(target))return;
 const old=countdowns.get(symbol),priorSignal=old?.signal||"STANDBY";
 const directional=()=>signal==="CALL"||signal==="PUT";
 const remaining=()=>Math.max(0,(target-Date.now())/1000);
 const fireWatch=()=>{if(!isMonitoring||apiStatus!=="ONLINE"||!directional())return;const key=symbol+":"+candleStart+":watch:10";if(alerts.has(key))return;alerts.add(key);playAlertTone("watch");playAlertVibration("watch")};
 const fireEntry=()=>{if(!isMonitoring||apiStatus!=="ONLINE"||!directional())return;const key=symbol+":"+candleStart+":"+signal+":entry:3";if(alerts.has(key))return;alerts.add(key);playAlertTone("entry");playAlertVibration("entry")};
 const show=left=>{const el=$("countdown-"+symbol.replace("/","-"));if(el)el.textContent="แท่งถัดไป "+String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0")};
 if(old&&old.target===target&&old.timer){
  const current=remaining(),becameDirectional=(priorSignal!=="CALL"&&priorSignal!=="PUT")&&directional();show(Math.ceil(current));
  if(current<=10&&current>0)fireWatch();
  if(current<=3&&current>0&&(becameDirectional||directional()))fireEntry();
  old.signal=signal;return;
 }
 if(old?.timer)clearInterval(old.timer);
 const rec={target,signal,timer:null,previous:remaining()};countdowns.set(symbol,rec);
 show(Math.ceil(rec.previous));if(rec.previous<=10&&rec.previous>0)fireWatch();if(rec.previous<=3&&rec.previous>0)fireEntry();
 rec.timer=setInterval(()=>{const current=remaining(),left=Math.ceil(current);show(left);if(rec.previous>10&&current<=10)fireWatch();if(rec.previous>3&&current<=3)fireEntry();rec.previous=current;if(current<=0){clearInterval(rec.timer);rec.timer=null;countdowns.delete(symbol)}},100);
}
function render(s){
 const api=s.apiStatus||"OFFLINE",pill=$("connection");if(!s.monitoring&&s.serverOnline){pill.className="pill api-online";pill.textContent="● SERVER ONLINE"}else{pill.className="pill api-"+api.toLowerCase();pill.textContent=api==="ONLINE"?"● API LIVE":api==="LOCKED"?"● API LOCKED":api==="CONNECTING"?"● CONNECTING":"● OFFLINE"}
 $("apiMessage").textContent=s.apiMessage||"รอเชื่อมต่อ Twelve Data";
 $("marketMode").textContent="NON-OTC · 1 MINUTE · MANUAL ONLY";
 if(s.monitoring&&Array.isArray(s.selectedSymbols))setSelected(s.selectedSymbols);
 updatePairCards(s);
 for(const [symbol,p] of Object.entries(s.pairs||{})){
  if(s.monitoring&&p.supportStatus==="STREAM_TIMEOUT"){const key=symbol+":timeout:"+p.statusMessage;if(!announcedIssues.has(key)){announcedIssues.add(key);notify(symbol+" ยังยืนยันการรองรับ Streaming ไม่ได้\n"+(p.statusMessage||"ยังไม่ได้รับราคา Streaming สด"))}}
  if(s.monitoring&&p.supportStatus==="UNSUPPORTED"){
   const key=symbol+":"+p.statusMessage;if(!announcedIssues.has(key)){announcedIssues.add(key);notify(symbol+" ไม่รองรับ\n"+(p.statusMessage||"บัญชี Twelve Data อาจไม่มีสิทธิ์ใช้งานคู่นี้"))}
  }
  if(s.monitoring&&p.apiStatus==="ONLINE"&&(p.signal==="CALL"||p.signal==="PUT")&&p.alertId){
   const key=symbol+":"+p.alertId;if(lastSignalAlerts.get(symbol)!==key){lastSignalAlerts.set(symbol,key);playAlertTone("signal");playAlertVibration()}
  }
  countdown(symbol,p.nextCandleAt,p.signal,p.apiStatus,!!s.monitoring);
 }
 if(api==="LOCKED"&&s.apiMessage&&lastApiAlert!==s.apiMessage){lastApiAlert=s.apiMessage;if(s.monitoring)notify(s.apiMessage)}if(api==="ONLINE"||api==="OFFLINE")lastApiAlert="";
}
function clearCountdowns(){for(const rec of countdowns.values())if(rec.timer)clearInterval(rec.timer);countdowns.clear();$("pairCards").querySelectorAll(".pair-countdown").forEach(el=>el.textContent="แท่งถัดไป --:--")}
function lockClient(message){const pill=$("connection");pill.className="pill api-locked";pill.textContent="● API OFFLINE";$("apiMessage").textContent=message;clearCountdowns();if(lastApiAlert!==message){lastApiAlert=message;if(monitoring)notify(message)}}
async function sendHttpAction(action,extra={}){const response=await fetch(API_ORIGIN+"/api/control",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({action,...extra})});const result=await response.json().catch(()=>({ok:false,error:"เซิร์ฟเวอร์ส่งข้อมูลไม่ถูกต้อง"}));if(!response.ok||!result.ok)throw new Error(result.error||"คำสั่งไม่สำเร็จ");if(result.state)render(result.state);return result}
async function pollState(){try{const response=await fetch(API_ORIGIN+"/api/state",{cache:"no-store"});if(!response.ok)throw new Error("HTTP "+response.status);render(await response.json())}catch(e){const pill=$("connection");pill.className="pill api-offline";pill.textContent="● SERVER OFFLINE";$("apiMessage").textContent="ติดต่อเซิร์ฟเวอร์ไม่ได้: "+(e.message||"ตรวจสอบอินเทอร์เน็ต")}}
function startPolling(){if(!pollingTimer){pollState();pollingTimer=setInterval(pollState,2000)}if(monitoring)sendHttpAction("heartbeat").catch(()=>{});if(!leaseTimer)leaseTimer=setInterval(()=>{if(monitoring)sendHttpAction("heartbeat").catch(()=>{})},5000)}
function stopPolling(){if(pollingTimer)clearInterval(pollingTimer);if(leaseTimer)clearInterval(leaseTimer);pollingTimer=null;leaseTimer=null}
function scheduleReconnect(){if(reconnectTimer)return;reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect()},4000)}
function connect(){if(socket&&socket.readyState<=1)return;const ws=new WebSocket("wss://ai-signal-radar-main-market.onrender.com/live");socket=ws;socketTimeout=setTimeout(()=>{if(ws.readyState===0)ws.close()},8000);ws.onopen=()=>{clearTimeout(socketTimeout);socketTimeout=null;stopPolling()};ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.type==="market_state")render(m.data)};ws.onclose=()=>{clearTimeout(socketTimeout);socketTimeout=null;if(socket===ws)socket=null;startPolling();scheduleReconnect()};ws.onerror=()=>{try{ws.close()}catch{startPolling();scheduleReconnect()}}}
$("openPairModal").addEventListener("click",openPairModal);
$("closePairModal").addEventListener("click",closePairModal);
$("pairModal").addEventListener("click",e=>{if(e.target===$("pairModal"))closePairModal()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closePairModal()});
document.querySelectorAll("[data-pair-select]").forEach(x=>x.addEventListener("change",()=>{const symbol=x.value;setSelected([symbol]);closePairModal();$("pairSummary").textContent="คู่ที่เลือก: "+symbol+(monitoring?" · กำลังเปลี่ยนคู่ที่สแกน":" · กดเริ่มเพื่อสแกน");if(monitoring)sendHttpAction("select",{symbol}).catch(e=>{$("apiMessage").textContent="เปลี่ยนคู่เงินไม่สำเร็จ: "+e.message})}));
setSelected(saved);
$("start").onclick=()=>{const values=selectedSymbols();if(!values.length){notify("กรุณาเลือกอย่างน้อย 1 คู่เงินก่อนเริ่ม");return}unlockAudio().catch(()=>{});monitoring=true;$("start").disabled=true;$("stop").disabled=false;connect();sendHttpAction("start",{symbols:values}).catch(e=>{startPolling();$("apiMessage").textContent="เริ่มสแกนไม่สำเร็จ: "+e.message;$("start").disabled=false;$("stop").disabled=true})};
$("sound").addEventListener("change",()=>{if($("sound").checked)unlockAudio().catch(()=>{})});
$("testSound").onclick=async()=>{const status=$("testStatus");status.textContent="กำลังทดสอบเสียง…";try{await tone("signal",true);status.textContent="กำลังเล่นเสียงทดสอบ หากยังไม่ได้ยินให้ตรวจระดับเสียงสื่อของโทรศัพท์"}catch(e){status.textContent="เสียงไม่พร้อม: "+(e.message||"อุปกรณ์ไม่รองรับ")}};
$("testVibration").onclick=()=>{const result=vibrate(true,"signal");$("testStatus").textContent=result.ok?(result.method.startsWith("telegram")?"ส่ง HapticFeedback ผ่าน Telegram แล้ว — ตรวจการตอบสนองที่ตัวเครื่อง":"ส่งคำสั่ง Vibration ผ่านเบราว์เซอร์แล้ว — ตรวจการสั่นที่ตัวเครื่อง"):"สั่นไม่ได้: "+result.reason};
$("stop").onclick=()=>{monitoring=false;$("start").disabled=false;$("stop").disabled=true;clearCountdowns();sendHttpAction("stop").catch(e=>{$("apiMessage").textContent="หยุดสแกนไม่สำเร็จ: "+e.message})};
document.addEventListener("pointerdown",e=>{if(e.target?.closest?.("#testSound,#start"))unlockAudio().catch(()=>{})},{capture:true});
const readyStatus=$("testStatus");if(readyStatus)readyStatus.textContent="ระบบควบคุมพร้อม · แตะทดสอบเสียงหรือเริ่มสแกน";
pollState();connect();
