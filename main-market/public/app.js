const $=id=>document.getElementById(id),tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
const SYMBOLS=["AUD/USD","EUR/USD","EUR/GBP","GBP/JPY","EUR/JPY","GBP/USD"];
let socket=null,monitoring=false,lastApiAlert="",audioContext=null;
const alerts=new Set(),announcedIssues=new Set(),lastSignalAlerts=new Map(),countdowns=new Map();
const saved=(()=>{try{const x=JSON.parse(localStorage.getItem("mainMarketSelectedPairs")||"null");return Array.isArray(x)?x.filter(s=>SYMBOLS.includes(s)):SYMBOLS.slice()}catch{return SYMBOLS.slice()}})();
function selectedSymbols(){return [...document.querySelectorAll("[data-pair-select]:checked")].map(x=>x.value)}
function setSelected(values){document.querySelectorAll("[data-pair-select]").forEach(x=>x.checked=values.includes(x.value));try{localStorage.setItem("mainMarketSelectedPairs",JSON.stringify(values))}catch{}}
function unlockAudio(force=false){if(!$("sound").checked&&!force)return;try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!audioContext||audioContext.state==="closed")audioContext=new C();if(audioContext.state==="suspended")audioContext.resume().catch(()=>{});}catch{}}
async function tone(k,force=false){if(!$("sound").checked&&!force)return;try{unlockAudio();if(!audioContext)return;if(audioContext.state!=="running")await audioContext.resume();const notes=k==="signal"?[880,1175]:k==="watch"?[740,988]:[k==="entry"?980:660];for(let i=0;i<notes.length;i++){const o=audioContext.createOscillator(),g=audioContext.createGain(),t=audioContext.currentTime+i*.13;o.type="sine";o.frequency.setValueAtTime(notes[i],t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.32,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+.19);o.connect(g);g.connect(audioContext.destination);o.start(t);o.stop(t+.2);}}catch{}}
function vibrate(force=false){if(!$("vibration").checked&&!force)return;try{if(tg?.HapticFeedback)tg.HapticFeedback.impactOccurred("heavy");if(navigator.vibrate)navigator.vibrate([150,70,150]);}catch{}}
function notify(message){if(tg?.showAlert)tg.showAlert(message);else window.alert(message)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function statusLabel(p){
 const labels={SUPPORTED:"รองรับ · LIVE",UNSUPPORTED:"ไม่รองรับ",LOCKED:"API ถูกล็อก",DATA_ERROR:"โหลดข้อมูลผิดพลาด",STREAM_ERROR:"Streaming ผิดพลาด",STALE:"ราคาเก่า",WAITING_PRICE:"รอราคา Streaming",CHECKING:"กำลังตรวจสอบ",OFFLINE:"หยุด"};
 return labels[p.supportStatus]||p.supportStatus||"กำลังตรวจสอบ";
}
function updatePairCards(s){
 const pairs=s.pairs||{},entries=Object.entries(pairs);
 $("pairCards").innerHTML=entries.map(([symbol,p])=>{
  const sig=p.signal||"STANDBY",status=p.supportStatus||"CHECKING",price=Number.isFinite(p.lastTickPrice)?p.lastTickPrice.toFixed(5):Number.isFinite(p.lastPrice)?p.lastPrice.toFixed(5):"—";
  const rsi=Number.isFinite(p.metrics?.rsi14)?p.metrics.rsi14.toFixed(1):"—",age=Number.isFinite(p.tickAgeSeconds)?p.tickAgeSeconds+"s":"—";
  return `<article class="pair-card ${status==="UNSUPPORTED"?"unsupported":status==="SUPPORTED"?"supported":""}">
   <div class="pair-head"><strong>${escapeHtml(symbol)}</strong><span class="pair-status ${status.toLowerCase()}">${escapeHtml(statusLabel(p))}</span></div>
   <div class="pair-signal ${sig.toLowerCase()}">${escapeHtml(sig)}</div>
   <div class="pair-metrics"><span>ราคา <b>${price}</b></span><span>RSI <b>${rsi}</b></span><span>DATA AGE <b>${age}</b></span></div>
   <p class="pair-reason">${escapeHtml(p.reason||p.statusMessage||"รอข้อมูล")}</p>
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
 const fireWatch=()=>{if(!isMonitoring||apiStatus!=="ONLINE")return;const key=symbol+":"+candleStart+":watch:10";if(alerts.has(key))return;alerts.add(key);tone("watch")};
 const fireEntry=()=>{if(!isMonitoring||apiStatus!=="ONLINE"||!directional())return;const key=symbol+":"+candleStart+":"+signal+":entry:3";if(alerts.has(key))return;alerts.add(key);tone("entry");vibrate()};
 if(old&&old.target===target&&old.timer){
  const current=remaining(),becameDirectional=(priorSignal!=="CALL"&&priorSignal!=="PUT")&&directional();
  if(current<=10&&current>0)fireWatch();
  if(current<=3&&current>0&&(becameDirectional||directional()))fireEntry();
  old.signal=signal;return;
 }
 if(old?.timer)clearInterval(old.timer);
 const rec={target,signal,timer:null,previous:remaining()};countdowns.set(symbol,rec);
 const show=left=>{const el=$("countdown-"+symbol.replace("/","-"));if(el)el.textContent="แท่งถัดไป "+String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0")};
 show(Math.ceil(rec.previous));if(rec.previous<=10&&rec.previous>0)fireWatch();if(rec.previous<=3&&rec.previous>0)fireEntry();
 rec.timer=setInterval(()=>{const current=remaining(),left=Math.ceil(current);show(left);if(rec.previous>10&&current<=10)fireWatch();if(rec.previous>3&&current<=3)fireEntry();rec.previous=current;if(current<=0){clearInterval(rec.timer);rec.timer=null;countdowns.delete(symbol)}},100);
}
function render(s){
 const api=s.apiStatus||"OFFLINE",pill=$("connection");pill.className="pill api-"+api.toLowerCase();pill.textContent=api==="ONLINE"?"● API LIVE":api==="LOCKED"?"● API LOCKED":api==="CONNECTING"?"● CONNECTING":"● OFFLINE";
 $("apiMessage").textContent=s.apiMessage||"รอเชื่อมต่อ Twelve Data";
 $("marketMode").textContent="NON-OTC · 1 MINUTE · MANUAL ONLY";
 if(s.monitoring&&Array.isArray(s.selectedSymbols))setSelected(s.selectedSymbols);
 updatePairCards(s);
 for(const [symbol,p] of Object.entries(s.pairs||{})){
  if(s.monitoring&&p.supportStatus==="UNSUPPORTED"){
   const key=symbol+":"+p.statusMessage;if(!announcedIssues.has(key)){announcedIssues.add(key);notify(symbol+" ไม่รองรับ\n"+(p.statusMessage||"บัญชี Twelve Data อาจไม่มีสิทธิ์ใช้งานคู่นี้"))}
  }
  if(s.monitoring&&p.apiStatus==="ONLINE"&&(p.signal==="CALL"||p.signal==="PUT")&&p.alertId){
   const key=symbol+":"+p.alertId;if(lastSignalAlerts.get(symbol)!==key){lastSignalAlerts.set(symbol,key);tone("signal");vibrate()}
  }
  countdown(symbol,p.nextCandleAt,p.signal,p.apiStatus,!!s.monitoring);
 }
 if(api==="LOCKED"&&s.apiMessage&&lastApiAlert!==s.apiMessage){lastApiAlert=s.apiMessage;if(s.monitoring)notify(s.apiMessage)}if(api==="ONLINE"||api==="OFFLINE")lastApiAlert="";
}
function clearCountdowns(){for(const rec of countdowns.values())if(rec.timer)clearInterval(rec.timer);countdowns.clear();$("pairCards").querySelectorAll(".pair-countdown").forEach(el=>el.textContent="แท่งถัดไป --:--")}
function lockClient(message){const pill=$("connection");pill.className="pill api-locked";pill.textContent="● API OFFLINE";$("apiMessage").textContent=message;clearCountdowns();if(lastApiAlert!==message){lastApiAlert=message;if(monitoring)notify(message)}}
function sendStart(){if(socket?.readyState===1)socket.send(JSON.stringify({action:"start",symbols:selectedSymbols()}))}
function connect(){if(socket&&socket.readyState<=1)return;const p=location.protocol==="https:"?"wss":"ws";socket=new WebSocket(p+"://"+location.host+"/live");socket.onopen=()=>{if(monitoring)sendStart()};socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.type==="market_state")render(m.data)};socket.onclose=()=>{if(monitoring){lockClient("อินเทอร์เน็ตหรือการเชื่อมต่อเซิร์ฟเวอร์ขาด — ระบบหยุดสัญญาณและกำลังเชื่อมใหม่");setTimeout(connect,2500)}else{const pill=$("connection");pill.className="pill api-offline";pill.textContent="● OFFLINE"}};socket.onerror=()=>{lockClient("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ — ระบบถูกล็อก");socket.close()}}
document.querySelectorAll("[data-pair-select]").forEach(x=>x.addEventListener("change",()=>{const values=selectedSymbols();try{localStorage.setItem("mainMarketSelectedPairs",JSON.stringify(values))}catch{}$("pairSummary").textContent=values.length+" คู่ที่เลือก · กดเริ่มเพื่อสแกน"}));
setSelected(saved);
$("start").onclick=()=>{const values=selectedSymbols();if(!values.length){notify("กรุณาเลือกอย่างน้อย 1 คู่เงินก่อนเริ่ม");return}unlockAudio();monitoring=true;$("start").disabled=true;$("stop").disabled=false;connect();if(socket?.readyState===1)sendStart()};
$("sound").addEventListener("change",()=>{if($("sound").checked)unlockAudio()});
$("testSound").onclick=()=>{unlockAudio(true);tone("signal",true);$("testStatus").textContent="ส่งเสียงทดสอบแล้ว"};
$("testVibration").onclick=()=>{vibrate(true);$("testStatus").textContent="ส่งคำสั่งสั่นทดสอบแล้ว"};
$("stop").onclick=()=>{monitoring=false;$("start").disabled=false;$("stop").disabled=true;if(socket?.readyState===1)socket.send(JSON.stringify({action:"stop"}));socket?.close();socket=null;clearCountdowns()};
fetch("/api/state").then(r=>r.json()).then(render).catch(()=>{});connect();
