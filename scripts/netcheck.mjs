// Shared helpers for the smoke test and the lag test: start the built server,
// and drive a scripted, predicting player while another client watches it.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Predict } from '@colyseus/sdk/predict';
import { simulateInput } from '@chaos/shared';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(predicate, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error(`Timed out: ${description}`);
    await delay(25);
  }
}

/** Starts apps/server/dist on `port` and resolves once it is listening. */
export async function startBuiltServer(port, env = {}) {
  const child = spawn(process.execPath, ['apps/server/dist/main.js'], {
    stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env, PORT: String(port) },
  });
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
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      error ? reject(error) : resolve();
    }
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
  child.stdout.resume();
  return {
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    },
  };
}

/** The client's prediction step, as in apps/client. */
const predictStep = (ctx, state, command) => simulateInput(state, command, ctx.dt);
const KEY_COMBOS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
/** Remote smoothing as in apps/client: 100 ms interpolation, 3-unit teleport cut. */
const REMOTE = { mode: 'lerp', snap: 3 };
const CORRECTION_FLOOR = 0.001;

/**
 * Drives a predicting client for `frames` 16 ms frames with a scripted pattern
 * (walking key combinations while hopping and diving, bumping into whatever
 * arena boxes are in the way), then waits for the server to
 * acknowledge everything. Meanwhile `watcher` draws the mover through remote
 * smoothing; a frame where the drawn position did not move is "frozen".
 * With `hitch`, a 400 ms pause (no frames, no sends) follows the pattern.
 */
export async function drivePrediction(room, frames, watcher, { hitch = false, ackTimeout = 5000, onCorrection } = {}) {
  const input = room.input({ mode: 'reliable' });
  const predict = Predict.get(room);
  const self = room.state.players.get(room.sessionId);
  // warnOnDivergence: Infinity makes the SDK record correction sizes (it skips
  // that bookkeeping otherwise) without ever printing warnings.
  const me = predict.reconciler(self, {
    // No `fields`: mirror every scalar on the avatar schema, as apps/client does.
    input, step: predictStep, warnOnDivergence: Infinity,
  });
  const watch = Predict.get(watcher, { mode: 'lerp', delay: 100 });
  watch.attachAll('players', { x: REMOTE, y: REMOTE, z: REMOTE });
  const seenByWatcher = watcher.state.players.get(room.sessionId);
  const remote = { frames: 0, smoothFrozen: 0, rawFrozen: 0, last: undefined, lastRaw: undefined };
  // Skip the first ~0.35 s while the interpolation buffer fills, plus the round trip.
  const firstMeasuredFrame = 20 + Math.ceil(room.clock.smoothedRtt() / 16);
  const watchFrame = (frame, now) => {
    watch.tick(now);
    const drawn = [watch.value(seenByWatcher, 'x'), watch.value(seenByWatcher, 'z')];
    const raw = [seenByWatcher.x, seenByWatcher.z];
    if (frame >= firstMeasuredFrame && frame < frames && remote.last) {
      remote.frames++;
      if (Math.hypot(drawn[0] - remote.last[0], drawn[1] - remote.last[1]) < 1e-6) remote.smoothFrozen++;
      if (Math.hypot(raw[0] - remote.lastRaw[0], raw[1] - remote.lastRaw[1]) < 1e-6) remote.rawFrozen++;
    }
    remote.last = drawn;
    remote.lastRaw = raw;
  };
  let reconciles = 0, corrections = 0, worst = 0, seen = me.reconcileSeq;
  const observe = () => {
    if (me.reconcileSeq === seen) return;
    seen = me.reconcileSeq;
    reconciles++;
    // Position only, as in apps/client: the SDK's lastCorrectionMag also counts vy.
    const { x = 0, y = 0, z = 0 } = me.lastCorrection;
    const pulled = Math.hypot(x, y, z);
    if (pulled > CORRECTION_FLOOR) corrections++;
    worst = Math.max(worst, pulled);
    if (pulled > CORRECTION_FLOOR) onCorrection?.({ pulled, predicted: { ...me.state }, server: self.toJSON() });
  };
  // Like the real client, keep sending (standing still) after the pattern ends so
  // the avatar lands inside the predicted stream; the reconciler only checks the
  // server on acknowledged inputs.
  let frame = 0;
  const runFrames = async count => {
    for (const end = frame + count; frame < end; frame++) {
      const now = performance.now();
      const steps = predict.tick(now);
      for (let i = 0; i < steps; i++) {
        const seq = input.sentCount + 1;
        // Key-like combinations: straight, unnormalized diagonals and single-key releases.
        const [x, z] = frame < frames ? KEY_COMBOS[Math.floor(seq / 7) % KEY_COMBOS.length] : [0, 0];
        input.data.x = x;
        input.data.z = z;
        // Hops every 20 inputs, plus a double tap (jump, then a dive two ticks later) every 45.
        input.data.jump = frame < frames && (seq % 20 === 0 || seq % 45 === 10 || seq % 45 === 12);
        input.send();
      }
      observe();
      watchFrame(frame, now);
      await delay(16);
    }
  };
  await runFrames(frames + 60);
  let backlog;
  if (hitch) {
    // The server's backlog of this client's inputs must drain back after the
    // catch-up burst rather than stay inflated. Read the server's own queue
    // (needs PLAYGROUND_TELEMETRY=1): the client's pendingCount also counts
    // inputs in flight and moves by one or two between 20 Hz patches.
    const sampleBacklog = async () => {
      const samples = [];
      for (let i = 0; i < 5; i++) {
        await runFrames(6);
        samples.push((await room.request('diagnostics', undefined, { timeout: 2000 })).inputBacklog);
      }
      return samples.sort((a, b) => a - b)[2]; // median of five
    };
    const before = await sampleBacklog();
    await delay(400);
    await runFrames(60);
    backlog = { before, afterHitch: await sampleBacklog() };
  }
  await until(() => {
    predict.tick(performance.now());
    observe();
    return input.lastProcessed === input.sentCount;
  }, 'prediction inputs acknowledged', ackTimeout);
  predict.tick(performance.now());
  const result = {
    sent: input.sentCount, reconciles, corrections, worst, predicted: { ...me.state }, server: self.toJSON(),
    remote: { frames: remote.frames, smoothFrozen: remote.smoothFrozen, rawFrozen: remote.rawFrozen },
    backlog,
  };
  predict.dispose();
  watch.dispose();
  return result;
}
