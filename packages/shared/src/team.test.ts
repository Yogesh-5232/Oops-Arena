import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CAPACITY, TEAM_BOXES, TEAM_GATES, TEAM_MOVERS, TEAM_RULES, assignTeams, cargoBox, cargoProgress, isPushing, laneX, newCargo,
  overlaps, plateCenter, plateUnder, resolveCargo, spawnPlayer, step, stepCargo, teamSpawn, teamWorld, type Player,
} from './index.js';

const DT = 1 / 30;
const START = TEAM_RULES.cargoStartZ;
const HZ = TEAM_RULES.cargoHalf[2];

function at(x: number, y: number, z: number): Player {
  const player = spawnPlayer(0);
  Object.assign(player, { x, y, z, grounded: false, coyote: 0, simTick: 0 });
  return player;
}

test('every team spawn stands still on the floor in its own lane, clear of walls and crates', () => {
  const world = teamWorld(START, START);
  for (const team of [0, 1]) {
    const spots = Array.from({ length: CAPACITY }, (_, slot) => teamSpawn(slot, team));
    assert.equal(new Set(spots.map(spot => `${spot.x}:${spot.z}`)).size, CAPACITY, 'spots are distinct');
    for (const spot of spots) {
      assert.equal(Math.sign(spot.x), team === 1 ? 1 : -1, 'spawn is in its own lane');
      for (const box of world) assert.ok(!overlaps([spot.x, spot.y, spot.z], box), `${JSON.stringify(spot)} overlaps ${box.id}`);
      const player = at(spot.x, spot.y, spot.z);
      for (let tick = 0; tick < 10; tick++) step(player, { x: 0, z: 0, jump: false, tick }, DT, world, []);
      assert.deepEqual([player.x, player.y, player.z], [spot.x, spot.y, spot.z]);
      assert.equal(player.grounded, true);
    }
  }
  assert.equal(new Set(TEAM_BOXES.map(box => box.id)).size, TEAM_BOXES.length, 'box ids are unique');
});

test('the lanes are mirror images of each other', () => {
  for (let gate = 0; gate < TEAM_GATES; gate++) {
    const [x0, z0] = plateCenter(0, gate);
    const [x1, z1] = plateCenter(1, gate);
    assert.equal(x0, -x1);
    assert.equal(z0, z1);
  }
  assert.equal(laneX(0), -laneX(1));
  const [a, b] = [cargoBox(0, 3), cargoBox(1, 3)];
  assert.deepEqual([a.min[0], a.max[0]], [-b.max[0], -b.min[0]]);
  const sweepers = TEAM_MOVERS.map(mover => mover.legs.map(leg => leg.from[0]));
  assert.deepEqual(sweepers.slice(0, 2), sweepers.slice(2).map(legs => legs.map(x => -x)));
});

test('a player walking into the back of the crate stops flush and counts as pushing', () => {
  const world = teamWorld(START, START);
  const player = at(laneX(0), 1, START + 4);
  const forward = { x: 0, z: -1, jump: false, tick: 0 };
  for (let tick = 0; tick < 30; tick++) step(player, { ...forward, tick }, DT, world, []);
  assert.equal(player.z, START + HZ + 0.5, 'blocked flush against the back face');
  assert.equal(isPushing(player, forward, 0, START), true);
  assert.equal(isPushing(player, { x: 0, z: 1 }, 0, START), false, 'pulling away is not pushing');
  assert.equal(isPushing(player, { x: 50, z: -1 }, 0, START), false, 'an oversized sideways input is judged after shortening');
  assert.equal(isPushing(player, forward, 1, START), false, 'the other lane\'s crate is not yours');
  player.x += 3;
  assert.equal(isPushing(player, forward, 0, START), false, 'beside the crate is not pushing');
});

test('a crate moving into a player pushes it out of the nearest face', () => {
  const ahead = at(laneX(0), 1, START - HZ - 0.3);
  resolveCargo(ahead, START, START);
  assert.equal(ahead.z, START - HZ - 0.5, 'pushed out ahead of the crate');
  const side = at(laneX(1) + 1.5, 1, START);
  resolveCargo(side, START, START);
  assert.equal(side.x, laneX(1) + TEAM_RULES.cargoHalf[0] + 0.5, 'pushed out of the side');
  const clear = at(laneX(0), 1, START + 5);
  resolveCargo(clear, START, START);
  assert.equal(clear.z, START + 5);
});

test('closed gates stop the crate, plates open them, and rollback stops at the last cleared gate', () => {
  const cargo = newCargo();
  const gate = TEAM_RULES.gates[0];
  for (let tick = 0; tick < 300; tick++) stepCargo(cargo, 2, () => false, DT);
  assert.equal(cargo.z, gate + HZ, 'held at the closed gate');
  assert.equal(cargo.passed, 0);
  for (let tick = 0; tick < 90; tick++) stepCargo(cargo, 2, index => index === 0, DT);
  assert.equal(cargo.passed, 1, 'cleared the open gate');
  assert.ok(cargo.z <= gate - HZ);
  for (let tick = 0; tick < 600; tick++) stepCargo(cargo, 0, () => false, DT);
  assert.equal(cargo.z, gate - HZ, 'rolled back no further than the cleared gate');
  for (let tick = 0; tick < 3000 && !cargo.delivered; tick++) stepCargo(cargo, 1, () => true, DT);
  assert.equal(cargo.delivered, true);
  assert.equal(cargo.z, TEAM_RULES.goalZ);
  assert.equal(cargoProgress(cargo.z), 1);
});

test('a crate already partly through a gate can finish crossing after the plate lapses', () => {
  const cargo = newCargo();
  const gate = TEAM_RULES.gates[0];
  cargo.z = gate + HZ - 0.5;
  stepCargo(cargo, 1, () => false, DT);
  assert.ok(cargo.z < gate + HZ - 0.5);
});

test('crate speed grows with pushers, but no faster than the table allows', () => {
  const speed = (pushers: number) => {
    const cargo = newCargo();
    stepCargo(cargo, pushers, () => true, 1);
    return START - cargo.z;
  };
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  close(speed(1), TEAM_RULES.pushSpeed[1]);
  assert.ok(speed(2) > speed(1));
  close(speed(99), TEAM_RULES.pushSpeed[TEAM_RULES.pushSpeed.length - 1]!);
});

test('plates register only for the standing player\'s own lane', () => {
  const [x, z] = plateCenter(1, 2);
  const player = at(x, 1, z);
  player.grounded = true;
  assert.equal(plateUnder(player, 1), 2);
  assert.equal(plateUnder(player, 0), -1);
  player.grounded = false;
  assert.equal(plateUnder(player, 1), -1, 'jumping over a plate does not press it');
});

test('teams differ by at most one, and the extra seat moves across rematches', () => {
  for (let size = 2; size <= 12; size++) {
    const roster = Array.from({ length: size }, (_, index) => `p${index}`);
    const counts = [0, 0];
    for (const team of assignTeams(roster, 0).values()) counts[team]!++;
    assert.ok(Math.abs(counts[0]! - counts[1]!) <= 1, `${size} players`);
  }
  const odd = ['a', 'b', 'c', 'd', 'e'];
  const bigSide = (rotation: number) => {
    const teams = assignTeams(odd, rotation);
    const big = [...teams.values()].filter(team => team === 0).length >= 3 ? 0 : 1;
    return odd.filter(id => teams.get(id) === big).sort().join('');
  };
  assert.notEqual(bigSide(0), bigSide(1));
});
