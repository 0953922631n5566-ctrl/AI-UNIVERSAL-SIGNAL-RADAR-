# ALERT CONFIGURATION — MUST PRESERVE

Project: AI Universal Signal Radar — MAIN MARKET / NON-OTC
Repository: 0953922631n5566-ctrl/AI-UNIVERSAL-SIGNAL-RADAR-
Branch: main
Production service: https://ai-universal-signal-radar-main.onrender.com
Last verified deployment for this alert behavior: commit 2d55d6ec78f33bb04b69c669328d95f539470d70
Commit message: Hold every final alert for 35 seconds then reset

## This is a fixed user requirement
Any new ChatGPT room or developer continuing this project MUST read and preserve this alert configuration. Do not silently remove, weaken, replace, or change its timing or behavior without the user's explicit approval.

## Exact required alert cycle (M1 / 1-minute candles)
Repeat the following cycle every minute while the Mini App is open and scanning is enabled:

1. **10 seconds before the candle changes:** issue the preparation/warning alert. This reminder is independent of whether CALL or PUT has been confirmed. Do not suppress it just because the current decision is STANDBY.
2. **5 seconds before the candle changes:** issue the final decision alert. It MUST always announce exactly one of:
   - CALL
   - PUT
   - STANDBY
3. **STANDBY is a required notification result, not silence.** If data is stale, live confirmation is unavailable, the two analysis engines disagree, or no valid CALL/PUT exists, explicitly notify STANDBY. Never leave the user with no final result.
4. **Every final result (CALL, PUT, and STANDBY) remains visibly displayed for 35 seconds** from the final decision notification.
5. After those 35 seconds, clear the held result and return the display to **STANDBY**, then wait for the next scheduled cycle.
6. Repeat every M1 cycle. Prevent duplicate alerts within the same minute, but do not let duplicate-prevention logic suppress the next minute's alerts.

## Single unified signal display
- The Mini App must show exactly one visible signal lamp: CALL, PUT, or STANDBY.
- REST closed-candle analysis and live WebSocket analysis are internal confirmation inputs only; never display a second live prediction panel or a second competing signal.
- Before the final notification, keep the sole lamp at STANDBY. The final notification is the single point that publishes the directional result.
- Start the 35-second hold at the exact final notification timestamp. Candle rollover must not clear the signal text, lamp illumination, or hold countdown.
- Only when 35 seconds have elapsed from that notification may the sole lamp return to gray STANDBY.

## Sound, vibration, and display
- The 10-second preparation alert must be perceptible.
- The final 5-second CALL/PUT/STANDBY result must trigger the configured sound and vibration, including when the result is STANDBY.
- Show the result and hold countdown on the Mini App while the 35-second hold is active.
- STANDBY must never be treated as a reason to mute or skip the final notification.
- Browser/Android sound and vibration permissions and user-device behavior must be tested on the actual Xiaomi 11T. A successful server deployment alone does not prove that physical sound/vibration works.

## Signal integrity and safety
- CALL/PUT is allowed only when the project's required confirmation logic validates it.
- If confirmation is missing or data is not fresh, announce STANDBY instead of inventing a direction.
- This is a manual signal/decision aid only. Never place broker orders automatically.
- Do not promise guaranteed predictions or profits.

## Verification status / implementation reference
- Commit `6f7bcbbdb8c7d7f5f9ceb9d57a2a29aa35549de3`: reliable 10-second preparation and final 5-second decision alerts; final result includes STANDBY when no dual confirmation exists.
- Commit `45bed5058cfb382cfcdf8a90a9b10eb9266a4409`: keep the 10-second and 5-second alert phases visible.
- Commit `2d55d6ec78f33bb04b69c669328d95f539470d70`: hold every final alert result for 35 seconds, then reset to STANDBY.
- Render deployment `dep-dbko3qrbc2fs7383jv9g` was checked and returned status `live`.
- Sound/vibration on the physical phone remains a required device-side test; do not report it as verified until tested.

## Non-negotiable acceptance checklist for future changes
- [ ] 10-second preparation alert occurs every M1 cycle while scanning.
- [ ] Final 5-second alert occurs every M1 cycle.
- [ ] Final alert always announces CALL, PUT, or STANDBY; no silent final cycle.
- [ ] STANDBY also triggers configured sound and vibration.
- [ ] CALL, PUT, and STANDBY final results all remain visible for 35 seconds.
- [ ] After 35 seconds, display resets to STANDBY.
- [ ] Next cycle proceeds normally with no duplicate alert within a single minute.
- [ ] No automatic broker order execution is introduced.

**Instruction to the next room:** Treat this file as the source of truth for alert behavior. Read it before editing alert code. Preserve every item exactly unless the user explicitly requests a change.
