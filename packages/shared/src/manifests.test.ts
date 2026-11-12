import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  ARENAS, ARENA_BUILD, DASH_BOXES, DASH_GATES, DODGE_BOXES, GREYBOX_ARENA, MOVERS, PROTOCOL_VERSION, arenaManifest, buildId,
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
