import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { ARENA_BUILD, DASH_GATES } from '@chaos/shared';

const port = process.env.PRIVATE_SMOKE_PORT ?? '2600';
const testScale = 0.1;
const endpoint = `http://127.0.0.1:${port}`;
const sdk = new Client(endpoint);
const rooms = new Set();
const server = spawn(process.execPath, ['apps/server/dist/main.js'], {
  env: {
    ...process.env, NODE_ENV: 'test', SHORT_PARTY_TEST_SCALE: String(testScale),
    PORT: port, PRIVATE_CODE_TTL_MS: '10000', PLAYGROUND_TELEMETRY: '1',
  }, stdio: ['ignore', 'ignore', 'inherit'],
});

async function until(check, message, timeout = 5000) {
  const deadline = performance.now() + timeout;
  while (!await check()) {
    assert.ok(performance.now() < deadline, message);
    await delay(25);
  }
}

async function track(connect) {
  const room = await connect;
  rooms.add(room);
  await until(() => room.state.guests?.has(room.sessionId), 'guest state did not arrive');
  return room;
}

async function leave(room, consented = true) {
  await room.leave(consented);
  rooms.delete(room);
}

async function diagnostics(room) {
  return room.request('diagnostics', undefined, { timeout: 1000 });
}

/** Samples server arena runs until stopped: one room's match must never hold more than one. */
function watchArenaRuns(room) {
  const seen = { max: 0, arenas: new Set(), next: new Set() };
  let running = true;
  const done = (async () => {
    while (running) {
      try { seen.max = Math.max(seen.max, (await diagnostics(room)).arenaRuns); } catch {}
      seen.arenas.add(room.state.arenaId);
      seen.next.add(`${room.state.phase}:${room.state.nextArenaId}`);
      await delay(100);
    }
  })();
  return async () => { running = false; await done; return seen; };
}

async function drive(room) {
  const input = room.input({ mode: 'reliable' });
  const position = () => room.state.players.get(room.sessionId);
  const command = (x, z) => {
    Object.assign(input.data, { x, z, jump: false });
    input.send();
  };
  for (const [index, gate] of DASH_GATES.entries()) {
    await until(() => {
      const delta = gate.x - position().x;
      if (Math.abs(delta) < 0.55) return true;
      command(Math.sign(delta), 0);
      return false;
    }, `failed to line up with gate ${index + 1}`);
    await until(() => {
      if (room.state.guests.get(room.sessionId).progress > index && position().z < gate.z - 0.8) return true;
      command(0, -1);
      return false;
    }, `failed to cross gate ${index + 1}`);
  }
}

