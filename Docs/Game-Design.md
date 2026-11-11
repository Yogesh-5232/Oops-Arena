# Game design and release scope

## Product requirements

Chaos Playground is a colorful third-person browser party game for groups of friends and public groups. Target desktop keyboard/mouse first. Support 4–12 players at match start. Keep newcomers active, recover quickly from mistakes and return every player for the next round. A small shared plaza connects four independently loaded arenas. Cosmetics never alter competitive behavior.

## Session budgets

| Preset | Countdown | Round windows | Transitions | Final results | Total |
|---|---:|---:|---:|---:|---:|
| Quick | 5 s | 105 s | 0 s | 10 s | 120 s |
| Short | 8 s | 2 × 140 s | 12 s | 15 s | 315 s |
| Standard | 8 s | 3 × 160 s | 2 × 15 s | 22 s | 540 s |
| Full | 8 s | 3 × 170 s + 150 s finale | 3 × 12 s | 26 s | 730 s |

All active windows include countdown, loading after kickoff, gameplay, transitions and results. Queue time is outside the match. The server owns every cutoff. Quick uses a compact layout or accelerated hazard schedule. Validate which modes can meet its pacing before exposing them. Keep outcome-locked time playable. Use an existing arena variation for the Full finale and regular score weighting.

## MVP arenas

| Arena | Core decision | Implementation boundary |
|---|---|---|
| Ultimate Obstacle Dash | Route and jump timing | Two or three checkpoints, controlled moving hazards, validated finish order and progress-ranked DNFs |
| Floor Is Lava | Climb and choose safe routes | Early respawn, progress gates, brief elimination near the end, return next round |
| Dodge Everything | Read telegraphs and safe gaps | Two initial hazard families, authored seeded combinations, short recovery |
| Teamwork Madness | Coordinate cargo movement or handoffs | Mirrored lanes, capped contributions, server ownership and recoverable mistakes |

For two-team modes, keep team size difference at most one. Cap active cargo contributors to the smaller team size and rotate the extra side across rematches. Test 5- and 11-player sessions explicitly. Use a relay handoff variant if cargo fails clarity, fairness or responsiveness tests.

## Controls, scoring and engagement

Target move, jump, dive (a quick second jump tap in the air), contextual grab/interact and emote. Add camera sensitivity and remapping as the UI matures. Favor predictable knockback, short recovery and protected spawns. Race finishers receive a playable cooldown. Elimination is limited to a short closing stretch and never removes a player from the full session.

Normalize race placement by roster size. A starting candidate is `2 + round(10 * (N - rank) / (N - 1))` for `N >= 4`. Rank DNFs by validated progress and assign average ranks to ties. Compare team scores such as 8/4 with 6/6 draws against actual leaderboard swings before locking balance. Keep extended statistics in the hub and result overlays brief.

## Release boundaries

| Milestone | Scope |
|---|---|
| First playable | Greybox, four browsers, responsive authoritative movement, platform, hazard, respawn, prediction, reconnect and 12-seat sanity check |
| MVP must-have | Four arenas, plaza, 4–12 players, private presets/codes, one party-aware public Short queue, ready state, rematch, scoring, odd-team support, server timing, basic colors/emotes and desktop validation |
| Should-have | Authored variants, short voting flow, remapping, sensitivity, accessible warning cues and objective highlights |
| Post-MVP | Persistent XP/cosmetics, additional regions and queues, Giant Ball Race, Capture the Flag, Balance Chaos and Treasure Hunt |
| Removed from initial scope | Freeform cooperative lifting, huge open world, bespoke finale systems, automatic funniest-moment selection, voice chat, trading, crafting and complex inventory |

Giant Ball Race and Balance Chaos need dedicated physics prototypes. Capture the Flag needs possession, spawn protection and reset rules. Treasure Hunt offers a lower-complexity variety option after density and clue readability tests.
