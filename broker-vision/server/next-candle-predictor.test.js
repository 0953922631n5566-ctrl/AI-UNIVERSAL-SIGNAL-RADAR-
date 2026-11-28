import test from "node:test";
import assert from "node:assert/strict";
import { predictNextCandle } from "./next-candle-predictor.js";

const axisPrices = [{ price: 2, y: 0 }, { price: 1, y: 1000 }];
const up = () => ({ color:"GREEN", openY:120, closeY:90, highY:85, lowY:125 });
const down = () => ({ color:"RED", openY:90, closeY:120, highY:85, lowY:125 });

test("predicts CALL from a consistent upward candle sequence", () => {
  const result = predictNextCandle({ candles:Array(5).fill(null).map(() => up()), axisPrices, price:1.9 });
  assert.equal(result.signal,"CALL");
  assert.equal(result.target,"NEXT_M1_CANDLE");
  assert.equal(result.source,"APK_PRICE_AND_CANDLE_GEOMETRY");
});

test("predicts PUT from a consistent downward candle sequence", () => {
  const result = predictNextCandle({ candles:Array(5).fill(null).map(() => down()), axisPrices, price:1.9 });
  assert.equal(result.signal,"PUT");
  assert.equal(result.target,"NEXT_M1_CANDLE");
});

test("fails closed when fewer than four candles can be calibrated", () => {
  const result = predictNextCandle({ candles:[up(),up(),up()], axisPrices, price:1.9 });
  assert.equal(result.signal,"WAIT");
  assert.equal(result.status,"CANDLE_DATA_INSUFFICIENT");
});

test("fails closed when the APK price is unreadable", () => {
  const result = predictNextCandle({ candles:Array.from({length:5},up()), axisPrices, price:null });
  assert.equal(result.signal,"WAIT");
  assert.equal(result.status,"PRICE_UNREADABLE");
});

test("uses APK candle geometry even when OCR price axis is unavailable", () => {
  const result = predictNextCandle({ candles:Array(5).fill(null).map(() => up()), axisPrices:[{price:1.9,y:200}], price:1.9 });
  assert.equal(result.signal,"CALL");
  assert.equal(result.calibration,"APK_CANDLE_PIXEL_GEOMETRY");
});
