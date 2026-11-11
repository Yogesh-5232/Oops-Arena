import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CAPACITY, GREYBOX_ARENA, HALF_EXTENTS, availableSpawn, overlaps, spawnPlayer, step } from './index.js';

const still = { x: 0, z: 0, jump: false, dive: false };

test('every seat has a distinct spawn standing on the floor, clear of every box', () => {
  const { spawns, boxes } = GREYBOX_ARENA;
  assert.equal(spawns.length, CAPACITY);
  assert.equal(new Set(spawns.map(p => p.id)).size, CAPACITY);
  assert.equal(new Set(spawns.map(p => `${p.x},${p.z}`)).size, CAPACITY);
  assert.equal(new Set(boxes.map(b => b.id)).size, boxes.length, 'box ids are unique');
  for (const spawn of spawns) {
    for (const box of boxes) assert.ok(!overlaps([spawn.x, spawn.y, spawn.z], box), `${spawn.id} overlaps ${box.id}`);
    const player = spawnPlayer(spawns.indexOf(spawn));
    for (let i = 0; i < 10; i++) step(player, still, 1 / 30);
    assert.deepEqual([player.x, player.y, player.z], [spawn.x, spawn.y, spawn.z], `${spawn.id} stays put`);
    assert.equal(player.grounded, true);
    assert.equal(player.y - HALF_EXTENTS[1], 0, 'feet on the main floor top');
  }
});

test('departures reuse the vacant slot without overlapping surviving seats', () => {
  const occupied = new Set<number>();
  for (let i = 0; i < CAPACITY; i++) {
    const slot = availableSpawn(occupied)!;
    assert.equal(slot, i);
    occupied.add(slot);
  }
  assert.equal(availableSpawn(occupied), undefined);
  for (const departed of [1, 0, 7, 11, 3]) {
    occupied.delete(departed);
    assert.equal(availableSpawn(occupied), departed);
    occupied.add(departed);
  }
});
