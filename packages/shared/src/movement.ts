import { GREYBOX_ARENA, type Box } from './arena.js';
import { HALF_EXTENTS, overlaps, sweepAxis, type Vec3 } from './collision.js';
import { MOVERS, moverBox, moverCenter, moverKnocks, type Mover } from './movers.js';

/**
 * One tick of player intent. `jump` is a fresh press: true on one tick per tap.
 * `tick` is the world tick the client believed it was in when it sampled the
 * input; the step evaluates moving boxes at that tick (the server clamps it).
 */
export type Input = { x: number; z: number; jump: boolean; tick: number };

/** What a player is doing; integers so they travel compactly and compare exactly. */
export const MODE = { normal: 0, diving: 1, recovering: 2, stunned: 3 } as const;

/**
 * Everything the step reads or writes. All of it is replicated and mirrored by
 * client prediction, so the predicted step starts from exactly the server's state.
 */
export type Player = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Standing on something at the end of the last step. */
  grounded: boolean;
  /** Mover the player is standing on: 0 for none or static ground, else mover index + 1. */
  ground: number;
  /** World tick of the last input simulated for this player. */
  simTick: number;
  /** Ticks left in which a recent jump press will still fire (jump buffering). */
  jumpBuffer: number;
  /** Ticks left in which a jump still works after walking off an edge (coyote time). */
  coyote: number;
  mode: number;
  /** Ticks left in the current recovery. */
  modeTicks: number;
  /** Ticks since this airborne stretch's jump, or NO_JUMP when standing or not jumping. */
  sinceJump: number;
  /** Ticks of protection left from hazard hits (after a hit, and after respawning). */
  shield: number;
  /** Last checkpoint touched: 0 for the player's own spawn, else pad index + 1. */
  checkpoint: number;
  /** Counts respawns (wrapping at 256) so clients can cut, not glide, to the new spot. */
  respawns: number;
  /** Unit direction the player last moved in; dives go this way. */
  faceX: number; faceZ: number;
  /** Spawn slot. */
  slot: number;
};

/** Tuning, in units and ticks (30 per second). Starting values to tune by feel. */
export const MOVEMENT = {
  speed: 6,
  gravity: 20,
  jumpSpeed: 7,
  maxFallSpeed: 20,
  /**
   * A jump press is remembered for this many ticks, counting the press tick.
   * Landing is known at the end of a tick, so a buffered jump fires the tick
   * after landing: a press up to jumpBufferTicks - 2 ticks (100 ms) before the
   * landing tick still jumps.
   */
  jumpBufferTicks: 5,
  coyoteTicks: 3,
  /**
   * Dive is a double tap: a second jump press within this many ticks of the
   * jump (about to the top of the arc) dives. A later press in the air is a
   * buffered jump for the landing instead, so jump buffering still works.
   */
  diveWindowTicks: 10,
  diveSpeed: 11,
  diveHop: 3,
  recoverTicks: 12,
  recoverSpeedScale: 0.4,
  /** A hazard hit throws the player this fast along the hazard's motion, and upward. */
  knockSpeed: 9,
  knockLift: 6,
  /** Protection after a hit or a respawn, so one hazard pass cannot hit twice. */
  shieldTicks: 30,
} as const;

/** sinceJump value meaning "not in a jump" (standing, or airborne without jumping). */
export const NO_JUMP = 255;

/** A freshly spawned player standing at `slot`. */
export function spawnPlayer(slot: number): Player {
  const player: Player = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, ground: 0, simTick: 0,
    jumpBuffer: 0, coyote: 0, mode: MODE.normal, modeTicks: 0, sinceJump: NO_JUMP,
    shield: 0, checkpoint: 0, respawns: 0, faceX: 0, faceZ: -1, slot,
  };
  resetToSpawn(player);
  return player;
}

