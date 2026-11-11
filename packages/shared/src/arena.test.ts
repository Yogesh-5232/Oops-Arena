import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CAPACITY, GREYBOX_ARENA, availableSpawn } from './index.js';

test('every seat has a distinct spawn inside the simulated bounds', () => {
  const { spawns, bounds } = GREYBOX_ARENA;
  assert.equal(spawns.length, CAPACITY);
  assert.equal(new Set(spawns.map(p => p.id)).size, CAPACITY);
  assert.equal(new Set(spawns.map(p => `${p.x},${p.z}`)).size, CAPACITY);
  for (const p of spawns) {
    assert.ok(p.x >= bounds.minX && p.x <= bounds.maxX);
    assert.ok(p.z >= bounds.minZ && p.z <= bounds.maxZ);
    assert.equal(p.y, GREYBOX_ARENA.standingHeight);
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
