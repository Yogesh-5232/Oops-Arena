import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { Client } from '@colyseus/sdk';
import { Predict } from '@colyseus/sdk/predict';
import { INPUT_BUFFER, simulateInput } from '@chaos/shared';

const STEP_DISTANCE = 6 / 30; // speed 6 units/s at 30 Hz
/** The client's prediction step, as in apps/client. */
const predictStep = (ctx, state, command) => simulateInput(state, command, ctx.dt);
const KEY_COMBOS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
/**
 * Drives a predicting client for `frames` 16 ms frames with a scripted pattern
 * (walking key combinations while hopping), then waits for the server to
 * acknowledge everything.
 */
async function drivePrediction(room, frames) {
  const input = room.input({ mode: 'reliable' });
  const predict = Predict.get(room);
  const self = room.state.players.get(room.sessionId);
  const me = predict.reconciler(self, { input, step: predictStep, fields: ['x', 'y', 'z', 'vy'], snap: 3 });
  let reconciles = 0, corrections = 0, worst = 0, seen = me.reconcileSeq;
  const observe = () => {
    if (me.reconcileSeq === seen) return;
    seen = me.reconcileSeq;
    reconciles++;
    if (me.lastCorrectionMag > 0.001) corrections++;
    worst = Math.max(worst, me.lastCorrectionMag);
  };
  // Like the real client, keep sending (standing still) after the pattern ends so
  // the avatar lands inside the predicted stream; the reconciler only checks the
  // server on acknowledged inputs.
  const settleFrames = 60;
  for (let frame = 0; frame < frames + settleFrames; frame++) {
    const steps = predict.tick(performance.now());
    for (let i = 0; i < steps; i++) {
      const seq = input.sentCount + 1;
      // Key-like combinations: straight, unnormalized diagonals and single-key releases.
      const [x, z] = frame < frames ? KEY_COMBOS[Math.floor(seq / 7) % KEY_COMBOS.length] : [0, 0];
      input.data.x = x;
      input.data.z = z;
      input.data.jump = frame < frames && seq % 20 === 0;
      input.send();
    }
    observe();
    await delay(16);
  }
  await until(() => {
    predict.tick(performance.now());
    observe();
    return input.lastProcessed === input.sentCount;
  }, 'prediction inputs acknowledged');
  predict.tick(performance.now());
  const result = { sent: input.sentCount, reconciles, corrections, worst, predicted: { ...me.state }, server: self.toJSON() };
  predict.dispose();
  return result;
}
const port = process.env.SMOKE_PORT ?? '2599';
const server = spawn(process.execPath, ['apps/server/dist/main.js'], {
  stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PORT: port },
});
const client = new Client(`http://localhost:${port}`);
const rooms = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error(`Timed out: ${description}`);
    await delay(25);
  }
}
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
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(Error('Server startup timed out')), 10000);
    let output = '';
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes('Playground server listening')) finish();
    };
    const onExit = code => finish(Error(`Server exited during startup (${code})`));
    const onError = error => finish(error);
    function finish(error) {
      clearTimeout(timeout);
      server.stdout.off('data', onData);
      server.off('exit', onExit);
      server.off('error', onError);
      error ? reject(error) : resolve();
    }
    server.stdout.on('data', onData);
    server.once('exit', onExit);
    server.once('error', onError);
  });
  server.stdout.resume();
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
    assert.ok(flooded > 0 && flooded <= INPUT_BUFFER * STEP_DISTANCE + 1e-9,
      `a 50-input flood moved ${flooded}, more than the ${INPUT_BUFFER}-input buffer allows`);
    if (cycle === 0) {
      const run = await drivePrediction(peers[2], 120);
      console.log('prediction:', JSON.stringify(run));
      assert.deepEqual(run.predicted, run.server, 'prediction must settle exactly on the server state');
      // Locally this is 0; the margin tolerates an occasional server tick with no input on a busy CI host.
      assert.ok(run.corrections <= run.reconciles / 4, `${run.corrections} of ${run.reconciles} reconciles corrected`);
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
  console.log('PASS: numbered movement/jump, idle, malformed and flooded input, prediction agreement, automatic and token reconnect, grace expiry, vacant spawn reuse, 12-seat cap, and room disposal');
} finally {
  for (const room of rooms) await room.leave();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}
