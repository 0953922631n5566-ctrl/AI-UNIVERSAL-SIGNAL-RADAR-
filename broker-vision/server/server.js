import express from "express";
import { predictNextCandle, getM1CycleWindow, evaluateOpenBias } from "./next-candle-predictor.js";
import path from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.VISION_API_TOKEN || "";
const MAX_FRAMES = 240;
const frames = [];
const priceCandles = [];
let lastPriceScale = null;
let latestFrameImage = null;
const STORAGE_DIR = process.env.VISION_STORAGE_DIR || "";
const enrollAttempts = new Map();
const DEVICE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));

function validDeviceToken(token) {
  const parts = String(token).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = createHmac("sha256", API_TOKEN).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(parts[3], "hex"); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function auth(req, res, next) {
  if (!API_TOKEN) return res.status(503).json({ ok:false, error:"VISION_API_TOKEN is not configured" });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token !== API_TOKEN && !validDeviceToken(token))
    return res.status(401).json({ ok:false, error:"Unauthorized or device token expired" });
  next();
}
const finite = n => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

function summarize(items) {
  const xs = items.filter(x => finite(x.price)).map(x => Number(x.price));
  if (xs.length < 2) return { direction:"WAIT", reason:"ต้องอ่านป้ายราคาได้ต่อเนื่องอย่างน้อย 2 ภาพ" };
  const first = xs[0], last = xs.at(-1), delta = last-first;
  const reportedPrecision = Number(frames.at(-1)?.pricePrecision);
  const decimals = Number.isInteger(reportedPrecision) && reportedPrecision>0
    ? reportedPrecision : (String(last).split(".")[1]?.length || 4);
  const tick = 10 ** (-Math.min(decimals,10));
  const steps = xs.slice(1).map((value,i)=>value-xs[i]);
  const up = steps.filter(value=>value>0).length;
  const down = steps.filter(value=>value<0).length;
  const dominance = steps.length ? Math.max(up,down)/steps.length : 0;
  const direction = Math.abs(delta)>=tick && dominance>=0.60
    ? (delta>0 ? "CALL" : "PUT") : "WAIT";
  return { direction, priceChange:delta, tickSize:tick, directionalConsistency:Math.round(dominance*100),
    reason:direction==="WAIT"?"ราคาเคลื่อนไหวยังไม่ถึงอย่างน้อย 1 tick หรือทิศทางยังไม่สม่ำเสมอ":`ราคาเคลื่อนไหวต่อเนื่องในทิศทาง ${direction}` };
}
async function persistLatestFrame(frame, image) {
  if (!STORAGE_DIR) return;
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(path.join(STORAGE_DIR, "latest-frame.jpg"), Buffer.from(image.base64, "base64"));
  await writeFile(path.join(STORAGE_DIR, "latest-frame.json"), JSON.stringify({ ...frame, image: undefined }));
}
async function restoreLatestFrame() {
  if (!STORAGE_DIR) return;
  try {
    const [bytes, metadata] = await Promise.all([
      readFile(path.join(STORAGE_DIR, "latest-frame.jpg")),
      readFile(path.join(STORAGE_DIR, "latest-frame.json"), "utf8")
    ]);
    const frame = JSON.parse(metadata);
    frame.receivedAt = frame.receivedAt || new Date().toISOString();
    frames.push(frame);
    updatePriceCandle(frame);
    latestFrameImage = { mimeType: "image/jpeg", base64: bytes.toString("base64") };
    console.log("Restored latest Broker Vision frame from persistent storage");
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not restore latest frame:", error.message);
  }
}
function updatePriceCandle(frame) {
  if (!finite(frame?.price) || Number(frame.price) <= 0 || !finite(frame?.deviceTime)) return;
  const price=Number(frame.price);
  if(lastPriceScale!==null && Math.abs(price-lastPriceScale)/Math.max(Math.abs(price),Math.abs(lastPriceScale))>0.05){
    priceCandles.length=0;
  }
  lastPriceScale=price;
  const epoch=Math.floor(Number(frame.deviceTime)/60000)*60000;
  const last=priceCandles.at(-1);
  if(last && epoch<last.epoch) return;
  if(last && epoch===last.epoch){
    last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);
    last.close=price;last.samples++;
  }else{
    if(last)last.closed=true;
    priceCandles.push({epoch,open:price,high:price,low:price,close:price,samples:1,closed:false,source:"APK_CAPTURED_PRICE"});
    if(priceCandles.length>100)priceCandles.splice(0,priceCandles.length-100);
  }
}

