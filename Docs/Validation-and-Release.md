# Validation and release gates

## Evidence recorded for the current foundation

The previous setup run passed type checking, three shared-input/movement/preset regression tests, client/server production builds, and a four-SDK-client join/replication/movement smoke test. The dependency audit was clear after the scoped build-tool override. These results cover the foundation. Browser rendering, transient reconnection, real-device latency and load capacity still require direct validation.

## Phase 1 four-player browser playtest

The project owner reported the four-player browser playtest complete on 2026-11-12.

Run the [LAN setup](Development-Guide.md) with diagnostics enabled. Use four browser clients across physical devices and record the commit, browsers, devices, and observed RTT.

1. Join from all four clients. Confirm everyone sees four distinct avatars and that each player can move and jump.
2. Click the arena to lock the mouse, turn the camera, and verify movement follows the view. Press Escape and confirm the hint updates and keyboard movement remains available.
3. Hold a movement key and switch tabs or windows. From a second client, verify the first avatar stops and stays still until fresh input.
4. Reload one tab and briefly interrupt another client's connection. Verify each recovers its original avatar and that neither replays movement from before the interruption.
5. Disconnect for more than 30 seconds. Verify the avatar disappears and the old seat cannot be recovered. Use Leave playground on a connected client and confirm its avatar disappears immediately.
6. Repeat the join and leave cycle. Record failures and attach the observed results before marking Phase 1 complete.

## Phase 2 network measurements

Recorded on 2026-11-11 with `npm run lagtest` (about 10 seconds of scripted walking with diagonals and hops per profile, one mover and one watcher, local relay). Stalls hold a chunk and everything behind it for 250 ms, modeling a TCP retransmit. Corrections count acknowledgements where the predicted position moved by more than 0.001 units. "Watcher frozen" counts 60 Hz frames where the smoothed remote avatar did not move while the mover was walking.

| Profile | Input-to-ack | Corrections | Worst correction | Watcher frozen | Raw updates frozen |
|---|---:|---:|---:|---:|---:|
| 40 ms ±5, no stalls | 108 ms | 0 of 218 | 0.000 | 4 of 580 | 389 of 580 |
| 100 ms ±20, 1% stalls | 191 ms | 3 of 192 | 0.200 | 62 of 580 | 411 of 580 |
| 180 ms ±40, 2% stalls | 357 ms | 6 of 168 | 0.400 | 86 of 580 | 420 of 580 |
| 180 ms ±40, no stalls | 276 ms | 2 of 217 | 0.165 | 4 of 580 | 389 of 580 |

Prediction settled exactly on the server state in every profile. Jitter up to ±40 ms is absorbed by the 100 ms interpolation buffer; stalls longer than the buffer cause the remaining freezes, and an uplink stall also makes the mover stand still on the server and then catch up. Input-to-ack includes the server input queue and the wait for the next 20 Hz patch, so it exceeds the relay round trip. These are synthetic measurements on one machine; physical-device and real-network validation is still required.

After adding collision, jump buffering, coyote time and dives (the scripted mover now also dives and bumps into arena boxes), corrections first rose: 7 of 201 (worst 0.720) at 100 ms and 17 of 185 (worst 1.501) at 180 ms with stalls, because the server stepped stalled players with an empty input, which kept dives flying and jump timers counting that the client never predicted. With the server waiting for late inputs (two runs with a consecutive eight-tick limit), corrections fell to 2 and 0 at 100 ms and 2 and 3 at 180 ms with stalls (worst 1.129), and to 0 without stalls. That limit let a client hover by trickling single inputs with pauses just under it (still airborne 3 s after a jump), so waiting is now rationed by a refilling allowance. With the allowance:

| Profile | Corrections | Worst correction | Watcher frozen |
|---|---:|---:|---:|
| 40 ms ±5, no stalls | 0 of 220 | 0.000 | 4 of 580 |
| 100 ms ±20, 1% stalls | 1 of 190 | 0.200 | 69 of 580 |
| 180 ms ±40, 2% stalls | 2 of 175 | 5.770 | 92 of 580 |
| 180 ms ±40, no stalls | 0 of 218 | 0.000 | 0 of 580 |

The 5.770 correction at 180 ms was a single outlier, most likely a fall off an edge that happened on one side only after a long stall; three further 180 ms runs measured 5, 3 and 6 corrections with a worst of 0.375. Remaining corrections come from stalls that outlast the allowance. With dive moved to a double tap of jump, a further run measured 0, 0, 3 (worst 0.291) and 0 corrections across the four profiles. The local smoke run measures 0 corrections, and the smoke test checks that a trickling client lands.

