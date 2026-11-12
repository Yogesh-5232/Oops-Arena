import type { Box } from './arena.js';
import { HALF_EXTENTS } from './collision.js';
import { MOVEMENT, resetToSpawn, type Player } from './movement.js';
import type { Mover } from './movers.js';

/**
 * Floor Is Lava: a stepped tower. Lava rises in steps through the round; early
 * on, touching it respawns the player on a safe gate pad; in the closing stretch
 * it sends the player to a walled viewing balcony for the rest of the round.
 *
 * Tiers are solid boxes stacked like a stepped pyramid, so no deck hangs over
 * another and every rise is reachable: stairs climb one unit per step (a jump
 * clears about 1.22) and alternate sides, and a lift on the far side of each
 * ledge is the faster, timed shortcut.
 */
type Tier = { readonly top: number; readonly half: number };

/** Base floor, then T1..T3, then the summit. Gate n means standing on TIERS[n]. */
export const LAVA_TIERS: readonly Tier[] = [
  { top: 0, half: 18 },
  { top: 3, half: 11 },
  { top: 6, half: 8 },
  { top: 9, half: 5 },
  { top: 11.5, half: 2.5 },
];
export const LAVA_GATES = LAVA_TIERS.length - 1;
const BALCONY = { min: [12, 12, -18], max: [18, 13, -12] } as const;

/**
 * Lava tunables. Keyframes are fractions of the round so the same tower plays
 * in any preset length; heights are the lava's top surface. After
 * `closingFrom` the lava keeps rising to `closingTop` (above the last stair,
 * below the summit) and touching it eliminates instead of respawning.
 */
export const LAVA_RULES = {
  keyframes: [
    [0, -0.5], [0.075, -0.5], [0.095, 0.5],
    [0.28, 0.5], [0.3, 3.5],
    [0.5, 3.5], [0.52, 6.5],
  ],
  closingFrom: 0.84,
  closingTop: 11.2,
  /** Warning shown this fraction of the round before a rise starts. */
  warningFraction: 0.02,
  /** A respawn pad counts as safe only this far above the lava. */
  safeMargin: 0.4,
} as const;

const box = (id: string, kind: Box['kind'], min: Box['min'], max: Box['max']): Box => ({ id, kind, min, max });

/** One-unit stairs between tier `from` and the next, on the north (-z) or south (+z) face. */
function stairs(from: number, side: 1 | -1): Box[] {
  const lower = LAVA_TIERS[from]!;
  const upper = LAVA_TIERS[from + 1]!;
  const rise = upper.top - lower.top;
  const count = Math.ceil(rise) - 1;
  const depth = (lower.half - upper.half) / count;
  return Array.from({ length: count }, (_, index) => {
    // Step 0 is the lowest, furthest from the upper tier.
    const outer = upper.half + depth * (count - index);
    const inner = outer - depth;
    const zMin = side > 0 ? inner : -outer;
    const zMax = side > 0 ? outer : -inner;
    return box(`lava-stair-${from}-${index}`, 'platform', [-2, lower.top, zMin], [2, lower.top + index + 1, zMax]);
  });
}

/** Floor→T1 stairs stand on the open floor south of T1; the rest sit on each ledge. */
function floorStairs(): Box[] {
  const t1 = LAVA_TIERS[1]!;
  return [
    box('lava-stair-0-0', 'platform', [-2, 0, t1.half + 1.5], [2, 1, t1.half + 3]),
    box('lava-stair-0-1', 'platform', [-2, 0, t1.half], [2, 2, t1.half + 1.5]),
  ];
}

const wall = (id: string, min: Box['min'], max: Box['max']) => box(id, 'wall', min, max);
const [bx0, by0, bz0] = BALCONY.min;
const [bx1, by1, bz1] = BALCONY.max;