try {
  await until(async () => {
    assert.equal(server.exitCode, null, 'private test server exited early');
    try { return (await fetch(`${endpoint}/__healthcheck`)).ok; }
    catch { return false; }
  }, 'private test server did not listen');
  const partyHost = await track(sdk.create('private-dash', { capacity: 5, party: true, build: ARENA_BUILD }));
  assert.equal(partyHost.state.party, true);
  const partyCode = partyHost.state.code;
  const party = [partyHost];
  for (let i = 0; i < 3; i++) party.push(await track(sdk.joinById(partyCode, { build: ARENA_BUILD })));
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => track(sdk.joinById(partyCode, { build: ARENA_BUILD }))));
  const admitted = attempts.filter(attempt => attempt.status === 'fulfilled');
  assert.equal(admitted.length, 1, 'concurrent joins must claim only the remaining seat');
  await leave(admitted[0].value);
  const lastMember = await track(sdk.joinById(partyCode, { build: ARENA_BUILD }));
  party.push(lastMember);
  await until(() => partyHost.state.guests.has(lastMember.sessionId), 'fifth member did not replicate');
  for (const room of party.slice(0, 4)) room.send('ready', true);
  await until(() => party.slice(0, 4).every(room => partyHost.state.guests.get(room.sessionId).ready),
    'party readiness did not replicate');
  partyHost.send('start');
  await delay(200);
  assert.equal(partyHost.state.phase, 'lobby', 'four ready members cannot leave a fifth behind');
  lastMember.send('ready', true);
  await until(() => partyHost.state.guests.get(lastMember.sessionId).ready, 'fifth member did not ready up');
  partyHost.send('start');
  await until(() => party.every(room => room.state.phase === 'countdown'), 'party did not enter countdown');
  assert.ok(party.every(room => partyHost.state.guests.get(room.sessionId).racing));
  await assert.rejects(() => sdk.joinById(partyCode, { build: ARENA_BUILD }), 'party code must close at countdown');
  await Promise.all(party.map(room => leave(room)));
  console.log('PASS: private party creation, concurrent capacity, seat reuse and whole-party kickoff');


  await assert.rejects(() => sdk.create('private-dash', { capacity: 3, build: ARENA_BUILD }));
  await assert.rejects(() => sdk.create('private-dash', { capacity: 6, build: 'p0-stale' }), /out of date/i);
  await assert.rejects(() => sdk.create('private-dash', { capacity: 6 }), /out of date/i, 'a client without a build id must be rejected');
  const host = await track(sdk.create('private-dash', { capacity: 6, build: ARENA_BUILD }));
  const code = host.state.code;
  assert.match(code, /^[2-9A-Z]{6}$/);
  assert.equal(host.state.capacity, 6);
  assert.ok(host.state.codeExpiresAt > Date.now());
  await assert.rejects(() => sdk.join('private-dash'), 'private room must not be discoverable by name');
  await assert.rejects(() => sdk.joinById(code, { build: 'p0-stale' }), /out of date/i, 'stale builds must not join');
  assert.equal(host.state.arenaId, 'plaza');
  assert.equal(host.state.nextArenaId, 'dash', 'the lobby must announce the first arena for prefetch');
  const racers = [host];
  for (let i = 1; i < 4; i++) racers.push(await track(sdk.joinById(code, { build: ARENA_BUILD })));
  const waiting = await track(sdk.joinById(code, { build: ARENA_BUILD }));
  host.send('start');
  await delay(150);
  assert.equal(host.state.phase, 'lobby');
  for (const room of racers) room.send('ready', true);
  await until(() => racers.every(room => host.state.guests.get(room.sessionId).ready), 'ready flags were not replicated');
  racers[1].send('start');
  await delay(150);
  assert.equal(host.state.phase, 'lobby', 'only the host may start');

  const started = performance.now();
  const stopWatching = watchArenaRuns(racers[2]);
  host.send('start');
  await until(() => [...rooms].every(room => room.state.phase === 'countdown'), 'countdown did not synchronize');
  assert.equal(host.state.guests.get(waiting.sessionId).racing, false);
  await assert.rejects(() => sdk.joinById(code, { build: ARENA_BUILD }), 'new admissions must stop at countdown');
  const dropped = racers[1];
  const id = dropped.sessionId;
  const token = dropped.reconnectionToken;
  dropped.reconnection.enabled = false;
  await leave(dropped, false);
  await until(() => !host.state.guests.get(id).connected, 'drop did not mark the seat disconnected');
  racers[1] = await track(sdk.reconnect(token));
  assert.equal(racers[1].sessionId, id);
  await until(() => racers.every(room => room.state.phase === 'round'), 'round did not synchronize', 7000);
  await Promise.all(racers.map(drive));
  await until(() => host.state.phase === 'cooldown', 'all finishers did not enter cooldown');
  const dashResult = JSON.parse(host.state.standings);
  assert.equal(dashResult.interrupted, false);
  assert.equal(dashResult.rows.length, 4);
  assert.ok(dashResult.rows.every(row => /^Dash \d/.test(row.rounds[0]?.summary ?? '')), 'every racer must finish Dash');
  await leave(host);
  const nextHost = racers[1];
  await until(() => nextHost.state.hostId === nextHost.sessionId, 'host did not transfer after leave');
  await until(() => [...rooms].every(room => room.state.phase === 'results'), 'Short Party results did not arrive', 40000);
  const final = waiting.state.standings;
  const combined = JSON.parse(final);
  assert.ok(combined.rows.every(row => row.rounds.length === 2 && row.rounds.every(Boolean)), 'both arena results must be present');
  assert.ok([...rooms].every(room => room.state.standings === final), 'clients received different combined standings');
  await until(() => [...rooms].every(room => room.state.phase === 'lobby'), 'lobby did not reopen', 3000);
  const elapsed = performance.now() - started;
  const seen = await stopWatching();
  assert.equal(seen.max, 1, 'exactly one arena run may be live during a match');
  assert.deepEqual([...seen.arenas].sort(), ['dash', 'dodge', 'plaza']);
  for (const expected of ['countdown:plaza', 'round:plaza', 'transition:dodge', 'lobby:dash']) {
    assert.ok(seen.next.has(expected), `next arena ${expected} was not announced (saw ${[...seen.next].join(', ')})`);
  }
  assert.equal((await diagnostics(waiting)).arenaRuns, 0, 'arena runs must be released when the match completes');
  const expected = 315_000 * testScale;
  assert.ok(elapsed >= expected - 1500 && elapsed < expected + 2000, `match took ${Math.round(elapsed)}ms`);
  assert.ok([...rooms].every(room => !room.state.guests.get(room.sessionId).ready));
  await assert.rejects(() => sdk.joinById(code, { build: ARENA_BUILD }), /room code expired/i);
  console.log('PASS: private code and expiry, readiness, locked roster, token reconnect, Dash + Dodge, shared standings, host transfer and fixed Short deadline');

  for (const room of rooms) room.send('ready', true);
  await until(() => [...rooms].every(room => nextHost.state.guests.get(room.sessionId).ready), 'rematch ready flags missing');
  nextHost.send('start');
  await until(() => waiting.state.phase === 'countdown' && waiting.state.guests.get(waiting.sessionId).racing, 'rematch did not start');
  for (const room of [...rooms]) if (room !== waiting) await leave(room);
  await until(() => waiting.state.phase === 'results', 'interrupted Short Party did not finalize', 40000);
  assert.equal(JSON.parse(waiting.state.standings).interrupted, true);
  await until(() => waiting.state.phase === 'lobby', 'interrupted rematch did not reopen the lobby', 3000);
  assert.equal((await diagnostics(waiting)).arenaRuns, 0, 'arena runs must be released after an interrupted match');
  console.log('PASS: same-room rematch and interrupted-session result');
  await leave(waiting);

  // Full Party: four rounds (the last a shorter Dodge finale) on one fixed 730-second timeline.
  const fullHost = await track(sdk.create('private-dash', { capacity: 4, build: ARENA_BUILD }));
  const full = [fullHost];
  for (let i = 1; i < 4; i++) full.push(await track(sdk.joinById(fullHost.state.code, { build: ARENA_BUILD })));
  fullHost.send('preset', 'full');
  await until(() => full.every(room => room.state.preset === 'full'), 'Full preset was not selected');
  for (const room of full) room.send('ready', true);
  await until(() => full.every(room => fullHost.state.guests.get(room.sessionId).ready), 'Full ready flags missing');
  const fullStarted = performance.now();
  const stopFull = watchArenaRuns(full[1]);
  fullHost.send('start');
  await until(() => fullHost.state.phase === 'countdown', 'Full Party did not start');
  const teamSizes = [0, 0];
  fullHost.state.guests.forEach(guest => teamSizes[guest.team]++);
  assert.deepEqual(teamSizes, [2, 2], 'Full Party assigns two even teams for Teamwork');
  await until(() => fullHost.state.arenaId === 'finale' && fullHost.state.phase === 'round', 'finale did not start', 80_000);
  assert.equal(fullHost.state.roundTicks, Math.round(150_000 * testScale / (1000 / 30)), 'the finale has its own shorter length');
  await until(() => fullHost.state.phase === 'lobby', 'Full Party did not return to the lobby', 30_000);
  const fullElapsed = performance.now() - fullStarted;
  const fullSeen = await stopFull();
  const fullResult = JSON.parse(fullHost.state.standings);
  assert.deepEqual(fullResult.arenas, ['dash', 'lava', 'team', 'finale']);
  for (const row of fullResult.rows) {
    assert.ok(row.rounds.length === 4 && row.rounds.every(Boolean), `${row.name} is missing a round result`);
    assert.match(row.rounds[3].summary, /^Finale /);
  }
  assert.deepEqual([...fullSeen.arenas].sort(), ['dash', 'finale', 'lava', 'plaza', 'team']);
  assert.equal(fullSeen.max, 1, 'exactly one arena run may be live during a Full match');
  assert.equal((await diagnostics(fullHost)).arenaRuns, 0, 'arena runs must be released after a Full match');
  const fullExpected = 730_000 * testScale;
  assert.ok(fullElapsed >= fullExpected - 1500 && fullElapsed < fullExpected + 2500, `Full match took ${Math.round(fullElapsed)}ms`);
  console.log('PASS: Full Party preset: Dash, Lava, Teamwork and Dodge finale scored on the fixed 730 s timeline');
} finally {
  await Promise.allSettled([...rooms].map(room => room.leave()));
  server.kill();
}
