# AI UNIVERSAL SIGNAL RADAR — Project Handoff

**Architecture baseline:** 2026-11-01  
**Implementation status:** Initial source scaffold committed. Not yet built, deployed, or device-tested.

## Product requirements
Standalone Android APK; no Telegram Mini App. One START/STOP workflow. Broker-agnostic and market-agnostic by design; no routine broker, market, asset or pair selection. User opens a chart, taps START, approves Android screen capture, and the app captures during that authorized session. STOP ends capture. Manual trading advice only; never place broker orders.

## Architecture
- Android APK: MediaProjection foreground service, consent prompt, frame metadata, authenticated HTTPS upload, result display, retry/dedup/stale-response protection.
- Backend: authenticated image ingestion, image quality/freshness/order checks, temporal frame context, chart perception/OCR, regime classification, adaptive analysis, risk/decision engine and signal invalidation.
- Secrets remain server-side. Never commit secrets or embed a private token in a public APK.
- Screenshot sampling is not a tick feed. Do not claim tick-level real-time.

## Intelligence policy
Situation-aware and event-driven, not a rigid timer-driven single-formula scanner. Compare sequential frames; identify trend/range/breakout/high volatility/weakening/reversal/unknown; adapt evidence; suppress decisions when image/data is ambiguous, stale, conflicting or risky. CALL/PUT require explicit testable and validated conditions. Otherwise STANDBY. Do not fabricate prices, candles, indicators or confidence. Use temporal confirmation/hysteresis to avoid noisy direction flips. Include rationale and invalidation conditions.

EMA/RSI/MACD, candle structure, support/resistance, momentum and volatility may be evidence tools; none is a universal fixed formula.

## Current code
- `backend/app.py`: health, session start/stop, bounded frame metadata/hash tracking, auth, JPEG/PNG and timestamp/sequence validation. Returns STANDBY because no vision model is configured.
- `android/`: initial Android 14 MediaProjection consent and foreground capture scaffold.
- The Android capture scaffold does not yet encode/upload frames or render backend decisions. Backend URL is a placeholder. No APK has been built.
- Android source needs compilation and lifecycle review before release.

## Next work
1. Complete Android frame encoding, upload, response parsing, retry/backoff and STOP/result UI.
2. Securely provision backend authentication and deploy backend over HTTPS.
3. Add a real vision adapter with structured perception outputs; keep STANDBY until validated.
4. Build test harness with labeled multi-broker image sequences and chronological/out-of-sample evaluation.
5. Build APK and test on Xiaomi 11T / Android 14, record exact artifact SHA-256 and test evidence.
6. Update this handoff after each meaningful change.

## Safety and release gates
No automatic trading. No fabricated signal/confidence. Do not release as production-ready before security, build, device, latency, image-perception, false-positive and out-of-sample tests. No paid resources without explicit cost approval. Legacy OCR and Telegram projects remain out of scope.


---

## 2026-11-01 — Project manager operating commitment (user-requested)

The user explicitly requested that this operating agreement be saved in the repository so future ChatGPT conversations can understand it immediately:

> ต่อไปเมื่อคุณสั่งงาน ผมจะทำแบบ ผู้จัดการโปรเจกต์ที่รับผิดชอบงานจนจบ ไม่ใช่แค่บอกวิธีทำให้คุณไปทำเอง  
> รับโจทย์แล้วลงมือทำจริง ให้มากที่สุดเท่าที่เครื่องมือจะทำได้  
> ถ้าทำแล้วไม่ตรงเป้าหมาย ผมจะแก้ไขและปรับวิธีเอง ไม่ยึดติดกับวิธีเดิม  
> ถ้าติดปัญหา ผมจะหาทางแก้หรือทางเลือกอื่น ไม่ปล่อยงานค้างโดยไม่จำเป็น  
> ตรวจสอบก่อนส่งมอบ ทั้งโค้ด การ Build การ Deploy และผลการทำงานตามที่ตรวจสอบได้  
> รักษาสิ่งที่ทำงานได้อยู่แล้ว ไม่แก้จนระบบเดิมเสีย  
> บันทึกเอกสารส่งต่องานทุกครั้ง เพื่อให้ห้องสนทนาถัดไปทำต่อได้ทันที  
> รายงานตามความจริง อะไรสำเร็จแล้ว อะไรยังต้องตรวจสอบ จะแยกให้ชัดเจน  
> จะไม่ให้ผู้ใช้เสียเวลาทำซ้ำในสิ่งที่ผู้ช่วยสามารถจัดการให้ได้ เป้าหมายคือรับงานแล้วพยายามส่งมอบเป็นผลงานที่พร้อมใช้งานจริงให้ได้มากที่สุด