export const LAVA_BOXES: readonly Box[] = [
  box('lava-floor', 'floor', [-18, -1, -18], [18, 0, 18]),
  wall('lava-rim-n', [-18, 0, -18.5], [18, 2, -18]),
  wall('lava-rim-s', [-18, 0, 18], [18, 2, 18.5]),
  wall('lava-rim-w', [-18.5, 0, -18.5], [-18, 2, 18.5]),
  wall('lava-rim-e', [18, 0, -18.5], [18.5, 2, 18.5]),
  ...LAVA_TIERS.slice(1).map((tier, index) => box(
    `lava-tier-${index + 1}`, 'platform', [-tier.half, 0, -tier.half], [tier.half, tier.top, tier.half],
  )),
  ...floorStairs(),
  ...stairs(1, -1),
  ...stairs(2, 1),
  ...stairs(3, -1),
  box('lava-balcony', 'floor', [bx0, by0, bz0], [bx1, by1, bz1]),
  wall('lava-balcony-n', [bx0, by1, bz0], [bx1, by1 + 1.5, bz0 + 0.3]),
  wall('lava-balcony-s', [bx0, by1, bz1 - 0.3], [bx1, by1 + 1.5, bz1]),
  wall('lava-balcony-w', [bx0, by1, bz0], [bx0 + 0.3, by1 + 1.5, bz1]),
  wall('lava-balcony-e', [bx1 - 0.3, by1, bz0], [bx1, by1 + 1.5, bz1]),
];

/**
 * Lifts: 3 x 1 x 3 (2.5 deep on the narrow top ledge) decks embedded in each
 * ledge, flush with it at rest, rising to the next tier at 2 units a second.
 * They sit on the side away from the stairs, so a lift trades waiting for a
 * shorter walk.
 */
function lift(id: string, x: number, from: number, size: number): Mover {
  const lower = LAVA_TIERS[from]!.top;
  const upper = LAVA_TIERS[from + 1]!.top;
  const bottom = [x, lower - 0.5, 0] as const;
  const top = [x, upper - 0.5, 0] as const;
  const travel = Math.round(((upper - lower) / 2) * 30);
  return {
    id, kind: 'ferry', size: [size, 1, size], warnTicks: 0,
    legs: [
      { from: bottom, to: bottom, ticks: 45 },
      { from: bottom, to: top, ticks: travel },
      { from: top, to: top, ticks: 45 },
      { from: top, to: bottom, ticks: travel },
    ],
  };
}

/** A low bar sweeping across the summit; jump it or get knocked into the lava. */
const SWEEP_REST_W = [-5.5, 11.9, 0] as const;
const SWEEP_REST_E = [5.5, 11.9, 0] as const;

export const LAVA_MOVERS: readonly Mover[] = [
  lift('lava-lift-1', 9.5, 1, 3),
  lift('lava-lift-2', -6.5, 2, 3),
  lift('lava-lift-3', 3.75, 3, 2.5),
  {
    id: 'lava-sweeper', kind: 'pusher', size: [0.8, 0.8, 5.4], warnTicks: 21,
    legs: [
      { from: SWEEP_REST_W, to: SWEEP_REST_W, ticks: 45 },
      { from: SWEEP_REST_W, to: SWEEP_REST_E, ticks: 50, knocks: true },
      { from: SWEEP_REST_E, to: SWEEP_REST_E, ticks: 45 },
      { from: SWEEP_REST_E, to: SWEEP_REST_W, ticks: 50, knocks: true },
    ],
  },
];

/**
 * Gate pads: where a player respawns for each gate, on the ledge where the
 * stairs from below arrive. Gate 0 is the player's own floor spawn.
 */
export const LAVA_PADS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 4, 9.5],
  [0, 7, -6.5],
  [0, 10, 3.75],
  [0, 12.5, 0],
];

export function lavaSpawn(slot: number) {
  return { x: (slot % 6 - 2.5) * 2.5, y: 1, z: 15.5 + Math.floor(slot / 6) * 1.5 };
}

export function lavaBalconySpot(slot: number) {
  return { x: 13.2 + (slot % 4) * 1.2, y: by1 + 1, z: -16.6 + Math.floor(slot / 4) * 1.8 };
}

