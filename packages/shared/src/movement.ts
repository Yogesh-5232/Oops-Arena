import { GREYBOX_ARENA, type Box } from './arena.js';
import { sweepAxis, type Vec3 } from './collision.js';

/** One tick of player intent. `jump` is a fresh press: true on one tick per tap. */
export type Input = { x: number; z: number; jump: boolean };

/** What a player is doing; integers so they travel compactly and compare exactly. */
export const MODE = { normal: 0, diving: 1, recovering: 2 } as const;

/**
 * Everything the step reads or writes. All of it is replicated and mirrored by
 * client prediction, so the predicted step starts from exactly the server's state.
 */
export type Player = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Standing on something at the end of the last step. */
  grounded: boolean;
  /** Ticks left in which a recent jump press will still fire (jump buffering). */
  jumpBuffer: number;
  /** Ticks left in which a jump still works after walking off an edge (coyote time). */
  coyote: number;
  mode: number;
  /** Ticks left in the current dive recovery. */
  modeTicks: number;
  /** Ticks since this airborne stretch's jump, or NO_JUMP when standing or not jumping. */
  sinceJump: number;
  /** Unit direction the player last moved in; dives go this way. */
  faceX: number; faceZ: number;
  /** Spawn slot, used to reset after falling off the world. */
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
} as const;

/** sinceJump value meaning "not in a jump" (standing, or airborne without jumping). */
export const NO_JUMP = 255;

/** A freshly spawned player standing at `slot`. */
export function spawnPlayer(slot: number): Player {
  const player: Player = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, jumpBuffer: 0, coyote: 0,
    mode: MODE.normal, modeTicks: 0, sinceJump: NO_JUMP, faceX: 0, faceZ: -1, slot,
  };
  resetToSpawn(player);
  return player;
}

/** Puts a player back on its spawn, at rest. */
export function resetToSpawn(player: Player): void {
  const spawn = GREYBOX_ARENA.spawns[player.slot] ?? GREYBOX_ARENA.spawns[0]!;
  player.x = spawn.x;
  player.y = spawn.y;
  player.z = spawn.z;
  player.vx = player.vy = player.vz = 0;
  player.grounded = true; // spawns stand on the floor (checked by the arena test)
  player.jumpBuffer = player.coyote = player.modeTicks = 0;
  player.mode = MODE.normal;
  player.sinceJump = NO_JUMP;
  player.faceX = 0;
  player.faceZ = -1;
}

const position: Vec3 = [0, 0, 0];

/**
 * One fixed step of player movement. Deterministic: the server and client
 * prediction run it on identical state and inputs and get identical results.
 */
export function step(player: Player, input: Input, dt: number, boxes: readonly Box[] = GREYBOX_ARENA.boxes): void {
  const m = MOVEMENT;
  const moving = input.x !== 0 || input.z !== 0;
  if (moving && player.mode !== MODE.diving) {
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
  // Diving keeps the launch velocity: no steering until it lands.

  player.vy = Math.max(player.vy - m.gravity * dt, -m.maxFallSpeed);

  position[0] = player.x;
  position[1] = player.y;
  position[2] = player.z;
  if (sweepAxis(position, 0, player.vx * dt, boxes)) player.vx = 0;
  if (sweepAxis(position, 2, player.vz * dt, boxes)) player.vz = 0;
  const falling = player.vy <= 0;
  const hitVertically = sweepAxis(position, 1, player.vy * dt, boxes);
  player.x = position[0];
  player.y = position[1];
  player.z = position[2];
  player.grounded = hitVertically && falling;
  if (hitVertically) player.vy = 0; // landed, or bumped a ceiling

  if (player.grounded) player.coyote = m.coyoteTicks;
  else if (player.coyote > 0) player.coyote--;
  if (player.grounded) player.sinceJump = NO_JUMP;
  else if (player.sinceJump < NO_JUMP) player.sinceJump++;

  if (player.mode === MODE.diving && player.grounded) {
    player.mode = MODE.recovering;
    player.modeTicks = m.recoverTicks;
    player.vx = player.vz = 0;
  }
  if (player.y < GREYBOX_ARENA.killY) resetToSpawn(player);
}
