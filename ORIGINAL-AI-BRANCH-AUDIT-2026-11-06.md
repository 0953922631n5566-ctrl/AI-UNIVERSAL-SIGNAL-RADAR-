# Original AI Branch Audit — 2026-11-06

## Purpose
This is an append-only inspection record for the Original AI recovery and Historical Assistant integration. It supplements existing project documents; it does not replace or authorize deletion of any README, handoff, report, source file, branch, workflow, or historical record.

## Repository and inspected branches
Repository: https://github.com/0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-

- Original AI branch inspected: `feature/original-ai-historical-assistant-main-market`
- Follow-on branch inspected: `main-market`
- Comparison baseline: `backup/main-market-before-original-ai-20261106`
- Recovery/integration branch also present: `integration/original-ai-historical-assistant`

## Branch comparison findings
1. The feature branch compared with the backup was 6 commits ahead and 0 behind at the inspection checkpoint.
2. The `main-market` branch compared with the feature branch was 24 commits ahead and 0 behind at the inspection checkpoint.
3. The feature branch introduced the modular `main-market/original-ai/` tree, including scanner, indicators, strategy router, strategies, engine, tests, and `server-original.js`.
4. The follow-on `main-market` branch added Android/client integration and further runtime changes.

These counts describe the comparison checkpoint on 2026-11-06 and may change as branches receive new commits.

## Source-level findings
The following files were inspected and found identical between the feature branch and `main-market` at the checkpoint:
- `main-market/original-ai/scanner/trend-scanner.js`
- `main-market/original-ai/engine/strategy-router.js`
- `main-market/original-ai/strategies/trend-continuation.js`
- `main-market/original-ai/strategies/sideway.js`

The active `analyze-market.js` and `decision-engine.js` in `main-market` have integration changes for preparation/finalization and Historical Assistant alignment. Their pre-integration counterparts are preserved as:
- `main-market/original-ai/engine/analyze-market-original.js`
- `main-market/original-ai/engine/decision-engine-original.js`

The archived files were found to match the corresponding pre-integration engine files from the feature branch at the checkpoint. The scanner/router/strategy parity findings do not establish predictive accuracy.

## Decision authority and Historical Assistant
- The Original AI Decision Engine is documented and wired as the sole authority for top-level CALL / PUT / STANDBY.
- Historical Analogue runs separately as `ADVISORY_ONLY`; its directional share is not a calibrated win probability or verified win rate.
- Assistant alignment values include `AGREES`, `CONFLICTS`, and `NO_COMPARISON`.
- A source/data-quality gate can force STANDBY when required market data is missing, stale, malformed, or otherwise fails its configured checks.
- Worker/assistant failure is intended not to replace or veto a valid Original AI decision.

## Logic and unresolved items
- The inspected trend scanner uses EMA 9/21/50/200, RSI, MACD histogram, ADX, DI+/DI-, volatility, and support/resistance context, with regimes including REVERSAL, UPTREND, DOWNTREND, SIDEWAY, and UNCLEAR.
- Strategy scoring is rule-based/heuristic. For example, the inspected trend-continuation strategy scores evidence items; this is not evidence of a trained or statistically calibrated AI model.
- The inspected decision engine defines `MIN_SCORE = 60`.
- The archived `server-original.js` contains `THRESHOLD = 64`.
- Runtime reachability and whether both thresholds are active in separate paths were not established in this source comparison. Trace the actual call graph and runtime configuration before changing either value.
- No sufficient Backtest, Out-of-Sample, Forward Test, or physical APK test was completed in this inspection.
- The requested one-candle-on / one-candle-standby rotation rule was not verified as implemented.

## Documentation consistency warning
Existing documentation contains historical descriptions that do not all describe the same current architecture. For example, older handoff/README text describes a Telegram Mini App, while later handoff entries and the current `main-market/README.md` describe a direct Android APK client and state Telegram is no longer used. The handoff itself contains dated historical checkpoints and later superseding corrections.