/** Puts a player back on its spawn, at rest. */
export function resetToSpawn(
  player: Player, spawn?: Pick<Player, 'x' | 'y' | 'z'>,
): void {
  const pad = GREYBOX_ARENA.checkpoints[player.checkpoint - 1];
  const defaultSpawn = GREYBOX_ARENA.spawns[player.slot] ?? GREYBOX_ARENA.spawns[0]!;
  const target = spawn ? [spawn.x, spawn.y, spawn.z] : pad?.respawn ?? [defaultSpawn.x, defaultSpawn.y, defaultSpawn.z];
  [player.x, player.y, player.z] = target;
  player.vx = player.vy = player.vz = 0;
  player.grounded = true; // spawns and pads stand on floors (checked by the arena test)
  player.ground = 0;
  player.jumpBuffer = player.coyote = player.modeTicks = 0;
  player.mode = MODE.normal;
  player.sinceJump = NO_JUMP;
  player.faceX = 0;
  player.faceZ = -1;
}

/** Falling off the world: back to the last checkpoint, protected for a moment. */
function respawn(player: Player, spawn?: Pick<Player, 'x' | 'y' | 'z'>): void {
  resetToSpawn(player, spawn);
  player.shield = MOVEMENT.shieldTicks;
  player.respawns = (player.respawns + 1) % 256;
}

const position: Vec3 = [0, 0, 0];
const from: Vec3 = [0, 0, 0];
const to: Vec3 = [0, 0, 0];

/**
 * A mover's motion over this step: from `before` (pose at the player's previous
 * tick) to `now`. If it moved into the player, push the player out ahead of it;
 * if it is in a knocking leg and swept through the player, also knock it back.
 */
function resolveMover(player: Player, mover: Mover, before: Box, now: Box, tick: number): void {
  const swept: Box = {
    id: mover.id, kind: 'platform',
    min: [Math.min(before.min[0], now.min[0]), Math.min(before.min[1], now.min[1]), Math.min(before.min[2], now.min[2])],
    max: [Math.max(before.max[0], now.max[0]), Math.max(before.max[1], now.max[1]), Math.max(before.max[2], now.max[2])],
  };
  const here: [number, number, number] = [player.x, player.y, player.z];
  const knocks = moverKnocks(mover, tick) && player.shield === 0;
  if (!overlaps(here, now) && !(knocks && overlaps(here, swept))) return;
  const motion = [now.min[0] - before.min[0], now.min[1] - before.min[1], now.min[2] - before.min[2]];
  // Push out along the mover's main direction of motion; a mover that has not
  // moved (or moved straight up into the player) lifts the player on top.
  let axis: 0 | 1 | 2 = 1;
  if (Math.abs(motion[0]!) > Math.abs(motion[axis]!)) axis = 0;
  if (Math.abs(motion[2]!) > Math.abs(motion[axis]!)) axis = 2;
  if (motion[axis] === 0) axis = 1;
  const forward = axis === 1 ? 1 : Math.sign(motion[axis]!);
  const coordinate = forward > 0 ? now.max[axis]! + HALF_EXTENTS[axis] : now.min[axis]! - HALF_EXTENTS[axis];
  if (axis === 0) player.x = coordinate;
  else if (axis === 1) player.y = coordinate;
  else player.z = coordinate;
  if (!knocks) return;
  const length = Math.hypot(motion[0]!, motion[2]!);
  const dirX = length > 0 ? motion[0]! / length : 0;
  const dirZ = length > 0 ? motion[2]! / length : 0;
  player.vx = dirX * MOVEMENT.knockSpeed;
  player.vz = dirZ * MOVEMENT.knockSpeed;
  player.vy = MOVEMENT.knockLift;
  player.mode = MODE.stunned;
  player.modeTicks = 0;
  player.shield = MOVEMENT.shieldTicks;
  player.jumpBuffer = 0;
  player.coyote = 0;
  player.sinceJump = NO_JUMP;
  player.grounded = false;
  player.ground = 0;
}

/**
 * One fixed step of player movement. Deterministic: the server and client
 * prediction run it on identical state and inputs and get identical results.
 * Movers are evaluated at `input.tick`, the moment this player saw.
 */
