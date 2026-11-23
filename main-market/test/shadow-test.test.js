import test from "node:test";
import assert from "node:assert/strict";
import { candidateSignals, outcomeFor, summarizeResults, buildReport } from "../shadow-test/strategy.js";

test("directional filters and 3-of-4 consensus agree in a strong trend", () => {
  const bullish = candidateSignals({ close: 1.105 }, {
    ema5: 1.104, ema20: 1.103, ema5Slope: 0.0001, rsi: 58, adx: 22, bbMiddle: 1.103
  });
  assert.equal(bullish.EMA5_FLOW, "CALL");
  assert.equal(bullish.EMA5_ADX_TREND, "CALL");
  assert.equal(bullish.RSI_BOLLINGER_MOMENTUM, "CALL");
  assert.equal(bullish.CONSENSUS_3_OF_4, "CALL");

  const bearish = candidateSignals({ close: 1.101 }, {
    ema5: 1.102, ema20: 1.103, ema5Slope: -0.0001, rsi: 42, adx: 24, bbMiddle: 1.103
  });
  assert.equal(bearish.EMA5_FLOW, "PUT");
  assert.equal(bearish.EMA5_ADX_TREND, "PUT");
  assert.equal(bearish.CONSENSUS_3_OF_4, "PUT");
});

test("consensus does not force a direction when filters disagree", () => {
  const result = candidateSignals({ close: 1.105 }, {
    ema5: 1.104, ema20: 1.103, ema5Slope: 0.0001, rsi: 50, adx: 10, bbMiddle: 1.103
  });
  assert.equal(result.CONSENSUS_3_OF_4, undefined);
});

test("outcomes use target candle entry-to-close direction", () => {
  assert.equal(outcomeFor("CALL", 1.1, 1.101), "WIN");
  assert.equal(outcomeFor("CALL", 1.1, 1.099), "LOSS");
  assert.equal(outcomeFor("PUT", 1.1, 1.099), "WIN");
  assert.equal(outcomeFor("PUT", 1.1, 1.101), "LOSS");
  assert.equal(outcomeFor("CALL", 1.1, 1.1), "FLAT");
});

test("the one-win target is only achieved by an actual consensus win", () => {
  const loss = buildReport([{ strategy: "CONSENSUS_3_OF_4", outcome: "LOSS", targetMinute: 1 }]);
  assert.equal(loss.targetAchieved, false);
  const win = buildReport([{ strategy: "CONSENSUS_3_OF_4", outcome: "WIN", targetMinute: 2 }]);
  assert.equal(win.targetAchieved, true);
});

test("streak calculation never counts losses or flats as wins", () => {
  const summary = summarizeResults([
    { outcome: "WIN" }, { outcome: "WIN" }, { outcome: "LOSS" },
    { outcome: "WIN" }, { outcome: "WIN" }, { outcome: "WIN" }, { outcome: "FLAT" }
  ]);
  assert.equal(summary.wins, 5);
  assert.equal(summary.losses, 1);
  assert.equal(summary.flats, 1);
  assert.equal(summary.longestWinStreak, 3);
  assert.equal(summary.meetsThreeConsecutive, true);
  assert.equal(summary.meetsFourConsecutive, false);
});
