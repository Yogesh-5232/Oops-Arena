# Technical scope

## Stack and ownership

Use the installed TypeScript/npm workspace, PlayCanvas client, Colyseus core plus WebSocket transport, and shared simulation package. The lockfile is the exact installed dependency record. A supported patched Node LTS is the deployment target. The current foundation accommodates Node 22.19. WebGL 2 is the release rendering baseline. WebGPU remains optional and requires a tested fallback path.

| Component | Responsibilities |
|---|---|
| Browser | Input, camera, rendering, animation, audio, local prediction, remote interpolation, menus and connection feedback |
| Room | Admission, roster, lifecycle, reconnect reservations and synchronized state |
| Match | Monotonic timing, phase transitions, round sequencing, score aggregation and one-time finalization |
| Arena | Collider/spawn definitions, hazards, checkpoints, objective rules and round ranking |
| Shared package | Protocol, input validation, fixed movement step, arena definitions and movement configuration |

Split modules when the corresponding feature is implemented. Preserve the modular monolith and a single networking path for all games.

## Simulation and networking

Run 30 fixed simulation steps per second and begin at 20 patches per second. Clients send one numbered input per tick over the SDK's reliable input channel, paced by a clock accumulator. The server consumes exactly one input per player per tick from an eight-input buffer (overflow drops the oldest) and echoes the consumed count as the acknowledgement. When the buffer is empty the server waits: it does not step that player, and each waited tick earns one catch-up credit (at most eight). Waiting is rationed by a per-player allowance of eight ticks that refills one tick per four, so a stall of about 270 ms is covered while a client trickling single inputs with pauses (to hang in the air) runs out and falls. While a player holds credit and more than one input is waiting, a tick runs one extra input and spends a credit, so a burst after a stall drains back to a one-input cushion instead of adding latency permanently. Waiting simulates nothing the client did not predict, so short stalls cause no corrections even mid-dive. Without allowance the server steps the player with an empty input, so gravity still acts and withholding inputs cannot hover; those steps earn no credit, so player steps never exceed elapsed ticks. The local avatar is predicted with the SDK reconciler: the client runs the same shared `simulateInput` as the server for each input as it is sent (it repairs a copy, never the received input, because delta-encoded fields keep their previous values), rewinds to the server state at each acknowledgement and replays unacknowledged inputs. Corrections decay over one patch interval. The local reconciler has no snap threshold, because the SDK compares it against every mirrored field including `vy`, so a mispredicted jump would pop the avatar; the local respawn counter triggers a visual cut. Correction telemetry requires `warnOnDivergence` (set to Infinity: measure, never warn) and reports position only. Only stalls longer than the wait limit cause server steps the client did not predict; those appear as corrections. Remote avatars render through SDK lerp interpolation 100 ms behind the server clock. Their interpolation buffers reset on respawns and transitions between the lobby and Dash, with a 3-unit snap threshold for other large jumps. The diagnostics overlay reports patch jitter against that buffer. It must continue advancing gravity and hazards when input is absent.

Keep player movement kinematic. Use simple collision shapes and authored collider IDs. The player is a 1 x 2 x 1 box swept against the arena's axis-aligned boxes one axis at a time (x, then z, then y); a contact snaps the coordinate exactly flush, fall speed is capped at 20 units per second and every move is swept, so thin boxes cannot be tunneled. Reconciled state is position, velocity, grounded, jump-buffer and coyote timers, mode (normal, diving, recovering) with its timer, ticks since the jump, facing and spawn slot; the client mirrors every schema scalar. Dive is a double tap with no separate input: a jump press while airborne within 10 ticks of the jump (about to the top of the arc) dives, a later airborne press stays a buffered jump for the landing, and a press after walking off an edge without jumping is a coyote jump or nothing. A dive launches along the facing at 11 units per second with no steering; landing starts 12 ticks of recovery at 40% speed with no jump or dive. Moving boxes (movers.ts: the ferry and the pusher) are pure functions of the world tick, so nothing about them is replicated. Each input carries the world tick the client estimated when it sampled it (the replicated state tick plus the snapshot age, stepped one tick per input and re-anchored on drift over two ticks), and the step evaluates movers at that tick. The server clamps the stamp to never be in the future, never more than 15 ticks (500 ms) behind its own tick and never before the player's previous input, so a lying client gains at most what 500 ms of lag would give. Riding and hazard hits are therefore predicted exactly. A rider is first carried by its mover's displacement since its previous input tick; a mover that moved into a player pushes it out along its motion (or lifts it on top); a knocking mover that swept through an unshielded player this step throws it along the motion (9 units/s) and up (6), stuns it with no control until landing, then recovery, and shields it for 30 ticks. Touching a checkpoint pad saves it; falling below the kill height respawns at the last pad (or the spawn) with a 30-tick shield and bumps a respawn counter so the local client cuts to the new spot instead of gliding. The client draws movers at its own smoothed simulation tick (the mirrored simTick, interpolated like position) so a rider stays on the deck; remote riders are drawn from their interpolated server positions and may sit slightly off a moving deck. The same movement code and tick ordering run on the server and in local prediction. Include velocity, grounding, cooldown and platform attachment in reconciliation state. Reset pending inputs and smoothing on respawn, reconnect and arena changes. Remote rendering begins with a 100 ms interpolation buffer and is tuned from jitter measurements.

