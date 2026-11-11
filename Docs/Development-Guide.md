# Development guide

Read [documentation index](README.md) for scope, architecture, gates and outstanding work.

## Run

Use Node 22.19 or newer supported LTS. Run `npm ci`, then `npm run dev`. Open http://localhost:5173 in multiple browser windows and select Join playground. The room server listens on port 2568. WASD/arrows move and Space jumps.

Run `npm run check` for type checking, shared simulation regression tests and production bundles. Run `npm run start -w @chaos/server` after building to start the server bundle.

Run `npm run smoke` after building to verify movement, jumping, spawn reuse, capacity, and disposal across three room lifecycles. It starts and stops its own built server on port 2599. Set `SMOKE_PORT` to use a different port. Port 2568 is the application default because 2567 was already occupied during setup. GitHub Actions runs a clean install, `npm run check`, and `npm run smoke`.

Installation on this machine used `npm install --cache D:/games/unknown/.npm-cache` because the system drive cache ran out of space. The cache is ignored by version control. A patched esbuild override is committed to address the dependency audit finding.

Set `PORT` for the server and `VITE_SERVER_URL` for the client when using a custom port or a separate server host. In development the client defaults to the hostname serving the page on port 2568. Production builds default to localhost unless configured at build time. Production hosting must terminate HTTPS/WSS.

For the four-player playtest, run `npm run dev:lan` on the host and share its local network URL on port 5173. Use a trusted local network and allow inbound TCP 5173 and 2568 on the host if its firewall blocks the test. See the [browser playtest checklist](Validation-and-Release.md#phase-1-four-player-browser-playtest).

Click the arena after joining to enable mouse look. Press Escape to release the mouse. Movement is relative to the camera. Reloading the same tab attempts to recover the seat during the 30-second reconnect window. Use Leave playground to release the seat immediately.

Start the server with `PLAYGROUND_TELEMETRY=1` and open the client with `?diagnostics` to see request RTT, connected and reserved seats, the largest server input backlog, this client's unacknowledged inputs, latest simulation step duration and received state updates per second. The smoke test takes roughly 35 seconds because it checks the full reservation window.
