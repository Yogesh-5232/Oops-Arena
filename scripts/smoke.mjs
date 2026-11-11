import { strict as assert } from 'node:assert';
import { Client } from '@colyseus/sdk';
import { INPUT_BUFFER } from '@chaos/shared';
import { delay, drivePrediction, startBuiltServer, until } from './netcheck.mjs';

const STEP_DISTANCE = 6 / 30; // speed 6 units/s at 30 Hz
const port = process.env.SMOKE_PORT ?? '2599';
// Telemetry lets the backlog check read the server's own input queue.
const server = await startBuiltServer(port, { PLAYGROUND_TELEMETRY: '1' });
const client = new Client(`http://localhost:${port}`);
const rooms = new Set();
async function track(promise) {
  const room = await promise;
  rooms.add(room);
  return room;
}
async function leave(room) {
  await room.leave();
  rooms.delete(room);
}
try {
  for (let cycle = 0; cycle < 3; cycle++) {
    const observer = await track(client.create('playground'));
    const peers = [];
    for (let i = 0; i < 3; i++) peers.push(await track(client.joinById(observer.roomId)));
    await until(() => [...rooms].every(room => room.state.players?.size === 4), 'four replicated seats');
    const player = () => observer.state.players.get(observer.sessionId);
    const input = observer.input({ mode: 'reliable' });
    const send = (x, z, jump) => {
      Object.assign(input.data, { x, z, jump });
      return input.send();
    };
    const before = player().x;
    send(1, 0, true);
    send(0, 0, false);
    await until(() => player().x > before && player().y > 1, 'movement and jump');
    await until(() => input.lastProcessed === input.sentCount, 'server acknowledges every numbered input');
    await until(() => player().y === 1, 'landing');
    const stopped = player().x;
    assert.ok(Math.abs(stopped - before - STEP_DISTANCE) < 1e-9, `one input moves exactly one step (moved ${stopped - before})`);
    await delay(150);
    assert.equal(player().x, stopped, 'no input must stand still');
    send(NaN, Infinity, false);
    send(0, 0, false);
    await until(() => input.lastProcessed === input.sentCount, 'malformed input acknowledged');
    await delay(100);
    assert.equal(player().x, stopped, 'malformed input must not move player');
    // Releasing one key of a diagonal changes only one field on the wire; the kept
    // field must still be the raw value, not a speed-repaired one.
    const diagonalStart = player().z;
    send(1, -1, false);
    send(0, -1, false);
    send(0, 0, false);
    await until(() => input.lastProcessed === input.sentCount, 'diagonal release acknowledged');
    await delay(100);
    const diagonalMoved = player().z - diagonalStart;
    const diagonalExpected = -(STEP_DISTANCE * Math.SQRT1_2 + STEP_DISTANCE);
    assert.ok(Math.abs(diagonalMoved - diagonalExpected) < 1e-9,
      `diagonal then straight moved ${diagonalMoved}, expected ${diagonalExpected}`);
    const floodStart = player().x;
    for (let i = 0; i < 50; i++) send(1, 0, false);
    send(0, 0, false);
    await until(() => input.lastProcessed === input.sentCount, 'flood acknowledged');
    await delay(100);
    const flooded = player().x - floodStart;
    // The flood can arrive across a tick or two, each running up to two inputs
    // (one plus catch-up), so allow the buffer plus those; 50 steps would be a failure.
    const floodLimit = (INPUT_BUFFER + 4) * STEP_DISTANCE;
    assert.ok(flooded > 0 && flooded <= floodLimit + 1e-9,
      `a 50-input flood moved ${flooded}, more than ${floodLimit} (buffer plus two ticks of catch-up)`);
    if (cycle === 0) {
      const run = await drivePrediction(peers[2], 120, observer, { hitch: true });
      console.log('prediction:', JSON.stringify(run));
      assert.deepEqual(run.predicted, run.server, 'prediction must settle exactly on the server state');
      // Locally this is 0; the margin tolerates an occasional server tick with no input on a busy CI host.
      assert.ok(run.corrections <= run.reconciles / 4, `${run.corrections} of ${run.reconciles} reconciles corrected`);
      // Raw 20 Hz updates freeze on roughly two of three 60 Hz frames; smoothing should almost never freeze.
      const { frames, smoothFrozen, rawFrozen } = run.remote;
      assert.ok(frames >= 50, `only ${frames} remote frames sampled`);
      assert.ok(smoothFrozen <= frames * 0.15, `smoothed remote froze on ${smoothFrozen} of ${frames} frames`);
      assert.ok(smoothFrozen < rawFrozen, `smoothing (${smoothFrozen} frozen) must beat raw updates (${rawFrozen} frozen)`);
      // Server-side queue, median of five readings. Before catch-up credit, a
      // 400 ms hitch left it permanently about 3 higher.
      assert.ok(run.backlog.afterHitch <= run.backlog.before + 1,
        `input backlog stayed at ${run.backlog.afterHitch} after a hitch (was ${run.backlog.before})`);
    }

    const dropped = peers[1];
    const token = dropped.reconnectionToken;
    const sessionId = dropped.sessionId;
    const spawn = observer.state.players.get(sessionId).toJSON();
    if (cycle === 0) {
      dropped.reconnection.minUptime = 0;
      let reconnected = false;
      dropped.onReconnect(() => { reconnected = true; });
      dropped.connection.close();
      await until(() => reconnected, 'automatic reconnection');
      assert.equal(dropped.sessionId, sessionId);
    } else {
      dropped.reconnection.enabled = false;
      await dropped.leave(false);
      rooms.delete(dropped);
      if (cycle === 2) {
        assert.ok(observer.state.players.has(sessionId), 'dropped seat must be reserved');
        await until(() => !observer.state.players.has(sessionId), 'grace expiry', 35000);
        await assert.rejects(() => client.reconnect(token), 'expired token must be rejected');
        await track(client.joinById(observer.roomId));
      } else {
        const recovered = await track(client.reconnect(token));
        assert.equal(recovered.sessionId, sessionId, 'reload token must recover the original identity');
      }
    }
    await until(() => observer.state.players.size === 4, 'four seats after recovery or replacement');
    if (cycle < 2) assert.deepEqual(observer.state.players.get(sessionId).toJSON(), spawn);

    // Removing a middle seat used to spawn the replacement on the last seat.
    const departed = peers[0];
    const oldSpawn = observer.state.players.get(departed.sessionId).toJSON();
    await leave(departed);
    await until(() => observer.state.players.size === 3, 'departure replication');
    const replacement = await track(client.joinById(observer.roomId));
    await until(() => observer.state.players.has(replacement.sessionId), 'replacement replication');
    assert.deepEqual(observer.state.players.get(replacement.sessionId).toJSON(), oldSpawn);
    while (rooms.size < 12) await track(client.joinById(observer.roomId));
    await until(() => [...rooms].every(room => room.state.players?.size === 12), 'twelve replicated seats');
    await assert.rejects(() => track(client.joinById(observer.roomId)), '13th seat must be rejected');
    const positions = [...observer.state.players.values()].map(p => `${p.x},${p.z}`);
    assert.equal(new Set(positions).size, 12, 'spawn positions must be distinct');
    const oldRoomId = observer.roomId;
    for (const room of [...rooms]) await leave(room);
    await delay(150);
    await assert.rejects(() => track(client.joinById(oldRoomId)), 'empty room must be disposed');
  }
  console.log('PASS: numbered movement/jump, idle, malformed and flooded input, prediction agreement, smooth remote avatars, automatic and token reconnect, grace expiry, vacant spawn reuse, 12-seat cap, and room disposal');
} finally {
  for (const room of rooms) await room.leave();
  await server.stop();
}
