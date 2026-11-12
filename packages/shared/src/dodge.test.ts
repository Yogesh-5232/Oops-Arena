import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ARENAS, DODGE_FINALE_RULES, DODGE_RULES, dodgeHazards, resolveDodgeHazards, spawnPlayer } from './index.js';

const families = (hazards: ReturnType<typeof dodgeHazards>) => hazards.map(hazard => hazard.family).sort().join(',');

test('standard Dodge waves show one seeded family at a time', () => {
  for (let wave = 0; wave < 20; wave++) {
    const active = dodgeHazards(7, wave * DODGE_RULES.waveTicks + DODGE_RULES.activeStart);
    assert.ok(['sweeper', 'drop,drop'].includes(families(active)), `wave ${wave}: ${families(active)}`);
  }
});

test('the finale reuses the Dodge floor with faster waves of both families together', () => {
  assert.equal(ARENAS.finale.boxes, ARENAS.dodge.boxes);
  assert.equal(ARENAS.finale.dodge, DODGE_FINALE_RULES);
  assert.ok(DODGE_FINALE_RULES.waveTicks < DODGE_RULES.waveTicks);
  for (let wave = 0; wave < 20; wave++) {
    const start = wave * DODGE_FINALE_RULES.waveTicks;
    assert.equal(dodgeHazards(7, start, DODGE_FINALE_RULES).length, 0, 'each wave opens with a quiet gap');
    const warning = dodgeHazards(7, start + DODGE_FINALE_RULES.warningStart, DODGE_FINALE_RULES);
    assert.equal(families(warning), 'drop,drop,sweeper');
    assert.ok(warning.every(hazard => hazard.phase === 'warning'), 'every hazard is telegraphed first');
    const active = dodgeHazards(7, start + DODGE_FINALE_RULES.activeStart, DODGE_FINALE_RULES);
    assert.equal(families(active), 'drop,drop,sweeper');
    assert.ok(active.every(hazard => hazard.phase === 'active'));
    assert.equal(new Set(active.map(hazard => hazard.id)).size, active.length, 'hazard ids are unique within a wave');
  }
});

test('finale hazards hit with the finale timing, not the standard one', () => {
  // An active drop zone in the finale at a tick where standard Dodge is still only warning.
  const tick = DODGE_FINALE_RULES.activeStart + 1;
  assert.ok(dodgeHazards(7, tick).every(hazard => hazard.phase === 'warning'), 'standard Dodge is still only warning');
  const drop = dodgeHazards(7, tick, DODGE_FINALE_RULES).find(hazard => hazard.family === 'drop')!;
  const at = { x: (drop.min[0] + drop.max[0]) / 2, y: 1, z: (drop.min[2] + drop.max[2]) / 2 };
  const player = spawnPlayer(0);
  Object.assign(player, at, { shield: 0 });
  assert.equal(resolveDodgeHazards(player, at, 7, 0, tick), false, 'standard rules: no hazard yet');
  assert.equal(resolveDodgeHazards(player, at, 7, 0, tick, DODGE_FINALE_RULES), true, 'finale rules: hit');
});
