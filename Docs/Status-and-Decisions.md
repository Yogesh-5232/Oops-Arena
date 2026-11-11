# Implementation status and open decisions

## Current status

The foundation has npm workspaces, a PlayCanvas scene and follow camera, a Colyseus room, 30 Hz authoritative movement, 20 Hz patches, numbered and acknowledged inputs through the SDK input channel (one consumed per tick, an eight-input buffer, sanitized to finite values of length at most 1, waiting for late inputs within a refilling eight-tick allowance before stepping without them, and credit-limited catch-up after stalls), float64 avatar state, SDK reconciler prediction of the local avatar with correction telemetry, 100 ms interpolation of remote avatars with history reset on respawn and scene changes, swept capsule collision against shared arena and mover boxes, jump buffering, coyote time, dive and recovery, tick-stamped inputs with mover poses evaluated at the stamped tick, a riding ferry, a telegraphed pusher hazard with swept knockback and a hit shield, checkpoint pads with respawn, and a 12-seat cap. Server reconnect reservation and client transient reconnect feedback are implemented but need scenario coverage.

The client and server share the greybox floor, movement bounds and spawn definitions. The server tracks occupied slots, including reconnect reservations, and releases them when a player leaves or a reservation expires. On blur or when the page becomes hidden, the client clears local controls and asks the server to discard the current command and buffered jump.

Phase 0 passed a clean install, checks, production builds and the SDK smoke test on [GitHub Actions](https://github.com/Yogesh-5232/Oops-Arena/actions/runs/43052905122). The smoke test covers four-client movement and jumping, automatic and token-based recovery of the original seat, reservation expiry, vacant spawn reuse, the 12-seat limit and empty room disposal. Browser mouse look, per-tab reload recovery, and opt-in diagnostics with input age are implemented. The project owner reported the four-player browser playtest complete on 2026-11-12, closing Phase 1.

The two-player browser playtest confirmed remote join through ngrok. Phase 2 has recorded SDK relay measurements at 40, 100 and 180 ms RTT. A four-player browser playtest on physical devices still needs to validate the controller, ferry, pusher and respawns.

Phase 3 server rules let a ready host start with at least four connected, ready players. Other guests keep their seats and wait for the next race. The match roster stays fixed, and returning to the lobby preserves seats and host ownership while resetting readiness. The Quick Chaos clock produces the phase and standings together and keeps the original deadline even if a tick skips the results window.

Phase 3 now has a live private Dash room alongside the playground. The browser supports creating or joining a room by code, readying up, racing through two checkpoints and the finish, and seeing the same results before returning to the plaza. Codes expire after 30 minutes by default. Existing seats can still reconnect and rematch. A race with fewer than two remaining roster seats before scoring locks is marked interrupted. If the server disappears, the client reports that the private session could not be recovered.

The SDK acceptance test uses five clients and runs the real two-minute clock. It covers invite expiry, host-only start, an unready guest waiting, admission lock, token reconnect, ordered checkpoint finishes, shared standings, host transfer, rematch and interruption. A separate SDK check started all 12 racers in one private countdown and verified rejection of a 13th guest. Unit tests cover DNF ranking and late ticks. Phase 3 browser acceptance remains open, including play on separate devices and the slow-loading case.

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
