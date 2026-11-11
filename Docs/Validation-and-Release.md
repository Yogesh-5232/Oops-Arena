# Validation and release gates

## Evidence recorded for the current foundation

The previous setup run passed type checking, three shared-input/movement/preset regression tests, client/server production builds, and a four-SDK-client join/replication/movement smoke test. The dependency audit was clear after the scoped build-tool override. These results cover the foundation. Browser rendering, transient reconnection, real-device latency and load capacity still require direct validation.

## Functional matrix

| Area | Required scenarios | Acceptance |
|---|---|---|
| Seats | 1/2/4/12 joins, 13th join, concurrent reservation, repeated leave/rejoin | No overflow or duplicate identity; production start requires 4 ready players |
| Input | Nonfinite values, malformed messages, excess rate, stale command, lost focus | Rejected or bounded input; no additional simulation time |
| Movement | Floor, wall, corner, jump, platform, hazard, checkpoint, respawn | Authoritative outcomes agree and corrections remain playable |
| Reconnect | Short outage, reload, grace expiry, intentional leave, process crash | Correct seat recovery or clear interruption; stale input cleared |
| Match clock | All presets, early finish, DNF, slow load, disconnect, delayed callback | Preset cutoff authoritative; no scored action after cutoff; one finalization |
| Parties | Concurrent party joins, incomplete reservation, queue cancellation | Whole-party admission and timely capacity release |
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
