# Historical EUR/USD research data

## Source and formats
- Primary source: Dukascopy public historical datafeed, hourly EUR/USD BI5 tick files.
- Raw files are stored under data/historical/raw/EURUSD/YYYY/MM-1/DD/HHh_ticks.bi5.
- The downloader uses UTC dates and zero-based months in the provider URL.
- The decoder expects 20-byte big-endian records (milliseconds from hour start, ask, bid, ask volume, bid volume), LZMA-Alone compressed. EUR/USD prices are scaled by 100000.
- Missing hours (weekends/holidays) are counted as missing, not fabricated. Existing non-empty raw files are reused.

## Prepare a bounded sample
Node.js 18+ and Python 3 with standard-library lzma are required.

```bash
npm run data:download -- --from 2025-01-06 --to 2025-01-10
npm run data:decode
npm run backtest:ticks
npm run backtest:m1 -- data/historical/EURUSD_M1.csv data/historical/reports/m1-report.json
npm test
```

The downloader defaults to the previous 30 complete UTC days and limits each run to 366 days. Use smaller date ranges first. Set HISTORICAL_DOWNLOAD_PAUSE_MS to adjust request spacing. Use --force to re-fetch cached hours.

The decoder creates:
- EURUSD_ticks.csv: timestamp (UTC), bid, ask
- EURUSD_M1.csv: bid OHLC bars aggregated from the same ticks

The tick replay defaults to EURUSD_ticks.csv and writes data/historical/reports/tick-backtest-report.json. It evaluates 10/20/30-second bid/ask excursions, not profitability.

## Important limitations
- This is a research data pipeline, not a live feed and not Twelve Data.
- The data represents Dukascopy's quote stream; it may differ from the user's broker in spread, liquidity, execution, and timestamps.
- The M1 output is aggregated from bid ticks and cannot validate intraminute outcomes.
- The existing tick harness requires at least 200 completed M1 candles before it can begin producing directional samples; a few days may produce no eligible samples.
- Downloaded raw files and generated CSV/report files are ignored by Git because they can be very large.
- Always inspect date coverage, tick counts, missing hours, spread distribution, and report sample counts before interpreting results.
- Synthetic unit tests validate code paths only. They are not empirical accuracy measurements.

## Safety policy
The Future Simulation Safety Gate remains research-only and disabled in production. Do not enable it until the full npm test suite passes in CI, a sufficiently large real tick dataset has been replayed, out-of-sample results are reviewed, and falseout capture versus good-signal loss is accepted explicitly. No accuracy or profitability percentage should be reported without a defined, independently checked metric.
