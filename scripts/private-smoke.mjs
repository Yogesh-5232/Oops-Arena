import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { DASH_GATES } from '@chaos/shared';

const port = process.env.PRIVATE_SMOKE_PORT ?? '2600';
const endpoint = `http://127.0.0.1:${port}`;
const sdk = new Client(endpoint);
const rooms = new Set();
const server = spawn(process.execPath, ['apps/server/dist/main.js'], {
  env: { ...process.env, PORT: port, PRIVATE_CODE_TTL_MS: '60000' }, stdio: ['ignore', 'ignore', 'inherit'],
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
      if (room.state.guests.get(room.sessionId).checkpoints > index && position().z < gate.z - 0.8) return true;
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
  const partyHost = await track(sdk.create('private-dash', { capacity: 5, party: true }));
  assert.equal(partyHost.state.party, true);
  const partyCode = partyHost.state.code;
  const party = [partyHost];
  for (let i = 0; i < 3; i++) party.push(await track(sdk.joinById(partyCode)));
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => track(sdk.joinById(partyCode))));
  const admitted = attempts.filter(attempt => attempt.status === 'fulfilled');
  assert.equal(admitted.length, 1, 'concurrent joins must claim only the remaining seat');
  await leave(admitted[0].value);
  const lastMember = await track(sdk.joinById(partyCode));
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
  await assert.rejects(() => sdk.joinById(partyCode), 'party code must close at countdown');
  await Promise.all(party.map(room => leave(room)));
  console.log('PASS: private party creation, concurrent capacity, seat reuse and whole-party kickoff');

  await assert.rejects(() => sdk.create('private-dash', { capacity: 3 }));
  const host = await track(sdk.create('private-dash', { capacity: 6 }));
  const code = host.state.code;
  assert.match(code, /^[2-9A-Z]{6}$/);
  assert.equal(host.state.capacity, 6);
  assert.ok(host.state.codeExpiresAt > Date.now());
  await assert.rejects(() => sdk.join('private-dash'), 'private room must not be discoverable by name');
  const racers = [host];
  for (let i = 1; i < 4; i++) racers.push(await track(sdk.joinById(code)));
  const waiting = await track(sdk.joinById(code));
  host.send('start');
  await delay(150);
  assert.equal(host.state.phase, 'lobby');
  for (const room of racers) room.send('ready', true);
  await until(() => racers.every(room => host.state.guests.get(room.sessionId).ready), 'ready flags were not replicated');
  racers[1].send('start');
  await delay(150);
  assert.equal(host.state.phase, 'lobby', 'only the host may start');

  const started = performance.now();
  host.send('start');
  await until(() => [...rooms].every(room => room.state.phase === 'countdown'), 'countdown did not synchronize');
  assert.equal(host.state.guests.get(waiting.sessionId).racing, false);
  await assert.rejects(() => sdk.joinById(code), 'new admissions must stop at countdown');
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
  const final = host.state.standings;
  const result = JSON.parse(final);
  assert.equal(result.interrupted, false);
  assert.equal(result.rows.length, 4);
  assert.ok(result.rows.every(row => row.finishMs !== null && row.checkpoints === 3));
  await leave(host);
  const nextHost = racers[1];
  await until(() => nextHost.state.hostId === nextHost.sessionId, 'host did not transfer after leave');
  await until(() => [...rooms].every(room => room.state.phase === 'results'), 'results window did not arrive', 115000);
  assert.ok([...rooms].every(room => room.state.standings === final), 'clients received different standings');
  await until(() => [...rooms].every(room => room.state.phase === 'lobby'), 'lobby did not reopen', 13000);
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 119500 && elapsed < 122000, `match took ${Math.round(elapsed)}ms`);
  assert.ok([...rooms].every(room => !room.state.guests.get(room.sessionId).ready));
  await assert.rejects(() => sdk.joinById(code), /room code expired/i);
  console.log('PASS: private code and expiry, host-only start, waiting guest, locked roster, token reconnect, Dash finish, shared results, host transfer and fixed deadline');

  for (const room of rooms) room.send('ready', true);
  await until(() => [...rooms].every(room => nextHost.state.guests.get(room.sessionId).ready), 'rematch ready flags missing');
  nextHost.send('start');
  await until(() => waiting.state.phase === 'countdown' && waiting.state.guests.get(waiting.sessionId).racing, 'rematch did not start');
  for (const room of [...rooms]) if (room !== waiting) await leave(room);
  await until(() => waiting.state.phase === 'cooldown', 'interrupted rematch did not close scoring', 7000);
  assert.equal(JSON.parse(waiting.state.standings).interrupted, true);
  console.log('PASS: same-room rematch and interrupted-session result');
} finally {
  await Promise.allSettled([...rooms].map(room => room.leave()));
  server.kill();
}
