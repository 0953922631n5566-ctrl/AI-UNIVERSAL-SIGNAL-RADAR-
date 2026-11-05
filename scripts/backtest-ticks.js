'use strict';

// Offline EUR/USD tick replay. Signal features use only completed M1 bars;
// outcome labels use subsequent bid/ask ticks, never future ticks in features.
const fs = require('node:fs');
const path = require('node:path');
const { analyzeMarket } = require('../engine/analyze-market');
const { simulateFuture } = require('../simulation/future-simulation-engine');

const HORIZONS = [10, 20, 30];
const DEFAULT_THRESHOLDS = [0.55, 0.60, 0.65, 0.70, 0.72, 0.75, 0.80];

function splitLine(line, delimiter = ';') {
  const out = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { out.push(value.trim()); value = ''; }
    else value += ch;
  }
  out.push(value.trim());
  return out;
}

function parseTimestamp(value) {
  const hist = /^(\d{4})(\d{2})(\d{2})\s(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (hist) {
    const [, y, mo, d, h, mi, sec] = hist;
    return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}-05:00`);
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function loadTicks(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
  if (!lines.length) throw new Error('Tick file is empty');
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const first = splitLine(lines[0], delimiter);
  const normalized = first.map(x => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (...keys) => normalized.findIndex(x => keys.includes(x));
  const ti = find('time', 'datetime', 'timestamp', 'date');
  const bi = find('bid', 'b');
  const ai = find('ask', 'a');
  const hasHeader = ti >= 0 && bi >= 0 && ai >= 0;
  const histdata = !hasHeader && /^\d{8}\s\d{6}$/.test(first[0]) && first.length >= 3;
  if (!hasHeader && !histdata) {
    throw new Error('Unsupported tick format. Expected timestamp,bid,ask headers or HistData Generic ASCII: YYYYMMDD HHMMSS;bid;ask');
  }
  const ticks = [];
  for (let row = hasHeader ? 1 : 0; row < lines.length; row++) {
    const cols = splitLine(lines[row], delimiter);
    if (cols.length < (hasHeader ? Math.max(ti, bi, ai) : 3) + 1) continue;
    const tick = {
      time: parseTimestamp(cols[hasHeader ? ti : 0]),
      bid: Number(cols[hasHeader ? bi : 1]),
      ask: Number(cols[hasHeader ? ai : 2])
    };
    if (!Number.isFinite(tick.time) || !Number.isFinite(tick.bid) || !Number.isFinite(tick.ask) ||
        tick.bid <= 0 || tick.ask <= 0 || tick.ask < tick.bid) {
      throw new Error(`Invalid bid/ask tick at line ${row + 1}`);
    }
    if (ticks.length && tick.time < ticks[ticks.length - 1].time) {
      throw new Error(`Tick timestamps must be non-decreasing; issue at line ${row + 1}`);
    }
    tick.mid = (tick.bid + tick.ask) / 2;
    ticks.push(tick);
  }
  if (ticks.length < 100) throw new Error(`Need at least 100 ticks; received ${ticks.length}`);
  return ticks;
}

function buildM1Candles(ticks) {
  const buckets = new Map();
  for (const tick of ticks) {
    const minute = Math.floor(tick.time / 60000) * 60000;
    let candle = buckets.get(minute);
    if (!candle) {
      candle = { time: minute, open: tick.mid, high: tick.mid, low: tick.mid, close: tick.mid, tickCount: 0 };
      buckets.set(minute, candle);
    }
    candle.high = Math.max(candle.high, tick.mid);
    candle.low = Math.min(candle.low, tick.mid);
    candle.close = tick.mid;
    candle.tickCount++;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function scorePath(signal, entryTick, pathTicks, atr) {
  const entry = signal === 'CALL' ? entryTick.ask : entryTick.bid;
  const prices = pathTicks.map(t => signal === 'CALL' ? t.bid : t.ask);
  if (!prices.length) return null;
  const favorable = signal === 'CALL'
    ? Math.max(0, ...prices.map(p => p - entry))
    : Math.max(0, ...prices.map(p => entry - p));
  const adverse = signal === 'CALL'
    ? Math.max(0, ...prices.map(p => entry - p))
    : Math.max(0, ...prices.map(p => p - entry));
  return {
    favorable,
    adverse,
    fakeout: adverse > favorable && adverse >= atr * 0.15,
    good: favorable > adverse,
    neutral: favorable === adverse
  };
}

function round(n) { return Math.round(n * 100) / 100; }

function runTickBacktest(ticks, options = {}) {
  const thresholds = options.thresholds || DEFAULT_THRESHOLDS;
  const horizons = options.horizons || HORIZONS;
  if (!Array.isArray(ticks) || ticks.length < 100) throw new Error('At least 100 valid ticks are required');
  const candles = buildM1Candles(ticks);
  const samples = Object.fromEntries(horizons.map(h => [h, []]));
  let staleEntrySkips = 0;
  let noHorizonDataSkips = 0;

  for (let i = 199; i < candles.length; i++) {
    const history = candles.slice(i - 199, i + 1);
    const signalTime = candles[i].time + 60000;
    const entryIndex = lowerBound(ticks, signalTime);
    if (entryIndex >= ticks.length) continue;
    const entryTick = ticks[entryIndex];
    if (entryTick.time - signalTime > 2000) { staleEntrySkips++; continue; }

    // At signalTime, only history through the preceding, fully completed M1 candle is visible.
    const decision = analyzeMarket(history);
    if (!decision || !['CALL', 'PUT'].includes(decision.signal)) continue;
    const simulation = simulateFuture(history, { volatilityRatio: decision.indicators?.volatilityRatio });
    if (!simulation || simulation.status !== 'READY' || !Number.isFinite(simulation.reversalRisk) ||
        !Number.isFinite(simulation.atr) || simulation.atr <= 0) continue;

    for (const horizon of horizons) {
      const endTime = signalTime + horizon * 1000;
      const start = entryIndex;
      const end = lowerBound(ticks, endTime + 1);
      const window = ticks.slice(start, end);
      if (!window.length || window[window.length - 1].time < endTime - 1000) {
        noHorizonDataSkips++;
        continue;
      }
      const outcome = scorePath(decision.signal, entryTick, window, simulation.atr);
      if (outcome) samples[horizon].push({ signal: decision.signal, risk: simulation.reversalRisk, ...outcome });
    }
  }

  const reports = {};
  for (const horizon of horizons) {
    const rows = samples[horizon];
    const fakeouts = rows.filter(x => x.fakeout).length;
    const good = rows.filter(x => x.good).length;
    const neutral = rows.filter(x => x.neutral).length;
    reports[horizon] = {
      samples: rows.length,
      baseline: { fakeouts, good, neutral },
      thresholds: thresholds.map(threshold => {
        const blocked = rows.filter(x => x.risk >= threshold);
        const blockedFakeouts = blocked.filter(x => x.fakeout).length;
        const blockedGood = blocked.filter(x => x.good).length;
        return {
          threshold,
          blockedSignals: blocked.length,
          retainedSignals: rows.length - blocked.length,
          fakeoutsBlocked: blockedFakeouts,
          fakeoutCapturePct: fakeouts ? round(blockedFakeouts / fakeouts * 100) : null,
          goodSignalsBlocked: blockedGood,
          goodSignalLossPct: good ? round(blockedGood / good * 100) : null,
          fakeoutsRemaining: fakeouts - blockedFakeouts
        };
      })
    };
  }
  return {
    mode: 'EURUSD_TICK_PATH_REPLAY',
    warning: 'Offline heuristic diagnostic only. Tick feed coverage, bid/ask convention, broker spread, slippage and out-of-sample stability must be verified. Not a profitability claim.',
    tickCount: ticks.length,
    m1CandleCount: candles.length,
    evaluatedHorizonsSeconds: horizons,
    staleEntrySkips,
    noHorizonDataSkips,
    reports
  };
}

function lowerBound(items, time) {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

if (require.main === module) {
  const input = process.argv[2] || 'data/historical/EURUSD_ticks.csv';
  const reportPath = process.argv[3] || 'data/historical/reports/tick-backtest-report.json';
  try {
    const ticks = loadTicks(fs.readFileSync(path.resolve(input), 'utf8'));
    const report = runTickBacktest(ticks);
    report.inputFile = path.resolve(input);
    report.generatedAt = new Date().toISOString();
    const output = JSON.stringify(report, null, 2);
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), output + '\\n');
    console.log(output);
    console.log('Report saved: ' + path.resolve(reportPath));
  } catch (error) {
    console.error('Tick backtest failed: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { loadTicks, buildM1Candles, runTickBacktest, HORIZONS, DEFAULT_THRESHOLDS };
