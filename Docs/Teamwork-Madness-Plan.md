# Teamwork Madness — technical implementation plan (Phase 6, step 2)

Status 2026-11-12: first playable greybox implemented (cargo variant). Playable as the **Teamwork Only** private preset. Also the third round of the Full Party preset. Tuning, 5- and 11-player playtests and the cargo-vs-relay decision remain.

Numbers are starting values to tune by feel.

## Gameplay contract

- Two mirrored lanes split by a wall: **Blue** (team 0, x < 0) and **Red** (team 1, x > 0). Each team pushes its own crate from its start toward a goal line (toward −z). Teams cannot reach each other's lane, so opponents cannot grief your crate.
- The crate is server-owned and moves only along its lane's center line ("constrained cargo"). It is 2.4 × 1.6 × 2.4: too tall to jump onto, so players push it rather than ride it. Players collide with it like any box.
- **Pushing:** a player pressed flush against the back face, steering toward the goal, counts as a pusher. Crate speed by pusher count is 0, 1.5, 2.1, 2.5, 2.8, 3.0, 3.2 u/s. Counted pushers are **capped at the smaller team's connected size**, so a 3v2 team gains no pushing advantage. The cap is recomputed when someone disconnects.
- **Gates and plates:** each lane has three gate lines (z = 4, −6, −16). A closed gate stops a crate whose front has not reached it. Each gate has a pressure plate 4 units past it at the lane's outer edge. Standing on the plate opens that gate, and it stays open for 4 s after the last touch. A team that splits roles (one runs ahead and holds the plate, the others push) is much faster. A team of one can still progress by stepping on the plate and running back. A crate already partly through the gate can always finish crossing.
- **Recoverable mistakes:** a crate with no pusher for 1 s rolls back at 0.6 u/s, but never behind the last gate it fully cleared.
- **Disruption:** one sweeper bar per lane at z = 9 and z = −13 crosses the lane on the same mirrored timing. It can be jumped, and a hit knocks pushers off the crate.
- **End:** the first delivery decides the round, and the rest of the round is cooldown. Otherwise the timer ends it.
- **Scoring:** every member shares their team's outcome. Delivered beats not delivered, an earlier delivery beats a later one, then crate progress decides. Equal team outcomes share placement points, using the existing average-rank rule, so a 2v2 win is 10 points for each winner and 4 for each loser. Disconnected players rank last as DNF.
- **Teams:** alternate down the roster after rotating it by the room's match count. Sizes never differ by more than one, and with an odd roster the extra seat changes hands across rematches. The team is fixed for the whole match and replicated on each guest (`team`, −1 outside a match).

## Implementation

- `packages/shared/src/team.ts`: lane boxes, sweepers, plates, `TEAM_RULES` (hashed into `BUILD_RULES`), `teamSpawn(slot, team)`, `teamWorld(cargo0, cargo1)` (lanes plus both crates, cached), `resolveCargo` (pushes a player out of a crate that moved into it), `isPushing`, `plateUnder`, `stepCargo`, and `assignTeams`. Manifest `team` (`hazards: 'team'`, plate and goal markers). `ArenaManifest.spawn` takes an optional team. Protocol version 5.
- `apps/server/src/team-arena.ts`: `TeamArenaRun`. It is the first arena with its own server world state. `update` moves both crates from the pushes recorded during the previous tick's player steps and counts down the plate latches. `playerStep` resolves crate overlap, records plates and pushes, and returns crate progress as a percentage. `objective()` exposes the crates and the gate mask.
- `ArenaRun` gained `spawn(slot, id)`, `boxes()` (the collision world now, which defaults to the manifest), an optional `input` on `playerStep`, `teams` in the setup, and optional `objective()`. The room publishes `cargo0`, `cargo1` and `gates` into the state every tick.
- Client: prediction collides with `teamWorld` at the latest replicated crate positions and runs `resolveCargo`. `ArenaView` draws crates and gate bars (a red bar while closed, a green floor line while open). Remote avatars wear their team color in the team arena, and you stay yellow. The HUD shows both crates' progress and the plate hint.

## Known trade-offs

- Prediction collides with crates at their last replicated position. Crates move at most 3.2 u/s, so a pusher's predicted contact is off by a few centimetres per update. That's a small correction while pushing, and it needs measuring in the lag test.
- Crates are not mover-attached, so standing on top of one (from a dive) does not carry you.
- Sweepers pass through the crates visually.

## Validation so far

- Unit tests: spawns, mirror symmetry, pushing contact, crate push-out, gate/plate/rollback rules, speed cap, plate ownership, team balance and rotation, arena-run lifecycle, delivery and shared team points.
- `npm run smoke:team`: four SDK bots, 2v2, one pusher and one plate holder per team, on a half-speed clock. Blue delivered at 41 s, gates opened from plates, and the teams shared 10 and 4 points.
- One browser tab plus four bots on a half-speed clock: crates, gates, team colors and the HUD rendered with no console errors.

## Next

1. Playtest 2v2 and 3v2 in browsers. Then explicitly test 5 and 11 players, as the design requires: are roles clear, does the plate hint teach the gate, is idle time acceptable?
2. Tune course length, crate speeds, latch and rollback against the 105–160 s round lengths.
3. Decide cargo vs relay handoff from those playtests (see Status-and-Decisions).
4. ~~Add Teamwork to the Full preset with its finale.~~ Done: Full runs Teamwork as its third round.
