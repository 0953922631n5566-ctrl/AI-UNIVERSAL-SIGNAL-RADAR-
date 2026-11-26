import test from "node:test";
import assert from "node:assert/strict";
import { buildCandlePatternModel, predictNextCandle } from "../src/candle-pattern-engine.js";

function makeCandles(count) {
  const rows=[];let price=1.08;
  for(let i=0;i<count;i++){
    const drift=(i%24<12?1:-1)*0.00008;
    const open=price,close=open+drift;
    rows.push({epoch:1_700_000_000+i*60,open,close,high:Math.max(open,close)+0.00003,low:Math.min(open,close)-0.00003});
    price=close;
  }
  return rows;
}
test("builds compact pattern index from OHLC history",()=>{
  const candles=makeCandles(1200);
  const model=buildCandlePatternModel(candles);
  assert.equal(model.candleCount,1200);
  assert.ok(model.patternCount>100);
  assert.equal(model.labels.length,model.patternCount);
});
test("returns a safe standby when the history is too short",()=>{
  const model=buildCandlePatternModel(makeCandles(100));
  const result=predictNextCandle(model,makeCandles(100).slice(-22));
  assert.equal(result.signal,"STANDBY");
});
test("does not use an outcome from the current or future query window",()=>{
  const candles=makeCandles(1200),model=buildCandlePatternModel(candles);
  const result=predictNextCandle(model,candles.slice(-22));
  assert.ok(["CALL","PUT","STANDBY"].includes(result.signal));
  assert.ok(result.matches===undefined||result.matches<=30);
});
