// Shared helpers for the smoke test and the lag test: start the built server,
// and drive a scripted, predicting player while another client watches it.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Predict } from '@colyseus/sdk/predict';
import { MODE, MOVERS, TICK_MS, nextInputTick, simulateInput } from '@chaos/shared';

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
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NODE_ENV: 'test', PLAYGROUND_TEST_COURSE: '1', ...env, PORT: String(port) },
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

/** The client's world tick estimate, as in apps/client. */
export function estimateTick(room) {
  const tick = room.state.tick ?? 0;
  const sentAt = room.clock.lastServerTime();
  return sentAt > 0 ? tick + (room.clock.serverNow() - sentAt) / TICK_MS : tick;
}

/** Wander: key combinations (straight, unnormalized diagonals, releases), hops and double-tap dives. */
function wanderRoute(frames) {
  return (state, tick, seq, frame) => {
    if (frame >= frames) return { x: 0, z: 0, jump: false, done: true };
    const [x, z] = KEY_COMBOS[Math.floor(seq / 7) % KEY_COMBOS.length];
    return { x, z, jump: seq % 20 === 0 || seq % 45 === 10 || seq % 45 === 12, done: false };
  };
}

const [FERRY] = MOVERS;
const FERRY_LOOP = FERRY.legs.reduce((sum, leg) => sum + leg.ticks, 0);
/** Unit-ish direction toward a target, slowing on the last step so it stops on it. */
function toward(state, x, z) {
  const dx = x - state.x;
  const dz = z - state.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.05) return undefined;
  const scale = Math.min(1, distance / 0.2) / distance;
  return [dx * scale, dz * scale];
}
/**
 * Course: stand in the pusher's lane until knocked back, walk to the east pit
 * edge, wait for the ferry, ride it across, step onto the east checkpoint pad,
 * then walk off the ledge and respawn on that pad. Steers by the predicted
 * state, like a player would. Reports which parts happened.
 */
function courseRoute(report) {
  let phase = 'toLane';
  let since = 0;
  let respawnsAtStart;
  const waypoints = { toLane: [[-4, -10.5]], toEdge: [[13, -6], [14.2, 0]], board: [[16.5, 0]], toPad: [[27, 0]], jumpOff: [[27, 6]] };
  let waypoint = 0;
  const follow = state => {
    const points = waypoints[phase];
    while (waypoint < points.length) {
      const direction = toward(state, ...points[waypoint]);
      if (direction) return direction;
      waypoint++;
    }
    return undefined;
  };
  const next = (name, tick) => { phase = name; since = tick; waypoint = 0; };
  return (state, tick) => {
    respawnsAtStart ??= state.respawns;
    const stand = { x: 0, z: 0, jump: false, done: false };
    switch (phase) {
      case 'toLane': {
        const direction = follow(state);
        if (direction) return { ...stand, x: direction[0], z: direction[1] };
        next('waitHit', tick);
        return stand;
      }
      case 'waitHit': {
        if (state.mode === MODE.stunned) report.hit = true;
        if ((report.hit && state.mode === MODE.normal) || tick - since > 300) {
          next('toEdge', tick);
          return stand;
        }
        // The returning pusher can shove us west, behind its resting spot, where its
        // back blocks the lane. Step north out of the lane, walk around, come back in.
        if (report.hit || state.mode !== MODE.normal || Math.hypot(state.x + 4, state.z + 10.5) < 0.5) return stand;
        const behind = state.x < -6 && state.z < -8.5;
        const back = behind ? toward(state, state.x, -7.5) : state.x < -4.5 ? toward(state, -4, -7.5) : toward(state, -4, -10.5);
        return back ? { ...stand, x: back[0], z: back[1] } : stand;
      }
      case 'toEdge': {
        const direction = follow(state);
        if (direction) return { ...stand, x: direction[0], z: direction[1] };
        next('waitFerry', tick);
        return stand;
      }
      case 'waitFerry': {
        // Board during the first half of the ferry's pause at the near end.
        const inLoop = ((tick % FERRY_LOOP) + FERRY_LOOP) % FERRY_LOOP;
        if (inLoop < FERRY.legs[0].ticks - 15) next('board', tick);
        return stand;
      }
      case 'board': {
        const direction = follow(state);
        if (direction) return { ...stand, x: direction[0], z: direction[1] };
        report.boarded = state.ground === 1;
        next('ride', tick);
        return stand;
      }
      case 'ride': {
        const inLoop = ((tick % FERRY_LOOP) + FERRY_LOOP) % FERRY_LOOP;
        const arrived = FERRY.legs[0].ticks + FERRY.legs[1].ticks;
        if (inLoop >= arrived && inLoop < arrived + FERRY.legs[2].ticks) next('toPad', tick);
        return stand;
      }
      case 'toPad': {
        const direction = follow(state);
        if (direction) return { ...stand, x: direction[0], z: direction[1] };
        report.crossed = state.x > 24 && state.checkpoint === 2;
        next('jumpOff', tick);
        return stand;
      }
      case 'jumpOff': {
        if (state.respawns !== respawnsAtStart) {
          report.respawned = state.checkpoint === 2 && Math.abs(state.x - 27) < 1e-9;
          next('done', tick);
          return { ...stand, done: true };
        }
        const direction = follow(state) ?? [0, 1];
        return { ...stand, x: direction[0], z: direction[1] };
      }
      default:
        return { ...stand, done: true };
    }
  };
}

/**
 * Drives a predicting client with a scripted route for up to `frames` 16 ms
 * frames, then waits for the server to acknowledge everything. Inputs are
 * stamped with world ticks exactly as apps/client stamps them.
 * - route 'wander': key combinations, hops and dives around the spawn, bumping
 *   into whatever boxes are in the way. Meanwhile `watcher` draws the mover
 *   through remote smoothing; a frame where it did not move is "frozen".
 * - route 'course': the pusher, the ferry, a checkpoint and a respawn (see
 *   courseRoute); `result.course` says which happened.
 * With `hitch`, a 400 ms pause (no frames, no sends) follows the route.
 */
export async function drivePrediction(room, frames, watcher, { route = 'wander', hitch = false, ackTimeout = 5000, onCorrection } = {}) {
  const course = {};
  const nextInputs = route === 'course' ? courseRoute(course) : wanderRoute(frames);
  let sentTick;
  let routeDone = false;
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
    if (route === 'wander' && frame >= firstMeasuredFrame && frame < frames && remote.last) {
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
        sentTick = nextInputTick(sentTick, estimateTick(room));
        const next = routeDone
          ? { x: 0, z: 0, jump: false, done: true }
          : nextInputs(me.state, sentTick, input.sentCount + 1, frame);
        routeDone ||= next.done;
        Object.assign(input.data, { x: next.x, z: next.z, jump: next.jump, tick: sentTick });
        input.send();
      }
      observe();
      watchFrame(frame, now);
      await delay(16);
    }
  };
  while (!routeDone && frame < frames) await runFrames(1);
  routeDone = true;
  await runFrames(60);
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
    course: route === 'course' ? { hit: false, boarded: false, crossed: false, respawned: false, ...course } : undefined,
  };
  predict.dispose();
  watch.dispose();
  return result;
}
