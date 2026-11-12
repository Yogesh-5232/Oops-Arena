import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PLAYLISTS, PRESETS, playlistMs, spawnPlayer } from '@chaos/shared';
import { liveArenaRuns } from './arena-run.js';
import { DashArenaRun } from './dash-arena.js';
import { DodgeArenaRun } from './dodge-arena.js';
import { LavaArenaRun } from './lava-arena.js';
import { PartyClock } from './party-clock.js';
import { PartyScoreboard } from './party-scoreboard.js';

const roster = ['a', 'b', 'c', 'd'];
const setup = { owner: 'room-a', roster, name: (id: string) => id, seed: 7, startTick: 0, roundTicks: 4800 };

test('a disposed arena run performs no gameplay and cannot be revived', () => {
  for (const run of [new DashArenaRun(), new DodgeArenaRun(), new LavaArenaRun()]) {
    assert.throws(() => run.update(0, 0), /not active/);
    run.setup(setup);
    assert.equal(liveArenaRuns('room-a'), 1);
    assert.throws(() => run.setup(setup), /only be set up once/);
    const player = spawnPlayer(0);
    run.playerStep('a', player, player, 0, 0);
    run.dispose();
    run.dispose();
    assert.equal(liveArenaRuns('room-a'), 0);
    assert.throws(() => run.update(1, 1), /not active/);
    assert.throws(() => run.playerStep('a', player, player, 0, 1), /not active/);
    assert.throws(() => run.rank(), /not active/);
    assert.throws(() => run.setup(setup), /only be set up once/);
  }
});

test('live arena runs are counted per owning room', () => {
  const a = new DashArenaRun();
  const b = new DodgeArenaRun();
  a.setup(setup);
  b.setup({ ...setup, owner: 'room-b' });
  assert.equal(liveArenaRuns('room-a'), 1);
  assert.equal(liveArenaRuns('room-b'), 1);
  assert.equal(liveArenaRuns(), 2);
  a.dispose();
  assert.equal(liveArenaRuns('room-a'), 0);
  assert.equal(liveArenaRuns('room-b'), 1);
  b.dispose();
  assert.equal(liveArenaRuns(), 0);
});

/** One Short Party's worth of arena work: Dash, then Dodge, each set up, played, ranked and disposed. */
function cycle() {
  const player = spawnPlayer(0);
  const dash = new DashArenaRun();
  dash.setup(setup);
  for (const id of roster) dash.playerStep(id, player, player, 10, 0);
  dash.rank();
  dash.dispose();
  const dodge = new DodgeArenaRun();
  dodge.setup(setup);
  for (let tick = 0; tick < 30; tick++) for (const id of roster) dodge.playerStep(id, player, player, 0, tick);
  dodge.rank();
  dodge.dispose();
  const lava = new LavaArenaRun();
  lava.setup(setup);
  for (let tick = 0; tick < 30; tick++) for (const id of roster) lava.playerStep(id, player, player, 0, tick);
  lava.rank();
  lava.dispose();
}

test('repeated Short Party arena cycles release every run', () => {
  for (let index = 0; index < 2000; index++) {
    cycle();
    assert.equal(liveArenaRuns(), 0);
  }
});

const gc = (globalThis as { gc?: () => void }).gc;
test('repeated Short Party arena cycles settle to a stable heap', { skip: !gc && 'needs node --expose-gc (npm test passes it)' }, () => {
  for (let index = 0; index < 50; index++) cycle();
  gc!();
  const baseline = process.memoryUsage().heapUsed;
  for (let index = 0; index < 2000; index++) cycle();
  gc!();
  assert.ok(process.memoryUsage().heapUsed - baseline < 2_000_000, 'heap grew across arena cycles');
});

