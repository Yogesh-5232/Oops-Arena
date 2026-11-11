# Chaos Playground implementation plan

## Product and release boundaries

Build a cartoon third-person desktop-browser party game for 4–12 players. Preserve private room codes, public party-aware matchmaking, a small shared plaza, four independently loaded arenas, and active matches lasting 120–900 seconds. Countdown, transitions, loading after kickoff, and results all consume the active window. Queue time precedes that window.

The foundation is a shared TypeScript workspace, PlayCanvas client and authoritative Colyseus server. The initial implementation uses npm workspaces and Node 22.19 because those tools are installed. Upgrade deployment to a supported patched Node LTS and verify the frozen lockfile before release. Package versions come from the registry at implementation time.

## Architecture decisions

- One Node process initially, with one PartyRoom per group and one active arena per room. Keep admission, match timing, arena rules and presentation separate.
- Shared fixed-step kinematic controller and versioned collision manifests. Start with simple boxes and planes. Prototype Rapier before adding general slopes or compound collision. PlayCanvas handles rendering. Competitive results are determined by the server.
- Start at 30 simulation ticks and 20 state patches per second. Validate input shape, finite values, normalized direction, phase permissions, queue bounds and rate limits. Never grant extra simulation time for extra commands.
- Add SDK prediction and acknowledgement-based reconciliation after authoritative motion works. Replay local inputs, reset history on teleport or phase changes, interpolate remote entities starting at 100 ms, and measure corrections under jitter.
- Platforms follow server ticks. Rider attachment and movement use the same order on client and server. Fast hazards use swept tests or targeted substeps. Cargo is server-owned with capped contributions and explicit grab permissions.
- Keep avatar rig and common assets resident. Mount one arena entity tree, prefetch the next and dispose old listeners, collision data and GPU assets. Export stable IDs and compare visible geometry against colliders.
- Use monotonic deadlines and idempotent finalization. Freeze scoring before the reserved result window. Loading and reconnection never extend the match. Treat server crashes as interrupted matches.
- Reserve disconnected seats for 30 seconds, neutralize movement, release objects and resync on reconnect. Clear stale input. Support reload tokens in the completed prototype. Expire empty lobbies and clean up all room resources.
- Start with guest sessions and in-memory results. Add PostgreSQL when persistent XP or cross-device unlocks become a product requirement. Make durable result commits unique by match ID.
- Host static assets on a CDN and an always-on WSS server in one region. Measure room capacity before scaling. Add Redis presence and shared allocation only when multiple processes are needed. Drain admissions before deployment.

## Game design

Quick lasts 120 seconds: 5 countdown, 105 playable round, 10 results. Short lasts 315 seconds: 8 countdown, two 140-second rounds, 12 transition, 15 results. Standard lasts 540 seconds: 8 countdown, three 160-second rounds, two 15-second transitions, 22 results. Full lasts 730 seconds: 8 countdown, three 170-second rounds, 150-second finale, three 12-second transitions, 26 results. Use playable cooldowns when competitive outcomes lock early.

Build Dash first with checkpoints and a compact Quick layout. Lava emphasizes upward route choice, early respawns and only a brief final elimination stretch. Dodge emphasizes telegraphs and safe gaps with authored seeded combinations. Teamwork uses mirrored lanes and constrained cargo or relay handoffs if cargo tests poorly. Cap active contributions to the smaller team size for odd rosters and rotate extra players across rematches.

Normalize race points by roster size, rank DNFs by validated checkpoint progress, share tied ranks, and tune team points against measured leaderboard swings. Cosmetics provide no advantage. Prioritize fast recovery, jump buffering, camera collision and contextual interaction. Give finishers a playable cooldown.

## Scope

Prototype: four clients, greybox, third-person camera, authoritative movement, jump, platform, hazard, respawn, prediction and reconnect. Also perform a 12-seat capacity sanity check.

MVP: plaza, four arenas, all private presets, one public Short queue, intact party reservations, host transfer, readiness, rematch, scoring, odd teams, color customization, move/jump/dive/interact/emote, strict deadlines and real browser validation.

Should have: authored seeded variants, short playlist vote, remapping, sensitivity, accessible cues and objective highlights.

Post-MVP: persistent XP, unlocks, additional regions and public queues as population supports them, Giant Ball Race, Capture the Flag, Balance Chaos and Treasure Hunt. Prototype their possession, collision and pacing separately. Remove bespoke finale technology, freeform multiplayer lifting, large open-world hub and automatic funniest-moment detection from initial scope.

## Ordered work and acceptance gates

1. Reproducible workspace and pinned dependencies; typecheck, tests and builds pass from a clean install.
2. Four-player authoritative greybox with observable input, tick, correction and connection state. Repeat join/drop/reconnect/leave without leaks.
3. Shared controller prediction, remote interpolation, platform and hazard. Test 40/100/180 ms RTT with jitter and loss. Confirm consistent outcomes.
4. Private Dash with room codes, readiness, checkpoints, exact Quick deadline and rematch. Exercise 12 clients and early finish/DNF cases.
5. Dodge, arena disposal, preload and party-aware public Short queue. Reserve parties atomically, cap seats at 12 and release failed reservations.
6. Lava, constrained Teamwork, all private presets and normalized scores. Test every roster size and measure voluntary rematches and idle time.
7. Release profiling on discrete and integrated GPU desktops, Chrome/Edge/Firefox/Safari, context loss, tab suspension and pointer lock. Target 60 FPS with recorded p95/p99 frame times, recurring-stall investigation and memory settling after repeated transitions.
8. Multi-room soak on the deployment host. Measure tick CPU, event-loop delay, patch bytes and socket backlog. Set an admission cap with headroom. Rehearse drain, restart and recovery.

## First 20 tasks

Pin tools; scaffold workspaces; SDK connection smoke test; shared arena manifest; render scene; camera/input; fixed movement step; authoritative room loop; input validation; replicated avatar state; remote interpolation; local prediction; fall/recovery; rideable platform; scripted hazard; transient reconnect; reload/expiry; telemetry; four-device scenario; 12-seat and cleanup check. Each task must produce a working increment before content expansion.

## Open validation decisions

Measure Editor export productivity and collider alignment before adopting it. Compare primitive collision with Rapier on representative platform edges. Tune patch and interpolation rates using correction data. Compare cargo against relay with 5 and 11 players. Set regions and room capacity from queue and load measurements. Establish production hardware budgets from actual profiles.

## Current foundation status

Implemented: workspace, shared movement/input validation, authoritative test room, floor and arena limits, server jump, 12-seat cap, stale-input timeout, bounded message rate, transient reconnect reservation, browser scene and connection UI, and regression checks. Prediction, moving-platform collision, public/private product flows, session state machine, readiness, durable identity, deployment hardening and real-device performance gates remain roadmap work. This foundation is an initial runnable increment, not a release certification.