export function step(
  player: Player, input: Input, dt: number, boxes: readonly Box[] = GREYBOX_ARENA.boxes,
  movers: readonly Mover[] = MOVERS, spawn?: Pick<Player, 'x' | 'y' | 'z'>,
): void {
  const m = MOVEMENT;
  const tick = input.tick;
  const previousTick = player.simTick;
  player.simTick = tick;

  // Ride: a player standing on a mover moves with it first.
  const riding = movers[player.ground - 1];
  if (riding) {
    moverCenter(riding, previousTick, from);
    moverCenter(riding, tick, to);
    player.x += to[0] - from[0];
    player.y += to[1] - from[1];
    player.z += to[2] - from[2];
  }
  // Then movers that moved into the player push it (and hazards knock it).
  const world: Box[] = boxes.slice();
  for (const mover of movers) {
    const now = moverBox(mover, tick);
    resolveMover(player, mover, moverBox(mover, previousTick), now, tick);
    world.push(now);
  }

  const moving = input.x !== 0 || input.z !== 0;
  const steering = player.mode !== MODE.diving && player.mode !== MODE.stunned;
  if (moving && steering) {
    const length = Math.hypot(input.x, input.z);
    player.faceX = input.x / length;
    player.faceZ = input.z / length;
  }
  // A press opens a short window; it fires on the first step the jump is allowed.
  if (input.jump) player.jumpBuffer = m.jumpBufferTicks;
  else if (player.jumpBuffer > 0) player.jumpBuffer--;

  if (player.mode === MODE.normal) {
    player.vx = input.x * m.speed;
    player.vz = input.z * m.speed;
    const canJump = player.grounded || player.coyote > 0;
    if (input.jump && !canJump && player.sinceJump <= m.diveWindowTicks) {
      // Second tap shortly after a jump: dive.
      player.mode = MODE.diving;
      player.vx = player.faceX * m.diveSpeed;
      player.vz = player.faceZ * m.diveSpeed;
      player.vy = Math.max(player.vy, m.diveHop);
      player.jumpBuffer = 0;
      player.coyote = 0;
    } else if (player.jumpBuffer > 0 && canJump) {
      player.vy = m.jumpSpeed;
      player.jumpBuffer = 0;
      player.coyote = 0;
      player.sinceJump = 0;
    }
  } else if (player.mode === MODE.recovering) {
    // Slowed, and no jump or dive, until recovery ends. A jump pressed in the
    // last few ticks stays buffered and fires as soon as it does.
    player.vx = input.x * m.speed * m.recoverSpeedScale;
    player.vz = input.z * m.speed * m.recoverSpeedScale;
    if (--player.modeTicks <= 0) {
      player.mode = MODE.normal;
      player.modeTicks = 0;
    }
  }
  // Diving and stunned keep their launch velocity: no steering until landing.

  player.vy = Math.max(player.vy - m.gravity * dt, -m.maxFallSpeed);

  position[0] = player.x;
  position[1] = player.y;
  position[2] = player.z;
  if (sweepAxis(position, 0, player.vx * dt, world) >= 0) player.vx = 0;
  if (sweepAxis(position, 2, player.vz * dt, world) >= 0) player.vz = 0;
  const falling = player.vy <= 0;
  const below = sweepAxis(position, 1, player.vy * dt, world);
  player.x = position[0];
  player.y = position[1];
  player.z = position[2];
  player.grounded = below >= 0 && falling;
  player.ground = player.grounded && below >= boxes.length ? below - boxes.length + 1 : 0;
  if (below >= 0) player.vy = 0; // landed, or bumped a ceiling

  if (player.grounded) player.coyote = m.coyoteTicks;
  else if (player.coyote > 0) player.coyote--;
  if (player.grounded) player.sinceJump = NO_JUMP;
  else if (player.sinceJump < NO_JUMP) player.sinceJump++;

  if ((player.mode === MODE.diving || player.mode === MODE.stunned) && player.grounded) {
    player.mode = MODE.recovering;
    player.modeTicks = m.recoverTicks;
    player.vx = player.vz = 0;
  }
  if (player.shield > 0) player.shield--;

  if (boxes === GREYBOX_ARENA.boxes) {
    const here: [number, number, number] = [player.x, player.y, player.z];
    GREYBOX_ARENA.checkpoints.forEach((pad, index) => {
      if (overlaps(here, { id: pad.id, kind: 'floor', min: pad.min, max: pad.max })) player.checkpoint = index + 1;
    });
  }
  if (player.y < GREYBOX_ARENA.killY) respawn(player, spawn);
}
