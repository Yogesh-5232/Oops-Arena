# Phase-wise implementation plan

## Delivery principles

Complete one testable increment before expanding content. Preserve 4–12-player matches, desktop browsers, private and public multiplayer, and the 120–900-second active-match window. Include countdown, gameplay, transitions and final results in that window. Use the server as the authority for outcomes and phase changes.

The phase order follows technical dependencies. Visual polish can progress within a phase once its gameplay contract is stable. Estimate later phases using actual iteration time from the first complete race, with explicit allowance for art, playtests and browser fixes.

| Phase | Outcome | Dependency | Current status |
|---|---|---|---|
| 0 | Reproducible foundation | Existing workspace | Complete. Clean install, checks, builds and smoke test passed on GitHub Actions |
| 1 | Reliable four-player greybox | Phase 0 | Complete. Four-player browser playtest reported complete |
| 2 | Responsive networked controller | Phase 1 | Complete. Lag measurements recorded; physical-device playtest reported complete |
| 3 | Complete private Dash match | Phase 2 | Complete. Physical browser acceptance reported complete |
| 4 | Arena lifecycle and Dodge | Phase 3 | Complete. SDK tests, a one-machine browser run, and multi-device full-speed acceptance reported complete |
| 5 | Public matchmaking and parties | Phase 4 | Deferred — public matchmaking after Phase 6. Private group parties implemented; browser playtest pending |
| 6 | Four-game MVP and all presets | Phase 4 | In progress — all four arenas and every private preset (Short, Standard, Full, single-arena) implemented; playtests, tuning, score normalization and roster sweeps next |
| 7 | Presentation and accessibility | Phase 6 | Planned |
| 8 | Release validation and operations | Phase 7 | Planned |
| 9 | Evidence-led expansion | Released MVP | Post-MVP |

## Phase 0 — Reproducible foundation

**Objective.** Establish a reliable client, server and shared-code development loop.

- Confirm npm workspaces and the committed lockfile install on a clean checkout with a supported Node LTS.
- Keep TypeScript checks, simulation regression tests, client build and server build available through root commands.
- Validate the built server independently from the development watcher.
- Record development ports, environment variables and the esbuild override in the development guide.
- Add CI that runs the same checks and the SDK smoke test before shared changes merge.

**Deliverable.** A reproducible application skeleton with a four-client SDK smoke test.

**Exit criteria.** Clean install, type checking, tests, builds and smoke test pass. A developer can launch the browser client using the documented instructions. Dependency findings have an explicit disposition.

