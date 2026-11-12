import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  ARENAS, ARENA_BUILD, BUILD_RULES, DASH_BOXES, DODGE_RULES, MOVEMENT, DASH_GATES, DODGE_BOXES, GREYBOX_ARENA, MOVERS, PROTOCOL_VERSION, arenaManifest, buildId,
  type ArenaManifest,
} from './index.js';

test('manifests carry the exact collision lists the simulation uses', () => {
  assert.equal(ARENAS.plaza.boxes, GREYBOX_ARENA.boxes);
  assert.equal(ARENAS.plaza.movers, MOVERS);
  assert.equal(ARENAS.dash.boxes, DASH_BOXES);
  assert.equal(ARENAS.dodge.boxes, DODGE_BOXES);
  assert.equal(ARENAS.dodge.movers.length, 0);
  assert.equal(ARENAS.dash.markers.length, DASH_GATES.length);
  ARENAS.dash.markers.forEach((marker, index) => {
    const gate = DASH_GATES[index]!;
    assert.equal((marker.min[0] + marker.max[0]) / 2, gate.x);
    assert.equal((marker.min[2] + marker.max[2]) / 2, gate.z);
  });
  for (const [id, arena] of Object.entries(ARENAS)) assert.equal(arena.id, id);
});

test('unset or unknown arena ids resolve to the plaza', () => {
  assert.equal(arenaManifest(''), ARENAS.plaza);
  assert.equal(arenaManifest('nope'), ARENAS.plaza);
  assert.equal(arenaManifest('dodge'), ARENAS.dodge);
});

test('build id is deterministic and changes with protocol or any arena content', () => {
  assert.equal(buildId(), ARENA_BUILD);
  assert.match(ARENA_BUILD, new RegExp(`^p${PROTOCOL_VERSION}-[0-9a-f]{8}$`));
  assert.notEqual(buildId(ARENAS, PROTOCOL_VERSION + 1), ARENA_BUILD);
  const moved: ArenaManifest = {
    ...ARENAS.dash,
    boxes: ARENAS.dash.boxes.map((box, index) => index === 0 ? { ...box, max: [box.max[0] + 0.01, box.max[1], box.max[2]] } : box),
  };
  assert.notEqual(buildId({ ...ARENAS, dash: moved }), ARENA_BUILD, 'a moved collision box must change the build');
  assert.notEqual(buildId({ ...ARENAS, dodge: { ...ARENAS.dodge, version: 2 } }), ARENA_BUILD);
  assert.notEqual(buildId({ ...ARENAS, dodge: { ...ARENAS.dodge, spawn: slot => ({ x: slot, y: 1, z: 0 }) } }), ARENA_BUILD);
});

test('build id changes with rule data outside the manifests', () => {
  const variants: unknown[] = [
    { ...BUILD_RULES, movement: { ...BUILD_RULES.movement, MOVEMENT: { ...MOVEMENT, jumpSpeed: MOVEMENT.jumpSpeed + 0.1 } } },
    { ...BUILD_RULES, dodge: { ...BUILD_RULES.dodge, DODGE_RULES: { ...DODGE_RULES, waveTicks: DODGE_RULES.waveTicks + 1 } } },
    { ...BUILD_RULES, plaza: { ...GREYBOX_ARENA, killY: GREYBOX_ARENA.killY - 1 } },
    {
      ...BUILD_RULES,
      plaza: {
        ...GREYBOX_ARENA,
        checkpoints: GREYBOX_ARENA.checkpoints.map((pad, index) => index === 0 ? { ...pad, respawn: [0, 1, 12] } : pad),
      },
    },
    { ...BUILD_RULES, timing: { ...BUILD_RULES.timing, MAX_TICK_REWIND: 16 } },
  ];
  for (const rules of variants) assert.notEqual(buildId(ARENAS, PROTOCOL_VERSION, rules), ARENA_BUILD);
  assert.ok(BUILD_RULES.dodge.schedule.every(wave => wave.length > 0), 'the sampled Dodge schedule must contain hazards');
});
