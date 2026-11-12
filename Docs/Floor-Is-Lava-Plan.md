# Floor Is Lava — technical implementation plan (Phase 6, step 1)

Status 2026-11-12: milestones A–D implemented; E (docs) done. Tuning and playtests remain.

Working plan for the third arena. Numbers are starting values to tune by feel. Testing details are owned separately; this plan lists only the minimum unit coverage needed to keep `npm run check` meaningful.

## Gameplay contract

- Vertical tower. Players start on the base floor and climb tiers. Lava rises in steps with a 3 s warning before each rise.
- Four progress gates (checkpoint pads): T1 top y=3, T2 y=6, T3 y=9, summit y=11.5.
- Two routes per tier: a wide, slow staircase (safe) and a fast route (lift mover or dive gap).
- Early phase: touching lava respawns the player (protected by shield) at their gate pad, or at the lowest pad still above the lava, whichever is higher. Laggards are carried forward so nobody sits out.
- Closing stretch (last 25 s of the round): lava rises continuously to above the summit. Touching lava now eliminates the player for this round only: they are moved to a walled viewing balcony and can still move there. Nobody leaves the session.
- Ranking: survivors first (highest gate, then highest height reached), then eliminated players by later elimination time, then gate, then height. Equal keys share placement points (existing average-rank rule).

## Movement limits that shape geometry

From `MOVEMENT`: jump apex ≈ 1.22 units (7²/(2·20)), air time ≈ 0.7 s, run 6 u/s → ≈4 u flat jump; dive 11 u/s. Rules for authoring: rises ≤ 1.0, flat gaps ≤ 3.0 (jump) or ≤ 4.5 (dive), landing pads ≥ 2×2.

## Milestone A — shared rules (`packages/shared/src/lava.ts`)

1. `LAVA_RULES` (single object, hashed into `BUILD_RULES` like `DODGE_RULES`):
   - `keyframes`: absolute seconds → lava top y. Draft: 0–15 s y=-0.6 (floor safe); 15–20 s rise to 0.5 (floor flooded); hold to 50; 55 → 2.5; hold to 85; 90 → 5.5; hold to 115; 120 → 8.5.
   - `closingSeconds: 25`, `closingTopY: 12.5`, `warningSeconds: 3`.
   - `playerFootOffset: 1` (avatar half-height), balcony spawn points.
2. `lavaLevel(elapsedTicks, roundTicks): number` — pure, integer-tick input, linear interpolation between keyframes; closing stretch interpolates from the level at `roundTicks - closing` to `closingTopY` at `roundTicks`. Exact arithmetic only (no `Math.hypot`) so it can be sampled into the build hash.
3. `lavaWarning(elapsedTicks, roundTicks): boolean` — true within `warningSeconds` before any rise (drawing only).
4. `LAVA_BOXES`, `LAVA_MOVERS` (vertical lifts reuse mover kind `ferry`; legs vary y), `LAVA_GATES` (pads with `respawn` points), `LAVA_BALCONY` (walled box outside the tower above `closingTopY`), `lavaSpawn(slot)` on the base floor.
5. `resolveLava(player, elapsedTicks, roundTicks): 'gate' | 'respawn' | 'out' | null` — run after `simulateInput` on server and in prediction:
   - Gate touch: `player.checkpoint = max(checkpoint, gateIndex + 1)` (monotonic).
   - Contact test: `player.y - footOffset < lavaLevel` and not on balcony.
   - Early: respawn at `max(own gate pad, lowest pad above lava + 1)`; set shield, bump `respawns` (same as `movement.respawn`).
   - Closing: teleport to balcony slot spot, bump `respawns`, return `'out'`.
6. Manifest: add `lava` to `ArenaId`/`ARENAS` (`hazards: 'lava'`, gate markers kind `checkpoint`). Extend `ArenaManifest.hazards` union. Bump `PROTOCOL_VERSION` to 2 (new state fields below).
7. Known trap: `resetToSpawn` ignores `checkpoint` only when `spawn` is passed, and `step()` reads `GREYBOX_ARENA.checkpoints` for the plaza. Reset `player.checkpoint = 0` on every arena change (server `teleportPlayer`), otherwise a Lava gate index leaks into plaza respawns.
8. Unit: `lavaLevel` monotonic and hits keyframes; every gate respawn and spawn stands on a box (reuse arena test pattern); lifts reach their tier tops; jump/dive reachability check per authored step (rise ≤ 1, gap ≤ limits).

