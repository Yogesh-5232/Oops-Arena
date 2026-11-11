import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DASH_BOXES, DASH_GATES, simulateInput, spawnPlayer } from '@chaos/shared';
import { DashRace } from './dash-race.js';

test('walls block movement outside the gap and the race requires forward gates in order', () => {
  const race = new DashRace(['a'], id => id);
  const gate = DASH_GATES[0];
  const blocked = { ...spawnPlayer(0), x: 0, z: gate.z + 0.7 };
  simulateInput(blocked, { x: 0, z: -1, jump: false, tick: 0 }, 1 / 30, DASH_BOXES);
  assert.ok(blocked.z > gate.z + 0.5);
  const side = { ...spawnPlayer(0), x: gate.x + gate.halfWidth - 0.55, z: gate.z };
  simulateInput(side, { x: 1, z: 0, jump: false, tick: 0 }, 1 / 30, DASH_BOXES);
  assert.equal(side.x, gate.x + gate.halfWidth - 0.5);
  assert.equal(race.record('a', { x: 0, z: -11 }, { x: 0, z: -13 }, 100), 0);
  assert.equal(race.record('a', { x: gate.x, z: 3 }, { x: gate.x, z: 5 }, 200), 0);
  assert.equal(race.record('a', { x: 0, z: 5 }, { x: 0, z: 3 }, 300), 0);
  assert.equal(race.record('a', { x: gate.x, z: 5 }, { x: gate.x, z: 3 }, 400), 1);
  assert.equal(race.allFinished, false);
});

test('finishers rank by crossing order and DNFs rank by checkpoint and best progress', () => {
  const race = new DashRace(['dnf-back', 'second', 'dnf-front', 'first'], id => id);
  for (const [index, id] of ['first', 'second'].entries()) {
    for (const gate of DASH_GATES) {
      race.record(id, { x: gate.x, z: gate.z + 0.1 }, { x: gate.x, z: gate.z - 0.1 }, 500 + index);
    }
  }
  race.record('dnf-front', { x: -6, z: 4.1 }, { x: -6, z: 3.9 }, 800);
  race.record('dnf-front', { x: -6, z: 3.9 }, { x: -6, z: 8 }, 900);
  race.record('dnf-back', { x: 0, z: 9 }, { x: 0, z: 4.7 }, 900);
  const standings = race.standings();
  assert.deepEqual(standings.map(row => [row.name, row.finishMs]), [
    ['first', 500], ['second', 501], ['dnf-front', null], ['dnf-back', null],
  ]);
  assert.equal(race.allFinished, false);
});
