# Signal Radar PRO — Primary Production Baseline

Status: PRIMARY PRODUCTION BASELINE (configuration and code snapshot)
Recorded: 2026-11-09
Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-
Production branch at baseline: main-market
Baseline commit: e9f42cf59d405a21c3a6c1727ec7327cf9698be4
Render service: ai-signal-radar-main-market
Production URL: https://ai-signal-radar-main-market.onrender.com
Health: https://ai-signal-radar-main-market.onrender.com/health
Mini App route: /signal

## Locked baseline
- Primary model: gemini-3.5-flash-lite
- Market: EUR/USD, M1 (Main Market)
- Gemini cadence: one single-shot request at T-5 per M1 candle
- PREPARE T-10 is UI-only; it must not trigger a Gemini analysis request.
- Fresh live tick required (maximum age 5 seconds) before analysis.
- No retries and no key rotation for Gemini within the same candle.
- Fail closed to STANDBY when data is stale/missing, provider fails, or evidence is unclear/conflicting.
- Preserve Twelve Data source and existing data-quality/timing guards.
- No forced CALL/PUT, no random directional fallback, no changes to core decision logic without explicit owner approval and a separate reviewed change.

## Change-control policy
Treat the baseline commit above as the reference implementation for Primary Production.
Do not change the Gemini model, T-5 scheduling, request-count behavior, data freshness gate, or directional decision/safety logic as routine maintenance.
Any proposed change requires explicit approval, a separate branch and pull request, tests, and a documented rollback path. Never edit this baseline branch as a shortcut to production.
This document and branch are a recorded operational baseline; they do not by themselves enforce GitHub branch protection or prevent an administrator from changing production settings.

## Verification record (evidence-based)
- Render deployment for commit e9f42cf59d405a21c3a6c1727ec7327cf9698be4 was confirmed LIVE on 2026-11-09.
- /health reported Gemini configured with model gemini-3.5-flash-lite and Twelve Data pool 10/10 ready.
- Runtime logs confirmed T-5 single-shot Gemini request and HTTP 200.
- The observed runtime decision in the inspected logs was STANDBY in SIDEWAY regime (confidence 45); no CALL/PUT was observed in that inspection.
- /signal returned the Telegram Mini App page, but the inspected page was still waiting for Telegram session/data and did not provide evidence of a live CALL/PUT rendered in the Mini App.
- Owner reports successful end-to-end Telegram Mini App and EUR/USD M1 testing on 2026-11-09. This is recorded as owner-reported acceptance, not independently evidenced by the logs inspected above.

## Reliability note
HTTP 200 confirms the Gemini API request succeeded; it does not guarantee a CALL/PUT result or immunity from future HTTP 429 rate limits. Model quotas and provider availability can change. STANDBY remains the safe result when conditions are not met.
