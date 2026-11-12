import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnPlayer } from '@chaos/shared';
import { liveArenaRuns } from './arena-run.js';
import { DashArenaRun } from './dash-arena.js';
import { DodgeArenaRun } from './dodge-arena.js';
import { SHORT_TIMING, ShortPartyClock } from './short-party-clock.js';

const roster = ['a', 'b', 'c', 'd'];
const setup = { owner: 'room-a', roster, name: (id: string) => id, seed: 7, startTick: 0 };

test('a disposed arena run performs no gameplay and cannot be revived', () => {
  for (const run of [new DashArenaRun(), new DodgeArenaRun()]) {
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

test('the Short Party timeline is 315 s and names the arena to prefetch', () => {
  assert.equal(
    SHORT_TIMING.countdownMs + 2 * SHORT_TIMING.roundMs + SHORT_TIMING.transitionMs + SHORT_TIMING.resultsMs,
    SHORT_TIMING.totalMs,
  );
  const clock = new ShortPartyClock(1000);
  assert.equal(clock.endsAt - clock.startedAt, SHORT_TIMING.totalMs);
  const at = (now: number) => {
    const { phase, arenaId, nextArenaId } = clock.snapshot(now, false);
    return `${phase}:${arenaId}>${nextArenaId}`;
  };
  assert.equal(at(1000), 'countdown:dash>plaza');
  assert.equal(at(clock.dashStartsAt), 'round:dash>plaza');
  assert.equal(at(clock.dashEndsAt), 'transition:plaza>dodge');
  assert.equal(at(clock.dodgeStartsAt), 'round:dodge>plaza');
  assert.equal(at(clock.dodgeEndsAt), 'results:dodge>plaza');
  // A late tick never extends the match: anything past the deadline is complete.
  assert.equal(at(clock.endsAt + 60_000), 'complete:plaza>');
  assert.equal(clock.acceptsScoring('dodge', clock.dodgeEndsAt), false);
  assert.equal(clock.acceptsScoring('plaza', clock.dashStartsAt), false);
});