function makeAnalysis() {
  const last=frames.at(-1);
  if(!last)return {signal:"WAIT",phase:"WAITING",status:"NO_DATA",reason:"ยังไม่มีภาพจาก APK",source:"APK_CAPTURED_PRICE_OHLC"};
  const ageMs=Date.now()-Date.parse(last.receivedAt);
  if(!Number.isFinite(ageMs)||ageMs<0||ageMs>10000)
    return {signal:"WAIT",phase:"WAITING",status:"STALE_FRAME",reason:"ภาพล่าสุดเก่าเกิน 10 วินาที จึงหยุดสัญญาณ",ageMs:Number.isFinite(ageMs)?ageMs:null,source:"APK_CAPTURED_PRICE_OHLC"};

  const price=Number(last.price);
  const readable=finite(price)&&price>0;
  const rawPriceSamples=frames.slice(-24).filter(frame=>finite(frame.price)&&Number(frame.price)>0);
  const recent=[];
  for(let i=rawPriceSamples.length-1;i>=0;i--){
    const current=Number(rawPriceSamples[i].price);
    const nextPrice=recent[0]?Number(recent[0].price):null;
    if(nextPrice!==null&&Math.abs(current-nextPrice)/Math.max(Math.abs(current),Math.abs(nextPrice))>0.05)break;
    recent.unshift(rawPriceSamples[i]);
  }
  const chartCandles=priceCandles.slice(-100);
  const captureMs=finite(last.deviceTime)?Number(last.deviceTime):Date.parse(last.receivedAt);
  const cycle=getM1CycleWindow(captureMs);
  const prediction=predictNextCandle({
    candles:chartCandles,
    price:readable?price:null,
    priceHistory:recent.map(frame=>Number(frame.price))
  });
  const currentCandle=chartCandles.at(-1);
  const signal=readable?prediction.signal:"WAIT";
  const reason=!readable?"ยังไม่ได้รับราคาตัวเลขจาก APK":prediction.reason||"วิเคราะห์จาก EMA5 เท่านั้น";

  return {
    signal,phase:"LIVE",cyclePhase:cycle.phase,cycleId:cycle.cycleId,elapsedSeconds:cycle.elapsedSeconds,
    secondsToNextCandle:cycle.secondsToNextCandle,
    currentCandleOpen:finite(currentCandle?.open)?Number(currentCandle.open):null,
    status:!readable?"PRICE_UNREADABLE":signal==="CALL"||signal==="PUT"?"LIVE_SIGNAL":"LIVE_WAIT",
    price:readable?price:null,pricePrecision:last.pricePrecision??null,
    candleCount:chartCandles.length,priceCandleCount:chartCandles.length,
    priceSamples:recent.length,calibratedCandles:prediction.calibratedCandles||0,
    signalEligible:["CALL","PUT"].includes(signal),
    nextCandlePrediction:prediction,ema5:prediction.ema5??null,
    priceCandles:chartCandles,chartSource:"APK_CAPTURED_PRICE_OHLC",
    signalConditions:{
      readablePrice:readable,calibratedCandles:prediction.calibratedCandles||0,
      target:"NEXT_M1_CANDLE",phase:cycle.phase,elapsedSeconds:cycle.elapsedSeconds,
      ema5:prediction.ema5??null,price:readable?price:null,
      trend:signal==="CALL"?"ABOVE_EMA5":signal==="PUT"?"BELOW_EMA5":"ON_OR_WAITING_FOR_EMA5",
      passed:["CALL","PUT"].includes(signal)
    },
    reason,analyzedAt:new Date().toISOString(),
    note:"วิเคราะห์ทุกครั้งที่ได้รับราคาจาก APK · ราคาเหนือ EMA5 = CALL · ราคาต่ำกว่า EMA5 = PUT · ไม่มีคะแนน · ใช้ราคา APK เท่านั้น"
  };
}

