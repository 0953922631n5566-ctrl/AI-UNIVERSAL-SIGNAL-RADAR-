'use strict';

// Offline M1 replay only. This measures the gate against the NEXT complete M1
// candle's range; it cannot validate 10/20/30-second projections.
const fs = require('node:fs');
const path = require('node:path');
const { analyzeMarket } = require('../engine/analyze-market');
const { simulateFuture } = require('../simulation/future-simulation-engine');

const DEFAULT_THRESHOLDS = [0.55, 0.60, 0.65, 0.70, 0.72, 0.75, 0.80];

function splitCsvLine(line, delimiter = ',') {
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

function parseTime(value) {
  // HistData Generic ASCII timestamps are YYYYMMDD HHMMSS in fixed EST (UTC-5),
  // explicitly without daylight-saving adjustment.
  const hist = /^(\d{4})(\d{2})(\d{2})\s(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (hist) {
    const [, y, mo, d, h, mi, sec] = hist;
    return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}-05:00`);
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n < 1e11 ? n * 1000 : n;
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function loadCandles(csvText) {
  const lines = String(csvText).replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
  if (!lines.length) throw new Error('CSV contains no candle rows');
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const first = splitCsvLine(lines[0], delimiter);
  const headers = first.map(x => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const index = (...names) => headers.findIndex(h => names.includes(h));
  const headerTime = index('time', 'datetime', 'timestamp', 'date');
  const hasHeader = headerTime >= 0 && index('open', 'o') >= 0 && index('high', 'h') >= 0 &&
    index('low', 'l') >= 0 && index('close', 'c') >= 0;
  // HistData Generic ASCII has no header: YYYYMMDD HHMMSS;open;high;low;close;volume
  const histDataRows = !hasHeader && /^\d{8}\s\d{6}$/.test(first[0]) && first.length >= 5;
  if (!hasHeader && !histDataRows) throw new Error('Unsupported CSV. Expected time/open/high/low/close headers or HistData Generic ASCII M1 rows.');
  const ti = hasHeader ? headerTime : 0;
  const oi = hasHeader ? index('open', 'o') : 1;
  const hi = hasHeader ? index('high', 'h') : 2;
  const li = hasHeader ? index('low', 'l') : 3;
  const ci = hasHeader ? index('close', 'c') : 4;
  const candles = [];
  for (let row = hasHeader ? 1 : 0; row < lines.length; row++) {
    const cols = splitCsvLine(lines[row], delimiter);
    if (cols.length <= Math.max(ti, oi, hi, li, ci)) continue;
    const candle = { time: parseTime(cols[ti]), open: Number(cols[oi]), high: Number(cols[hi]), low: Number(cols[li]), close: Number(cols[ci]) };
    if (!Number.isFinite(candle.time) || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
        candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) {
      throw new Error(`Invalid OHLC row at CSV line ${row + 1}`);
    }
    if (candles.length && candle.time <= candles[candles.length - 1].time) throw new Error(`Timestamps must be strictly ascending; issue at CSV line ${row + 1}`);
    candles.push(candle);
  }
  if (candles.length < 202) throw new Error(`Need at least 202 M1 candles; received ${candles.length}`);
  return candles;
}

function outcomeFor(signal, entry, next, atr) {
  const adverse = signal === 'CALL' ? Math.max(0, entry - next.low) : Math.max(0, next.high - entry);
  const favorable = signal === 'CALL' ? Math.max(0, next.high - entry) : Math.max(0, entry - next.low);
  const fakeout = adverse > favorable && adverse >= atr * 0.15;
  const good = favorable > adverse;
  return { adverse, favorable, fakeout, good };
}

function round(value) { return Math.round(value * 100) / 100; }

function runM1Backtest(candles, thresholds = DEFAULT_THRESHOLDS) {
  if (!Array.isArray(candles) || candles.length < 202) throw new Error('At least 202 candles are required');
  const samples = [];
  for (let i = 199; i < candles.length - 1; i++) {
    const history = candles.slice(0, i + 1); // strictly no future candle in the feature window
    const next = candles[i + 1];
    if (next.time - candles[i].time !== 60000) continue; // avoid weekend/session gaps
    const decision = analyzeMarket(history);
    if (!['CALL', 'PUT'].includes(decision.signal)) continue;
    const simulation = simulateFuture(history, { volatilityRatio: decision.indicators?.volatilityRatio });
    if (simulation.status !== 'READY') continue;
    const outcome = outcomeFor(decision.signal, next.open, next, simulation.atr);
    samples.push({ signal: decision.signal, risk: simulation.reversalRisk, ...outcome });
  }

  const fakeouts = samples.filter(x => x.fakeout).length;
  const good = samples.filter(x => x.good).length;
  const neutral = samples.length - fakeouts - good;
  const rows = thresholds.map(threshold => {
    let blocked = 0, blockedFakeouts = 0, blockedGood = 0, retainedFakeouts = 0;
    for (const sample of samples) {
      const block = sample.risk >= threshold;
      if (block) { blocked++; if (sample.fakeout) blockedFakeouts++; if (sample.good) blockedGood++; }
      else if (sample.fakeout) retainedFakeouts++;
    }
    return {
      threshold,
      baselineSignals: samples.length,
      blockedSignals: blocked,
      retainedSignals: samples.length - blocked,
      fakeoutsInBaseline: fakeouts,
      fakeoutsBlocked: blockedFakeouts,
      fakeoutCapturePct: fakeouts ? round(blockedFakeouts / fakeouts * 100) : null,
      goodSignalsInBaseline: good,
      goodSignalsBlocked: blockedGood,
      goodSignalLossPct: good ? round(blockedGood / good * 100) : null,
      fakeoutsRemaining: retainedFakeouts,
      neutralOutcomes: neutral
    };
  });
  return {
    mode: 'M1_NEXT_CANDLE_RANGE_DIAGNOSTIC',
    warning: 'This M1 replay does not validate 10/20/30-second outcomes or prove profitability.',
    candleCount: candles.length,
    evaluatedDirectionalSignals: samples.length,
    baseline: { fakeouts, good, neutral },
    thresholds: rows
  };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/backtest-m1.js <EURUSD_M1.csv> [report.json]');
    process.exitCode = 2;
  } else {
    try {
      const candles = loadCandles(fs.readFileSync(path.resolve(input), 'utf8'));
      const report = runM1Backtest(candles);
      const output = JSON.stringify(report, null, 2);
      if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), `${output}\n`);
      console.log(output);
    } catch (error) {
      console.error(`Backtest failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { loadCandles, runM1Backtest, DEFAULT_THRESHOLDS };