Do not delete those historical records. Treat them as historical statements with their stated dates. For current behavior, verify the active branch source, workflows, deployment configuration, and live runtime; then append a dated correction/update to the relevant documents. Do not silently rewrite history.

## Exact inspection boundary
Completed:
- Repository metadata and push permissions checked.
- Existing `PROJECT-HANDOFF.md` and branch README files read on the inspected branches.
- Branch comparisons completed.
- Selected Original AI engine/scanner/router/strategy source files compared.

Not completed:
- No runtime call-graph trace.
- No execution/backtest/forward-test.
- No fresh deployment verification in this audit.
- No new APK build or physical-device test.
- No source code, runtime config, branch, or deployment was changed as part of the source inspection itself. This audit-document commit only records findings and process requirements.

## Mandatory append-only audit and documentation policy
For every future inspection, investigation, test, build, deployment, configuration change, or source edit:
1. Record the date/time (timezone), branch, commit SHA, scope, files/endpoints/workflows inspected, tools or commands used, and exact evidence.
2. Separate findings into **verified**, **failed**, **not tested**, and **inconclusive**. Never present an assumption as a verified result.
3. When a document conflicts with source, record the discrepancy and identify which exact source/commit/runtime evidence was used to resolve it. Do not erase the old statement; append a dated correction and mark what it supersedes.
4. Preserve every existing report, handoff, README, changelog, workflow, source file, and branch unless the user explicitly directs a specific deletion.
5. After each material task, append a dated entry to `PROJECT-HANDOFF.md` and add/update the appropriate audit record. Do not replace the whole handoff with a short summary.
6. Before editing an existing document, fetch its latest content and SHA; preserve all existing content and append the new entry. If the file changed concurrently, re-fetch and reconcile before retrying.
7. Record changed file paths, commit SHA/URL, tests and their exact results, deployment status, and any user/device validation still pending.
8. Do not claim success, readiness, accuracy, or completion without corresponding evidence.

## Next task
Continue with a read-only runtime trace of `feature/original-ai-historical-assistant-main-market` versus `main-market`. Identify the actual active entry points and call graph, resolve the 60-versus-64 threshold path, verify the advisory-only boundary, and test the one-candle-on/one-candle-standby rule. Do not delete or overwrite any existing project material.


## 2026-11-06 — Active Original AI core simplified

- Branch changed: `main-market`; repository: `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`.
- Active files changed: `main-market/original-ai/engine/analyze-market.js` and `main-market/original-ai/engine/decision-engine.js`.
- The active analyzer preserves the adapter exports required by `main-market/src/analyzer.js`, but calls the Original Decision Engine without injecting Historical Analogue into its decision context.
- The active decision engine restores the original standalone implementation and retains `MIN_SCORE=60`, volatility blocking, and support/resistance checks.
- Historical Analogue remains advisory metadata only; it cannot affect the top-level decision.
- Backup snapshots `analyze-market-original.js` and `decision-engine-original.js` remain untouched. No unrelated engine, strategy, data source, APK, server, or branch was deleted.
- VERIFIED: source-level interface compatibility by inspection of the active `src/analyzer.js` import/call sites and new CommonJS exports.
- NOT TESTED: automated tests/CI, Render deployment, live API behavior, APK build, and physical-device validation.


### Verification follow-up — 2026-11-06

- Initial adapter commits caused Main Market Checks runs #231 and #232 to fail one existing analyzer assertion: top-level `assistantAlignment` was missing. All other 31/32 tests passed in the first run.
- Fixed compatibility by exposing assistant alignment/direction as output diagnostics only; no assistant values are passed into the Original Decision Engine.
- Main Market Checks run #233 (`42164410306`) completed **success** on commit `3a05d984500cbbf3a1ba3022ff06653a9db69d01`.
- Render deployment, live Twelve Data stream, APK build/install, and physical-device behavior remain **NOT TESTED** in this audit follow-up.