**Evidence.** The [initial GitHub Actions run](https://github.com/Yogesh-5232/Oops-Arena/actions/runs/43052905122) passed the clean install, type checks, unit tests, production builds and built-server smoke test. The earlier dependency audit finding was addressed by the esbuild override documented in the development guide.

## Phase 1 — Reliable multiplayer greybox

**Objective.** Make the existing room reliable through normal browser entry points.

- Introduce stable arena and spawn definitions shared by rendering and simulation.
- Replace spawn selection based on roster size with occupied-slot-aware allocation.
- Validate four physical browser clients joining, moving, jumping and leaving.
- Finish mouse camera control, pointer-lock feedback and input clearing on blur or visibility changes.
- Verify unexpected drops, intentional leaves, grace expiry and reload-token reconnection. Prevent stale buffered movement from replaying after reconnect.
- Expose development telemetry for RTT, room population, input age, tick duration and patch traffic.
- Repeat room creation and cleanup and exercise the 12-seat limit and 13th-client rejection.

**Deliverable.** A stable four-player greybox usable over a real network.

**Exit criteria.** Repeated join/drop/reload/leave cycles preserve one identity and seat per player. Expired players disappear. Rooms clean up. Invalid inputs cannot move players outside the simulation rules. Browser tests confirm the visual state.

**Main risks.** Duplicate seats, stale input, leaked timers, overlapping spawns and browser focus behavior.

## Phase 2 — Responsive movement, platforms and hazards

**Objective.** Prove the movement model required by all arenas.

- Extend shared movement to a capsule with grounded checks, simple obstacle collision, jump buffering, controlled recovery and dive.
- Introduce input sequences and acknowledgements through the SDK prediction path. Bound pending input and handle replay/reset explicitly.
- Add local prediction and reconciliation with immediate physical correction and smoothed visual offsets where appropriate.
- Interpolate remote avatars, initially around 100 ms, and reset history for respawns and scene changes.
- Implement one moving platform with tick-driven motion, rider attachment and shared update ordering.
- Implement one telegraphed hazard with swept contact detection, server knockback and a respawn checkpoint.
- Test at 40, 100 and 180 ms RTT with jitter and loss. Compare simple collision against Rapier only if representative geometry requires it.

**Deliverable.** The first complete playable prototype with four browser clients and a 12-seat sanity check.

**Exit criteria.** Jump and movement feel immediate. Landing, riding, jumping off platforms, getting hit and respawning converge to authoritative state. Excess input never grants extra simulation steps. Record correction magnitude and frequency during network tests.

**Main risks.** Platform timing disagreement, repeated corrections, replaying one-shot actions and fast-hazard tunneling. Resolve these before producing full arenas.

## Phase 3 — First complete private match

**Objective.** Ship a start-to-finish Quick Chaos race for friends.

- Build a compact Ultimate Obstacle Dash with two or three checkpoints and validated finish/progress ranking.
- Add private room creation, expiring six-character codes, guest identity, ready state, configurable capacity and host transfer.
- Require two ready connected players to start and lock the roster at countdown.
- Implement the server phase machine, monotonic match deadline and idempotent result finalization.
- Budget Quick as 5 seconds countdown, 105 seconds round and 10 seconds results. Provide playable cooldown after early outcome lock.
- Add a minimal plaza, results overlay and rematch flow with the same group.

**Deliverable.** A private link/code experience with a complete two-minute match.

**Exit criteria.** At least four and at most 12 players start together. Early finish, DNF, reconnect, slow loading and host loss never extend the active deadline. Final scoring happens once and every client receives the same result. Interrupted sessions are identified explicitly.

**Main risks.** Off-by-one deadline behavior, excessive finisher downtime, duplicate scoring and host privileges bypassing server checks.

## Phase 4 — Reusable arena lifecycle and Dodge

**Objective.** Demonstrate multi-round play and bounded resources.

- Extract a small arena interface for setup, fixed-step update, round ranking and disposal based on Dash's actual needs.
- Keep match phases, deadlines and result finalization in the server room; each arena run owns only arena setup, its fixed-tick behavior, progress/ranking and run-scoped cleanup.
- Keep one PlayCanvas app, common avatar assets and one active arena entity tree.
- Add versioned arena manifests, next-arena prefetch and disposal of obsolete entities, listeners, collision data and assets.
- Build Dodge Everything with two readable hazard families and authored seeded event patterns.
- Add Short Party transitions and shared leaderboard aggregation.
- Define safe late-load behavior and reject incompatible protocol/asset builds at admission.

**Deliverable.** A complete two-game Short Party playable privately.

**Exit criteria.** Repeated transitions settle to a stable memory baseline. Disabled arenas perform no gameplay simulation. A slow client can resync into a valid current phase without pausing others. The full match lasts 315 seconds.

**Main risks.** Resource leaks, asset/collider drift and loading stalls consuming the round.

**Progress.** The server has a reusable `ArenaRun` contract with Dash and Dodge adapters. The room owns the 315-second Short Party timeline, phase changes, roster, and finalization. State snapshots include the current arena, phase, round, remaining time, hazard seed/start tick, and cumulative leaderboard so reconnects can resume without restarting the match. Dodge uses a seeded six-second sequence of low sweepers and marked drop zones; both server authority and client prediction use the same hazard function. Placement points combine both rounds with tied placements sharing average-rank points. Physical browser, slow-load/reconnect, repeated-transition cleanup, and memory validation were later reported complete (see Lifecycle below).

**Lifecycle (2026-11-12).** Arenas are described by versioned manifests in `@chaos/shared` (`ARENAS`: plaza, dash, dodge), each with collision boxes, movers, floor markers, hazard family and spawns. Server arena runs and client prediction collide with the same manifest lists. `ARENA_BUILD` hashes the protocol version, every manifest and the shared rule data (`BUILD_RULES`). The server checks it in matchmaking (static `onAuth`, which runs before create and every join), and turns away a stale or missing build with a reload prompt. The room publishes `nextArenaId`, and the client keeps one PlayCanvas app with an `ArenaStage` holding the arena on screen plus the next one built hidden. A transition flips visibility, and every other tree is destroyed with its materials. Avatars share one material per color. On the server only the active arena run exists. Runs share one lifecycle base (`ArenaRunBase`) that registers them per owning room (`liveArenaRuns`); disposed runs refuse further updates, and the room releases both runs at their cutoffs, on completion and on dispose. Late-load rule: the server never waits for a client. A late or reloading client builds the current arena from its first snapshot (arena, phase, seed, start tick, standings) and joins the phase in progress. Movement is gated by phase, and stale input stamps are clamped to the rewind window. The project owner reported multi-device browser acceptance and a full-speed 315-second run complete on 2026-11-12, closing Phase 4. Asset (GLB) prefetch applies once arenas use loaded assets; today they are built from code.

## Phase 5 — Public matchmaking and parties

**Status.** Deferred for future implementation (decided 2026-11-12). Phase 6 proceeds first on the private path; this phase must land before Phase 8 release validation.

**Objective.** Let strangers and intact friend groups enter the same complete game loop.

- Launch one public Short Party queue in one region.
- Add party creation/joining and atomic seat reservations for the whole party.
- Use a short fill window once four players are ready, then atomically lock admission at countdown.
- Release expired and failed reservations. Preserve party membership when returning to queue.
- Separate valid reconnect admission from new arrivals after kickoff.
- Record queue time, abandonment, readiness failures, reservation expiry and room occupancy.

**Deliverable.** Public and private entry paths converging on the same match lifecycle.

**Exit criteria.** Concurrent join attempts never exceed capacity or split a party. Failed joins release capacity. Matches start only with the ready minimum, and in-progress rooms accept only valid reconnects.

**Main risks.** Sparse population, races in reservation handling and fragmented queues. Add queue variants only when population evidence supports them.

**Progress (private group parties).** The private-room slice is implemented. **Create group party** makes a private room (capacity 4–12) that starts only when every member is connected and ready and there are at least two. The host can renew an expired invite from the lobby. Admissions lock at countdown, dropped members keep their reconnect reservation and must ready up again, and the group stays in the same room for a rematch. Concurrent joins respect capacity and released seats can be reused. Browser checks of invite renewal, reconnect, host transfer and same-party rematch remain. Protocol version is 3 (party state field and invite renewal message). The public queue is still deferred.

## Phase 6 — Four-game MVP and session presets

**Objective.** Complete the promised gameplay variety.

- Build vertical Floor Is Lava with route choice, early respawns and a short closing elimination stretch.
- Prototype Teamwork Madness with mirrored lanes, constrained cargo and server-validated contextual interaction.
- Test odd rosters and cap active contributions to the smaller team size. Rotate the extra side across rematches.
- Substitute a relay handoff design if cargo playtests fail to produce clear, recoverable teamwork.
- Normalize placement scores, define shared ties and DNF progress, and tune team points against leaderboard swings.
- Add Standard and Full private presets. Reuse an arena variation for the finale.
- Validate each supported preset/playlist combination, including Quick-specific layouts or eligibility restrictions.

**Deliverable.** Four arenas and all private session presets. The public Short queue follows with Phase 5.

**Exit criteria.** Every roster size from 4 through 12 completes each applicable mode. All scheduled match windows stay within 120–900 seconds. No round elimination removes a player from the session. Playtesters can understand and recover from team failures.

**Main risks.** Cargo griefing, roster imbalance, repetitive survival modes and excessive idle time.

**Progress (2026-11-12).** Floor Is Lava is implemented ([plan](Floor-Is-Lava-Plan.md)): a stepped four-gate tower with stairs and timed lifts, lava rising on fractions of the round, early respawns carried past flooded pads, a closing stretch that sends caught players to a viewing balcony, and a summit sweeper. Server and prediction share `resolveLava`. The room now runs data-driven playlists (`PLAYLISTS`): Short (Dash, Dodge, 315 s) and Standard (Dash, Lava, Dodge, 540 s), chosen by the host in the lobby. A generic `PartyClock` and `PartyScoreboard` replace the Short-only versions; results carry one summary per round. Protocol version is 2. Unit tests cover tower reachability, lava rules, playlist timing and Lava ranking. A one-tab plus three-bot run at 10% speed completed a Standard match with all three rounds scored and arena runs released. Open: full-speed and multi-device Lava playtests, Teamwork Madness playtests and tuning, the Full preset and its finale, roster-size sweeps.

**Teamwork Madness (2026-11-12).** First playable greybox of the cargo variant ([plan](Teamwork-Madness-Plan.md)): mirrored Blue and Red lanes, a server-owned crate per team that players push to a goal line, three gates per lane opened by pressure plates past them (latched 4 s), counted pushers capped at the smaller team's size, rollback to the last cleared gate when nobody pushes, and a sweeper per lane section. Teams alternate down a rotated roster, so the extra seat moves across rematches. Teammates share fixed team points (win 10, loss 4, draw 7). It is playable as the private **Teamwork Only** preset. Protocol version is 5. Evidence: unit tests, `npm run smoke:team` (four bots, 2v2, delivery in 41 s at half-speed clock), and one browser tab with four bots (3v2, no console errors). Open: 2v2, 5- and 11-player browser playtests, tuning, and the cargo-vs-relay decision.

**Full preset (2026-11-12).** The private **Full Party** preset runs Dash, Floor Is Lava and Teamwork Madness for 170 s each, then a 150 s finale, with 12 s transitions, an 8 s countdown and 26 s of results: 730 s. The finale reuses the Dodge Everything floor with four-second waves where the sweeper and both drop zones come together (`DODGE_FINALE_RULES`, manifest `finale`), and it scores like any round. Playlists can now give the last round its own length (`finaleMs`), so the room tracks round length per round. Protocol version is 6. Evidence: unit tests for the Full timeline, finale hazards and finale scoring; `npm run smoke:private` now plays a whole Full match at 10% speed (all four rounds scored, 2v2 teams, at most one live arena run, none left after, 730 s timeline held); one browser tab with three bots completed a Full match at 10% speed. Open: full-speed Full playtests with people.

**Roster-size sweep (2026-11-13).** `npm run sweep:roster` plays every single-arena mode at every roster size from 4 to 12, one room per size in parallel, with bots that play (Dash bots run the gates, Teamwork bots push and hold plates, Lava and Dodge bots stand still). All 36 combinations completed: the whole roster started racing, nobody left the session, every racer was scored once with 2–12 points, arena runs were released, and each match ended on its deadline. Teamwork teams were never more than one apart (2v2 through 6v6). Every playlist's length is unit-tested to sit within 120–900 s. The sweep found that rank-averaged team points depended on team size, and team rounds now use fixed points. That covers the roster-size and match-window exit criteria; the remaining Phase 6 exit criterion is playtesters understanding and recovering from team failures.

## Phase 7 — Presentation and accessibility

**Objective.** Make the completed loop readable and enjoyable for newcomers.

- Replace greybox avatars with one shared rig, colors and a small emote set.
- Add readable animation, audio, warning cues and clear contextual prompts.
- Tune camera collision, sensitivity, recovery duration and menu/input focus.
- Offer color-plus-shape hazard cues and prioritize control remapping as capacity allows.
- Keep results brief, put detailed statistics in the hub and support a direct rematch.
- Profile representative art and effects as they arrive. Split and preload assets according to measured loading cost.

**Deliverable.** An external-playtest build with coherent cartoon presentation.

**Exit criteria.** New players reach meaningful action quickly, understand objectives and voluntarily rematch. Record onboarding confusion, idle time and motion/camera complaints alongside performance measurements.

**Main risks.** Art increasing GPU cost, unreadable effects and UI obscuring the course.

## Phase 8 — Release validation and operations

**Objective.** Establish a measured production release boundary.

- Complete the browser, network, security, lifecycle and load matrix in Validation-and-Release.md.
- Deploy versioned assets and an always-on HTTPS/WSS server with health/readiness checks, structured logs and an observed room cap.
- Add admission draining and rehearse deployment, rollback and process-crash recovery.
- Run multi-room soak tests on the target host and record CPU, memory, event-loop delay, egress and socket backlog.
- Verify identity, origin policy, message bounds, code lookup limits, token handling and result integrity.
- Publish the tested device/browser matrix and known limitations with the build ID.

**Deliverable.** A release candidate with repeatable validation and operating instructions.

**Exit criteria.** All must-have scope is demonstrated, critical failures are resolved and capacity is set from measurements. The owner can diagnose and recover an interrupted service without corrupting results.

**Main risks.** Unmeasured deployment limits, integrated-GPU stalls, socket backlog and reconnect storms.

## Phase 9 — Post-MVP expansion

Use retained-player feedback and operational measurements to choose the next investment. Add durable XP and cosmetics when account continuity is required. Add regions or processes when queues and capacity justify them. Prototype Giant Ball Race, Capture the Flag, Balance Chaos and Treasure Hunt individually. Each addition needs its own replayability, fairness and performance gate.
