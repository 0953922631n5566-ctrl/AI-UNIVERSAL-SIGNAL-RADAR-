import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCandleLines, CANDLE_LINES_MIN_HISTORY } from "../src/custom-candle-lines-engine.js";

function history() {
  return Array.from({length:24},(_,i)=>({
    epoch:i*60,live:false,open:1.10000,high:1.10010,low:1.09990,close:1.10002
  }));
}
function live(direction) {
  const last=history().at(-1);
  return direction==="up"
    ? {epoch:1440,live:true,open:1.10005,high:1.10035,low:1.10004,close:1.10030}
    : {epoch:1440,live:true,open:1.09995,high:1.09996,low:1.09965,close:1.09970};
}

test("custom line engine requires enough real closed M1 candles",()=>{
 const closedCandles=history().slice(0,CANDLE_LINES_MIN_HISTORY-1);
 const result=analyzeCandleLines({symbol:"EUR/USD",closedCandles,liveCandle:live("up"),tickAgeSeconds:1});
 assert.equal(result.signal,"WAIT");
 assert.match(result.reason,/ประวัติแท่งปิดไม่พอ/);
});

test("upper custom trigger-line breakout produces CALL without technical indicators",()=>{
 const result=analyzeCandleLines({symbol:"EUR/USD",closedCandles:history(),liveCandle:live("up"),tickAgeSeconds:1});
 assert.equal(result.signal,"CALL");
 assert.equal(result.regime,"CUSTOM_LINE_CALL");
 assert.ok(result.lines.upperTrigger>result.lines.microHigh);
 assert.equal(result.indicatorSource,"NONE · custom price lines only");
 assert.equal("ema5" in result,false);
 assert.equal("rsi14" in result,false);
});

test("lower custom trigger-line breakout produces PUT",()=>{
 const result=analyzeCandleLines({symbol:"EUR/USD",closedCandles:history(),liveCandle:live("down"),tickAgeSeconds:1});
 assert.equal(result.signal,"PUT");
 assert.equal(result.regime,"CUSTOM_LINE_PUT");
 assert.ok(result.lines.lowerTrigger<result.lines.microLow);
});

test("flat candles without a line event remain WAIT",()=>{
 const flat=history();
 const current={epoch:1440,live:true,open:1.10000,high:1.10010,low:1.09990,close:1.10002};
 const result=analyzeCandleLines({symbol:"EUR/USD",closedCandles:flat,liveCandle:current,tickAgeSeconds:1});
 assert.equal(result.signal,"WAIT");
 assert.equal(result.lineStatus,"LINES_ARMED");
});

test("stale streaming price cannot trigger a custom line signal",()=>{
 const result=analyzeCandleLines({symbol:"EUR/USD",closedCandles:history(),liveCandle:live("up"),tickAgeSeconds:6});
 assert.equal(result.signal,"WAIT");
 assert.match(result.reason,/ไม่สด/);
});

test("custom line engine rejects malformed OHLC geometry",()=>{
 const malformed={...live("up"),high:1.0990};
 const result=analyzeCandleLines({symbol:"EUR/USD",closedCandles:history(),liveCandle:malformed,tickAgeSeconds:1});
 assert.equal(result.signal,"WAIT");
 assert.match(result.reason,/OHLC/);
});
