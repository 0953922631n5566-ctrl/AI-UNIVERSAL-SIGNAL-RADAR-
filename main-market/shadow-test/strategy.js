const finite = Number.isFinite;

export const STRATEGY_NAMES = Object.freeze([
  "EMA5_FLOW", "EMA5_ADX_TREND", "RSI_BOLLINGER_MOMENTUM",
  "EMA5_FAST_MOMENTUM", "LIVE_SYSTEM_SIGNAL", "CONSENSUS_3_OF_4"
]);

/** Shadow-only candidates derived from a completed EUR/USD M1 candle. */
export function candidateSignals(candle, metrics = {}, liveSignal = "STANDBY") {
  const close = Number(candle?.close);
  const ema5 = Number(metrics.ema5);
  const ema20 = Number(metrics.ema20);
  const slope5 = Number(metrics.ema5Slope);
  const rsi = Number(metrics.rsi);
  const adx = Number(metrics.adx);
  const bbMiddle = Number(metrics.bbMiddle);
  if (![close, ema5, ema20, slope5, rsi, adx].every(finite)) return {};

  const out = {};
  const put = (name, direction) => {
    if (direction === "CALL" || direction === "PUT") out[name] = direction;
  };

  put("EMA5_FLOW",
    close > ema5 && slope5 > 0 && rsi >= 52 ? "CALL"
      : close < ema5 && slope5 < 0 && rsi <= 48 ? "PUT" : null);
  put("EMA5_ADX_TREND",
    ema5 > ema20 && slope5 > 0 && adx >= 18 && rsi > 50 ? "CALL"
      : ema5 < ema20 && slope5 < 0 && adx >= 18 && rsi < 50 ? "PUT" : null);

  if (finite(bbMiddle)) {
    put("RSI_BOLLINGER_MOMENTUM",
      rsi >= 55 && rsi <= 68 && close > bbMiddle ? "CALL"
        : rsi >= 32 && rsi <= 45 && close < bbMiddle ? "PUT" : null);
  }

  put("EMA5_FAST_MOMENTUM",
    close > ema5 && slope5 > 0 && rsi > 50 && adx >= 14 ? "CALL"
      : close < ema5 && slope5 < 0 && rsi < 50 && adx >= 14 ? "PUT" : null);
  put("LIVE_SYSTEM_SIGNAL", liveSignal);

  const votes = ["EMA5_FLOW", "EMA5_ADX_TREND", "RSI_BOLLINGER_MOMENTUM", "EMA5_FAST_MOMENTUM"];
  for (const direction of ["CALL", "PUT"]) {
    const count = votes.filter(name => out[name] === direction).length;
    if (count >= 3) {
      out.CONSENSUS_3_OF_4 = direction;
      break;
    }
  }
  return out;
}

export function outcomeFor(direction, entryPrice, exitPrice) {
  if (!["CALL", "PUT"].includes(direction) ||
      !finite(entryPrice) || !finite(exitPrice) || entryPrice <= 0 || exitPrice <= 0) return "UNSETTLED";
  if (exitPrice === entryPrice) return "FLAT";
  return direction === "CALL"
    ? (exitPrice > entryPrice ? "WIN" : "LOSS")
    : (exitPrice < entryPrice ? "WIN" : "LOSS");
}

export function summarizeResults(records = []) {
  const wins = records.filter(x => x.outcome === "WIN").length;
  const losses = records.filter(x => x.outcome === "LOSS").length;
  const flats = records.filter(x => x.outcome === "FLAT").length;
  let current = 0, longest = 0;
  for (const row of records) {
    if (row.outcome === "WIN") { current++; longest = Math.max(longest, current); }
    else current = 0;
  }
  const decided = wins + losses;
  return {
    trades: records.length, wins, losses, flats,
    winRate: decided ? Math.round(wins / decided * 1000) / 10 : null,
    longestWinStreak: longest, currentWinStreak: current,
    meetsThreeConsecutive: longest >= 3,
    meetsFourConsecutive: longest >= 4
  };
}

export function buildReport(records = []) {
  const strategies = Object.fromEntries(STRATEGY_NAMES.map(name => {
    const rows = records.filter(row => row.strategy === name)
      .sort((a, b) => a.targetMinute - b.targetMinute);
    return [name, { ...summarizeResults(rows), records: rows }];
  }));
  const consensus = strategies.CONSENSUS_3_OF_4;
  return {
    totalRecords: records.length,
    target: "At least one WIN from the 3-of-4 consensus strategy during a 5-minute observation window",
    targetAchieved: consensus.wins >= 1,
    strategies,
    disclaimer: "Shadow screening only. Entry uses the first observed live tick in the target minute, not broker execution or guaranteed candle-open fill. No win is guaranteed."
  };
}