/** Lava top surface at an elapsed arena tick. Exact arithmetic only, so every engine agrees. */
export function lavaLevel(elapsedTicks: number, roundTicks: number): number {
  const keys = LAVA_RULES.keyframes;
  const t = roundTicks > 0 ? Math.max(0, elapsedTicks) / roundTicks : 0;
  if (t >= LAVA_RULES.closingFrom) {
    const start = keys[keys.length - 1]![1];
    const into = Math.min(1, (t - LAVA_RULES.closingFrom) / (1 - LAVA_RULES.closingFrom));
    return start + (LAVA_RULES.closingTop - start) * into;
  }
  for (let index = keys.length - 1; index >= 0; index--) {
    const [at, y] = keys[index]!;
    if (t < at) continue;
    const next = keys[index + 1];
    if (!next) return y;
    return y + (next[1] - y) * ((t - at) / (next[0] - at));
  }
  return keys[0]![1];
}

/** True while the lava is rising or about to (drawing only). */
export function lavaWarning(elapsedTicks: number, roundTicks: number): boolean {
  const ahead = elapsedTicks + Math.round(roundTicks * LAVA_RULES.warningFraction);
  return lavaLevel(ahead, roundTicks) > lavaLevel(elapsedTicks, roundTicks);
}

/** From here to the end of the round, touching lava eliminates instead of respawning. */
export function lavaClosing(elapsedTicks: number, roundTicks: number): boolean {
  return roundTicks > 0 && elapsedTicks / roundTicks >= LAVA_RULES.closingFrom;
}

/** Highest tier the player is standing on (0 = floor), or -1 when not standing on one. */
function standingTier(player: Player): number {
  if (!player.grounded || player.ground !== 0) return -1;
  const feet = player.y - HALF_EXTENTS[1];
  for (let index = LAVA_TIERS.length - 1; index >= 0; index--) {
    const tier = LAVA_TIERS[index]!;
    if (Math.abs(feet - tier.top) < 1e-6 && Math.abs(player.x) <= tier.half && Math.abs(player.z) <= tier.half) return index;
  }
  return -1;
}

const onBalcony = (player: Player) =>
  player.x >= bx0 && player.x <= bx1 && player.z >= bz0 && player.z <= bz1 && player.y >= by1;

function place(player: Player, at: { x: number; y: number; z: number }): void {
  resetToSpawn(player, at);
  player.shield = MOVEMENT.shieldTicks;
  player.respawns = (player.respawns + 1) % 256;
}

/** Respawn pad for a player at `gate`, carried forward past any pad the lava has covered. */
function safePad(player: Player, gate: number, lava: number): { x: number; y: number; z: number } {
  for (let index = gate; index <= LAVA_GATES; index++) {
    const surface = LAVA_TIERS[index]!.top;
    if (surface > lava + LAVA_RULES.safeMargin) {
      if (index === 0) return lavaSpawn(player.slot);
      const [x, y, z] = LAVA_PADS[index - 1]!;
      return { x, y, z };
    }
  }
  const [x, y, z] = LAVA_PADS[LAVA_GATES - 1]!;
  return { x, y, z };
}

export type LavaEvent = 'respawn' | 'out' | null;

/**
 * Lava step after the shared movement step, identical on server and in
 * prediction: raise the player's gate when standing on a higher tier, then
 * resolve lava contact. `player.checkpoint` holds the gate (0 = floor).
 */
export function resolveLava(player: Player, elapsedTicks: number, roundTicks: number): LavaEvent {
  if (onBalcony(player)) return null;
  const tier = standingTier(player);
  if (tier > player.checkpoint) player.checkpoint = tier;
  const lava = lavaLevel(elapsedTicks, roundTicks);
  if (player.y - HALF_EXTENTS[1] >= lava) return null;
  if (lavaClosing(elapsedTicks, roundTicks)) {
    place(player, lavaBalconySpot(player.slot));
    return 'out';
  }
  place(player, safePad(player, player.checkpoint, lava));
  return 'respawn';
}
