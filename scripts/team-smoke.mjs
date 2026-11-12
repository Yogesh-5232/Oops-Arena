/**
 * Teamwork Madness with SDK bots: four bots split 2v2, one pushing and one
 * holding the next gate's plate on each team, until a crate is delivered.
 *
 *   npm run smoke:team                 starts its own built server (half-speed clock) and asserts a delivery
 *   TEAM_SMOKE_SERVER=http://localhost:2610 TEAM_SMOKE_HUMANS=1 npm run smoke:team
 *                                      uses a running server and waits for one browser guest to join and ready up
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { ARENA_BUILD, TEAM_RULES, laneX, plateCenter } from '@chaos/shared';

const external = process.env.TEAM_SMOKE_SERVER;
const humans = Number(process.env.TEAM_SMOKE_HUMANS ?? 0);
const port = process.env.TEAM_SMOKE_PORT ?? '2601';
const endpoint = external ?? `http://127.0.0.1:${port}`;
const server = external ? undefined : spawn(process.execPath, ['apps/server/dist/main.js'], {
  env: { ...process.env, NODE_ENV: 'test', SHORT_PARTY_TEST_SCALE: '0.5', PORT: port },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sdk = new Client(endpoint);
const rooms = [];

async function until(check, message, timeout = 5000) {
  const deadline = performance.now() + timeout;
  while (!await check()) {
    assert.ok(performance.now() < deadline, message);
    await delay(25);
  }
}

async function join(connect) {
  const room = await connect;
  rooms.push(room);
  await until(() => room.state.guests?.has(room.sessionId), 'guest state did not arrive');
  return room;
}

/** Steers a bot every tick: the pusher lines up behind its crate and pushes; the holder stands on the next gate's plate. */
function drive(room, role) {
  const input = room.input({ mode: 'reliable' });
  const timer = setInterval(() => {
    const me = room.state.players.get(room.sessionId);
    const guest = room.state.guests.get(room.sessionId);
    if (!me || !guest || room.state.arenaId !== 'team' || room.state.phase !== 'round') return;
    const team = guest.team;
    const cargo = team === 1 ? room.state.cargo1 : room.state.cargo0;
    const back = cargo + TEAM_RULES.cargoHalf[2] + 0.5;
    let target;
    let push = false;
    if (role === 'push') {
      const lined = Math.abs(me.x - laneX(team)) < 0.4 && me.z >= back - 0.05;
      target = lined ? [laneX(team), back - 1] : [laneX(team), back + 1.2];
      push = lined;
    } else {
      const gate = TEAM_RULES.gates.findIndex(z => cargo > z - TEAM_RULES.cargoHalf[2]);
      target = plateCenter(team, gate < 0 ? TEAM_RULES.gates.length - 1 : gate);
    }
    const dx = target[0] - me.x;
    const dz = target[1] - me.z;
    const length = Math.hypot(dx, dz);
    const scale = push || length > 0.15 ? 1 / Math.max(1, length) : 0;
    Object.assign(input.data, { x: push ? 0 : dx * scale, z: push ? -1 : dz * scale, jump: false });
    input.send();
  }, 1000 / 30);
  return () => clearInterval(timer);
}

const stops = [];
try {
  await until(async () => {
    if (server) assert.equal(server.exitCode, null, 'test server exited early');
    try { return (await fetch(`${endpoint}/__healthcheck`)).ok; } catch { return false; }
  }, 'server did not listen');
  const host = await join(sdk.create('private-dash', { capacity: 4 + humans, build: ARENA_BUILD }));
  const bots = [host];
  for (let i = 0; i < 3; i++) bots.push(await join(sdk.joinById(host.state.code, { build: ARENA_BUILD })));
  host.send('preset', 'team');
  await until(() => host.state.preset === 'team', 'host could not pick the Teamwork preset');
  for (const bot of bots) bot.send('ready', true);
  if (humans > 0) {
    console.log(`Room code ${host.state.code}: join from the browser and press Ready.`);
    await until(() => {
      let ready = 0;
      host.state.guests.forEach(guest => { if (guest.ready && guest.connected) ready++; });
      return ready >= 4 + humans;
    }, 'browser guest did not ready up', 300_000);
  }
  await until(() => {
    let ready = 0;
    host.state.guests.forEach(guest => { if (guest.ready) ready++; });
    return ready >= 4 + humans;
  }, 'bots did not ready up');
  host.send('start');
  await until(() => host.state.phase === 'countdown', 'match did not start');
  // Within each team, the first bot pushes and the second holds plates.
  const seen = [0, 0];
  for (const bot of bots) {
    const team = host.state.guests.get(bot.sessionId).team;
    assert.ok(team === 0 || team === 1, 'every racer has a team');
    stops.push(drive(bot, seen[team]++ === 0 ? 'push' : 'hold'));
  }
  await until(() => host.state.phase === 'round', 'round did not begin', 15_000);
  let openedGate = false;
  let last = 0;
  await until(() => {
    openedGate ||= host.state.gates !== 0;
    if (performance.now() - last > 2000) {
      last = performance.now();
      console.log(`${host.state.phase} ${Math.ceil(host.state.remainingMs / 1000)}s · Blue ${host.state.cargo0.toFixed(1)} · Red ${host.state.cargo1.toFixed(1)} · gates ${host.state.gates.toString(2)}`);
    }
    return host.state.phase !== 'round';
  }, 'round did not end', 200_000);
  const result = JSON.parse(host.state.standings);
  for (const row of result.rows) console.log(`${row.place}. ${row.name} ${row.totalPoints} pts · ${row.rounds[0]?.summary}`);
  assert.ok(openedGate, 'a plate opened a gate');
  assert.equal(host.state.phase, 'cooldown', 'a crate was delivered before time ran out');
  assert.ok(result.rows.some(row => /delivered/.test(row.rounds[0]?.summary ?? '')), 'results name the delivering team');
  console.log('PASS: Teamwork teams, pushing, gate plates, delivery and shared team placement');
} finally {
  stops.forEach(stop => stop());
  await Promise.allSettled(rooms.map(room => room.leave()));
  server?.kill();
}
