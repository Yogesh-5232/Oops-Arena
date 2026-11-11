# Implementation status and open decisions

## Current status

The foundation has npm workspaces, a PlayCanvas scene and follow camera, a Colyseus room, 30 Hz authoritative movement, 20 Hz patches, normalized finite input, a 60-message-per-second allowance, a 250 ms stale-input timeout, floor/arena limits, jumping and a 12-seat cap. Server reconnect reservation and client transient reconnect feedback are implemented but need scenario coverage.

The client and server share the greybox floor, movement bounds and spawn definitions. The server tracks occupied slots, including reconnect reservations, and releases them when a player leaves or a reservation expires. On blur or when the page becomes hidden, the client clears local controls and asks the server to discard the current command and buffered jump.

Phase 0 passed a clean install, checks, production builds and the SDK smoke test on [GitHub Actions](https://github.com/Yogesh-5232/Oops-Arena/actions/runs/43052905122). The smoke test covers four-client movement and jumping, automatic and token-based recovery of the original seat, reservation expiry, vacant spawn reuse, the 12-seat limit and empty room disposal. Browser mouse look, per-tab reload recovery, and opt-in diagnostics are implemented. The four-player browser playtest is the remaining Phase 1 gate. The current preset constants do not enforce match deadlines.

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