With the ferry, pusher and checkpoints (inputs stamped with world ticks), the lag test also runs the course with a fresh player at each profile:

| Profile | Wander corrections | Course corrections | Course worst | Course completed |
|---|---:|---:|---:|---|
| 40 ms ±5, no stalls | 0 of 220 | 0 of 425 | 0.000 | all but the pusher hit (bot shoved behind the pusher; fixed in the bot) |
| 100 ms ±20, 1% stalls | 1 of 184 | 6 of 237 | 0.207 | all |
| 180 ms ±40, 2% stalls | 5 of 177 | 0 of 222 | 0.000 | all |
| 180 ms ±40, no stalls | 0 of 216 | 0 of 263 | 0.000 | all |

After the bot fix, four 40 ms course runs completed every part with 0 corrections and exact final states, and the local smoke course measured 0 of 341. Prediction settled exactly in every run.

After switching the player collider to a capsule, the full lag test completed all four course events and settled exactly on the server state in every profile. Course corrections were 0 of 287 at 40 ms, 2 of 246 at 100 ms (largest 0.200 units), 3 of 232 at 180 ms with stalls (largest 0.400 units), and 0 of 265 at 180 ms without stalls.

Correction counts reported before this measurement (local smoke and browser checks during the Phase 2 feel work) were not measured: the SDK records correction sizes only when `warnOnDivergence` is set. With it enabled the local smoke run measures 0 of 90.

## Short Party browser acceptance

Use the LAN setup and at least four browser clients on separate devices. Record the commit, device/browser combinations and elapsed match time.

1. Create a private room, share the code, join as guests, and ready up. Confirm a guest cannot start and a host cannot start before four guests are ready.
2. Start with four ready guests and, if available, a fifth unready guest. Verify countdown and admission lock. The fifth guest stays in the room and waits for the next race.
3. Have some Dash racers finish and others time out. Verify gates count in order, every browser receives the same Dash standings, and the party enters Dodge at the scheduled transition.
4. In Dodge, confirm both hazard families show their warnings before impact and produce the same server result for all clients. Record the match seed so a repeated seed can reproduce the pattern.
5. Repeat with a slow-loading browser, a reload during either arena, and the host leaving. Verify reconnect restores the current arena, phase, remaining time, seed, and current standings without shifting the 315-second deadline.
6. Verify final standings combine both rounds, tied placements share points, the room returns to the plaza at 315 seconds, and the same group can rematch. Confirm an interrupted match is labeled clearly.

### Dash lifecycle baseline

The pre-Phase 4 Quick Dash lifecycle remains the implementation baseline for the first Short Party round:

1. In the lobby, the first guest is host. The host can lock a roster of at least four connected, ready guests. The roster is fixed for the match; other guests wait for the next race and new admission is closed.
2. The server resets the roster and starts a 5-second countdown. The shared movement simulation runs with Dash course collision during the round.
3. The server accepts checkpoint and finish scoring only in order and only from the locked roster. The race allows 105 seconds of scoring. An early all-finish or interruption locks standings; otherwise standings are finalized at the scoring cutoff.
4. The match has a fixed 120-second deadline from start. It shows the results phase for the final 10 seconds, then discards active race state, resets avatars and readiness, reopens the lobby, and unlocks admission. The standings remain visible in the lobby until the next race starts.
5. A reconnecting seat retains its identity. Host ownership updates when the host leaves. A rematch uses the same room; if fewer than two roster seats remain before standings lock, results are marked interrupted.

**Historical automated baseline evidence (2026-11-12):** Before the Short Party changes, on branch `codex/phase-4-baseline` based on `main` at `b76436a`, `npm run check` passed with Node 24.22.2: type checking, all 34 unit tests, and production client/server builds. The then-current `scripts/private-smoke.mjs` passed against a local server and verified invite validation/expiry, host-only start, a waiting unready guest, roster and admission lock, token reconnect, ordered Dash finishes, shared standings, host transfer, the 120-second deadline, rematch, and interrupted results. These results do not validate the new Short Party code. The client build reported a 2.4 MB minified JavaScript chunk, above Vite's 500 kB advisory threshold.

**Short Party automated evidence (2026-11-12):** On `main` after merging `codex/phase-4-baseline` with the Phase 2 controller fixes, `npm run check` passed with Node 24.22.2 (type checking, 35 unit tests, production builds). `npm run smoke` passed, and `npm run smoke:private` at 10% clock speed verified invite expiry, readiness, roster lock, token reconnect, Dash then Dodge, combined standings, host transfer, the fixed Short deadline, rematch, and interrupted results.

