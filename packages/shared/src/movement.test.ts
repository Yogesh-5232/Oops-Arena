import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  GREYBOX_ARENA, MODE, MOVEMENT, PRESETS, overlaps, sanitizeInput, spawnPlayer, step, sweepAxis,
  type Box, type Input, type Player,
} from './index.js';

const DT = 1 / 30;
const input = (x = 0, z = 0, jump = false, tick = 0): Input => ({ x, z, jump, tick });
/** A standing player at a chosen spot, built from a real spawn so every field is set. */
function playerAt(x: number, y: number, z: number): Player {
  const player = spawnPlayer(0);
  // Not standing yet: the first step settles it (or starts its fall).
  Object.assign(player, { x, y, z, grounded: false, coyote: 0 });
  return player;
}
function run(player: Player, command: Input, ticks: number, boxes?: readonly Box[]) {
  for (let i = 0; i < ticks; i++) step(player, command, DT, boxes);
}
const flatFloor: Box = { id: 'f', kind: 'floor', min: [-50, -1, -50], max: [50, 0, 50] };

test('capsule sweeps stop at rounded corners without treating them as square', () => {
  const box: Box = { id: 'corner', kind: 'wall', min: [0, 0, 0], max: [1, 2, 1] };
  const beside: [number, number, number] = [-2, 1, -0.4];
  assert.equal(sweepAxis(beside, 0, 4, [box]), 0);
  assert.ok(Math.abs(beside[0] - (-0.3)) < 1e-9);
  assert.equal(overlaps(beside, box), false);
  assert.equal(overlaps([-0.29, 1, -0.4], box), true);

  const above: [number, number, number] = [-0.3, 5, -0.3];
  assert.equal(sweepAxis(above, 1, -6, [box]), 0);
  assert.ok(above[1] > 2.5 && above[1] < 3, 'rounded foot contacts the upper corner');
  assert.equal(overlaps(above, box), false);
});

test('repairs nonfinite input and normalizes diagonals', () => {
  const broken = { x: Infinity, z: NaN, jump: 'yes', tick: -3 } as unknown as Input;
  sanitizeInput(broken);
  assert.deepEqual(broken, { x: 0, z: 0, jump: false, tick: 0 });
  const diagonal = input(1, 1, true);
  sanitizeInput(diagonal);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9);
  assert.equal(diagonal.jump, true);
  const gentle = input(0.3, 0);
  sanitizeInput(gentle);
  assert.equal(gentle.x, 0.3, 'short directions are kept as-is');
});

test('a wall stops the player flush and lets it slide along', () => {
  // wall-west spans x -8..-7.5; the player is 1 wide, so it stops with its center at -7.
  const player = playerAt(-5, 1, 0);
  run(player, input(-1, 0), 30);
  assert.equal(player.x, -7);
  run(player, input(-Math.SQRT1_2, Math.SQRT1_2), 10);
  assert.equal(player.x, -7, 'pressed against the wall');
  assert.ok(player.z > 1, 'but still sliding along it');
});

test('a knee-high step blocks walking but can be jumped onto', () => {
  // step-low spans x 5..8 with its top at 1.
  const player = playerAt(3, 1, 0);
  run(player, input(1, 0), 20);
  assert.equal(player.x, 4.5, 'blocked by the step side');
  step(player, input(1, 0, true), DT);
  run(player, input(1, 0), 20);
  assert.equal(player.y, 2, 'standing on the step top');
  assert.equal(player.grounded, true);
});

test('the high platform is one jump up from the step', () => {
  // platform-high spans x 8..11 with its top at 2.
  const player = playerAt(6.5, 2, 0);
  run(player, input(), 2);
  step(player, input(1, 0, true), DT);
  run(player, input(1, 0), 15);
  assert.equal(player.y, 3);
  assert.ok(player.x > 8.5);
});

