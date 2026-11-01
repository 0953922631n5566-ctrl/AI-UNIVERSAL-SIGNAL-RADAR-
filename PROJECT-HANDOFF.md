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


### CI build follow-up — 2026-11-01

- Workflow file: `.github/workflows/android-apk.yml`.
- Initial CI attempt `41306165458` failed because `android-actions/setup-android@v3` attempted to install the retired SDK package `tools`.
- Second attempt `41306238949` failed during SDK install; workflow was changed to locate `sdkmanager` directly under the runner's Android SDK.
- Third attempt `41306290711` passed checkout, JDK 17, Gradle setup, and Android SDK platform installation. At the latest check, Gradle `:app:assembleDebug` was still running; no artifact or SHA-256 was available yet.
- Latest workflow source commit: `5d49dfd490392550d3bd930cbf9194d890b35267`.
- Status distinction: CI pipeline implemented; Android build not yet confirmed; no APK artifact yet; no device test; no signal validation.


### Build failure diagnosis and fix — 2026-11-01

- Inspected failed workflow run `41306290711` job logs.
- Root cause: Kotlin compile error in `MainActivity.kt`: unresolved `androidx.activity.ComponentActivity`; Android app module did not declare the AndroidX Activity dependency. This caused cascading unresolved Activity members.
- Fixed by changing `MainActivity` to extend platform `android.app.Activity` and removing the unresolved AndroidX import. This avoids introducing an unnecessary dependency for the current simple Activity UI.
- Fix commit: `c300b2b396dacbd1805272972f29789442d92adb`.
- New automatic build run: `41306686510`; latest check showed it in progress. APK/artifact/checksum remain unconfirmed until this run completes.
- No device test or signal validation has been performed.


### Xiaomi 11T crash after screen-capture consent — investigation and patch (2026-11-01)

- User reported the installed debug APK closes immediately after approving Android screen capture on Xiaomi 11T / Android 14.
- Reviewed current MainActivity.kt and CaptureService.kt. The failure boundary is the transition from the consent result into the MediaProjection foreground service. No device logcat/stack trace has been supplied, so the exact runtime exception is not yet confirmed.
- Patched CaptureService.kt to call the API 29+ three-argument startForeground(..., FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) explicitly; retain the two-argument call on older Android versions.
- Added guarded startup/error handling, explicit null/size checks, bounded cleanup, and in-app error status broadcast. This should prevent common service-start exceptions from silently terminating the process and expose the actual exception message on the app screen.
- Patched MainActivity.kt to manage START/STOP enabled state, catch consent/service launch exceptions, and receive READY/FAILED/STOPPED status updates. Removed the no-op view lookup.
- Commits: MainActivity 5ab90715a213ffde30a4d249833d39a1c55b77c1; CaptureService and current branch HEAD b26c73001bd9964b6fdc900160d399b819baa2bb.
- Source verification: latest main contains both the receiver/status changes and explicit MediaProjection foreground service type.
- NOT YET VERIFIED: Android CI rebuild after this patch, installation, or successful capture on Xiaomi 11T. The previous APK must not be reused as a fix.
- Next: inspect the new GitHub Actions run; resolve any compile failure; distribute a new APK only after the CI artifact is present. Ask for the exact on-screen error or Android bug report only if the patched build still closes.
- Capture-to-backend upload and real vision analysis remain unimplemented; this patch only addresses startup robustness and diagnosis. Manual trading only; no automatic broker orders.


### Crash-fix APK CI result — 2026-11-01

- Follow-up CI run `41307402212` on commit `b26c73001bd9964b6fdc900160d399b819baa2bb` completed successfully. All steps passed: Gradle build, APK existence verification, SHA-256 generation, and artifact upload.
- An earlier run `41307398431` failed because it started from the intermediate MainActivity-only commit before the matching CaptureService constants landed. The subsequent run on the complete branch head passed; no source rollback was needed.
- Artifact ID: `13083772367`; name `ai-universal-signal-radar-debug-apk`; GitHub artifact ZIP digest `ca66bd2d10d5028d842463253b47b7b91d0ed4163fa26af64ee0a6ce5f2e9d93`; expires 2026-11-15.
- Downloaded and inspected the ZIP. It contains `app-debug.apk` (822,161 bytes) and `SHA256SUMS.txt`. APK SHA-256 verified locally: `c5a2a9a04bdff133097bc6ad5a664eb93b2d652cd32fcb859031534ba2acaeac`.
- The APK is built and artifact-verified, but it has NOT been installed or tested on the user's Xiaomi 11T. The explicit foreground-service type patch is intended to address the Android 14 startup path; the exact original crash cause remains unconfirmed without a device stack trace.
- Next validation: install this new crash-fix APK (not the prior build), approve screen capture, verify the UI reports capture started and STOP ends it. If it still fails, collect the exact error shown in the app; then request Android bug report/logcat if needed.
- No backend upload, vision analysis, or CALL/PUT signal generation is included in this build. Backend remains STANDBY-only; manual trading only.


### GitHub repository resolution corrected — 2026-11-01

- The previously used repository name `0953922631n5566-ctrl/my-ai-signal-bot` returns “Could not resolve to a Repository” and is not present in the linked account's accessible repository list.
- Enumerated repositories for owner `0953922631n5566-ctrl`; the active project repository is confirmed as `0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-`.
- Confirmed via GitHub connector: repository ID `1441692362`, public, default branch `main`, permissions include `admin: true` and `push: true`.
- Successfully fetched repository metadata and root contents, including this `PROJECT-HANDOFF.md`, `README.md`, `android/`, `backend/`, and `.github/`. GitHub connector access is now verified against the correct repository; no additional reconnect or installation step is currently required.
- No application source code or APK was changed during this access investigation. Existing crash-fix APK status and SHA-256 above remain unchanged.
- Use `AI-UNIVERSAL-SIGNAL-RADAR-` as the canonical repository in future work; do not use the obsolete `my-ai-signal-bot` path unless independently rediscovered.