**Phase 4 lifecycle evidence (2026-11-12, branch `phase-4-lifecycle`):** `npm run check` passed (46 unit tests, including manifest and rule build-id coverage, arena-run disposal, per-room run counts, a 2,000-cycle arena soak, a heap-growth check that `npm test` runs under `--expose-gc`, and the client arena stage). `npm run smoke`, `npm run lagtest` and `npm run smoke:private` passed. The private smoke also verified stale and missing build rejection, at most one live server arena run in the room during a match, zero after a completed or interrupted match, and the announced next arenas. In one desktop browser tab with three SDK bots on a 10%-speed server, `oopsArena.stats()` read 36 entities and 14 materials in the lobby before and after each of two full matches. A reload during Dodge rejoined Dodge with Plaza prefetched while the round continued. There were no console errors.

This is SDK-level historical evidence, not browser acceptance. The Short Party browser scenarios above remain open, especially seeded hazard agreement, mixed Dash finish/DNF, slow loading, reconnect during Dodge, and visual agreement across clients. Do not mark Phase 4 complete until those results are recorded.

## Phase 5 private party browser playtest

1. Create a party with room for five and invite four friends by code.
2. Ready four members and verify the host cannot start until the fifth is ready. Drop and reconnect that member before kickoff and verify they keep their seat and must ready up again.
3. Start Dash and confirm all five enter countdown together. Try the invite code from a separate browser and verify it cannot join during the race.
4. Finish the race and confirm the same party returns to its lobby. Have the host leave, verify leadership transfers, and start another race once everyone is ready.
5. Let an invite expire in the lobby. Verify the host can renew it and a new member can use it when there is a free seat.

## Functional matrix

| Area | Required scenarios | Acceptance |
|---|---|---|
| Seats | 1/2/4/12 joins, 13th join, concurrent reservation, repeated leave/rejoin | No overflow or duplicate identity; production start requires 4 ready players |
| Input | Nonfinite values, malformed messages, excess rate, stale command, lost focus | Rejected or bounded input; no additional simulation time |
| Movement | Floor, wall, corner, jump, platform, hazard, checkpoint, respawn | Authoritative outcomes agree and corrections remain playable |
| Reconnect | Short outage, reload, grace expiry, intentional leave, process crash | Correct seat recovery or clear interruption; stale input cleared |
| Match clock | All presets, early finish, DNF, slow load, disconnect, delayed callback | Preset cutoff authoritative; no scored action after cutoff; one finalization |
| Private parties | Concurrent joins, ready checks, reconnect, host transfer, invite renewal, rematch | Capacity holds and the whole ready party starts together |
| Teams | Every roster size 4–12 and teammate loss | Bounded imbalance, useful participation and recoverable cargo |
| Cleanup | Repeated rounds/rematches, empty rooms, stale codes | No orphan timers/seats and memory stabilizes |

## Browser, performance and network tests

Test current desktop Chrome, Edge, Firefox and macOS Safari on recorded device/OS combinations. Include an integrated-GPU device and a discrete-GPU reference. Exercise pointer lock and Escape, audio activation, background/resume, resize, high DPI, WebGL context loss and failed asset loads.

Target 60 FPS with representative 12-player art, hazards and HUD. Start with 1080p on the reference desktop and 720p Low on the integrated GPU. Record median, p95 and p99 frame intervals. An initial tuning threshold is p95 near 20 ms with investigation of recurring stalls over 50 ms. Calibrate against playability and hardware evidence before treating it as a release promise.

Test roughly 40/100/180 ms RTT with jitter and packet loss. Record local correction magnitude/frequency, interpolation stalls, lost actions, reconnect time and final-result agreement. Validate on separate physical devices. SDK load clients provide capacity evidence but do not measure GPU rendering or human movement feel.

Measure first interactive load, arena download/decode, main-thread stalls and repeated-transition memory. The current engine bundle triggers a size warning. Profile and split loading by actual cost.

## Server capacity and operations

Increase simultaneous full rooms on the target host while measuring tick CPU, patch encoding, event-loop delay, memory, socket backlog and egress. Starting targets include p95 room simulation plus patch work under 10 ms and no sustained event-loop delay over the 33.3 ms tick window. Set the production room cap with measured headroom.

Run a multi-room soak and a reconnect burst. Rehearse admission draining, shutdown, deployment, rollback, restart and clear handling of interrupted matches. Validate proxy WebSocket behavior, origin policy, credential redaction and health/readiness checks. Redis or more processes require measured capacity or regional demand.

## Release record

For each candidate record build ID, lockfile, host configuration, tested devices, scenarios, latency profiles, observed timings, failures and remaining limitations. Release only after must-have scope and critical lifecycle behavior have evidence. Repeat checks affected by a change. Keep historical results separate from current implementation status.