## Milestone B — server arena run (`apps/server/src/lava-arena.ts`)

- `LavaArenaRun extends ArenaRunBase<LavaStanding[]>`; setup takes `seed` (unused now, keep for variants), `startTick`, `roundTicks`, `inactiveIds`.
- `onPlayerStep`: call `resolveLava`; track per racer `{ gate, maxHeight, outMs, active }`; return gate as public progress.
- `LavaStanding = { name, gate, height, outMs: number | null, active }` in shared `short-party.ts` (to be renamed, see C).
- `setConnected` like Dodge → promote to optional method on `ArenaRun` so the room stops special-casing Dodge.
- Unit: ranking order and tie keys; disposal leaves `liveArenaRuns` at 0.

## Milestone C — generic party match (needed to schedule a third round)

The room hard-codes Dash → Dodge. Replace with playlist data:

1. Shared `PLAYLISTS`: `short: { rounds: ['dash','dodge'], countdownMs: 8000, roundMs: 140000, transitionMs: 12000, resultsMs: 15000 }`, `standard: { rounds: ['dash','lava','dodge'], 8000, 160000, 15000, 22000 }` (= 540 s). Assert totals equal `PRESETS`.
2. `PartyClock(startedAt, playlist)` replaces `ShortPartyClock`: computes per-round start/end, `acceptsScoring(roundIndex, now)`, `snapshot(now, lockedEarly)`. Keep `SHORT_PARTY_TEST_SCALE` scaling.
3. `PartyScoreboard` replaces `ShortScoreboard`: `record(roundIndex, arenaId, rows)` once per round with a tie-key per arena (dash: existing; dodge: existing; lava: `out|alive:gate:height:outMs`). Results type `PartyResults { interrupted, preset, rows: { place, name, rounds: { arenaId, summary, points }[], totalPoints }[] }` — `summary` is a short display string built server-side so the client needs no per-arena code.
4. Room: `active.runs[roundIndex]` created at round start from a factory `{ dash, dodge, lava }`; dispose at round cutoff; one generic early-lock (`allFinished`) for any arena. State gets `preset` (string) and `roundMs` (number) so prediction knows `roundTicks`.
5. Lobby: host chooses preset in the `start` message (`'short' | 'standard'`), validated server-side; default `short`.
6. Regression: Short keeps its 315 s timeline and current scores (existing tests must pass unchanged in behavior).

## Milestone D — client

- `ArenaView`: lava surface = one box spanning the tower footprint from y=-1 to `lavaLevel`, red-orange with glow; tint to warning color while `lavaWarning`. Pose it from `arenaStartTick`/`roundMs` like Dodge hazards. Gate pads already render as markers. Balcony renders from boxes.
- Prediction (`main.ts` `predictStep`): `if (arena.hazards === 'lava') resolveLava(state, state.simTick - arenaStartTick, roundTicks)`. Gate predictStep on Lava round phase like Dodge.
- HUD (`private-ui.ts`): phase labels from playlist (`Next: Floor Is Lava`), Lava line `Floor Is Lava · 42s · gate 2/4` and `Out — watching from the balcony`; results rows from `rounds[].summary`; preset picker for the host (Short / Standard).
- Camera: check follow camera pitch for a vertical arena; raise default pitch only if climbing reads poorly.

## Milestone E — wrap-up

- Docs: Game-Design (Lava contract), Technical-Scope, Status-and-Decisions, Implementation-Phases progress line.
- Smoke script: add a Standard run at reduced speed (owner of testing decides depth).

## Order and size

A → B → C → D → E. A and B are self-contained; C is the riskiest refactor (touches room, scoreboard, results UI) and must keep Short identical. Each milestone lands as its own commit with `npm run check` green.

## Open questions

- Should the Short preset ever include Lava (e.g. random second round)? Default: no, Lava is Standard/Full only.
- Balcony players: free movement only, or also a small toy (e.g. drop harmless markers)? Default: free movement only.
