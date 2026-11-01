const $=id=>document.getElementById(id),tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
let socket=null,monitoring=false,lastAlert=null,timer=null,countdownTarget=null,countdownSignal="STANDBY",previousRemaining=null,alerts=new Set(),lastApiAlert="",audioContext=null;
function unlockAudio(force=false){if(!$("sound").checked&&!force)return;try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!audioContext||audioContext.state==="closed")audioContext=new C();if(audioContext.state==="suspended")audioContext.resume().catch(()=>{});}catch{}}
async function tone(k,force=false){if(!$("sound").checked&&!force)return;try{unlockAudio();if(!audioContext)return;if(audioContext.state!=="running")await audioContext.resume();const notes=k==="signal"?[880,1175]:k==="watch"?[740,988]:[k==="entry"?980:660];for(let i=0;i<notes.length;i++){const o=audioContext.createOscillator(),g=audioContext.createGain(),t=audioContext.currentTime+i*.13;o.type="sine";o.frequency.setValueAtTime(notes[i],t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.18,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+.19);o.connect(g);g.connect(audioContext.destination);o.start(t);o.stop(t+.2);}}catch{}}
function vibrate(force=false){if(!$("vibration").checked&&!force)return;try{if(tg?.HapticFeedback)tg.HapticFeedback.impactOccurred("heavy");if(navigator.vibrate)navigator.vibrate([150,70,150]);}catch{}}
function render(s){const sig=s.signal||"STANDBY";const api=s.apiStatus||(s.connected?"ONLINE":"OFFLINE");const pill=$("connection");pill.className="pill api-"+api.toLowerCase();pill.textContent=api==="ONLINE"?"● API LIVE":api==="LOCKED"?"● API LOCKED":api==="CONNECTING"?"● CONNECTING":"● OFFLINE";if(api==="LOCKED"&&s.apiMessage&&lastApiAlert!==s.apiMessage){lastApiAlert=s.apiMessage;if(tg?.showAlert)tg.showAlert(s.apiMessage);else if(monitoring)window.alert(s.apiMessage)}if(api==="ONLINE"||api==="OFFLINE")lastApiAlert="";$("signalCard").className="signal "+sig.toLowerCase();$("signal").textContent=sig;$("reason").textContent=s.reason||"รอข้อมูลที่ยืนยันได้";$("regime").textContent=s.regime||"UNKNOWN";$("price").textContent=Number.isFinite(s.lastTickPrice)?s.lastTickPrice.toFixed(5):Number.isFinite(s.lastPrice)?s.lastPrice.toFixed(5):"—";$("rsi").textContent=Number.isFinite(s.metrics?.rsi14)?s.metrics.rsi14.toFixed(1):"—";$("age").textContent=Number.isFinite(s.tickAgeSeconds)?s.tickAgeSeconds+"s":Number.isFinite(s.ageSeconds)?s.ageSeconds+"s":"—";$("priceMeta").textContent=(s.source||"Twelve Data")+" · "+(api==="ONLINE"?"รับราคา API สด":api==="LOCKED"?"ล็อกการวิเคราะห์":api==="CONNECTING"?"รอราคา API":"ยังไม่เชื่อมต่อ");$("updated").textContent=s.analyzedAt?"อัปเดต "+new Date(s.analyzedAt).toLocaleTimeString():"ยังไม่ได้วิเคราะห์";$("evidence").replaceChildren();(s.evidence?.length?s.evidence:[s.reason||"รอข้อมูล"]).forEach(x=>{const li=document.createElement("li");li.textContent=x;$("evidence").append(li)});if(s.monitoring&&api==="ONLINE"&&(sig==="CALL"||sig==="PUT")&&s.alertId&&s.alertId!==lastAlert){lastAlert=s.alertId;tone("signal");vibrate()}if(s.dataLocked){$("signalCard").classList.add("locked");$("reason").textContent=s.reason||"ระบบล็อก: ไม่มีข้อมูล API สด"}else{$("signalCard").classList.remove("locked")}if(s.nextCandleAt)countdown(s.nextCandleAt,s.signal,api,!!s.monitoring)}
function countdown(next,signal,apiStatus,isMonitoring){
 const target=Number(next),candleStart=target-60000;
 if(!Number.isFinite(target))return;
 const priorSignal=countdownSignal;
 countdownSignal=signal||"STANDBY";
 const remaining=()=>Math.max(0,(target-Date.now())/1000);
 const directional=()=>countdownSignal==="CALL"||countdownSignal==="PUT";
 const fireWatch=()=>{if(!isMonitoring||apiStatus!=="ONLINE")return;const key=candleStart+":watch:10";if(alerts.has(key))return;alerts.add(key);tone("watch")};
 const fireEntry=()=>{if(!isMonitoring||apiStatus!=="ONLINE"||!directional())return;const key=candleStart+":"+countdownSignal+":entry:3";if(alerts.has(key))return;alerts.add(key);tone("entry");vibrate()};
 // Keep one timer per candle. The 10-second watch chime is independent of
 // CALL/PUT; the 3-second entry warning is only for a confirmed direction.
 if(countdownTarget===target&&timer){
  const current=remaining();
  if(current<=10&&current>0)fireWatch();
  const becameDirectional=(priorSignal!=="CALL"&&priorSignal!=="PUT")&&directional();
  if(current<=3&&current>0&&(becameDirectional||directional()))fireEntry();
  return;
 }
 clearInterval(timer);countdownTarget=target;
 previousRemaining=remaining();
 const show=left=>{$("countdown").textContent=String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0")};
 show(Math.ceil(previousRemaining));
 if(previousRemaining<=10&&previousRemaining>0)fireWatch();
 if(previousRemaining<=3&&previousRemaining>0)fireEntry();
 timer=setInterval(()=>{
  const current=remaining(),left=Math.ceil(current);show(left);
  if(previousRemaining>10&&current<=10)fireWatch();
  if(previousRemaining>3&&current<=3)fireEntry();
  previousRemaining=current;
  if(current<=0){clearInterval(timer);timer=null;countdownTarget=null;previousRemaining=null}
 },100);
}
function lockClient(message){const pill=$("connection");pill.className="pill api-locked";pill.textContent="● API OFFLINE";$("signalCard").className="signal standby locked";$("signal").textContent="STANDBY";$("reason").textContent=message;$("priceMeta").textContent="เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ · ล็อกการวิเคราะห์";clearInterval(timer);timer=null;countdownTarget=null;previousRemaining=null;$("countdown").textContent="--:--";if(lastApiAlert!==message){lastApiAlert=message;if(tg?.showAlert)tg.showAlert(message);else if(monitoring)window.alert(message)}}
function connect(){if(socket&&socket.readyState<=1)return;const p=location.protocol==="https:"?"wss":"ws";socket=new WebSocket(p+"://"+location.host+"/live");socket.onopen=()=>{$("connection").textContent="CONNECTED";if(monitoring)socket.send(JSON.stringify({action:"start"}))};socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="market_state")render(m.data)};socket.onclose=()=>{if(monitoring){lockClient("อินเทอร์เน็ตหรือการเชื่อมต่อเซิร์ฟเวอร์ขาด — ล็อกสัญญาณไว้ที่ STANDBY และกำลังเชื่อมใหม่");setTimeout(connect,2500)}else{const pill=$("connection");pill.className="pill api-offline";pill.textContent="● OFFLINE"}};socket.onerror=()=>{lockClient("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ — ระบบถูกล็อก");socket.close()}}
$("start").onclick=()=>{unlockAudio();monitoring=true;$("start").disabled=true;$("stop").disabled=false;connect();if(socket?.readyState===1)socket.send(JSON.stringify({action:"start"}))};
$("sound").addEventListener("change",()=>{if($("sound").checked)unlockAudio()});
$("testSound").onclick=()=>{unlockAudio(true);tone("signal",true);$("testStatus").textContent="ส่งเสียงทดสอบแล้ว"};
$("testVibration").onclick=()=>{vibrate(true);$("testStatus").textContent="ส่งคำสั่งสั่นทดสอบแล้ว"};
$("stop").onclick=()=>{monitoring=false;$("start").disabled=false;$("stop").disabled=true;if(socket?.readyState===1)socket.send(JSON.stringify({action:"stop"}));socket?.close();socket=null;clearInterval(timer);timer=null;countdownTarget=null;previousRemaining=null;$("countdown").textContent="--:--"};
fetch("/api/state").then(r=>r.json()).then(render).catch(()=>{});connect();