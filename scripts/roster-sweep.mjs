/**
 * Roster-size sweep (Phase 6 exit criterion): every roster size from 2 to 12
 * plays every single-arena mode, with bots that actually play — Dash bots run
 * the gates in three lanes, Teamwork bots push and hold plates, Lava and Dodge bots stand
 * their ground. One private room per size, all sizes at once, the same rooms
 * rematching through each mode.
 *
 * Each match must start with the whole roster racing, keep every guest in the
 * session, score every racer exactly once with points from 2 to 12, release
 * its arena run, and return to the lobby on time. Teamwork teams must differ
 * by at most one. Prints a points table per mode and size for score tuning.
 *
 *   npm run sweep:roster
 *   SWEEP_MODES=team,dash SWEEP_SIZES=5,11 SWEEP_SCALE=0.25 npm run sweep:roster
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { ARENA_BUILD, DASH_GATES, PLAYLISTS, TEAM_RULES, laneX, plateCenter, playlistMs } from '@chaos/shared';

const port = process.env.SWEEP_PORT ?? '2602';
const scale = Number(process.env.SWEEP_SCALE ?? 0.25);
const modes = (process.env.SWEEP_MODES ?? 'dash,lava,dodge,team').split(',');
const sizes = (process.env.SWEEP_SIZES ?? '2,3,4,5,6,7,8,9,10,11,12').split(',').map(Number);
const endpoint = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['apps/server/dist/main.js'], {
  env: { ...process.env, NODE_ENV: 'test', SHORT_PARTY_TEST_SCALE: String(scale), PORT: port, PLAYGROUND_TELEMETRY: '1' },
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

/** Unit-length steer toward a point, or nothing when already there. */
function toward(me, x, z) {
  const dx = x - me.x;
  const dz = z - me.z;
  const length = Math.hypot(dx, dz);
  return length < 0.15 ? [0, 0] : [dx / Math.max(1, length), dz / Math.max(1, length)];
}

/** One bot's steering for the current round; `role` is its Teamwork job ('push' or 'hold'). */
function steer(room, role, lane) {
  const me = room.state.players.get(room.sessionId);
  const guest = room.state.guests.get(room.sessionId);
  if (!me || !guest?.racing || room.state.phase !== 'round') return [0, 0];
  if (room.state.arenaId === 'dash') {
    const index = Math.min(guest.progress, DASH_GATES.length - 1);
    const gate = DASH_GATES[index];
    // Line up inside the gap, clear of the wall just passed, then run straight through it.
    const previous = DASH_GATES[index - 1];
    const laneZ = Math.max(gate.z + 1.5, Math.min(me.z, previous ? previous.z - 1.5 : Infinity));
    // Players block each other, so bots spread over three lanes in the gap instead of queueing on one point.
    const gapX = gate.x + ((lane % 3) - 1) * 1.1;
    if (Math.abs(me.x - gapX) > 0.3) return toward(me, gapX, laneZ);
    return [0, -1];
  }
  if (room.state.arenaId === 'team') {
    const team = guest.team === 1 ? 1 : 0;
    const cargo = team === 1 ? room.state.cargo1 : room.state.cargo0;
    if (role === 'hold') {
      const gate = TEAM_RULES.gates.findIndex(z => cargo > z - TEAM_RULES.cargoHalf[2]);
      return toward(me, ...plateCenter(team, gate < 0 ? TEAM_RULES.gates.length - 1 : gate));
    }
    const back = cargo + TEAM_RULES.cargoHalf[2] + 0.5;
    // Pushers spread across the crate's back face so several can press at once.
    const offset = ((role.slot % 3) - 1) * 0.9;
    const lined = Math.abs(me.x - (laneX(team) + offset)) < 0.4 && me.z >= back - 0.05;
    return lined ? [0, -1] : toward(me, laneX(team) + offset, back + 1.2);
  }
  return [0, 0]; // Lava and Dodge: stand still and take what comes.
}

/** One input sender per room for its whole life, reused across modes. */
const inputs = new WeakMap();
function drive(room, role, lane) {
  if (!inputs.has(room)) inputs.set(room, room.input({ mode: 'reliable' }));
  const input = inputs.get(room);
  const timer = setInterval(() => {
    const [x, z] = steer(room, role, lane);
    Object.assign(input.data, { x, z, jump: false });
    input.send();
  }, 1000 / 30);
  return () => clearInterval(timer);
}

