import * as pc from 'playcanvas';
import { Client } from '@colyseus/sdk';
import { GREYBOX_ARENA, TICK_MS } from '@chaos/shared';
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
function box(name: string, color: pc.Color, scale: pc.Vec3) {
  const entity = new pc.Entity(name);
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.update();
  entity.addComponent('render', { type: 'box', material });
  entity.setLocalScale(scale);
  app.root.addChild(entity);
  return entity;
}
const arenaFloor = GREYBOX_ARENA.floor;
const floor = box(GREYBOX_ARENA.id, new pc.Color(0.4, 0.7, 0.45), new pc.Vec3(arenaFloor.width, arenaFloor.thickness, arenaFloor.depth));
floor.setPosition(0, -arenaFloor.thickness / 2, 0);
app.start();
const keys = new Set<string>();
let jump = false;
window.addEventListener('keydown', event => {
  if (!localAvatar || event.target instanceof HTMLButtonElement) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === 'Space' && !event.repeat) jump = true;
});
window.addEventListener('keyup', event => keys.delete(event.code));
const avatars = new Map<string, pc.Entity>();
const env = (import.meta as ImportMeta & { env: { DEV: boolean; VITE_SERVER_URL?: string } }).env;
const endpoint = env.VITE_SERVER_URL ?? `http://${env.DEV ? location.hostname : 'localhost'}:2568`;
const reconnectKey = `playground-seat:${endpoint}`;
const diagnosticsEnabled = new URLSearchParams(location.search).has('diagnostics');
let yaw = 0;
let pitch = Math.atan2(10, 14);
let localAvatar: pc.Entity | undefined;
app.on('update', () => {
  if (!localAvatar) return;
  const { x, y, z } = localAvatar.getPosition();
  const radius = 17 * Math.cos(pitch);
  camera.setPosition(x + radius * Math.sin(yaw), y + 17 * Math.sin(pitch), z + radius * Math.cos(yaw));
  camera.lookAt(x, y, z);
});
button.onclick = async () => {
  button.disabled = true;
  status.textContent = 'Connecting…';
  try {
    const client = new Client(endpoint);
    const token = sessionStorage.getItem(reconnectKey);
    const room = token ? await client.reconnect(token) : await client.joinOrCreate('playground');
    const saveToken = () => sessionStorage.setItem(reconnectKey, room.reconnectionToken);
    saveToken();
    room.reconnection.minUptime = 0;
    button.hidden = true;
    leaveButton.hidden = false;
    leaveButton.onclick = () => { void room.leave(); };
    leaveButton.blur();
    let patches = 0;
    room.onStateChange(state => {
      patches++;
      const alive = new Set<string>();
      state.players.forEach((player: { x: number; y: number; z: number }, id: string) => {
        alive.add(id);
        let entity = avatars.get(id);
        if (!entity) {
          entity = box(id, id === room.sessionId ? new pc.Color(1, 0.8, 0.2) : new pc.Color(0.7, 0.35, 0.9), new pc.Vec3(1, 2, 1));
          avatars.set(id, entity);
        }
        entity.setPosition(player.x, player.y, player.z);
        if (id === room.sessionId) localAvatar = entity;
      });
      for (const [id, entity] of avatars) if (!alive.has(id)) { entity.destroy(); avatars.delete(id); }
    });
    let connected = true;
    const clearInput = () => {
      keys.clear();
      jump = false;
      if (connected) room.sendUnreliable('clear-input');
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
    room.onDrop(() => { connected = false; clearInput(); status.textContent = 'Reconnecting…'; });
    room.onReconnect(() => { connected = true; clearInput(); saveToken(); showControls(); });
    const diagnostics = diagnosticsEnabled ? document.createElement('p') : undefined;
    if (diagnostics) leaveButton.after(diagnostics);
    let requestPending = false;
    const diagnosticsTimer = diagnostics && window.setInterval(async () => {
      const patchCount = patches;
      patches = 0;
      if (!connected || requestPending) return;
      requestPending = true;
      try {
        const started = performance.now();
        const stats = await room.request<undefined, {
          seats: number; connected: number; tickMs: number; inputAgeMs: number | null;
        }>('diagnostics', undefined, { timeout: 1000 });
        const age = stats.inputAgeMs === null ? 'none' : `${Math.round(stats.inputAgeMs)} ms`;
        diagnostics.textContent = `${Math.round(performance.now() - started)} ms RTT · ${stats.connected}/${stats.seats} connected · oldest input ${age} · tick ${stats.tickMs.toFixed(2)} ms · ${patchCount} patches/s`;
      } catch {
        diagnostics.textContent = 'Server diagnostics unavailable.';
      } finally {
        requestPending = false;
      }
    }, 1000);
    const timer = window.setInterval(() => {
      if (!connected || document.hidden || !document.hasFocus()) return;
      const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const back = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
      room.sendUnreliable('input', {
        x: right * Math.cos(yaw) + back * Math.sin(yaw),
        z: back * Math.cos(yaw) - right * Math.sin(yaw), jump
      });
      jump = false;
    }, TICK_MS);
    room.onLeave(() => {
      connected = false;
      clearInput();
      sessionStorage.removeItem(reconnectKey);
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
      window.clearInterval(timer);
      for (const entity of avatars.values()) entity.destroy();
      avatars.clear();
      status.textContent = 'Disconnected. Join again to continue.';
      button.hidden = false; button.disabled = false;
    });
  } catch (error) {
    const expired = sessionStorage.getItem(reconnectKey) !== null;
    sessionStorage.removeItem(reconnectKey);
    status.textContent = expired ? 'Could not recover your seat. Join again to continue.'
      : error instanceof Error ? error.message : 'Connection failed';
    button.disabled = false;
  }
};
if (sessionStorage.getItem(reconnectKey)) button.click();
