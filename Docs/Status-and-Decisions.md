# Implementation status and open decisions

## Current status

The foundation has npm workspaces, a PlayCanvas scene and follow camera, a Colyseus room, 30 Hz authoritative movement, 20 Hz patches, numbered and acknowledged inputs through the SDK input channel (one consumed per tick, an eight-input buffer, sanitized to finite values of length at most 1, waiting for late inputs within a refilling eight-tick allowance before stepping without them, and credit-limited catch-up after stalls), float64 avatar state, SDK reconciler prediction of the local avatar with correction telemetry, 100 ms interpolation of remote avatars, axis-swept box collision against shared arena boxes, jump buffering, coyote time, dive and recovery, tick-stamped inputs with mover poses evaluated at the stamped tick, a riding ferry, a telegraphed pusher hazard with swept knockback and a hit shield, checkpoint pads with respawn, and a 12-seat cap. Server reconnect reservation and client transient reconnect feedback are implemented but need scenario coverage.

The client and server share the greybox floor, movement bounds and spawn definitions. The server tracks occupied slots, including reconnect reservations, and releases them when a player leaves or a reservation expires. On blur or when the page becomes hidden, the client clears local controls and asks the server to discard the current command and buffered jump.

Phase 0 passed a clean install, checks, production builds and the SDK smoke test on [GitHub Actions](https://github.com/Yogesh-5232/Oops-Arena/actions/runs/43052905122). The smoke test covers four-client movement and jumping, automatic and token-based recovery of the original seat, reservation expiry, vacant spawn reuse, the 12-seat limit and empty room disposal. Browser mouse look, per-tab reload recovery, and opt-in diagnostics are implemented. The four-player browser playtest is the remaining Phase 1 gate. The current preset constants do not enforce match deadlines.

The two-player browser playtest confirmed remote join through ngrok. The four-player browser gate remains open. The Phase 3 branch includes the Phase 2 controller changes from main.

The private room requires four connected, ready players to start, locks the roster, and keeps other guests waiting. Returning to the lobby preserves seats and host ownership while resetting readiness. The original Quick Dash timing and SDK results evidence are recorded as the Phase 3 baseline; the current private room now runs the Short Party sequence.

The private browser flow supports room codes, ready state, reconnect, host transfer, and rematch. The active sequence is now Dash followed by Dodge, then combined results. Its server timeline is an eight-second countdown, two 140-second rounds, a 12-second transition, and 15 seconds of final results: 315 seconds total. The server retains the locked roster and does not extend deadlines for late ticks or slow clients.

Earlier SDK acceptance covered the Quick Dash flow, invitation expiry, readiness, token reconnect, host transfer, rematch, and interruption; a separate SDK check covered 12 racers. That evidence does not verify the new Short Party sequence. The physical browser acceptance remains open, including separate devices, mixed Dash finish/DNF, Dodge hazards, reconnect during Dodge, and slow loading.

Phase 4 now has a server-side `ArenaRun` contract, Dash and Dodge adapters, deterministic seeded hazard families, a recoverable Short Party clock, arena transitions, and a combined placement leaderboard. `PrivateDash` still owns authoritative phases, deadlines, results, and roster rules. Browser resynchronization, physical acceptance, repeated cleanup, and Phase 4 exit criteria remain open. The previous baseline check was run before these changes; the new implementation has not yet been built or exercised.

## Decisions to validate

| Decision | Options and trade-off | Preferred next step | Gate |
|---|---|---|---|
| Authoring | Editor speeds placement; code/GLB simplifies reproducibility | Keep code-first until a timed Editor export trial | Stable IDs and collider alignment after two iterations |
| Collision | Primitives reduce scope; Rapier handles more geometry with integration cost | Prototype representative platform edges with primitives | Correct grounding, slopes needed by content, reproducible replay |
| Netcode | SDK prediction reduces custom code; custom replay grants control with maintenance cost | Use SDK prediction at 30 Hz and 20 Hz patches | Latency/correction measurements from Phase 2 |
| Teamwork | Cargo gives physical collaboration; relay clarifies ownership | Test constrained cargo with 5 and 11 players | Clear contribution and fair, recoverable play |
| Content scheduling | Curated playlists ease testing; more queues fragment players | One public Short queue, private presets | Queue time and abandonment justify expansion |
| Infrastructure | One process is simple; distribution adds capacity and routing work | Measure concurrent rooms first | Saturation, latency and regional demand |
| Persistence | Guest sessions minimize scope; durable XP requires identity and writes | Defer XP persistence | Proven repeat play and account continuity requirement |

## Status update rule

Mark a phase complete only when its exit criteria have recorded evidence. Record a deliberate scope change in the phase plan and technical/game scope together. Preserve optional choices as decisions until validated.