test('every playlist matches its preset length and names the arena to prefetch', () => {
  for (const [id, playlist] of Object.entries(PLAYLISTS)) {
    const preset = playlist.rounds.length === 1 ? 'quick' : id as 'short' | 'standard';
    assert.equal(playlistMs(playlist), PRESETS[preset] * 1000, `${id} length`);
    const clock = new PartyClock(1000, playlist);
    assert.equal(clock.endsAt - clock.startedAt, playlistMs(playlist));
    if (preset === 'quick') {
      const [round] = clock.rounds;
      assert.equal(round!.arenaId, id);
      assert.equal(clock.snapshot(round!.endsAt, () => false).phase, 'results');
      assert.equal(clock.snapshot(clock.endsAt, () => false).arenaId, 'plaza');
    }
  }
  const clock = new PartyClock(1000, PLAYLISTS.standard);
  const at = (now: number) => {
    const { phase, arenaId, nextArenaId, roundIndex } = clock.snapshot(now, () => false);
    return `${phase}:${arenaId}>${nextArenaId}#${roundIndex}`;
  };
  const [dash, lava, dodge] = clock.rounds;
  assert.equal(at(1000), 'countdown:dash>plaza#0');
  assert.equal(at(dash!.startsAt), 'round:dash>plaza#0');
  assert.equal(at(dash!.endsAt), 'transition:plaza>lava#1');
  assert.equal(at(lava!.startsAt), 'round:lava>plaza#1');
  assert.equal(at(lava!.endsAt), 'transition:plaza>dodge#2');
  assert.equal(at(dodge!.startsAt), 'round:dodge>plaza#2');
  assert.equal(at(dodge!.endsAt), 'results:dodge>plaza#2');
  // A late tick never extends the match: anything past the deadline is complete.
  assert.equal(at(clock.endsAt + 60_000), 'complete:plaza>#2');
  assert.equal(clock.snapshot(dash!.startsAt, index => index === 0).phase, 'cooldown');
  assert.equal(clock.acceptsScoring(2, dodge!.endsAt), false);
  assert.equal(clock.acceptsScoring(1, dash!.startsAt), false);
});

test('Lava credits only climbed gates and locks once every connected racer is caught', () => {
  const run = new LavaArenaRun();
  run.setup({ ...setup, roster: ['idle', 'climber'] });
  const idle = spawnPlayer(0);
  Object.assign(idle, { x: 0, y: 1, z: 15.5, grounded: true });
  const climber = spawnPlayer(1);
  Object.assign(climber, { x: 0, y: 4, z: 9.5, grounded: true });
  // The floor is flooded at 20% of the round: idle is carried up to the T1 pad and stands there.
  for (let tick = 960; tick < 970; tick++) {
    run.playerStep('idle', idle, idle, tick * 33, tick);
    run.playerStep('climber', climber, climber, tick * 33, tick);
  }
  assert.equal(idle.checkpoint, 1);
  const byName = () => Object.fromEntries(run.rank().map(row => [row.name, row]));
  assert.equal(byName().idle!.gate, 0, 'a carried respawn earns no gate');
  assert.equal(byName().idle!.falls, 1);
  assert.equal(byName().climber!.gate, 1, 'standing on a tier reached by climbing earns it');
  assert.equal(run.allFinished, false);
  // Closing stretch: both touch the lava and go to the balcony.
  for (const [id, player] of [['idle', idle], ['climber', climber]] as const) {
    player.y = 2;
    run.playerStep(id, player, player, 150_000, 4700);
  }
  assert.equal(run.allFinished, true, 'nothing left to decide once everyone is out');
  run.dispose();
});

test('Lava ranks survivors above eliminated players, later eliminations higher, and ties share points', () => {
  const board = new PartyScoreboard(['a', 'b', 'c', 'd'], 'standard', ['dash', 'lava', 'dodge']);
  board.record(1, [
    { name: 'b', gate: 4, falls: 0, outMs: null, active: true },
    { name: 'c', gate: 4, falls: 0, outMs: null, active: true },
    { name: 'a', gate: 3, falls: 2, outMs: 150_000, active: true },
    { name: 'd', gate: 3, falls: 0, outMs: 140_000, active: true },
  ]);
  board.record(1, []);
  const rows = board.snapshot(false).rows;
  const points = Object.fromEntries(rows.map(row => [row.name, row.rounds[1]!.points]));
  assert.deepEqual(points, { a: 5, b: 10, c: 10, d: 2 });
  assert.equal(rows.find(row => row.name === 'b')!.rounds[1]!.summary, 'Lava summit');
  assert.equal(rows[0]!.rounds[0], null, 'unscored rounds stay empty');
});
