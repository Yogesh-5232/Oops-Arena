import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeInput, step, PRESETS, type Input } from './index.js';
test('repairs nonfinite input and normalizes diagonals', () => {
  const broken = { x: Infinity, z: NaN, jump: 'yes' } as unknown as Input;
  sanitizeInput(broken);
  assert.deepEqual(broken, { x: 0, z: 0, jump: false });
  const diagonal = { x: 1, z: 1, jump: true };
  sanitizeInput(diagonal);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9);
  assert.equal(diagonal.jump, true);
  const gentle = { x: 0.3, z: 0, jump: false };
  sanitizeInput(gentle);
  assert.equal(gentle.x, 0.3, 'short directions are kept as-is');
});
test('falling settles on the floor and cannot leave arena', () => {
  const p = { x: 0, y: 10, z: 0, vy: 0 };
  for (let i = 0; i < 300; i++) step(p, { x: 1, z: 0, jump: false }, 1 / 30);
  assert.deepEqual(p, { x: 14, y: 1, z: 0, vy: 0 });
});
test('presets satisfy match bounds', () => {
  for (const seconds of Object.values(PRESETS)) assert.ok(seconds >= 120 && seconds <= 900);
});