test('a ceiling stops a jump flat', () => {
  const ceiling: Box = { id: 'c', kind: 'wall', min: [-5, 2.5, -5], max: [5, 3, 5] };
  const player = playerAt(0, 1, 0);
  step(player, input(0, 0, true), DT, [flatFloor, ceiling]);
  let highest = player.y;
  for (let i = 0; i < 30; i++) {
    step(player, input(), DT, [flatFloor, ceiling]);
    highest = Math.max(highest, player.y);
  }
  assert.equal(highest, 1.5, 'head stops at the ceiling underside');
  assert.equal(player.y, 1, 'and falls back down');
});

test('a fast fall cannot pass through a thin floor', () => {
  const thin: Box = { id: 't', kind: 'floor', min: [-5, -0.05, -5], max: [5, 0, 5] };
  const player = playerAt(0, 60, 0);
  run(player, input(), 200, [thin]);
  assert.equal(player.vy, 0);
  assert.equal(player.y, 1, 'landed on the 0.05-thick floor at terminal speed');
});

test('walking off the world resets to the spawn', () => {
  // floor-main ends at z -15 with nothing beyond; walk off it and catch the reset tick.
  const player = spawnPlayer(5);
  const spawn = GREYBOX_ARENA.spawns[5]!;
  let fell = false;
  for (let i = 0; i < 300 && !(fell && player.y === spawn.y); i++) {
    step(player, input(0, -1), DT);
    fell ||= player.y < 0;
  }
  assert.ok(fell, 'fell off the edge');
  assert.deepEqual([player.x, player.y, player.z, player.vy, player.mode], [spawn.x, spawn.y, spawn.z, 0, MODE.normal]);
});

test('a jump pressed just before landing fires on landing (jump buffer)', () => {
  const landsAfter = (pressTicksBeforeLanding: number | undefined) => {
    const player = playerAt(0, 1.6, 0);
    const ticks: boolean[] = [];
    // Find the landing tick first, then replay pressing jump earlier.
    const probe = playerAt(0, 1.6, 0);
    let landing = 0;
    while (!probe.grounded) { step(probe, input(), DT, [flatFloor]); landing++; }
    for (let t = 1; t <= landing + 3; t++) {
      const press = pressTicksBeforeLanding !== undefined && t === landing - pressTicksBeforeLanding;
      step(player, input(0, 0, press), DT, [flatFloor]);
      ticks.push(player.vy > 0);
    }
    return ticks.some(Boolean);
  };
  assert.equal(landsAfter(undefined), false, 'no press, no jump');
  assert.equal(landsAfter(0), true, 'pressed on the landing tick jumps');
  assert.equal(landsAfter(MOVEMENT.jumpBufferTicks - 2), true, 'pressed at the buffer limit still jumps');
  assert.equal(landsAfter(MOVEMENT.jumpBufferTicks - 1), false, 'pressed one tick too early is forgotten');
});

test('a jump just after walking off an edge still works (coyote time)', () => {
  // floor-main ends at z 8; walk off it, then try jumping a few ticks later.
  const jumpsAfter = (airborneTicks: number) => {
    const player = playerAt(0, 1, 7);
    while (player.grounded || player.z < 8) step(player, input(0, 1), DT);
    run(player, input(0, 1), airborneTicks);
    step(player, input(0, 1, true), DT);
    return player.vy > 0;
  };
  assert.equal(jumpsAfter(0), true);
  assert.equal(jumpsAfter(MOVEMENT.coyoteTicks - 2), true);
  assert.equal(jumpsAfter(MOVEMENT.coyoteTicks + 1), false, 'too late: already falling');
});

/** A standing player facing -z on a flat floor. */
function readyToDive(): Player {
  const player = playerAt(0, 1, 0);
  run(player, input(0, -1), 3, [flatFloor]);
  return player;
}

