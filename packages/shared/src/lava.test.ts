import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CAPACITY, LAVA_BOXES, LAVA_MOVERS, LAVA_PADS, LAVA_RULES, LAVA_TIERS, lavaBalconySpot, lavaClosing, lavaLevel, lavaSpawn,
  lavaWarning, overlaps, resolveLava, spawnPlayer, step, type Input, type Player,
} from './index.js';

const DT = 1 / 30;
const ROUND = 4800;
const NONE: never[] = [];

function at(x: number, y: number, z: number, slot = 0): Player {
  const player = spawnPlayer(slot);
  Object.assign(player, { x, y, z, grounded: false, coyote: 0, simTick: 0 });
  return player;
}

function settle(player: Player, ticks = 10) {
  for (let tick = 0; tick < ticks; tick++) step(player, { x: 0, z: 0, jump: false, tick }, DT, LAVA_BOXES, NONE);
}

/** Walks toward each waypoint in turn, jumping on every landing, like a player hopping up stairs. */
function climb(player: Player, waypoints: Array<[number, number]>, limit = 240): void {
  let tick = 0;
  for (const [x, z] of waypoints) {
    while (tick++ < limit) {
      const dx = x - player.x;
      const dz = z - player.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.2) break;
      const input: Input = { x: dx / Math.max(1, length), z: dz / Math.max(1, length), jump: player.grounded, tick };
      step(player, input, DT, LAVA_BOXES, NONE);
      resolveLava(player, 0, ROUND);
    }
  }
  settle(player, 30);
  resolveLava(player, 0, ROUND);
}

test('spawns, pads and balcony spots stand still on solid ground, clear of every box', () => {
  const spots = [
    ...Array.from({ length: CAPACITY }, (_, slot) => lavaSpawn(slot)),
    ...Array.from({ length: CAPACITY }, (_, slot) => lavaBalconySpot(slot)),
    ...LAVA_PADS.map(([x, y, z]) => ({ x, y, z })),
  ];
  for (const spot of spots) {
    for (const box of LAVA_BOXES) assert.ok(!overlaps([spot.x, spot.y, spot.z], box), `${JSON.stringify(spot)} overlaps ${box.id}`);
    const player = at(spot.x, spot.y, spot.z);
    settle(player);
    assert.deepEqual([player.x, player.y, player.z], [spot.x, spot.y, spot.z]);
    assert.equal(player.grounded, true);
  }
  assert.equal(new Set(LAVA_BOXES.map(box => box.id)).size, LAVA_BOXES.length, 'box ids are unique');
});

test('every stair flight is climbable from the tier below', () => {
  const flights: Array<{ start: [number, number, number]; path: Array<[number, number]>; gate: number }> = [
    { start: [0, 1, 15.5], path: [[0, 9.5]], gate: 1 },
    { start: [-3.5, 4, -10.25], path: [[0, -10.25], [0, -6.5]], gate: 2 },
    { start: [-3.5, 7, 7.25], path: [[0, 7.25], [0, 3.75]], gate: 3 },
    { start: [-3.5, 10, -4.4], path: [[0, -4.4], [0, 0]], gate: 4 },
  ];
  for (const { start, path, gate } of flights) {
    const player = at(...start);
    player.checkpoint = gate - 1;
    climb(player, path);
    assert.equal(player.checkpoint, gate, `reached gate ${gate} (at ${player.x.toFixed(2)}, ${player.y.toFixed(2)}, ${player.z.toFixed(2)})`);
    assert.equal(player.y - 1, LAVA_TIERS[gate]!.top);
  }
});

test('each lift carries a rider from its ledge to the next tier', () => {
  const lifts = LAVA_MOVERS.filter(mover => mover.kind === 'ferry');
  lifts.forEach((lift, index) => {
    const [x, y] = lift.legs[0]!.from;
    const player = at(x, y + 1.5, 0);
    for (let tick = 0; tick <= 45 + lift.legs[1]!.ticks + 5; tick++) {
      step(player, { x: 0, z: 0, jump: false, tick }, DT, LAVA_BOXES, [lift]);
    }
    assert.equal(player.y - 1, LAVA_TIERS[index + 2]!.top, `lift ${lift.id} reaches the next tier`);
  });
});

test('lava follows its keyframes, warns before rising, and closes at the end', () => {
  assert.equal(lavaLevel(0, ROUND), -0.5);
  assert.equal(lavaLevel(ROUND * 0.2, ROUND), 0.5);
  assert.equal(lavaLevel(ROUND * 0.4, ROUND), 3.5);
  assert.equal(lavaLevel(ROUND * 0.7, ROUND), 6.5);
  assert.ok(Math.abs(lavaLevel(ROUND, ROUND) - LAVA_RULES.closingTop) < 1e-9);
  let previous = -Infinity;
  for (let tick = 0; tick <= ROUND; tick += 15) {
    const level = lavaLevel(tick, ROUND);
    assert.ok(level >= previous, 'lava never drops');
    previous = level;
  }
  assert.ok(lavaLevel(ROUND, ROUND) < LAVA_TIERS[4]!.top, 'the summit stays safe');
  assert.equal(lavaWarning(ROUND * 0.06, ROUND), true);
  assert.equal(lavaWarning(ROUND * 0.2, ROUND), false);
  assert.equal(lavaClosing(ROUND * 0.83, ROUND), false);
  assert.equal(lavaClosing(ROUND * 0.85, ROUND), true);
});

test('touching lava respawns on a safe pad early, and eliminates in the closing stretch', () => {
  const early = at(0, 1, 15.5);
  settle(early);
  assert.equal(resolveLava(early, ROUND * 0.2, ROUND), 'respawn');
  assert.deepEqual([early.x, early.y, early.z], [...LAVA_PADS[0]!], 'floor flooded: carried to the T1 pad');
  assert.ok(early.shield > 0);

  const climber = at(...LAVA_PADS[1]!);
  climber.checkpoint = 2;
  climber.y = 3.5; // fell back to the T1 ledge
  assert.equal(resolveLava(climber, ROUND * 0.45, ROUND), 'respawn');
  assert.deepEqual([climber.x, climber.y, climber.z], [...LAVA_PADS[1]!], 'back to its own gate');
  climber.y = 6.2;
  assert.equal(resolveLava(climber, ROUND * 0.6, ROUND), 'respawn');
  assert.deepEqual([climber.x, climber.y, climber.z], [...LAVA_PADS[2]!], 'own gate flooded: carried up');

  const late = at(...LAVA_PADS[2]!, 5);
  late.y = 9.5;
  assert.equal(resolveLava(late, ROUND * 0.97, ROUND), 'out');
  const spot = lavaBalconySpot(5);
  assert.deepEqual([late.x, late.y, late.z], [spot.x, spot.y, spot.z]);
  assert.equal(resolveLava(late, ROUND, ROUND), null, 'the balcony is safe');
});
