import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HALF_EXTENTS, LAVA_MOVERS, moverCenter, spawnPlayer } from '@chaos/shared';
import { RemotePose } from './remote-pose.js';

test('remote summit riders stay on the rendered sweeper through a direction change and a late patch', () => {
  const sweeper = LAVA_MOVERS[3]!;
  const pose = new RemotePose();
  const out = { x: 0, y: 0, z: 0 };
  const rider = spawnPlayer(0);
  for (const [time, tick, offset] of [[100, 93, -0.1], [150, 95, 0.1]] as const) {
    const [x, y, z] = moverCenter(sweeper, tick);
    pose.push({ ...rider, x: x + offset, y: y + sweeper.size[1] / 2 + HALF_EXTENTS[1], z, simTick: tick, ground: 4 }, time);
  }

  const [x, y, z] = moverCenter(sweeper, 95.5);
  assert.ok(pose.read(125, LAVA_MOVERS, 95.5, out));
  assert.ok(Math.abs(out.x - x) < 1e-9);
  assert.equal(out.y, y + sweeper.size[1] / 2 + HALF_EXTENTS[1]);
  assert.equal(out.z, z);

  const [returnX] = moverCenter(sweeper, 150.5);
  assert.ok(pose.read(300, LAVA_MOVERS, 150.5, out));
  assert.ok(Math.abs(out.x - returnX - 0.1) < 1e-9, 'the last known rider offset still follows the visible deck');

  pose.push({ ...rider, respawns: 1 }, 310);
  assert.ok(pose.read(300, LAVA_MOVERS, 150.5, out));
  assert.deepEqual(out, { x: rider.x, y: rider.y, z: rider.z });
});