### Verified repository and implementation state at this checkpoint

- Active repository: `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`
- Default branch: `main`; repository visibility: public; connected GitHub permissions observed: admin/push.
- Existing scaffold commit observed: `bceb9e63b977195798697a2b14a8ceac635402df`.
- Existing files include `README.md`, this handoff, Android Kotlin scaffold and `backend/app.py`.
- Backend currently validates auth, image type/size, timestamp and sequence, records frame hashes, and deliberately returns STANDBY. There is no vision model adapter, no actual chart perception, no signal decision model and no deployment configuration confirmed.
- Android currently requests MediaProjection permission and creates a foreground capture session, but its CaptureService explicitly has no frame encoding/upload loop and no backend response rendering. The backend URL is still a placeholder. MainActivity's START/STOP UI is incomplete: STOP is initially disabled but no state update enables it after capture begins; START is not disabled; there is no robust service-state/result binding.
- No APK build, installation, Xiaomi 11T device test, backend deployment, HTTPS endpoint test, authenticated end-to-end frame upload, or signal validation has been verified. Do not describe this scaffold as ready to install or trade.
- Android 14 MediaProjection consent and foreground-service lifecycle must be tested on the target Xiaomi 11T. Capture must remain user-consented and user-stoppable.
- Legacy Telegram Mini App / 8xTrade OCR project remains out of scope unless the user explicitly reopens it.

### Required execution and reporting discipline

For every meaningful project change:
1. Inspect current repository state before editing; preserve working code and avoid destructive changes.
2. Implement the most useful safe next step directly when tools permit.
3. Run available automated checks/builds; report exact commands and outcomes. If the environment lacks Android SDK/Gradle, state that build could not be run rather than claiming success.
4. Deploy only after the user has authorized the target and any costs; never incur paid resources without explicit cost approval.
5. Verify deployment health and end-to-end behavior where access permits.
6. Record commit SHA, changed files, tests/build/deploy outcomes, blockers and next actions in this handoff after each meaningful change.
7. Clearly distinguish **implemented**, **built**, **deployed**, **device-tested**, and **validated**. Never infer one from another.
8. Do not produce CALL/PUT until real visual perception and decision logic are validated; default to STANDBY when evidence is insufficient. Manual trading only.

### Immediate next milestones

1. Complete Android capture pipeline: safe frame acquisition, JPEG conversion, authenticated HTTPS upload, sequence/timestamp handling, bounded retries/backoff, response parsing, visible decision/reason, reliable START/STOP lifecycle.
2. Add backend session expiry/resource bounds, robust session/frame state, structured perception adapter interface and test fixtures. Keep directional decisions disabled until a real model and evaluation data exist.
3. Provision a secure server-side secret and deploy an HTTPS backend only after cost/target authorization; never embed a private token in this public repository or APK.
4. Establish reproducible Android build environment/CI, build debug APK, record SHA-256, then test on Xiaomi 11T Android 14.
5. Create multi-broker labeled screenshot sequences and chronological/out-of-sample evaluation before enabling directional signals.


---

## 2026-11-01 — Android APK CI build pipeline added

- Added `.github/workflows/android-apk.yml` in commit `1a41060b788eb3994591ebfe372f3d3d08fcb22a`.
- Workflow supports manual dispatch and pushes affecting Android source/workflow.
- Uses Ubuntu, Temurin JDK 17, Gradle 8.9, Android SDK platform/build-tools 35, and runs `:app:assembleDebug`.
- On successful build it verifies the APK exists, writes SHA-256, and uploads the debug APK plus checksum as a 14-day GitHub Actions artifact.
- First run ID: `41306165458`; observed status at handoff update: queued/in progress. Build result and artifact are not yet confirmed.
- This pipeline only builds the existing scaffold. It does not complete the capture-to-backend upload pipeline or enable real chart analysis. The current app still has a placeholder backend URL and no upload loop; backend returns STANDBY.
- No secrets are added to the public repository or APK. No paid resources created.
- Next: inspect run jobs/logs; fix build failures if any; confirm artifact and checksum; then continue Android lifecycle/capture implementation and target-device testing.
