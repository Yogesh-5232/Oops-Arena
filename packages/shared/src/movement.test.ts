import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseInput, step, PRESETS } from './index.js';
test('rejects nonfinite input and normalizes diagonals', () => {
  assert.equal(parseInput({ x: Infinity, z: 0, jump: false }), undefined);
  const input = parseInput({ x: 1, z: 1, jump: false })!;
  assert.ok(Math.abs(Math.hypot(input.x, input.z) - 1) < 1e-9);
});
test('falling settles on the floor and cannot leave arena', () => {
  const p = { x: 0, y: 10, z: 0, vy: 0 };
  for (let i = 0; i < 300; i++) step(p, { x: 1, z: 0, jump: false }, 1 / 30);
  assert.deepEqual(p, { x: 14, y: 1, z: 0, vy: 0 });
});
test('presets satisfy match bounds', () => {
  for (const seconds of Object.values(PRESETS)) assert.ok(seconds >= 120 && seconds <= 900);
});
