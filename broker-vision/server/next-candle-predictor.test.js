import test from "node:test";
import assert from "node:assert/strict";
import { predictNextCandle } from "./next-candle-predictor.js";

const axisPrices = [{ price: 2, y: 0 }, { price: 1, y: 1000 }];
const up = i => {
  const closeY=110-i*8;
  return {color:"GREEN",openY:closeY+28,closeY,highY:closeY-5,lowY:closeY+33};
};
const down = i => {
  const closeY=110+i*8;
  return {color:"RED",openY:closeY-28,closeY,highY:closeY-33,lowY:closeY+5};
};

test("predicts CALL from rising closes and bullish candle structure", () => {
  const result = predictNextCandle({ candles:Array.from({length:6},(_,i)=>up(i)), axisPrices, price:1.9, priceHistory:[1.8998,1.8999,1.9000] });
  assert.equal(result.signal,"CALL");
  assert.equal(result.target,"NEXT_M1_CANDLE");
  assert.equal(result.setup,"TREND_CONTINUATION");
  assert.equal(result.source,"APK_PRICE_AND_CANDLE_GEOMETRY");
});

test("predicts PUT from falling closes and bearish candle structure", () => {
  const result = predictNextCandle({ candles:Array.from({length:6},(_,i)=>down(i)), axisPrices, price:1.9, priceHistory:[1.9002,1.9001,1.9000] });
  assert.equal(result.signal,"PUT");
  assert.equal(result.target,"NEXT_M1_CANDLE");
  assert.equal(result.setup,"TREND_CONTINUATION");
});

test("waits when candle shape and recent price direction conflict", () => {
  const result = predictNextCandle({ candles:Array.from({length:6},(_,i)=>up(i)), axisPrices, price:1.9, priceHistory:[1.9002,1.9001,1.9000] });
  assert.equal(result.signal,"WAIT");
  assert.match(result.reason,/ขัด/);
});

test("fails closed when fewer than four candles can be calibrated", () => {
  const result = predictNextCandle({ candles:[up(0),up(1),up(2)], axisPrices, price:1.9 });
  assert.equal(result.signal,"WAIT");
  assert.equal(result.status,"CANDLE_DATA_INSUFFICIENT");
});

test("fails closed when the APK price is unreadable", () => {
  const result = predictNextCandle({ candles:Array.from({length:6},(_,i)=>up(i)), axisPrices, price:null });
  assert.equal(result.signal,"WAIT");
  assert.equal(result.status,"PRICE_UNREADABLE");
});

test("uses APK candle geometry when OCR price axis is unavailable", () => {
  const result = predictNextCandle({ candles:Array.from({length:6},(_,i)=>up(i)), axisPrices:[{price:1.9,y:200}], price:1.9 });
  assert.equal(result.signal,"CALL");
  assert.equal(result.calibration,"APK_CANDLE_PIXEL_GEOMETRY");
});
