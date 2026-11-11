import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  GREYBOX_ARENA, MAX_TICK_REWIND, MODE, MOVEMENT, MOVERS, clampInputTick, moverBox, moverCenter,
  nextInputTick, overlaps, spawnPlayer, step, type Input, type Mover, type Player,
} from './index.js';

const DT = 1 / 30;
const [ferry, pusher] = MOVERS as [Mover, Mover];
const input = (tick: number, x = 0, z = 0, jump = false): Input => ({ x, z, jump, tick });
function playerAt(x: number, y: number, z: number, tick: number): Player {
  const player = spawnPlayer(0);
  Object.assign(player, { x, y, z, grounded: false, coyote: 0, simTick: tick });
  return player;
}
const loop = (mover: Mover) => mover.legs.reduce((sum, leg) => sum + leg.ticks, 0);

test('movers are a pure, looping function of the tick', () => {
  assert.deepEqual(moverCenter(ferry, 0), [16.5, -0.5, 0]);
  assert.deepEqual(moverCenter(ferry, 30 + 72), [22.5, -0.5, 0], 'across the pit after the pause and the crossing');
  for (const tick of [0, 17, 95, 140]) assert.deepEqual(moverCenter(ferry, tick), moverCenter(ferry, tick + 5 * loop(ferry)));
  assert.equal(loop(pusher), 90, 'the pusher repeats every 3 s');
});

test('a rider on the ferry is carried across, and can walk off onto the ledge', () => {
  const start = 30; // the ferry leaves A at tick 30
  const player = playerAt(16.5, 1, 0, start - 1);
  step(player, input(start - 1), DT);
  assert.equal(player.ground, 1, 'standing on the ferry');
  for (let tick = start; tick <= start + 72; tick++) {
    step(player, input(tick), DT);
    assert.equal(player.ground, 1, `still riding at tick ${tick}`);
  }
  assert.ok(Math.abs(player.x - 22.5) < 1e-9, `carried to ${player.x}`);
  assert.equal(player.y, 1);
  for (let tick = start + 73; tick < start + 73 + 15; tick++) step(player, input(tick, 1, 0), DT);
  assert.ok(player.x > 24.5 && (player.ground as number) === 0 && player.grounded, 'walked onto the east ledge');
});

test('a moving box pushes a standing player instead of overlapping it', () => {
  const ram: Mover = {
    id: 'ram', kind: 'ferry', size: [1, 2, 1], warnTicks: 0,
    legs: [{ from: [-3, 1, 0], to: [3, 1, 0], ticks: 30 }, { from: [3, 1, 0], to: [-3, 1, 0], ticks: 30 }],
  };
  const player = playerAt(0, 1, 0, 0);
  for (let tick = 0; tick <= 30; tick++) {
    step(player, input(tick), DT, GREYBOX_ARENA.boxes, [ram]);
    assert.ok(!overlaps([player.x, player.y, player.z], moverBox(ram, tick)), `overlapping at tick ${tick}`);
  }
  assert.equal(player.x, 3 + 1, 'pushed ahead of the box to the end of its run');
});

test('the pusher knocks a player back, then the shield prevents a second hit', () => {
  // The knocking leg is ticks 30..54 (rest 30, then 10 units at 12 u/s).
  const player = playerAt(-4, 1, -10.5, 29);
  let hitAt = -1;
  let thrownX = 0;
  for (let tick = 29; tick < 30 + 25; tick++) {
    step(player, input(tick), DT);
    if (player.mode === MODE.stunned && hitAt < 0) {
      hitAt = tick;
      thrownX = player.vx;
    }
  }
  assert.ok(hitAt > 30, 'hit while the pusher slammed east');
  assert.ok(Math.abs(thrownX - MOVEMENT.knockSpeed) < 1e-9, `thrown east at ${thrownX}`);
  assert.ok(player.shield > 0 && player.shield <= MOVEMENT.shieldTicks);
  let tick = 55;
  while (player.mode === MODE.stunned && tick < 200) step(player, input(tick++), DT);
  assert.equal(player.mode, MODE.recovering, 'lands into recovery');
});

test('a hazard too fast to see in any single tick still hits (swept)', () => {
  const bullet: Mover = {
    id: 'bullet', kind: 'pusher', size: [0.5, 2, 1], warnTicks: 0,
    legs: [{ from: [-10, 1, 0], to: [10, 1, 0], ticks: 5, knocks: true }, { from: [10, 1, 0], to: [10, 1, 0], ticks: 5 }],
  };
  // 4 units per tick through a 1-unit-wide player: no single pose overlaps it at x 0.
  const player = playerAt(0, 1, 0, 0);
  for (let tick = 0; tick < 5; tick++) step(player, input(tick), DT, GREYBOX_ARENA.boxes, [bullet]);
  assert.equal(player.mode, MODE.stunned);
  const shielded = playerAt(0, 1, 0, 0);
  shielded.shield = 20;
  for (let tick = 0; tick < 5; tick++) step(shielded, input(tick), DT, GREYBOX_ARENA.boxes, [bullet]);
  assert.notEqual(shielded.mode, MODE.stunned, 'shielded players are not knocked');
});

test('touching a pad saves it; falling off respawns there, protected, and counts the respawn', () => {
  const pad = GREYBOX_ARENA.checkpoints[0]!;
  const player = playerAt(pad.respawn[0], pad.respawn[1], pad.respawn[2], 0);
  step(player, input(0), DT);
  assert.equal(player.checkpoint, 1);
  Object.assign(player, { x: 0, y: 1, z: 15.6 }); // just past the island's far edge
  let tick = 1;
  while (player.respawns === 0 && tick < 200) step(player, input(tick++), DT);
  assert.equal(player.respawns, 1);
  assert.deepEqual([player.x, player.y, player.z], [...pad.respawn]);
  assert.equal(player.shield, MOVEMENT.shieldTicks);
});

test('input ticks: never future, never too old, never backwards', () => {
  assert.equal(clampInputTick(120, 90, 100), 100, 'future clamps to the server tick');
  assert.equal(clampInputTick(10, 0, 100), 100 - MAX_TICK_REWIND, 'too old moves forward');
  assert.equal(clampInputTick(95, 98, 100), 98, 'cannot go back before the previous input');
  assert.equal(clampInputTick(97, 90, 100), 97, 'a normal stamp is kept');
  assert.equal(clampInputTick(NaN, 90, 100), 100);
});

test('clients stamp consecutive ticks, re-anchoring only on drift', () => {
  assert.equal(nextInputTick(undefined, 41.7), 41);
  assert.equal(nextInputTick(41, 42.4), 42);
  assert.equal(nextInputTick(42, 44.9), 43, 'small drift: keep stepping evenly');
  assert.equal(nextInputTick(43, 50), 50, 'large drift: re-anchor');
  assert.equal(nextInputTick(50, 30), 50, 'never backwards');
});
