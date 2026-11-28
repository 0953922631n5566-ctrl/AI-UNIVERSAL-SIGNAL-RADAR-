import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.VISION_API_TOKEN || "";
const MAX_FRAMES = 240;
const frames = [];
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

function auth(req, res, next) {
  if (!API_TOKEN) return res.status(503).json({ ok:false, error:"VISION_API_TOKEN is not configured" });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token !== API_TOKEN) return res.status(401).json({ ok:false, error:"Unauthorized" });
  next();
}
const finite = n => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

function summarize(items) {
  const xs = items.filter(x => finite(x.price)).map(x => Number(x.price));
  if (xs.length < 2) return { direction:"WAIT", reason:"ต้องอ่านป้ายราคาได้ต่อเนื่องอย่างน้อย 2 ภาพ", confidence:0 };
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
  const confidence = direction==="WAIT" ? 0
    : clamp(Math.round(45+(dominance-0.5)*70+Math.min(Math.abs(delta)/tick,4)*5),0,85);
  return { direction, priceChange:delta, tickSize:tick, directionalConsistency:Math.round(dominance*100),
    confidence, reason:direction==="WAIT"?"ราคาเคลื่อนไหวยังไม่ถึงอย่างน้อย 1 tick หรือทิศทางยังไม่สม่ำเสมอ":`ราคาเคลื่อนไหวต่อเนื่องในทิศทาง ${direction}` };
}
function makeAnalysis() {
  const last = frames.at(-1);
  if (!last) return { signal:"WAIT", status:"NO_DATA", reason:"ยังไม่มีภาพจากอุปกรณ์" };
  if (last.symbol === "UNKNOWN" || last.timeframe === "UNKNOWN")
    return { signal:"WAIT", status:"INSTRUMENT_UNIDENTIFIED", reason:"ยังระบุสินทรัพย์หรือกรอบเวลาไม่ชัดเจน จึงงดออกสัญญาณ" };
  const recent = frames.filter(x=>x.symbol===last.symbol && x.timeframe===last.timeframe).slice(-12);
  const candles = Array.isArray(last.candles) ? last.candles : [];
  const price = Number(last.price);
  const readable = finite(price) && price > 0;
  const trend = summarize(recent.filter(x => finite(x.price)));
  const candleCount = candles.length;
  const quality = clamp(Math.round((readable?40:0) + Math.min(candleCount,8)*5 + (last.ocr?.length?10:0)),0,100);
  const completedCandles = candles.length>1 ? candles.slice(0,-1) : [];
  if (!readable || completedCandles.length < 3 || quality < 60) {
    return { signal:"WAIT", status:"INSUFFICIENT_VISUAL_DATA", reason:"ข้อมูลภาพยังไม่ครบ: ต้องอ่านราคาและแท่งเทียนที่ปิดแล้วได้ชัดเจน", quality, price:readable?price:null, candleCount, completedCandleCount:completedCandles.length, analyzedAt:new Date().toISOString() };
  }
  const bodies = completedCandles.slice(-5).map(c => Number(c.closeY)-Number(c.openY)).filter(finite);
  const bodyBias = bodies.reduce((a,b)=>a+b,0);
  const candleDirection = bodyBias < -1 ? "CALL" : bodyBias > 1 ? "PUT" : "WAIT";
  const agree = trend.direction === candleDirection && trend.direction !== "WAIT";
  const signal = agree ? trend.direction : "WAIT";
  return { signal, status:"ANALYZED", price, candleCount, completedCandleCount:completedCandles.length, quality,
    confidence:signal==="WAIT"?Math.min(trend.confidence,45):Math.min(85,Math.round((trend.confidence+quality)/2)),
    reason:signal==="WAIT"?"ราคาและรูปทรงแท่งเทียนยังไม่ยืนยันไปในทิศทางเดียวกัน":`ราคาและแท่งเทียนยืนยัน ${signal} ตรงกัน`,
    priceMomentum:trend, candleBias:candleDirection, analyzedAt:new Date().toISOString(),
    note:"คะแนนความมั่นใจเป็นคะแนนจากกฎภาพ ไม่ใช่ความน่าจะเป็นหรืออัตราชนะที่พิสูจน์แล้ว" };
}

app.get("/health", (_req,res)=>res.json({ok:true,service:"universal-broker-vision",version:"0.1.0",receivedFrames:frames.length,tokenConfigured:Boolean(API_TOKEN)}));
app.get("/vision", (_req,res)=>res.sendFile(path.resolve("public/vision.html")));
app.get("/api/vision/public", (_req,res)=>{
  const last=frames.at(-1);
  res.json({ok:true,receivedFrames:frames.length,lastFrameAt:last?.receivedAt||null,
    symbol:last?.symbol||"UNKNOWN",timeframe:last?.timeframe||"UNKNOWN",
    price:last?.price??null,candleCount:last?.candles?.length||0,analysis:makeAnalysis()});
});
app.post("/api/vision/frame", auth, (req,res)=>{
  const b=req.body||{};
  if (!finite(b.width)||!finite(b.height)||!Array.isArray(b.ocr)||!Array.isArray(b.candles))
    return res.status(400).json({ok:false,error:"Expected width, height, ocr[], and candles[]"});
  const texts=b.ocr.map(x=>String(x.text||"").trim()).filter(Boolean);
  const priceCandidate=texts.map(t=>t.replace(/,/g,"").match(/\d+(?:\.\d{3,8})?/g)?.at(-1)).find(Boolean);
  const price=finite(b.price)?Number(b.price):(priceCandidate?Number(priceCandidate):null);
  const frame={id:randomUUID(),receivedAt:new Date().toISOString(),deviceTime:b.deviceTime||null,
    width:Number(b.width),height:Number(b.height),symbol:String(b.symbol||"UNKNOWN").slice(0,40),
    timeframe:String(b.timeframe||"UNKNOWN").slice(0,20),price,
    pricePrecision:finite(b.pricePrecision)?clamp(Math.round(Number(b.pricePrecision)),0,10):null,
    ocr:b.ocr.slice(0,100),
    candles:b.candles.slice(-100),chart:b.chart||null};
  frames.push(frame); if(frames.length>MAX_FRAMES) frames.splice(0,frames.length-MAX_FRAMES);
  const analysis=makeAnalysis();
  res.status(202).json({ok:true,frameId:frame.id,receivedAt:frame.receivedAt,analysis});
});
app.get("/api/vision/snapshot", auth, (_req,res)=>res.json({ok:true,analysis:makeAnalysis(),frames:frames.slice(-20)}));
app.get("/api/vision/status", auth, (_req,res)=>res.json({ok:true,frames:frames.length,lastFrame:frames.at(-1)?.receivedAt||null,analysis:makeAnalysis()}));
app.listen(PORT,"0.0.0.0",()=>console.log(`Universal Broker Vision API listening on ${PORT}`));