app.get("/health", (_req,res)=>res.json({ok:true,service:"universal-broker-vision",version:"0.2.0",receivedFrames:frames.length,tokenConfigured:Boolean(API_TOKEN),demoEnrollment:process.env.VISION_DEMO_ENROLLMENT==="true"}));
app.post("/api/vision/enroll", (req,res)=>{
  if (process.env.VISION_DEMO_ENROLLMENT !== "true")
    return res.status(503).json({ok:false,error:"Device enrollment is disabled"});
  const now=Date.now();
  const ip=String(req.ip||req.socket.remoteAddress||"unknown");
  const attempts=(enrollAttempts.get(ip)||[]).filter(ts=>now-ts<60*60*1000);
  if (attempts.length>=10) return res.status(429).json({ok:false,error:"Too many enrollments; try again later"});
  attempts.push(now);enrollAttempts.set(ip,attempts);
  const expiresAt=now+DEVICE_TOKEN_TTL_MS;
  const payload=`v1.${expiresAt}.${randomUUID()}`;
  const signature=createHmac("sha256",API_TOKEN).update(payload).digest("hex");
  const token=`${payload}.${signature}`;
  res.status(201).json({ok:true,token,expiresAt:new Date(expiresAt).toISOString(),expiresInSeconds:DEVICE_TOKEN_TTL_MS/1000});
});
app.get("/vision", (_req,res)=>res.sendFile(path.resolve("public/vision.html")));
app.get("/api/vision/chart-image", (_req,res)=>{
  res.setHeader("Cache-Control","no-store, no-cache, max-age=0, must-revalidate");
  res.setHeader("Pragma","no-cache");
  if(!latestFrameImage?.base64) return res.status(204).end();
  res.type("image/jpeg").send(Buffer.from(latestFrameImage.base64,"base64"));
});
app.get("/api/vision/miniapp", (_req,res)=>{
  res.setHeader("Cache-Control","no-store, no-cache, max-age=0, must-revalidate");
  const last=frames.at(-1);
  res.json({ok:true,receivedFrames:frames.length,lastFrameAt:last?.receivedAt||null,
    symbol:last?.symbol||"UNKNOWN",timeframe:last?.timeframe||"UNKNOWN",
    price:last?.price??null,pricePrecision:last?.pricePrecision??null,candleCount:makeAnalysis().priceCandleCount||0,
    priceCandles:priceCandles.slice(-100),chartSource:"APK_CAPTURED_PRICE_OHLC",
    priceDiagnostics:last?{ocrLineCount:last.ocrLineCount??null,priceCandidateCount:last.priceCandidateCount??null,
      axisPriceCount:last.axisPriceCount??null,priceReadStatus:last.priceReadStatus??"UNKNOWN"}:null,
    analysis:makeAnalysis()});
});
app.get("/api/vision/public", (_req,res)=>{
  const last=frames.at(-1);
  res.json({ok:true,receivedFrames:frames.length,lastFrameAt:last?.receivedAt||null,
    symbol:last?.symbol||"UNKNOWN",timeframe:last?.timeframe||"UNKNOWN",
    price:last?.price??null,candleCount:last?.candles?.length||0,
    analysis:makeAnalysis()});
});
app.post("/api/vision/frame", auth, (req,res)=>{
  const b=req.body||{};
  if (!finite(b.width)||!finite(b.height)||!Array.isArray(b.ocr)||!Array.isArray(b.candles))
    return res.status(400).json({ok:false,error:"Expected width, height, ocr[], and candles[]"});
  // APK sends the OCR-derived price metadata directly; image upload is optional.
  // Reject delayed or future captures so stale screen prices cannot enter the live window.
  const deviceTime=finite(b.deviceTime)?Number(b.deviceTime):NaN;
  const deviceAge=Date.now()-deviceTime;
  if(!Number.isFinite(deviceAge)||deviceAge < -3000||deviceAge > 10000)
    return res.status(409).json({ok:false,error:"Stale or future APK capture rejected"});
  let imageBytes=null;
  if(b.imageBase64!==undefined){
    if(typeof b.imageBase64!=="string"||b.imageBase64.length<100||b.imageBase64.length>5_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.imageBase64))
      return res.status(400).json({ok:false,error:"Invalid optional imageBase64"});
    imageBytes=Buffer.from(b.imageBase64,"base64");
    if(imageBytes.length<75||imageBytes.length>3_750_000||imageBytes[0]!==0xff||imageBytes[1]!==0xd8||imageBytes.at(-2)!==0xff||imageBytes.at(-1)!==0xd9)
      return res.status(400).json({ok:false,error:"imageBase64 must contain a valid JPEG image"});
  }
  // Never treat arbitrary page text or integer labels as a broker instrument/price.
  const rawSymbol=String(b.symbol||"").toUpperCase().replace(/\s/g,"");
  const pairMatch=rawSymbol.match(/^([A-Z]{3})\/([A-Z]{3})(?:\(OTC\))?$/);
  const symbol=pairMatch?pairMatch[1]+"/"+pairMatch[2]+(rawSymbol.endsWith("(OTC)")?"(OTC)":""):"UNKNOWN";
  const rawTimeframe=String(b.timeframe||"").toUpperCase().trim();
  const timeframeMatch=rawTimeframe.match(/^([1-9]\d?)(S|M|H|D)$/);
  const timeframe=timeframeMatch?timeframeMatch[1]+timeframeMatch[2]:"UNKNOWN";
  const suppliedPrecision=finite(b.pricePrecision)?clamp(Math.round(Number(b.pricePrecision)),0,10):(String(b.price||"").split(".")[1]||"").length;
  const suppliedPrice=finite(b.price)&&Number(b.price)>0&&suppliedPrecision>=1?Number(b.price):null;
  const priceCandidates=b.ocr.map(x=>{
    const left=Number(x.left),right=Number(x.right),top=Number(x.top);
    // Match the APK's OCR acceptance window (4%-92% of screen height/width).
    // The previous narrower API window rejected valid price tags near the top/bottom of the chart.
    if(!Number.isFinite(left)||!Number.isFinite(right)||left<Number(b.width)*0.04||right<=left||
       (Number.isFinite(top)&&(top<Number(b.height)*0.08||top>Number(b.height)*0.92))) return null;
    const match=[...String(x.text||"").replace(/,/g,"").matchAll(/\b\d+(?:\.\d{1,10})\b/g)].at(-1);
    return match?Number(match[0]):null;
  }).filter(value=>Number.isFinite(value)&&value>0);
  // Use only the numeric value explicitly supplied by the APK. Never substitute
  // unrelated OCR text (for example a timer or menu number) as the market price.
  const price=suppliedPrice??null;
  const pricePrecision=price===null?null:suppliedPrecision;
  const priceReadStatus = suppliedPrice !== null ? "PRICE_OK_APK_DIRECT"
    : priceCandidates.length ? "OCR_TEXT_FOUND_BUT_APK_PRICE_MISSING"
    : "NO_APK_PRICE_OR_OCR_CANDIDATE";
  const axisPrices = Array.isArray(b.axisPrices) ? b.axisPrices.slice(0,30) : [];
  const frame={id:randomUUID(),receivedAt:new Date().toISOString(),deviceTime:b.deviceTime||null,
    width:Number(b.width),height:Number(b.height),symbol,
    timeframe,
    price,
    pricePrecision,
    ocrLineCount:b.ocr.length,
    priceCandidateCount:priceCandidates.length,
    axisPriceCount:axisPrices.length,
    priceReadStatus,
    axisPrices,
    ocr:b.ocr.slice(0,100),
    candles:b.candles.slice(-100),chart:b.chart||null};
  frames.push(frame); if(frames.length>MAX_FRAMES) frames.splice(0,frames.length-MAX_FRAMES);
  updatePriceCandle(frame);
  if(imageBytes){
    latestFrameImage={mimeType:"image/jpeg",base64:b.imageBase64};
    void persistLatestFrame(frame,latestFrameImage).catch(error=>console.error("Frame persistence failed:",error.message));
  }
  const analysis=makeAnalysis();
  res.status(202).json({ok:true,frameId:frame.id,receivedAt:frame.receivedAt,imageReceived:Boolean(imageBytes),imageBytes:imageBytes?.length||0,analysis});
});
app.get("/api/vision/snapshot", auth, (_req,res)=>res.json({ok:true,analysis:makeAnalysis(),frames:frames.slice(-20)}));
app.get("/api/vision/status", auth, (_req,res)=>res.json({ok:true,frames:frames.length,lastFrame:frames.at(-1)?.receivedAt||null,analysis:makeAnalysis()}));
await restoreLatestFrame();
app.listen(PORT,"0.0.0.0",()=>console.log(`Universal Broker Vision API listening on ${PORT}; persistent storage ${STORAGE_DIR ? "enabled" : "not configured"}`));