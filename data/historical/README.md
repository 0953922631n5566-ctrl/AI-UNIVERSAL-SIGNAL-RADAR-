# Historical EUR/USD research data

## Source and formats
- Dukascopy public historical EUR/USD hourly BI5 tick files; UTC dates and zero-based month path.
- BI5 records are 20-byte big-endian values (ms from hour start, ask, bid, ask volume, bid volume), LZMA-Alone; price scale 100000.
- Raw files are stored under `data/historical/raw/EURUSD/YYYY/MM-1/DD/HHh_ticks.bi5`.
- HTTP 404/empty files and exhausted per-hour failures are recorded in `data/historical/download-manifest.json`; downloader continues to later hours and does not fabricate missing quotes.

## Commands
```bash
npm run data:download -- --from 2025-01-06 --to 2025-01-10
npm run data:decode
npm run backtest:ticks
npm run backtest:m1 -- data/historical/EURUSD_M1.csv data/historical/reports/m1-report.json
npm test
```
Downloader defaults to the previous 30 complete UTC days, max 366 days. Existing files are reused. Retryable network/timeout, HTTP 408/425/429 and 5xx errors receive exponential retries; after exhaustion that hour is marked missing and the next hour is attempted. Set `HISTORICAL_DOWNLOAD_PAUSE_MS`, `HISTORICAL_DOWNLOAD_RETRIES`, or `HISTORICAL_DOWNLOAD_TIMEOUT_MS` to tune requests.

## Coverage gate and outputs
- `HISTORICAL_MIN_COVERAGE_PCT` defaults to 50% of expected Monday-Friday hours; weekends are excluded.
- Decoder independently counts valid BI5 files and enforces `HISTORICAL_MIN_TICKS=100` and `HISTORICAL_MIN_M1_CANDLES=202`.
- Decoder writes `data/historical/reports/decode-report.json`; if coverage/data minimums fail, it exits non-zero but retains decoded CSVs and report.
- Tick replay produces separate 10s/20s/30s buckets in `tick-backtest-report.json`. Always inspect sample counts; a zero-sample horizon is not an accuracy result.
- M1 replay is a coarse next-M1-candle diagnostic and cannot validate intraminute projections.
- Workflow artifact contains download manifest, CSVs and JSON reports.

## Limitations and safety
This is a research pipeline, not Twelve Data or the user's broker feed. Dukascopy spread, liquidity, execution and timestamps may differ. M1 bars aggregated from bid ticks cannot validate 10/20/30s outcomes. Inspect coverage, corrupt/missing hours, tick counts, spread distribution and sample counts. Synthetic tests are not empirical results. Safety Gate remains research-only and OFF in production until real tick replay and out-of-sample review are complete. Do not claim accuracy or profitability without independently checked metrics.