test('tap jump, then tap again quickly: dive launches forward', () => {
  const player = readyToDive();
  const startZ = player.z;
  step(player, input(0, 0, true), DT, [flatFloor]);
  assert.ok(player.vy > 0 && player.mode === MODE.normal, 'first tap jumps');
  step(player, input(0, 0, true), DT, [flatFloor]);
  assert.equal(player.mode, MODE.diving, 'second tap dives');
  while (player.mode === MODE.diving) step(player, input(1, 0), DT, [flatFloor]);
  assert.equal(player.mode, MODE.recovering);
  assert.ok(startZ - player.z > 4, `dive travelled ${startZ - player.z}`);
  assert.ok(Math.abs(player.x) < 1e-9, 'no steering mid-dive');
});

test('the second tap dives anywhere in the window, and not after it', () => {
  const tapAfter = (ticks: number) => {
    const player = readyToDive();
    step(player, input(0, 0, true), DT, [flatFloor]);
    run(player, input(), ticks - 1, [flatFloor]);
    step(player, input(0, 0, true), DT, [flatFloor]);
    return player.mode;
  };
  assert.equal(tapAfter(1), MODE.diving);
  assert.equal(tapAfter(MOVEMENT.diveWindowTicks), MODE.diving, 'last tick of the window');
  assert.equal(tapAfter(MOVEMENT.diveWindowTicks + 1), MODE.normal, 'too late: no dive');
});

test('a late tap in the air is still a buffered jump for the landing, not a dive', () => {
  const player = readyToDive();
  step(player, input(0, 0, true), DT, [flatFloor]);
  let ticks = 1;
  const probe = structuredClone(player);
  while (!probe.grounded) { step(probe, input(), DT, [flatFloor]); ticks++; }
  // Tap two ticks before landing: inside the jump buffer, long past the dive window.
  run(player, input(), ticks - 3, [flatFloor]);
  step(player, input(0, 0, true), DT, [flatFloor]);
  assert.equal(player.mode, MODE.normal, 'no dive');
  run(player, input(), 3, [flatFloor]);
  assert.ok(player.vy > 0, 'jumped again on landing');
});

test('pressing jump after walking off an edge is a coyote jump, never a dive', () => {
  const player = playerAt(0, 1, 7);
  while (player.grounded || player.z < 8) step(player, input(0, 1), DT);
  step(player, input(0, 1, true), DT);
  assert.equal(player.mode, MODE.normal);
  assert.ok(player.vy > 0, 'coyote jump');
  // Falling off without having jumped: a press is not a dive either.
  const faller = playerAt(0, 1, 7);
  while (faller.grounded || faller.z < 8) step(faller, input(0, 1), DT);
  run(faller, input(0, 1), MOVEMENT.coyoteTicks + 1);
  step(faller, input(0, 1, true), DT);
  assert.equal(faller.mode, MODE.normal);
});

test('recovery slows and blocks both jump and dive', () => {
  const player = readyToDive();
  step(player, input(0, 0, true), DT, [flatFloor]);
  step(player, input(0, 0, true), DT, [flatFloor]);
  while (player.mode === MODE.diving) step(player, input(), DT, [flatFloor]);
  const before = player.x;
  step(player, input(1, 0, true), DT, [flatFloor]);
  assert.equal(player.mode, MODE.recovering, 'tapping during recovery does nothing');
  assert.ok(player.vy <= 0, 'cannot jump while recovering');
  assert.ok(Math.abs(player.x - before - MOVEMENT.speed * MOVEMENT.recoverSpeedScale * DT) < 1e-9, 'slowed');
  run(player, input(), MOVEMENT.recoverTicks, [flatFloor]);
  assert.equal(player.mode, MODE.normal);
});

test('a dive into a wall stops at the wall', () => {
  const player = playerAt(-5, 1, 0);
  run(player, input(-1, 0), 2);
  step(player, input(0, 0, true), DT);
  step(player, input(0, 0, true), DT);
  assert.equal(player.mode, MODE.diving);
  run(player, input(), 30);
  assert.equal(player.x, -7);
});

test('presets satisfy match bounds', () => {
  for (const seconds of Object.values(PRESETS)) assert.ok(seconds >= 120 && seconds <= 900);
});
