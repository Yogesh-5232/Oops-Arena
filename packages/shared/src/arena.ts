/** A solid axis-aligned box. Stable ids let rendering and collision refer to the same piece. */
export type Box = {
  readonly id: string;
  readonly kind: 'floor' | 'platform' | 'wall';
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

const box = (id: string, kind: Box['kind'], min: Box['min'], max: Box['max']): Box => ({ id, kind, min, max });

/**
 * Greybox playground: a main floor with spawns in the middle, a low step and a
 * higher platform to climb (each about one jump high), a wall to slide along,
 * and an island across a gap to jump or dive to. Walking off any edge falls
 * below KILL_Y and resets to the player's spawn.
 */
export const GREYBOX_ARENA = {
  id: 'playground-v2',
  boxes: [
    box('floor-main', 'floor', [-15, -1, -15], [15, 0, 8]),
    box('floor-island', 'floor', [-6, -1, 10.5], [6, 0, 15]),
    box('step-low', 'platform', [5, 0, -2], [8, 1, 2]),
    box('platform-high', 'platform', [8, 0, -2], [11, 2, 2]),
    box('wall-west', 'wall', [-8, 0, -6], [-7.5, 3, 6]),
  ],
  /** Below this height a player has fallen off the world. */
  killY: -10,
  /** Player centers when standing on the main floor (avatar is 2 tall). */
  spawns: Array.from({ length: 12 }, (_, slot) => ({
    id: `spawn-${slot}`, x: (slot % 4) * 2 - 3, y: 1, z: Math.floor(slot / 4) * 2 - 2,
  })),
} as const satisfies { id: string; boxes: readonly Box[]; killY: number; spawns: readonly { id: string; x: number; y: number; z: number }[] };

/** Reservations retain their slot until the player actually leaves. */
export function availableSpawn(occupied: Iterable<number>): number | undefined {
  const used = new Set(occupied);
  const slot = GREYBOX_ARENA.spawns.findIndex((_, index) => !used.has(index));
  return slot < 0 ? undefined : slot;
}