/** Plays one mode in one room of `size` bots; returns a summary row for the table. */
async function play(group, mode) {
  const [host] = group;
  const size = group.length;
  host.send('preset', mode);
  await until(() => group.every(room => room.state.preset === mode), `${size}p ${mode}: preset not applied`);
  for (const room of group) room.send('ready', true);
  await until(() => group.every(room => host.state.guests.get(room.sessionId)?.ready), `${size}p ${mode}: not all ready`);
  const started = performance.now();
  const startTick = host.state.tick;
  host.send('start');
  await until(() => host.state.phase === 'countdown', `${size}p ${mode}: did not start`);
  assert.ok(group.every(room => host.state.guests.get(room.sessionId).racing), `${size}p ${mode}: someone was left out of the roster`);

  // Teamwork roles: in each team the first bot holds plates and the rest push.
  const teams = [[], []];
  for (const room of group) teams[host.state.guests.get(room.sessionId).team]?.push(room);
  if (mode === 'team') {
    assert.equal(teams[0].length + teams[1].length, size, `${size}p team: every racer has a team`);
    assert.ok(Math.abs(teams[0].length - teams[1].length) <= 1, `${size}p team: teams ${teams[0].length}v${teams[1].length}`);
  }
  let tickRate = 0;
  const stops = group.map((room, lane) => {
    const team = teams.findIndex(members => members.includes(room));
    const index = team < 0 ? 0 : teams[team].indexOf(room);
    return drive(room, index === 0 ? 'hold' : { slot: index }, lane);
  });
  try {
    const expected = playlistMs(PLAYLISTS[mode]) * scale;
    await until(() => host.state.phase === 'lobby', `${size}p ${mode}: did not return to the lobby`, expected + 10_000);
    const elapsed = performance.now() - started;
    tickRate = (host.state.tick - startTick) / (elapsed / 1000);
    assert.ok(elapsed >= expected - 1500, `${size}p ${mode}: ended early after ${Math.round(elapsed)} ms, expected ${Math.round(expected)}`);
    assert.ok(elapsed < expected + 2500, `${size}p ${mode}: took ${Math.round(elapsed)} ms, expected ${Math.round(expected)}`);
  } finally {
    stops.forEach(stop => stop());
  }

  assert.equal(host.state.guests.size, size, `${size}p ${mode}: a guest left the session`);
  const result = JSON.parse(host.state.standings);
  assert.equal(result.interrupted, false, `${size}p ${mode}: interrupted`);
  assert.equal(result.rows.length, size, `${size}p ${mode}: standings rows`);
  for (const row of result.rows) {
    const round = row.rounds[0];
    assert.ok(round, `${size}p ${mode}: ${row.name} was not scored`);
    assert.ok(round.points >= 2 && round.points <= 12, `${size}p ${mode}: ${row.name} got ${round.points} points`);
  }
  const diagnostics = await host.request('diagnostics', undefined, { timeout: 1000 });
  assert.equal(diagnostics.arenaRuns, 0, `${size}p ${mode}: arena run not released`);

  const points = result.rows.map(row => row.rounds[0].points);
  const summaries = result.rows.map(row => row.rounds[0].summary);
  const note = mode === 'dash' ? `${summaries.filter(s => !/DNF/.test(s)).length} finished`
    : mode === 'team' ? `${teams[0].length}v${teams[1].length}, ${summaries.find(s => /delivered/.test(s)) ? 'delivered' : 'no delivery'}`
    : mode === 'lava' ? `${summaries.filter(s => /out/.test(s)).length} caught (e.g. ${summaries[0]})` : '';
  return { size, mode, max: Math.max(...points), min: Math.min(...points), distinct: new Set(points).size, note, tickRate };
}

try {
  await until(async () => {
    assert.equal(server.exitCode, null, 'sweep server exited early');
    try { return (await fetch(`${endpoint}/__healthcheck`)).ok; } catch { return false; }
  }, 'sweep server did not listen');
  const groups = [];
  for (const size of sizes) {
    // Rooms hold at least four seats; a match can start with as few as two ready players.
    const host = await join(sdk.create('private-dash', { capacity: Math.max(4, size), build: ARENA_BUILD }));
    const group = [host];
    for (let i = 1; i < size; i++) group.push(await join(sdk.joinById(host.state.code, { build: ARENA_BUILD })));
    groups.push(group);
  }
  const table = [];
  for (const mode of modes) {
    // Every size plays this mode at the same time, in its own room.
    table.push(...await Promise.all(groups.map(group => play(group, mode))));
    console.log(`PASS: ${mode} completed for ${sizes.join(', ')} players`);
  }
  // Ticks per second the room actually ran: below 30, tick-timed hazards (lava, Dodge waves) lag the wall-clock round.
  console.log('\nmode  size  top  bottom  levels  ticks/s  notes');
  for (const row of table) {
    console.log(`${row.mode.padEnd(5)} ${String(row.size).padStart(4)}  ${String(row.max).padStart(3)}  ${String(row.min).padStart(6)}  ${String(row.distinct).padStart(6)}  ${row.tickRate.toFixed(1).padStart(7)}  ${row.note}`);
  }
  const slow = table.filter(row => row.tickRate < 29);
  if (slow.length) console.log(`\nWARN: ${slow.length} matches ran below 29 ticks/s; tick-timed hazards fell behind the round clock.`);
  console.log(`\nPASS: roster sweep — ${modes.length} modes × ${sizes.length} sizes, every racer scored, nobody removed, runs released`);
} finally {
  await Promise.allSettled(rooms.map(room => room.leave()));
  server.kill();
}
