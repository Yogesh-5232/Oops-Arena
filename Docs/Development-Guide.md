# Development guide

Read [documentation index](README.md) for scope, architecture, gates and outstanding work.

## Run

Use Node 22.19 or newer supported LTS. Run `npm ci`, then `npm run dev`. Open http://localhost:5173 in multiple browser windows and select Join playground. The room server listens on port 2568. WASD/arrows move and Space jumps; tap Space again within about a third of a second of jumping to dive. The greybox has a low step and a higher platform (each one jump up), a wall, an island across a gap, an east ledge across a pit reached on a shuttling ferry, and a pusher in the south lane that glows yellow before it slams east and knocks you back. Blue pads on the island and the east ledge are checkpoints: walking off an edge respawns you at the last one you touched (or your spawn).

Run `npm run check` for type checking, shared simulation regression tests and production bundles. Run `npm run start -w @chaos/server` after building to start the server bundle.

Run `npm run smoke` after building to verify movement, jumping, input bounds, prediction agreement, remote smoothing, backlog recovery after a stall, the hover cheat, the pusher/ferry/checkpoint course, spawn reuse, capacity, and disposal across three room lifecycles. It runs through tsx so it can import the shared simulation. It starts and stops its own built server on port 2599. Set `SMOKE_PORT` to use a different port. Port 2568 is the application default because 2567 was already occupied during setup. GitHub Actions runs a clean install, `npm run check`, and `npm run smoke`.

Installation on this machine used `npm install --cache D:/games/unknown/.npm-cache` because the system drive cache ran out of space. The cache is ignored by version control. A patched esbuild override is committed to address the dependency audit finding.

Set `PORT` for the server and `VITE_SERVER_URL` for the client when using a custom port or a separate server host. In development the client defaults to the hostname serving the page on port 2568. Production builds default to localhost unless configured at build time. Production hosting must terminate HTTPS/WSS.

For the four-player playtest, run `npm run dev:lan` on the host and share its local network URL on port 5173. Use a trusted local network and allow inbound TCP 5173 and 2568 on the host if its firewall blocks the test. See the [browser playtest checklist](Validation-and-Release.md#phase-1-four-player-browser-playtest).

Click the arena after joining to enable mouse look. Press Escape to release the mouse. Movement is relative to the camera. Reloading the same tab attempts to recover the seat during the 30-second reconnect window. Use Leave playground to release the seat immediately.

To feel the game over a slow connection, run `npm run lag -- --rtt 100 --jitter 20 --loss 1` beside `npm run dev` and open http://localhost:5173/?server=http://localhost:2569&diagnostics. The relay listens on 2569 (`--port`), forwards to 2568 (`--target`), delays each direction by half the round trip plus up to `--jitter` ms, and stalls `--loss` percent of chunks for 250 ms with everything behind them, as a TCP retransmit would. The `?server=` override works only in development builds.

Run `npm run lagtest` after building to drive a predicting player and a watching player through the relay at 40, 100 and 180 ms (plus 180 ms without stalls). It prints corrections, worst position correction and how often the watcher saw the mover freeze, then runs the course (pusher hit, ferry ride, east checkpoint, respawn) with a fresh player and prints its corrections and which parts happened. It fails only if prediction does not settle exactly on the server state. `LAGTEST_FRAMES` sets the run length (default 600 frames, about 10 seconds per profile).

Start the server with `PLAYGROUND_TELEMETRY=1` and open the client with `?diagnostics` to see request RTT, connected and reserved seats, the largest server input backlog, this client's unacknowledged inputs, prediction corrections per second with the worst position correction and drift status (matched, jitter or diverging), latest simulation step duration, received state updates per second and patch jitter against the 100 ms remote interpolation buffer. The smoke test takes roughly 35 seconds because it checks the full reservation window.

To play Quick Chaos, choose a capacity of 4–12 and select **Create private race**. Friends enter the six-character code and select **Join private race**. When the host and at least three other guests are ready, the host can start. Follow the two marked gaps and cross the finish line. After results, ready up in the same room to race again. Codes expire after 30 minutes by default. Set `PRIVATE_CODE_TTL_MS` on the server to change the invite window.

Run `npm run smoke:private` after building to verify the live private room flow. It uses port 2600 by default and takes just over two minutes. Set `PRIVATE_SMOKE_PORT` to avoid a port conflict.
