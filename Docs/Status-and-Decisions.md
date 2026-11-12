# Implementation status and open decisions

## Current status

The foundation has npm workspaces, a PlayCanvas scene and follow camera, a Colyseus room, 30 Hz authoritative movement, 20 Hz patches, numbered and acknowledged inputs through the SDK input channel (one consumed per tick, an eight-input buffer, sanitized to finite values of length at most 1, waiting for late inputs within a refilling eight-tick allowance before stepping without them, and credit-limited catch-up after stalls), float64 avatar state, SDK reconciler prediction of the local avatar with correction telemetry, 100 ms interpolation of remote avatars with history reset on respawn and scene changes, swept capsule collision against shared arena and mover boxes, jump buffering, coyote time, dive and recovery, tick-stamped inputs with mover poses evaluated at the stamped tick, a riding ferry, a telegraphed pusher hazard with swept knockback and a hit shield, checkpoint pads with respawn, and a 12-seat cap. Server reconnect reservation and client transient reconnect feedback are implemented but need scenario coverage.

The client and server share the greybox floor, movement bounds and spawn definitions. The server tracks occupied slots, including reconnect reservations, and releases them when a player leaves or a reservation expires. On blur or when the page becomes hidden, the client clears local controls and asks the server to discard the current command and buffered jump.

Phase 0 passed a clean install, checks, production builds and the SDK smoke test on [GitHub Actions](https://github.com/Yogesh-5232/Oops-Arena/actions/runs/43052905122). The smoke test covers four-client movement and jumping, automatic and token-based recovery of the original seat, reservation expiry, vacant spawn reuse, the 12-seat limit and empty room disposal. Browser mouse look, per-tab reload recovery, and opt-in diagnostics with input age are implemented. The project owner reported the four-player browser playtest complete on 2026-11-12, closing Phase 1.

The two-player browser playtest confirmed remote join through ngrok. Phase 2 has recorded SDK relay measurements at 40, 100 and 180 ms RTT. The project owner reported the four-player physical-device playtest of the controller, ferry, pusher and respawns complete on 2026-11-12, closing Phase 2.

The private room requires four connected, ready players to start, locks the roster, and keeps other guests waiting. Returning to the lobby preserves seats and host ownership while resetting readiness. The original Quick Dash timing and SDK results evidence are recorded as the Phase 3 baseline; the current private room now runs the Short Party sequence.

The private browser flow supports room codes, ready state, reconnect, host transfer, and rematch. The active sequence is now Dash followed by Dodge, then combined results. Its server timeline is an eight-second countdown, two 140-second rounds, a 12-second transition, and 15 seconds of final results: 315 seconds total. The server retains the locked roster and does not extend deadlines for late ticks or slow clients.

Earlier SDK acceptance covered the Quick Dash flow, invitation expiry, readiness, token reconnect, host transfer, rematch, and interruption; a separate SDK check covered 12 racers. That evidence does not verify the new Short Party sequence. The project owner reported the physical browser acceptance complete on 2026-11-12 (separate devices, mixed Dash finish/DNF, Dodge hazards, reconnect during Dodge, slow loading), closing Phase 3.

Phase 4 now has a server-side `ArenaRun` contract, Dash and Dodge adapters, deterministic seeded hazard families, a recoverable Short Party clock, arena transitions, and a combined placement leaderboard. `PrivateDash` still owns authoritative phases, deadlines, results, and roster rules. After merging into `main` with the Phase 2 controller fixes, `npm run check` (35 unit tests and production builds), `npm run smoke` and the 10%-speed `npm run smoke:private` Short Party run passed on Node 24.22.2. That SDK-level evidence was followed by the browser acceptance below.

The Phase 4 lifecycle work is merged into `main` (PR #8): versioned arena manifests with an admission build check, next-arena prefetch, disposal of obsolete arena trees and materials, a single live server arena run, and a defined late-load rule. A one-machine browser run (one tab plus three SDK bots, 10% clock) showed identical entity and material totals in the lobby before and after two full matches (36 entities, 14 materials with four avatars). A reload mid-Dodge rejoined the running round without pausing others. The project owner reported multi-device acceptance and a full-speed run complete on 2026-11-12, closing Phase 4.

Phase 5 (public matchmaking and parties) is deferred for future implementation. Phase 6 is in progress: Floor Is Lava and the Standard preset (Dash, Lava, Dodge, 540 s) are implemented with a host preset picker, generic playlist clock and per-round results (protocol 2). Evidence so far is unit tests and one 10%-speed browser run with bots. Teamwork Madness now has a first playable greybox (cargo variant, Teamwork Only preset, protocol 5) with unit tests, a bot smoke test and one bot-assisted browser run; see [the plan](Teamwork-Madness-Plan.md). The Full preset (Dash, Lava, Teamwork, then a 150 s Dodge finale variation; 730 s, protocol 6) is implemented and passes an automated whole-match run at 10% speed. Teamwork playtests and tuning, full-speed Full and Lava playtests, score normalization and roster-size sweeps remain.

## Decisions to validate

| Decision | Options and trade-off | Preferred next step | Gate |
|---|---|---|---|
| Authoring | Editor speeds placement; code/GLB simplifies reproducibility | Keep code-first until a timed Editor export trial | Stable IDs and collider alignment after two iterations |
| Collision | Primitives reduce scope; Rapier handles more geometry with integration cost | Prototype representative platform edges with primitives | Correct grounding, slopes needed by content, reproducible replay |
| Netcode | SDK prediction reduces custom code; custom replay grants control with maintenance cost | Use SDK prediction at 30 Hz and 20 Hz patches | Latency/correction measurements from Phase 2 |
| Teamwork | Cargo gives physical collaboration; relay clarifies ownership | Cargo greybox built (crates, plate gates, capped pushers); playtest it with 5 and 11 players | Clear contribution and fair, recoverable play |
| Content scheduling | Curated playlists ease testing; more queues fragment players | One public Short queue, private presets | Queue time and abandonment justify expansion |
| Infrastructure | One process is simple; distribution adds capacity and routing work | Measure concurrent rooms first | Saturation, latency and regional demand |
| Persistence | Guest sessions minimize scope; durable XP requires identity and writes | Defer XP persistence | Proven repeat play and account continuity requirement |

## Status update rule

Mark a phase complete only when its exit criteria have recorded evidence. Record a deliberate scope change in the phase plan and technical/game scope together. Preserve optional choices as decisions until validated.