Platforms derive motion from server ticks. Apply platform displacement to riders consistently. Use sweeps or targeted substeps for fast hazards. The server owns hits, checkpoint order, finishes, team objectives and scores. Keep player blocking disabled in narrow passages and cap any added bumps. Cargo ownership, grab distance, contribution rate, release and recovery rules are explicit server decisions. Cosmetic reactions have no gameplay collision.

## Arena and asset lifecycle

Use one persistent PlayCanvas application with independently mounted arena trees. Common rigs/materials remain resident. Preload upcoming assets while the current round runs. Dispose old entities, event subscriptions, colliders and resource references. Track asset/collider manifests by build version and stable entity IDs. Test Editor export against this contract before adopting it as the primary authoring tool.

## Match lifecycle

The intended flow is waiting → readiness → countdown → round → transition → next round → final results → hub/rematch. The active clock starts at countdown. Store monotonic start, phase cutoffs, scoring cutoff and preset end. Check cutoffs before accepting competitive actions on every tick. Reserve final-results time and finalize at most once.

Loading, disconnects and clock adjustments cannot extend a match. Preserve the chosen time budget with playable cooldown when outcomes lock early. If too few competitors remain, mark the result incomplete where appropriate. A server crash interrupts the match. Recovery returns clients to a clear lobby flow without inventing a completed result.

## Admission and identity

Private rooms use random six-character codes, collision checks, expiry and rate-limited lookup. Guest identity and short-lived seat credentials authorize access. Require at least four connected ready players and count reservations toward the 12-seat maximum. Transfer host rights after a bounded grace period and check settings permissions server-side.

Public matchmaking starts with one Short playlist and one region. Reserve entire parties atomically, expire incomplete admissions and lock new entry at countdown. Reconnect reservations are distinct from ordinary joins. Reserve dropped players for up to 30 seconds, neutralize their input and release held objects. Reload recovery uses a scoped token. Intentional leaves and expired reservations release resources.

## Security and reliability

Validate message size, shape, finite numbers, enums and phase permissions. Bound rates and queues, reject unsupported protocol versions and prevent duplicate actions. Never accept client scores, position declarations or winner claims. Escape display names, use preset emotes and restrict host operations. Protect reconnect tokens from logs and cross-room reuse. Configure the browser origin policy and HTTPS/WSS in deployment.

Use match IDs and idempotent result commits. Dispose timers, input maps, event listeners, room-code mappings and reservations. Add idle lobby expiry, bounded rematch waiting and readiness/health endpoints. Keep telemetry free of credentials.

## Hosting and persistence

Start with a static asset host/CDN and one always-on Node process in the launch region. Confirm WebSocket upgrades, proxy timeout behavior and versioned asset caching. Drain admission before shutdown and allow rooms to finish within their existing deadlines. Measure room capacity on the actual host before scaling.

Keep guest state and match results in memory for MVP. Store local cosmetic preference in the browser. Add PostgreSQL for durable accounts, history and unlocks when required. Add Redis presence and shared allocation when deploying multiple room processes. Route a room's connections to its owner. Crash recovery of an active room would require a separate persistence design.

## Explicit exclusions from the foundation

The shared controller sweeps an upright capsule against authored arena and mover boxes. The greybox includes a moving ferry and pusher hazard. Private Dash has room codes, readiness and an authoritative match deadline. Slopes, public parties and operational hardening remain future work.
