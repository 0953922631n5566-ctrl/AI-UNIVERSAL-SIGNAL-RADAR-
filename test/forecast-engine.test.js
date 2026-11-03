const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateNextCandle } = require('../forecast-engine');
function sampleCandles(n=80) {
  return Array.from({length:n},(_,i)=>{
    const close=1.08+i*0.000012+Math.sin(i/2)*0.000035;
    const open=close-(i%3===0?0.000018:-0.000008);
    return {datetime:new Date(Date.UTC(2026,0,1,0,i)).toISOString().slice(0,19).replace('T',' '),
      open,high:Math.max(open,close)+0.00002,low:Math.min(open,close)-0.00002,close};
  });
}
test('insufficient closed history returns STANDBY',()=>{
  const r=evaluateNextCandle(sampleCandles(20));
  assert.equal(r.signal,'STANDBY'); assert.equal(r.horizon,1);
});
test('forecast is based only on completed candle OHLC and is NEXT M1 only',()=>{
  const candles=sampleCandles();
  const a=evaluateNextCandle(candles), b=evaluateNextCandle(candles);
  assert.deepEqual(a,b);
  assert.ok(['CALL','PUT','STANDBY'].includes(a.signal));
  assert.equal(a.validFor,'NEXT_M1_ONLY');
  assert.equal(a.lastClosedAt,a.nextCandleAt);
  assert.match(a.agreementVotes,/^\d+\/6$/);
});
test('live tick inputs are not part of the forecast API',()=>{
  assert.equal(evaluateNextCandle.length,1);
});
test('changing the latest closed candle changes the candle key used for a new decision',()=>{
  const candles=sampleCandles(), first=evaluateNextCandle(candles);
  candles.push({...candles.at(-1),datetime:'2026-01-01 01:20:00',open:1.2,close:1.199});
  const second=evaluateNextCandle(candles);
  assert.notEqual(first.lastClosedAt,second.lastClosedAt);
});

test('directional results must agree with both EMA trend and latest closed candle body',()=>{
  const candles=sampleCandles();
  const r=evaluateNextCandle(candles);
  if(r.signal==='CALL'){
    assert.equal(r.trend,'UPTREND');
    assert.equal(r.candleDirection,'BULLISH');
  }
  if(r.signal==='PUT'){
    assert.equal(r.trend,'DOWNTREND');
    assert.equal(r.candleDirection,'BEARISH');
  }
});
test('a bullish latest candle during a downtrend must not produce PUT',()=>{
  const candles=Array.from({length:80},(_,i)=>{
    const close=1.2-i*0.00002;
    const open=close+0.00001;
    return {datetime:new Date(Date.UTC(2026,0,1,0,i)).toISOString().slice(0,19).replace('T',' '),
      open,high:Math.max(open,close)+0.00001,low:Math.min(open,close)-0.00001,close};
  });
  const last=candles.at(-1);
  last.open=last.close-0.00001; // latest completed candle is bullish against the broader downtrend
  const r=evaluateNextCandle(candles);
  assert.equal(r.trend,'DOWNTREND');
  assert.equal(r.candleDirection,'BULLISH');
  assert.equal(r.signal,'STANDBY');
});
test('a bearish latest candle during an uptrend must not produce CALL',()=>{
  const candles=Array.from({length:80},(_,i)=>{
    const close=1.08+i*0.00002;
    const open=close-0.00001;
    return {datetime:new Date(Date.UTC(2026,0,1,0,i)).toISOString().slice(0,19).replace('T',' '),
      open,high:Math.max(open,close)+0.00001,low:Math.min(open,close)-0.00001,close};
  });
  const last=candles.at(-1);
  last.open=last.close+0.00001; // latest completed candle is bearish against the broader uptrend
  const r=evaluateNextCandle(candles);
  assert.equal(r.trend,'UPTREND');
  assert.equal(r.candleDirection,'BEARISH');
  assert.equal(r.signal,'STANDBY');
});
