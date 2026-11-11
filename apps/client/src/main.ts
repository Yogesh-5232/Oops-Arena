import * as pc from 'playcanvas';
import { Client } from '@colyseus/sdk';
import { Predict, classifyDrift, type Reconciler } from '@colyseus/sdk/predict';
import {
  DASH_BOXES, DASH_GATES, GREYBOX_ARENA, MODE, MOVERS, TICK_MS, dashSpawn, moverCenter, moverWarns, nextInputTick,
  simulateInput, type Box, type Input, type Player,
} from '@chaos/shared';
import { capacity, createButton, joinCode, privateEntry, privatePanel } from './private-ui.js';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const button = document.querySelector<HTMLButtonElement>('#join')!;
const leaveButton = document.createElement('button');
leaveButton.textContent = 'Leave playground';
leaveButton.hidden = true;
button.after(leaveButton);
const app = new pc.Application(canvas, {});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());
app.scene.ambientLight = new pc.Color(0.7, 0.75, 0.8);
const camera = new pc.Entity('camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.32, 0.62, 0.8) });
camera.setPosition(0, 14, 18);
camera.lookAt(0, 0, 0);
app.root.addChild(camera);
function box(name: string, color: pc.Color, scale: pc.Vec3, parent: pc.Entity = app.root) {
  const entity = new pc.Entity(name);
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.update();
  entity.addComponent('render', { type: 'box', material });
  entity.setLocalScale(scale);
  parent.addChild(entity);
  return entity;
}
/** A 1 x 2 x 1 body with a small "nose" on its front face so facing is visible. */
function avatar(id: string, color: pc.Color) {
  const root = new pc.Entity(id);
  app.root.addChild(root);
  box(`${id}-body`, color, new pc.Vec3(1, 2, 1), root);
  box(`${id}-nose`, new pc.Color(0.15, 0.15, 0.2), new pc.Vec3(0.4, 0.4, 0.4), root).setLocalPosition(0, 0.5, 0.6);
  return root;
}
const facing = new pc.Quat();
const tilt = new pc.Quat();
/** Turns an avatar toward its facing; tips it forward while diving and back when knocked (display only). */
function poseAvatar(entity: pc.Entity, state: Pick<Player, 'faceX' | 'faceZ' | 'mode'>) {
  facing.setFromEulerAngles(0, Math.atan2(state.faceX, state.faceZ) * pc.math.RAD_TO_DEG, 0);
  tilt.setFromEulerAngles(state.mode === MODE.diving ? 60 : state.mode === MODE.stunned ? -50 : 0, 0, 0);
  entity.setRotation(facing.mul(tilt));
}
// The arena is drawn from the same box list the simulation collides with.
const BOX_COLORS = {
  floor: new pc.Color(0.4, 0.7, 0.45),
  platform: new pc.Color(0.85, 0.6, 0.35),
  wall: new pc.Color(0.55, 0.55, 0.65),
} as const;
function renderBoxes(pieces: readonly Box[]) {
  return pieces.map(piece => {
    const [x0, y0, z0] = piece.min;
    const [x1, y1, z1] = piece.max;
    const entity = box(piece.id, BOX_COLORS[piece.kind], new pc.Vec3(x1 - x0, y1 - y0, z1 - z0));
    entity.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return entity;
  });
}
const playground = renderBoxes(GREYBOX_ARENA.boxes);
const course = renderBoxes(DASH_BOXES);
DASH_GATES.forEach((gate, index) => {
  const marker = box(`dash-gate-${index}`, new pc.Color(1, 0.75, 0.15), new pc.Vec3(gate.halfWidth * 2, 0.05, 0.8));
  marker.setPosition(gate.x, 0.03, gate.z);
  course.push(marker);
});
function showCourse(visible: boolean) {
  for (const entity of course) entity.enabled = visible;
  for (const entity of playground) entity.enabled = !visible;
  for (const entity of checkpointEntities) entity.enabled = !visible;
}
// Checkpoint pads: thin markers on the floor (they are triggers, not solid).
const checkpointEntities = GREYBOX_ARENA.checkpoints.map(pad => {
  const [x0, , z0] = pad.min;
  const [x1, , z1] = pad.max;
  const entity = box(pad.id, new pc.Color(0.35, 0.75, 0.95), new pc.Vec3(x1 - x0, 0.06, z1 - z0));
  entity.setPosition((x0 + x1) / 2, pad.min[1] + 0.03, (z0 + z1) / 2);
  return entity;
});
// Movers: posed every frame from the shared formula, so they need no network data.
const MOVER_COLORS = { ferry: new pc.Color(0.85, 0.6, 0.35), pusher: new pc.Color(0.75, 0.25, 0.25) } as const;
const WARNING_COLOR = new pc.Color(1, 0.85, 0.2);
const moverEntities = MOVERS.map(mover => {
  const entity = box(mover.id, MOVER_COLORS[mover.kind], new pc.Vec3(...mover.size));
  const material = entity.render!.meshInstances[0]!.material as pc.StandardMaterial;
  return { mover, entity, material };
});
const moverCenterScratch: [number, number, number] = [0, 0, 0];
/** Poses movers at a (possibly fractional) world tick and shows hazard warnings. */
function poseMovers(tick: number) {
  for (const { mover, entity, material } of moverEntities) {
    entity.setPosition(...moverCenter(mover, tick, moverCenterScratch));
    const warning = moverWarns(mover, Math.floor(tick));
    const color = warning ? WARNING_COLOR : MOVER_COLORS[mover.kind];
    if (!material.diffuse.equals(color)) {
      material.diffuse.copy(color);
      material.emissive.copy(warning ? new pc.Color(0.4, 0.3, 0) : pc.Color.BLACK);
      material.update();
    }
  }
}
showCourse(false);
poseMovers(0);
app.start();
const keys = new Set<string>();
let jump = false;
window.addEventListener('keydown', event => {
  if (!localAvatar || (event.target instanceof HTMLElement && event.target.closest('button,input,select'))) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  // Every fresh tap is a jump press; a quick second tap in the air dives (see MOVEMENT.diveWindowTicks).
  if (event.code === 'Space' && !event.repeat) jump = true;
});
window.addEventListener('keyup', event => keys.delete(event.code));
const avatars = new Map<string, pc.Entity>();
const env = (import.meta as ImportMeta & { env: { DEV: boolean; VITE_SERVER_URL?: string } }).env;
// Development builds accept ?server=<url> to route through the lag relay (npm run lag).
// Production ignores it, so a shared link cannot point players at another server.
const devServerOverride = env.DEV ? new URLSearchParams(location.search).get('server') : null;
const endpoint = devServerOverride ?? env.VITE_SERVER_URL ?? `http://${env.DEV ? location.hostname : 'localhost'}:2568`;
const reconnectKey = `playground-seat:${endpoint}`;
const modeKey = `${reconnectKey}:mode`;
const diagnosticsEnabled = new URLSearchParams(location.search).has('diagnostics');
let yaw = 0;
let pitch = Math.atan2(10, 14);
let localAvatar: pc.Entity | undefined;
/** Runs after the local avatar is placed each frame, so the camera never trails it by a frame. */
function followCamera(x: number, y: number, z: number) {
  const radius = 17 * Math.cos(pitch);
  camera.setPosition(x + radius * Math.sin(yaw), y + 17 * Math.sin(pitch), z + radius * Math.cos(yaw));
  camera.lookAt(x, y, z);
}
/** How far in the past other players are drawn: two 50 ms server updates of headroom. */
const REMOTE_DELAY_MS = 100;
/** A jump bigger than this between updates is a teleport (respawn), drawn as a cut, not a glide. */
const TELEPORT_DISTANCE = 3;
async function connect(action: 'playground' | 'create' | 'join') {
  if (button.disabled) return;
  button.disabled = true;
  createButton.disabled = true;
  status.textContent = 'Connecting…';
  try {
    const client = new Client(endpoint);
    const token = sessionStorage.getItem(reconnectKey);
    const room = token ? await client.reconnect(token)
      : action === 'create' ? await client.create('private-dash', { capacity: Number(capacity.value) })
      : action === 'join' ? await client.joinById(joinCode.value.trim().toUpperCase())
      : await client.joinOrCreate('playground');
    const isPrivate = room.name === 'private-dash';
    const saveToken = () => {
      sessionStorage.setItem(reconnectKey, room.reconnectionToken);
      sessionStorage.setItem(modeKey, isPrivate ? 'private' : 'playground');
    };
    saveToken();
    room.reconnection.minUptime = 0;
    button.hidden = true;
    privateEntry.hidden = true;
    leaveButton.hidden = false;
    leaveButton.textContent = isPrivate ? 'Leave room' : 'Leave playground';
    leaveButton.onclick = () => { void room.leave(); };
    leaveButton.blur();
    // One numbered input per server tick. The server simulates each exactly once, in order.
    // WebSocket is ordered and reliable, so the "reliable" channel avoids redundant resends.
    const input = room.input<Input>({ mode: 'reliable' });
    const panel = isPrivate ? privatePanel(
      value => room.sendUnreliable('ready', value),
      () => room.sendUnreliable('start'),
    ) : undefined;
    const canMove = () => !isPrivate || room.state.phase === 'lobby' ||
      ((room.state.phase === 'round' || room.state.phase === 'cooldown') &&
        room.state.guests?.get(room.sessionId)?.racing);
    const predictStep = (ctx: { dt: number }, state: Player, command: Input) => {
      if (!canMove()) return;
      const racing = isPrivate && room.state.phase !== 'lobby';
      simulateInput(state, command, ctx.dt, racing ? DASH_BOXES : undefined, racing ? dashSpawn(state.slot) : undefined);
    };
    // Prediction: the local avatar runs the shared step the moment an input is sent;
    // each server update rewinds to the server's answer and replays unacknowledged inputs.
    // Small disagreements fade out over ~50 ms; jumps over 3 units (teleports) cut instantly.
    // Other players are drawn REMOTE_DELAY_MS in the past, gliding between the two
    // server updates around that moment instead of jumping 20 times a second.
    const predict = Predict.get(room, { mode: 'lerp', delay: REMOTE_DELAY_MS });
    const remoteSmoothing = { mode: 'lerp', snap: TELEPORT_DISTANCE } as const;
    const remoteFields = { x: remoteSmoothing, y: remoteSmoothing, z: remoteSmoothing };
    let me: Reconciler<Player, Input> | undefined;
    let meSource: Player | undefined;
    const sources = new Map<string, Player>();
    const remoteRespawns = new Map<string, number>();
    let showingCourse = false;
    let patches = 0;
    room.onStateChange(state => {
      patches++;
      const courseVisible = isPrivate && state.phase !== 'lobby';
      const sceneChanged = showingCourse !== courseVisible;
      showingCourse = courseVisible;
      if (isPrivate) {
        panel?.render(state, room.sessionId);
        showCourse(courseVisible);
      }
      for (const [id, source] of sources) {
        if (id === room.sessionId || state.players.get(id) === source) continue;
        predict.detach(source);
      }
      state.players.forEach((player: Player, id: string) => {
        const previous = sources.get(id);
        sources.set(id, player);
        let entity = avatars.get(id);
        if (!entity) {
          entity = avatar(id, id === room.sessionId ? new pc.Color(1, 0.8, 0.2) : new pc.Color(0.7, 0.35, 0.9));
          entity.setPosition(player.x, player.y, player.z);
          avatars.set(id, entity);
        }
        if (id !== room.sessionId) {
          if (previous !== player || sceneChanged || remoteRespawns.get(id) !== player.respawns) {
            // Reattaching seeds a fresh interpolation buffer at the new position.
            if (previous === player) predict.detach(player);
            predict.attach(player, remoteFields);
            remoteRespawns.set(id, player.respawns);
          }
          return;
        }
        localAvatar = entity;
        // A resync can hand us a fresh instance; predict from whichever is live.
        if (player !== meSource) {
          me?.dispose();
          meSource = player;
          me = predict.reconciler(player, {
            input, step: predictStep,
            // `fields` is left out on purpose: the SDK then mirrors every scalar on
            // the avatar schema (velocity, grounded, jump timers, mode, facing), so
            // replay never starts from a stale value when the step gains state.
            // No snap here: the SDK compares it against every field, including vy,
            // so a mispredicted jump (vy off by ~6) would pop the avatar instead of
            // gliding. Respawns are cut to instead (see the respawns counter below).
            // The SDK only records correction size and drift when a divergence
            // tolerance is set; Infinity turns the measurement on without warnings.
            warnOnDivergence: Infinity,
          });
        }
      });
      for (const [id, entity] of avatars) {
        if (state.players.has(id)) continue;
        entity.destroy();
        avatars.delete(id);
        sources.delete(id);
        remoteRespawns.delete(id);
      }
    });
    let connected = true;
    // Lost focus: forget held keys. Inputs keep flowing as "stand still", so prediction stays in step.
    const clearInput = () => {
      keys.clear();
      jump = false;
    };
    const onVisibility = () => { if (document.hidden) clearInput(); };
    window.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', onVisibility);
    const showControls = () => {
      if (connected) status.textContent = document.pointerLockElement === canvas
        ? 'Mouse look active. Press Esc to release.'
        : 'Click the arena to enable mouse look.';
    };
    const lockCamera = async () => {
      if (!connected || document.pointerLockElement === canvas) return;
      try { await canvas.requestPointerLock(); }
      catch { status.textContent = 'Mouse look unavailable. You can still move and jump.'; }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas || !connected) return;
      yaw = (yaw - event.movementX * 0.003) % (2 * Math.PI);
      pitch = Math.max(0.15, Math.min(1.35, pitch + event.movementY * 0.003));
    };
    const onLockError = () => {
      if (connected) status.textContent = 'Mouse look unavailable. You can still move and jump.';
    };
    canvas.addEventListener('click', lockCamera);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', showControls);
    document.addEventListener('pointerlockerror', onLockError);
    showControls();
    room.onDrop(() => { connected = false; panel?.setConnected(false); clearInput(); status.textContent = 'Reconnecting…'; });
    room.onReconnect(() => { connected = true; panel?.setConnected(true); clearInput(); saveToken(); showControls(); });
    // Corrections: how often, and how far, the server's answer disagreed with our prediction.
    const CORRECTION_FLOOR = 0.001;
    let lastReconcile = 0;
    let corrections = 0;
    let worstCorrection = 0;
    const diagnostics = diagnosticsEnabled ? document.createElement('p') : undefined;
    if (diagnostics) leaveButton.after(diagnostics);
    let requestPending = false;
    const diagnosticsTimer = diagnostics && window.setInterval(async () => {
      const patchCount = patches;
      patches = 0;
      const correctionText = me
        ? `${corrections} corrections/s, worst ${worstCorrection.toFixed(3)} · drift ${classifyDrift(me.drift, 0.01)}`
        : 'no prediction yet';
      corrections = 0;
      worstCorrection = 0;
      if (!connected || requestPending) return;
      requestPending = true;
      try {
        const started = performance.now();
        const stats = await room.request<undefined, {
          seats: number; connected: number; tickMs: number; inputBacklog: number; inputAgeMs: number | null;
        }>('diagnostics', undefined, { timeout: 1000 });
        const inputAge = stats.inputAgeMs == null ? '—' : `${Math.round(stats.inputAgeMs)} ms`;
        diagnostics.textContent = `${Math.round(performance.now() - started)} ms RTT · ${stats.connected}/${stats.seats} connected · input age ${inputAge} · input backlog ${stats.inputBacklog} · ${input.pendingCount} unacked · ${correctionText} · tick ${stats.tickMs.toFixed(2)} ms · ${patchCount} patches/s · jitter ${room.clock.jitter().toFixed(1)} ms (others drawn ${REMOTE_DELAY_MS} ms behind)`;
      } catch {
        diagnostics.textContent = 'Server diagnostics unavailable.';
      } finally {
        requestPending = false;
      }
    }, 1000);
    // Per frame: predict.tick paces sends at the server's 30 Hz (at most 5 catch-up
    // steps after a stall) and folds in server answers. Send first, then read the
    // predicted pose, so the avatar is drawn from this frame's inputs.
    // The clock is built from PlayCanvas' frame dt, which comes from the vsync-aligned
    // requestAnimationFrame timestamp; reading performance.now() here would add scheduling jitter.
    let frameClock = performance.now();
    // World tick estimate: the tick in the latest update plus how long ago the
    // server sent it. Inputs are stamped with consecutive ticks from it.
    const estimateTick = () => {
      const tick = (room.state as { tick?: number }).tick ?? 0;
      const sentAt = room.clock.lastServerTime();
      return sentAt > 0 ? tick + (room.clock.serverNow() - sentAt) / TICK_MS : tick;
    };
    let sentTick: number | undefined;
    let shownRespawns: number | undefined;
    let cutFrames = 0;
    const frame = (dt: number) => {
      frameClock += dt * 1000;
      const steps = predict.tick(frameClock);
      for (let i = 0; i < steps; i++) {
        sentTick = nextInputTick(sentTick, estimateTick());
        input.data.tick = sentTick;
        const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
        const back = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
        input.data.x = right * Math.cos(yaw) + back * Math.sin(yaw);
        input.data.z = back * Math.cos(yaw) - right * Math.sin(yaw);
        input.data.jump = jump;
        input.send();
        jump = false;
      }
      if (me && me.reconcileSeq !== lastReconcile) {
        lastReconcile = me.reconcileSeq;
        // Position only: the SDK's lastCorrectionMag also counts vy, a velocity.
        const { x = 0, y = 0, z = 0 } = me.lastCorrection;
        const pulled = Math.hypot(x, y, z);
        if (pulled > CORRECTION_FLOOR) corrections++;
        worstCorrection = Math.max(worstCorrection, pulled);
      }
      // Movers are drawn at our own smoothed simulation tick, the same moment our
      // predicted avatar is drawn at, so a rider stays glued to the deck.
      poseMovers(me && meSource ? predict.value(meSource, 'simTick') : estimateTick());
      // A respawn jumps the predicted position: cut to it instead of gliding for a frame.
      if (me && me.state.respawns !== shownRespawns) {
        if (shownRespawns !== undefined) cutFrames = 2;
        shownRespawns = me.state.respawns;
      }
      // One read for everyone: predicted for the local avatar, interpolated for the rest.
      for (const [id, entity] of avatars) {
        const source = sources.get(id);
        if (!source) continue;
        const exact = entity === localAvatar && cutFrames > 0 ? me?.state : undefined;
        const x = exact ? exact.x : predict.value(source, 'x');
        const y = exact ? exact.y : predict.value(source, 'y');
        const z = exact ? exact.z : predict.value(source, 'z');
        entity.setPosition(x, y, z);
        // Facing and dive tilt: our own from the prediction, others from the latest update.
        poseAvatar(entity, entity === localAvatar && me ? me.state : source);
        if (entity === localAvatar) followCamera(x, y, z);
      }
      if (cutFrames > 0) cutFrames--;
    };
    app.on('update', frame);
    room.onLeave(code => {
      connected = false;
      clearInput();
      sessionStorage.removeItem(reconnectKey);
      sessionStorage.removeItem(modeKey);
      panel?.dispose();
      showCourse(false);
      leaveButton.hidden = true;
      leaveButton.onclick = null;
      canvas.removeEventListener('click', lockCamera);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', showControls);
      document.removeEventListener('pointerlockerror', onLockError);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      localAvatar = undefined;
      if (diagnosticsTimer !== undefined) window.clearInterval(diagnosticsTimer);
      diagnostics?.remove();
      window.removeEventListener('blur', clearInput);
      document.removeEventListener('visibilitychange', onVisibility);
      app.off('update', frame);
      predict.dispose();
      me = undefined;
      meSource = undefined;
      sources.clear();
      remoteRespawns.clear();
      for (const entity of avatars.values()) entity.destroy();
      avatars.clear();
      status.textContent = isPrivate && code !== 4000
        ? 'Connection lost. Your private session was interrupted.' : 'Ready to play';
      button.hidden = false; button.disabled = false;
      privateEntry.hidden = false; createButton.disabled = false;
    });
  } catch (error) {
    const expired = sessionStorage.getItem(reconnectKey) !== null;
    const privateRecovery = sessionStorage.getItem(modeKey) === 'private';
    sessionStorage.removeItem(reconnectKey);
    sessionStorage.removeItem(modeKey);
    status.textContent = expired ? privateRecovery ? 'Could not recover your private session. Join again to continue.'
      : 'Could not recover your seat. Join again to continue.'
      : error instanceof Error ? error.message : 'Connection failed';
    button.disabled = false;
    createButton.disabled = false;
  }
}
button.onclick = () => { void connect('playground'); };
createButton.onclick = () => { if (capacity.reportValidity()) void connect('create'); };
privateEntry.onsubmit = event => {
  event.preventDefault();
  if (joinCode.reportValidity()) void connect('join');
};
if (sessionStorage.getItem(reconnectKey)) button.click();
