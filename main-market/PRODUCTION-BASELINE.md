# Main Market Production Baseline — 2026-11-10

Status: **Locked production baseline**  
Service: `ai-signal-radar-main-market`  
Branch: `main-market`  
Default market checked: `EUR/USD · M1 · NON-OTC`  
Decision engine: `LOCAL_PARTIAL_SCORING_65_AGILE`  
External AI/Gemini decision calls: **DISABLED / NOT USED**

This document records the deployed parameter baseline. A lock means the implementation and configuration must not drift without an explicitly reviewed change, tests, and a new release. It does **not** claim a verified win rate or guarantee trading accuracy.

## 1. Scoring model — fixed weights

| Component | Weight |
|---|---:|
| EMA5 Slope Reversal | 30 points |
| S/R Fakeout | 30 points |
| Proximity & Momentum | 20 points |
| Trend Context | 20 points |
| **Total** | **100 points** |

Partial points are retained within each component; do not convert the model to all-or-nothing scoring.

## 2. Decision thresholds — fixed

- **CALL / PUT:** top directional score >= 65, provided neither kill switch is active.
- **PREPARE:** top directional score 45–64, provided neither kill switch is active.
- **STANDBY:** top directional score < 45, ambiguous direction, insufficient data, or either kill switch is active.

The score is a rule-based score, not a probability of winning.

## 3. Kill switches — fixed

- **Choppy market:** EMA5 and EMA20 are tangled when their absolute separation is <= 0.12 × ATR; both EMA slopes are flat when each absolute slope is <= 0.025 × ATR. When both conditions are true, force STANDBY.
- **Abnormal ATR spike:** force STANDBY when the latest candle range is > 2.8 × ATR, or recent ATR is > 2.4 × the historical baseline ATR.
- EMA20 is used for the Choppy kill switch only; EMA5 remains the directional reference in the scoring model.

## 4. Candle/data requirements — fixed

- Timeframe: M1.
- Closed-candle analysis only.
- 50 context candles + 4 entry candles = 54 closed candles required.
- Do not require the user to manually accumulate candles; the backend obtains market data through the existing Twelve Data connection.
- Preserve data-quality, stale-data, streaming, and timing guards.

## 5. Signal timing and execution boundary

- PREPARE monitoring window: T-10.
- Final CALL/PUT decision window: T-5.
- Keep the signal visible for the existing 30-second hold period after the new M1 candle opens.
- Manual decision support only; no broker execution or automatic order placement.

## 6. Telegram Mini App and integration freeze

- Preserve the existing Telegram Mini App layout and authentication/session behavior.
- Preserve the Reason & Evidence block in the upper content area.
- Preserve Twelve Data API Keys status block at the bottom.
- Preserve Twelve Data API pool, REST/Streaming, failover, stale-data checks, and existing pair selector.
- Main Market remains separate from OTC/OCR and the VISUAL-SIGNAL-AI experiment.
- Do not reintroduce Gemini or other external AI calls into the directional decision path.

## 7. Change control

Any proposed change to weights, thresholds, kill-switch formulas, candle counts, signal timing, UI block order, or data connections requires:
1. A dedicated feature branch and pull request.
2. Tests covering the changed behavior.
3. CI passing before merge.
4. Production health/API verification after deployment.
5. A new versioned release/tag after the merged commit is confirmed live.

Rollback target for this baseline is the commit to which the production release tag is ultimately attached.

## 8. Verification caveat

The baseline values above reflect the current implementation. They are not evidence that the strategy has achieved the highest possible accuracy. Validate with out-of-sample backtests and forward testing before making performance claims.


---

## 9. Superseding production architecture — 2026-11-12

The 2026-11-10 M1-only scoring baseline above is retained as historical change-control context. It is superseded for the active production decision path by the merged M5/M1 architecture:

- Active analyzer: M5 LIVE DIRECTION + M1 PRECISION ENTRY.
- Data source: Twelve Data M1 REST candles for historical context plus the current M1 candle updated by Twelve Data live Streaming ticks.
- Signal decisions require a fresh Streaming tick; stale or REST-only data cannot produce CALL/PUT.
- Context requirement: at least 30 closed M1 candles plus the current live M1 candle.
- M5 direction: aggregate the five-minute block while it is forming; require directional displacement and confirmation against prior completed M5 candles.
- M1 entry: EMA5 pullback, live breakout beyond the previous closed M1 high/low, and extension no greater than 1.4 ATR.
- Signal cap: one finalized signal per M5 block.
- Existing Mini App session/authentication, pair selector, API pool, T-10 non-directional PREPARE, T-5 CALL/PUT, and 30-second signal hold remain.
- REST fallback is disabled for signal decisions. REST is used only for historical closed-candle context.
- No synthetic prices, CSV replay, external AI decision calls, or broker execution in the production path.
- Release validation remains false pending out-of-sample and longer forward testing. This is manual decision support, not a guarantee of winning trades.
- Rollback: revert the active server import to the retained src/analyzer.js and restore the previous release metadata; keep the current feature commit available for comparison.

