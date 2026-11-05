'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const BASE = 'https://datafeed.dukascopy.com/datafeed/EURUSD';
const RAW = path.resolve('data/historical/raw/EURUSD');
const MAX_DAYS = 366;
const PAUSE_MS = Number(process.env.HISTORICAL_DOWNLOAD_PAUSE_MS || 250);
function dateArg(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) throw new Error(name + ' must be YYYY-MM-DD');
  return new Date(value + 'T00:00:00Z');
}
function pad(n) { return String(n).padStart(2, '0'); }
function targetFor(hour) {
  return path.join(RAW, String(hour.getUTCFullYear()), pad(hour.getUTCMonth()), pad(hour.getUTCDate()), pad(hour.getUTCHours()) + 'h_ticks.bi5');
}
async function fetchHour(hour, force) {
  const target = targetFor(hour);
  if (!force && fs.existsSync(target) && fs.statSync(target).size > 0) return 'cached';
  const y = hour.getUTCFullYear(), m = pad(hour.getUTCMonth()), d = pad(hour.getUTCDate()), h = pad(hour.getUTCHours());
  const url = BASE + '/' + y + '/' + m + '/' + d + '/' + h + 'h_ticks.bi5';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'AI-Universal-Signal-Radar historical research downloader' }, signal: AbortSignal.timeout(30000) });
      if (response.status === 404) return 'missing';
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) return 'missing';
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = target + '.part'; fs.writeFileSync(temp, bytes); fs.renameSync(temp, target);
      return 'downloaded';
    } catch (error) {
      if (attempt === 4) throw new Error(url + ': ' + error.message);
      await sleep(attempt * 1000);
    }
  }
}
async function main() {
  const args = process.argv.slice(2);
  const value = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; };
  const force = args.includes('--force'), now = new Date();
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const defaultFrom = new Date(defaultTo); defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const from = dateArg(value('--from') || defaultFrom.toISOString().slice(0, 10), '--from');
  const to = dateArg(value('--to') || defaultTo.toISOString().slice(0, 10), '--to');
  if (to < from) throw new Error('--to must be on or after --from');
  const days = Math.round((to - from) / 86400000) + 1;
  if (days > MAX_DAYS) throw new Error('Range limited to ' + MAX_DAYS + ' days per run; split larger downloads into batches');
  fs.mkdirSync(RAW, { recursive: true });
  const counts = { downloaded: 0, cached: 0, missing: 0 }, start = Date.now();
  for (let day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    for (let h = 0; h < 24; h++) {
      const hour = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h));
      const status = await fetchHour(hour, force); counts[status]++;
      if (status === 'downloaded') process.stdout.write('Downloaded ' + hour.toISOString() + '\n');
      await sleep(PAUSE_MS);
    }
  }
  console.log(JSON.stringify({ source: 'Dukascopy public historical datafeed', instrument: 'EUR/USD', utcDateRange: { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) }, hourlyFiles: counts, rawDirectory: RAW, elapsedSeconds: Math.round((Date.now()-start)/1000), next: 'npm run data:decode' }, null, 2));
}
main().catch(error => { console.error('Historical download failed: ' + error.message); process.exitCode = 1; });
