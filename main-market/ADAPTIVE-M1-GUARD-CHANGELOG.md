# Adaptive M1 Safety and Signal Calibration

Date: 2026-11-09
Branch: main-market
Scope: backend-only; EUR/USD M1 Main Market / AI-10 CORE.

## Changes
- Safety Noise Guard remains mandatory with unconditional VETO authority.
- Retains 200 valid closed candles, valid OHLC checks, fresh streaming/approved REST source checks, extreme volatility veto (>2.8), and abnormal latest-candle spike veto (>3.5x average range).
- Narrows the hard M1 continuity veto to gaps exceeding 120 seconds within the latest three closed candles. A single missing M1 minute is tolerated; multi-minute recent gaps still veto. Older isolated gaps in the 30-candle analysis window do not automatically veto an otherwise fresh setup.
- Central Dispatcher still requires at least two independent directional engines; aggregate score floor is reduced from 55 to 50 and conflict margin from 22% to 15%.
- Trend ADX floor is reduced from 18 to 14, while directional DI, MACD, RSI, candle-flow and higher-timeframe conflict protections remain.
- Range-bound volatility allowance is adjusted from 1.8 to 2.0; the high-volatility and extreme-volatility protections remain.

## Verification required
- Run the full Node test suite and confirm Render auto-deployment reaches LIVE.
- Inspect live diagnostics for signal frequency, veto reasons, engine votes, and API freshness.
- This calibration is not a backtest or proof of profitability. Continue manual-only use pending paper-trading and out-of-sample validation.
- No Android source or APK build is part of this backend-only change.
