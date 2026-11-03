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
- REST supplies completed candle history and freshness only. The single NEXT M1 forecast is the only directional decision source; never add a second competing REST direction or a second forecast horizon.
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
- CALL/PUT is allowed only when the single NEXT M1 forecast passes its configured rules and both the REST history and WebSocket quote are fresh. REST must not produce a competing direction or act as a second directional vote.
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


## Single-horizon update — 2026-11-03
- User authorized removing the second forecast horizon and the legacy REST directional engine.
- The only forecast horizon is NEXT M1 (the immediately upcoming 1-minute candle).
- REST is history/freshness input only; it no longer calculates a competing CALL/PUT direction.
- The NEXT M1 forecast alone supplies the final directional decision when the data-health guards pass.
- Keep all existing alert timing and 35-second hold requirements unchanged.


## Candle-close-only signal timing correction — 2026-11-03

The strategy now calculates from the latest fully closed candle and applies the result to the immediately following M1 candle. To keep that candle alignment correct:
- Preparation alert remains 10 seconds before the minute boundary.
- The final CALL/PUT/STANDBY result is published 5 seconds after the new minute begins, using the just-closed candle's decision for the candle now underway.
- The final result is held for 35 seconds from the notification timestamp.
- One final alert per minute; STANDBY still sounds/vibrates.


## Candle-aligned early alert and trend guard — 2026-11-03

- Keep the 10-second preparation reminder and 35-second result hold.
- The final result is no longer tied to a fixed +5-second window. It is emitted as soon as a fresh forecast arrives whose `nextCandleAt` exactly matches the currently opening M1 minute.
- The browser checks the local cached live endpoint every 500 ms. The Twelve Data REST history refresh remains one request after each minute boundary; actual notification latency therefore still depends on provider response/network time and is not guaranteed to be zero.
- If no matching, fresh, aligned result arrives within 12 seconds of the boundary, emit STANDBY once for that minute. Do not publish a late CALL/PUT for an already-missed entry window.
- Starting the Mini App mid-minute does not generate a fake result for a candle already in progress; it waits for the next M1 boundary.
- The forecast still uses EMA5/EMA20, RSI14, MACD12/26/9, and the latest fully closed candle. A CALL requires UPTREND plus a bullish latest closed candle; a PUT requires DOWNTREND plus a bearish latest closed candle. If the candle body opposes the EMA trend, force STANDBY even if the 5/6 vote threshold is otherwise met.
- The UI displays the EMA trend and latest completed candle direction separately. The forming candle is not treated as confirmed before it closes.
- CALL/PUT/STANDBY sound, vibration, 35-second hold, one-alert-per-minute, and manual-only behavior remain in force.


## User-authorized formula replacement — 2026-11-03

The user explicitly replaced the prior signal formula and changed the final timing/hold. This section supersedes the earlier 5-second final alert and 35-second hold settings above.

- Preparation reminder remains **10 seconds before M1 rollover**.
- Formula evaluation is continuous from real market data, but CALL/PUT can be created only when **0.0–3.0 seconds remain** in the current M1 candle.
- Final CALL/PUT/STANDBY is notified in that last-three-second window; if no valid directional signal is available at the minute edge, notify STANDBY.
- Hold every final result for **30 seconds** from notification, then reset the lamp to STANDBY.
- Strategy: EMA5/EMA20 trend following; CALL only if EMA5 > EMA20 and live price >= EMA5; PUT only if EMA5 < EMA20 and live price <= EMA5.
- Bollinger Bands(20, 2): bandwidth <0.04% is SIDEWAY/DANGER and blocks directional signals.
- RSI(14) is calculated and displayed as a supporting indicator; it does not override the supplied trend rule.
- Confidence begins at 65, adds 20 when trend alignment exists, adds 10 when the live price differs from the previous tick, and is capped at 96.
- No MACD, six-vote scoring, old closed-candle candle-body guard, or synthetic random prices are used.
- Input data is real Twelve Data EUR/USD closed M1 history plus the current live WebSocket quote. If live data is stale or fewer than 20 closed candles exist, remain STANDBY.
- Manual entry only; no broker orders.

