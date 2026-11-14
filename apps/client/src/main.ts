import * as pc from 'playcanvas';
import { Client } from '@colyseus/sdk';
import { Predict, classifyDrift, type Reconciler } from '@colyseus/sdk/predict';
import {
  ARENA_BUILD, MODE, PLAYLISTS, PLAZA_PORTALS, TICK_MS, arenaManifest, nextInputTick, plazaPortalAt, resolveCargo, resolveDodgeHazards, resolveLava, simulateInput, teamWorld,
  type Input, type Player,
} from '@chaos/shared';
import { ArenaStage } from './arena-stage.js';
import { ArenaView, TEAM_COLORS, createMaterial, materialCount, solid } from './arena-view.js';
import { LavaKit } from './lava-kit.js';
import { PlazaKit } from './plaza-kit.js';
import { capacity, createButton, createPartyButton, joinCode, privateEntry, privatePanel } from './private-ui.js';
import { RemotePose } from './remote-pose.js';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const portalPrompt = document.querySelector<HTMLParagraphElement>('#portal-prompt')!;
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
function framePlaza() {
  camera.setPosition(0, 11, 23);
  camera.lookAt(0, 0.6, -3);
}
framePlaza();
app.root.addChild(camera);
// Avatars share one material per color, so joins and leaves never allocate materials.
const avatarMaterials = new Map<string, pc.StandardMaterial>();
function avatarMaterial(color: pc.Color) {
  const key = `${color.r},${color.g},${color.b}`;
  let material = avatarMaterials.get(key);
  if (!material) avatarMaterials.set(key, material = createMaterial(color));
  return material;
}
const LOCAL_COLOR = new pc.Color(1, 0.8, 0.2);
const REMOTE_COLOR = new pc.Color(0.7, 0.35, 0.9);
const NOSE_COLOR = new pc.Color(0.15, 0.15, 0.2);
const avatarColorParts = new WeakMap<pc.Entity, pc.Entity>();
const toyUrl = new URL('./assets/oops-arena-base-toy-rigged.glb', import.meta.url).href;
const avatarAnimations = new WeakMap<pc.Entity, pc.AnimComponentLayer>();
const toyGraph = new pc.AnimStateGraph({
  layers: [{
    name: 'Base',
    states: [{ name: 'START' }, { name: 'Idle', loop: true }, { name: 'Run', loop: true }],
    transitions: [{ from: 'START', to: 'Idle' }],
  }],
  parameters: {},
});
let toy: { container: pc.ContainerResource; idle: pc.AnimTrack; run: pc.AnimTrack } | undefined;

function showToy(root: pc.Entity, material: pc.Material) {
  if (!toy) return;
  const model = toy.container.instantiateRenderEntity();
  // The model is two units tall with a floor origin. The player root is at the collider center.
  model.setLocalPosition(0, -1, 0);
  root.addChild(model);
  model.addComponent('anim');
  const anim = model.anim!;
  anim.loadStateGraph(toyGraph);
  anim.assignAnimation('Idle', toy.idle);
  anim.assignAnimation('Run', toy.run);
  const layer = anim.baseLayer!;
  layer.play('Idle');
  avatarAnimations.set(root, layer);
  root.findByName('Avatar placeholder')?.destroy();
  const marker = solid('Player marker', material, new pc.Vec3(0.2, 0.2, 0.2), root);
  avatarColorParts.set(root, marker);
  marker.setLocalPosition(0, 1.32, 0);
  marker.setLocalEulerAngles(45, 0, 45);
}

