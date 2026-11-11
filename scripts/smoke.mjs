import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { Client } from '@colyseus/sdk';

// Mirrors @chaos/shared: speed 6 units/s at 30 Hz, and the per-player input buffer.
const STEP_DISTANCE = 6 / 30;
const INPUT_BUFFER = 8;
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
    for (let i = 0; i < 50; i++) send(1, 0, false);
    send(0, 0, false);
    await until(() => input.lastProcessed === input.sentCount, 'flood acknowledged');
    await delay(100);
    const flooded = player().x - stopped;
    assert.ok(flooded > 0 && flooded <= INPUT_BUFFER * STEP_DISTANCE + 1e-9,
      `a 50-input flood moved ${flooded}, more than the ${INPUT_BUFFER}-input buffer allows`);

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
  console.log('PASS: numbered movement/jump, idle, malformed and flooded input, automatic and token reconnect, grace expiry, vacant spawn reuse, 12-seat cap, and room disposal');
} finally {
  for (const room of rooms) await room.leave();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}
