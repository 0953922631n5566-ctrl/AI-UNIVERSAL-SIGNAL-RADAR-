# Main Market Production Baseline — 2026-11-10

Status: **Locked production baseline**  
Service: `ai-signal-radar-main-market`  
Branch: `main-market`  
Default market checked: `EUR/USD · M1 · NON-OTC`  
Decision engine: `LOCAL_PARTIAL_SCORING_75_AGILE`  
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

- **CALL / PUT:** top directional score >= 75, provided neither kill switch is active.
- **PREPARE:** top directional score 45–74, provided neither kill switch is active.
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