function avatar(id: string, color: pc.Color) {
  const root = new pc.Entity(id);
  app.root.addChild(root);
  if (toy) {
    showToy(root, avatarMaterial(color));
  } else {
    const placeholder = new pc.Entity('Avatar placeholder');
    root.addChild(placeholder);
    avatarColorParts.set(root, solid('Body', avatarMaterial(color), new pc.Vec3(1, 2, 1), placeholder));
    solid('Nose', avatarMaterial(NOSE_COLOR), new pc.Vec3(0.4, 0.4, 0.4), placeholder).setLocalPosition(0, 0.5, 0.6);
  }
  return root;
}
/** Recolors the player marker or placeholder body using the shared team materials. */
function colorAvatar(entity: pc.Entity, color: pc.Color) {
  const part = avatarColorParts.get(entity);
  const material = avatarMaterial(color);
  if (part?.render && part.render.material !== material) part.render.material = material;
}
const facing = new pc.Quat();
const tilt = new pc.Quat();
/** Turns an avatar toward its facing; tips it forward while diving and back when knocked (display only). */
function poseAvatar(entity: pc.Entity, state: Player) {
  facing.setFromEulerAngles(0, Math.atan2(state.faceX, state.faceZ) * pc.math.RAD_TO_DEG, 0);
  tilt.setFromEulerAngles(state.mode === MODE.diving ? 60 : state.mode === MODE.stunned ? -50 : 0, 0, 0);
  entity.setRotation(facing.mul(tilt));
  const animation = avatarAnimations.get(entity);
  if (animation) {
    const running = state.grounded && state.mode === MODE.normal && Math.hypot(state.vx, state.vz) > 0.2;
    const next = running ? 'Run' : 'Idle';
    if (animation.activeState !== next) animation.transition(next, 0.12);
  }
}
// One arena tree on screen and at most one more prefetched for the next transition.
// Each is built from the same manifest the simulation collides with.
const plazaKit = new PlazaKit(app);
const lavaKit = new LavaKit(app);
const arenas = new ArenaStage(id => new ArenaView(app.root, arenaManifest(id), plazaKit, lavaKit));
arenas.show('plaza');
arenas.current?.pose(0);
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
app.assets.loadFromUrl(toyUrl, 'container', (error, asset) => {
  if (error || !asset?.resource) {
    console.warn('Could not load the wind-up toy avatar.', error);
    return;
  }
  const container = asset.resource as pc.ContainerResource;
  const idle = container.animations.find(clip => clip.resource?.name === 'Idle')?.resource;
  const run = container.animations.find(clip => clip.resource?.name === 'Run')?.resource;
  if (!idle || !run) {
    console.warn('The wind-up toy is missing its Idle or Run clip.');
    return;
  }
  toy = { container, idle, run };
  for (const entity of avatars.values()) {
    const material = avatarColorParts.get(entity)?.render?.material;
    if (material) showToy(entity, material);
  }
});
const env = (import.meta as ImportMeta & { env: { DEV: boolean; VITE_SERVER_URL?: string } }).env;
// Development builds accept ?server=<url> to route through the lag relay (npm run lag).
// Production ignores it, so a shared link cannot point players at another server.
const devServerOverride = env.DEV ? new URLSearchParams(location.search).get('server') : null;
const endpoint = devServerOverride ?? env.VITE_SERVER_URL ?? `http://${env.DEV ? location.hostname : 'localhost'}:2568`;
const reconnectKey = `playground-seat:${endpoint}`;
const modeKey = `${reconnectKey}:mode`;
const diagnosticsEnabled = new URLSearchParams(location.search).has('diagnostics');
if (diagnosticsEnabled) {
  // Leak checks: entity and material totals should return to the same baseline after every transition.
  const countEntities = (node: pc.GraphNode): number => node.children.reduce((total, child) => total + countEntities(child), 1);
  Object.assign(window, {
    oopsArena: {
      build: ARENA_BUILD,
      stats: () => ({
        entities: countEntities(app.root), materials: materialCount(),
        arena: arenas.current?.id, prefetched: arenas.next?.id,
      }),
    },
  });
}
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
const PORTAL_ENTRY_MS = 1_050;
type PortalTarget = { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
type PortalEntry = {
  startedAt: number;
  targets: Map<string, PortalTarget>;
};
/** Positions every party member across the mouth of a plaza portal for the short entry animation. */
function portalEntryTarget(index: number, count: number, portal: (typeof PLAZA_PORTALS)[number]): { x: number; y: number; z: number } {
  const spacing = Math.min(0.44, 1.7 / Math.max(1, count - 1));
  const across = (index - (count - 1) / 2) * spacing;
  const forward = 0.95;
  const cos = Math.cos(portal.yaw);
  const sin = Math.sin(portal.yaw);
  return { x: portal.x + cos * across + sin * forward, y: 1, z: portal.z - sin * across + cos * forward };
}
function easePortalEntry(progress: number): number { return progress * progress * (3 - 2 * progress); }
async function connect(action: 'playground' | 'create' | 'create-party' | 'join') {
  if (button.disabled) return;
  button.disabled = true;
  createButton.disabled = createPartyButton.disabled = true;
  status.textContent = 'Connecting…';
  try {
    const client = new Client(endpoint);
    const token = sessionStorage.getItem(reconnectKey);
    const room = token ? await client.reconnect(token)
      : action === 'create' || action === 'create-party' ? await client.create('private-dash', {
        capacity: Number(capacity.value), party: action === 'create-party', build: ARENA_BUILD,
      })
      : action === 'join' ? await client.joinById(joinCode.value.trim().toUpperCase(), { build: ARENA_BUILD })
      : await client.joinOrCreate('playground', { build: ARENA_BUILD });
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
      () => room.send('start'),
      value => room.send('preset', value),
      () => room.sendUnreliable('renew-invite'),
    ) : undefined;
    const canMove = (id: string) => {
      if (!isPrivate) return true;
      const guest = room.state.guests?.get(id);
      return guest?.connected && (room.state.phase === 'lobby' ||
        (guest.racing && (room.state.phase === 'round' || room.state.phase === 'cooldown')));
    };
    const predictStep = (ctx: { dt: number }, state: Player, command: Input) => {
      if (!canMove(room.sessionId)) return;
      // The same manifest the server's arena run collides with.
      const arena = arenaManifest(isPrivate ? room.state.arenaId : 'plaza');
      const before = { x: state.x, y: state.y, z: state.z };
      const teamArena = arena.hazards === 'team';
      // Team arenas collide with the server's crates at their latest replicated positions.
      const boxes = teamArena ? teamWorld(room.state.cargo0, room.state.cargo1) : arena.boxes;
      const team = Math.max(0, room.state.guests?.get(room.sessionId)?.team ?? 0);
      const peers: Player[] = [];
      room.state.players.forEach((peer: Player, id: string) => {
        if (id !== room.sessionId && canMove(id)) peers.push(peer);
      });
      simulateInput(state, command, ctx.dt, boxes, arena.spawn?.(state.slot, team), undefined, arena.movers, peers);
      if (arena.hazards === 'dodge') resolveDodgeHazards(
        state, before, room.state.arenaSeed, room.state.arenaStartTick, state.simTick, arena.dodge,
      );
      else if (arena.hazards === 'lava') resolveLava(state, state.simTick - room.state.arenaStartTick, room.state.roundTicks);
      else if (teamArena) resolveCargo(state, room.state.cargo0, room.state.cargo1);
    };
    // Prediction: the local avatar runs the shared step the moment an input is sent;
    // each server update rewinds to the server's answer and replays unacknowledged inputs.
    // Small disagreements fade out over ~50 ms; jumps over 3 units (teleports) cut instantly.
    // Other players are drawn REMOTE_DELAY_MS in the past, gliding between the two
    // server updates around that moment instead of jumping 20 times a second.
    const predict = Predict.get(room);
    let me: Reconciler<Player, Input> | undefined;
    let meSource: Player | undefined;
    const sources = new Map<string, Player>();
    const remotePoses = new Map<string, RemotePose>();
    const remotePosition = { x: 0, y: 0, z: 0 };
    let shownArena = 'plaza';
    let gameArenaId = 'plaza';
    let portalEntry: PortalEntry | undefined;
    let patches = 0;
    room.onStateChange(state => {
      patches++;
      const arenaId = isPrivate ? arenaManifest(state.arenaId).id : 'plaza';
      const entryPortal = PLAZA_PORTALS.find(portal => portal.preset === state.preset && portal.preset === arenaId);
      if (entryPortal && isPrivate && !portalEntry && shownArena === 'plaza' &&
          state.phase === 'countdown' && state.roundIndex === 0) {
        const targets = new Map<string, PortalTarget>();
        const count = Math.max(1, state.players.size);
        let index = 0;
        state.players.forEach((player: Player, id: string) => {
          const visible = avatars.get(id);
          const position = visible?.getPosition() ?? player;
          targets.set(id, { from: { x: position.x, y: position.y, z: position.z }, to: portalEntryTarget(index++, count, entryPortal) });
        });
        portalEntry = { startedAt: performance.now(), targets };
      }
      gameArenaId = arenaId;
      const displayArenaId = portalEntry ? 'plaza' : arenaId;
      const sceneChanged = shownArena !== displayArenaId;
      shownArena = displayArenaId;
      arenas.show(displayArenaId);
      if (isPrivate) {
        panel?.render(state, room.sessionId);
        arenas.prefetch(state.nextArenaId);
      }
      const sampledAt = performance.now();
      state.players.forEach((player: Player, id: string) => {
        const previous = sources.get(id);
        sources.set(id, player);
        let entity = avatars.get(id);
        if (!entity) {
          entity = avatar(id, id === room.sessionId ? LOCAL_COLOR : REMOTE_COLOR);
          entity.setPosition(player.x, player.y, player.z);
          avatars.set(id, entity);
        }
        // Teammates and opponents wear their team color in team arenas; you stay yellow.
        const team = isPrivate && arenaId === 'team' ? state.guests?.get(id)?.team ?? -1 : -1;
        colorAvatar(entity, id === room.sessionId ? LOCAL_COLOR : team >= 0 ? TEAM_COLORS[team]! : REMOTE_COLOR);
        if (id !== room.sessionId) {
          let pose = remotePoses.get(id);
          if (!pose || previous !== player || sceneChanged) remotePoses.set(id, pose = new RemotePose());
          pose.push(player, sampledAt);
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
        remotePoses.delete(id);
      }
    });
    let connected = true;
    const currentPortal = () => {
      const player = me?.state;
      if (!connected || !isPrivate || room.state.phase !== 'lobby' || room.state.hostId !== room.sessionId ||
        !player?.grounded || player.y > 1.25) return;
      return plazaPortalAt(player.x, player.z);
    };
    const selectPortal = (event: KeyboardEvent) => {
      if (event.code !== 'KeyE' || event.repeat ||
        (event.target instanceof HTMLElement && event.target.closest('button,input,select,textarea,[contenteditable]'))) return;
      const portal = currentPortal();
      if (portal) room.send('preset', portal.preset);
    };
    window.addEventListener('keydown', selectPortal);
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
          seats: number; connected: number; tickMs: number; inputBacklog: number; inputAgeMs: number | null; arenaRuns: number;
        }>('diagnostics', undefined, { timeout: 1000 });
        const inputAge = stats.inputAgeMs == null ? '—' : `${Math.round(stats.inputAgeMs)} ms`;
        diagnostics.textContent = `${Math.round(performance.now() - started)} ms RTT · ${stats.connected}/${stats.seats} connected · input age ${inputAge} · input backlog ${stats.inputBacklog} · ${input.pendingCount} unacked · ${correctionText} · tick ${stats.tickMs.toFixed(2)} ms · ${patchCount} patches/s · jitter ${room.clock.jitter().toFixed(1)} ms (others drawn ${REMOTE_DELAY_MS} ms behind) · arena ${arenas.current?.id ?? '—'}${arenas.next ? ` (next ${arenas.next.id} loaded)` : ''} · ${stats.arenaRuns} server arena runs · build ${ARENA_BUILD}`;
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
      const worldTick = meSource && canMove(room.sessionId) ? predict.value(meSource, 'simTick') : estimateTick();
      // Hazards only run during a round itself; the server scores nothing outside it.
      const roundLive = isPrivate && room.state.arenaId !== 'plaza' &&
        (room.state.phase === 'round' || room.state.phase === 'cooldown');
      if (portalEntry && performance.now() - portalEntry.startedAt >= PORTAL_ENTRY_MS) {
        portalEntry = undefined;
        shownArena = gameArenaId;
        arenas.show(gameArenaId);
      }
      arenas.current?.pose(worldTick, roundLive ? {
        seed: room.state.arenaSeed, elapsedTicks: worldTick - room.state.arenaStartTick, roundTicks: room.state.roundTicks,
      } : undefined, isPrivate ? { cargo: [room.state.cargo0, room.state.cargo1], gates: room.state.gates } : undefined);
      // A respawn jumps the predicted position: cut to it instead of gliding for a frame.
      if (me && me.state.respawns !== shownRespawns) {
        if (shownRespawns !== undefined) cutFrames = 2;
        shownRespawns = me.state.respawns;
      }
      // The arena is already active on the server during this visual transition.
      if (portalEntry) {
        const progress = easePortalEntry(Math.min(1, (performance.now() - portalEntry.startedAt) / PORTAL_ENTRY_MS));
        for (const [id, entity] of avatars) {
          const target = portalEntry.targets.get(id);
          if (!target) continue;
          const x = target.from.x + (target.to.x - target.from.x) * progress;
          const y = target.from.y + (target.to.y - target.from.y) * progress;
          const z = target.from.z + (target.to.z - target.from.z) * progress;
          entity.setPosition(x, y, z);
          avatarAnimations.get(entity)?.transition('Run', 0.1);
          if (entity === localAvatar) followCamera(x, y, z);
        }
      } else {
        // One read for everyone: predicted for the local avatar, interpolated for the rest.
        const remoteTime = performance.now() - REMOTE_DELAY_MS;
        const movers = arenaManifest(shownArena).movers;
        for (const [id, entity] of avatars) {
        const source = sources.get(id);
        if (!source) continue;
        if (entity !== localAvatar) {
          if (remotePoses.get(id)?.read(remoteTime, movers, worldTick, remotePosition)) {
            entity.setPosition(remotePosition.x, remotePosition.y, remotePosition.z);
          }
          poseAvatar(entity, source);
          continue;
        }
        const exact = entity === localAvatar && cutFrames > 0 ? me?.state : undefined;
        const x = exact ? exact.x : predict.value(source, 'x');
        const y = exact ? exact.y : predict.value(source, 'y');
        const z = exact ? exact.z : predict.value(source, 'z');
        entity.setPosition(x, y, z);
        // Facing and dive tilt: our own from the prediction, others from the latest update.
        poseAvatar(entity, entity === localAvatar && me ? me.state : source);
        if (entity === localAvatar) followCamera(x, y, z);
        }
      }
      if (cutFrames > 0) cutFrames--;
      const portal = currentPortal();
      const prompt = portal
        ? room.state.preset === portal.preset ? `${PLAYLISTS[portal.preset].name} selected` : `Press E to select ${PLAYLISTS[portal.preset].name}`
        : '';
      if (portalPrompt.textContent !== prompt) portalPrompt.textContent = prompt;
      portalPrompt.hidden = !prompt;
    };
    app.on('update', frame);
    room.onLeave(code => {
      connected = false;
      window.removeEventListener('keydown', selectPortal);
      portalPrompt.hidden = true;
      clearInput();
      sessionStorage.removeItem(reconnectKey);
      sessionStorage.removeItem(modeKey);
      panel?.dispose();
      arenas.show('plaza');
      arenas.prefetch('');
      framePlaza();
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
      remotePoses.clear();
      for (const entity of avatars.values()) entity.destroy();
      avatars.clear();
      status.textContent = isPrivate && code !== 4000
        ? 'Connection lost. Your private session was interrupted.' : 'Ready to play';
      button.hidden = false; button.disabled = false;
      privateEntry.hidden = false; createButton.disabled = createPartyButton.disabled = false;
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
    createButton.disabled = createPartyButton.disabled = false;
  }
}
button.onclick = () => { void connect('playground'); };
createButton.onclick = () => { if (capacity.reportValidity()) void connect('create'); };
createPartyButton.onclick = () => { if (capacity.reportValidity()) void connect('create-party'); };
privateEntry.onsubmit = event => {
  event.preventDefault();
  if (joinCode.reportValidity()) void connect('join');
};
if (sessionStorage.getItem(reconnectKey)) button.click();
