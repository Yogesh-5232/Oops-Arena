/** A solid axis-aligned box. Stable ids let rendering and collision refer to the same piece. */
export type Box = {
  readonly id: string;
  readonly kind: 'floor' | 'platform' | 'wall';
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

const box = (id: string, kind: Box['kind'], min: Box['min'], max: Box['max']): Box => ({ id, kind, min, max });

/** A pad that becomes a player's respawn point when touched. */
export type Checkpoint = {
  readonly id: string;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Player center after respawning here. */
  readonly respawn: readonly [number, number, number];
};

/**
 * Greybox playground: a main floor with spawns in the middle, a low step and a
 * higher platform to climb (each about one jump high), a wall to slide along,
 * an island across a gap to jump or dive to, and an east ledge across a pit too
 * wide to jump, reached on the ferry (see movers.ts). The south lane has the
 * pusher hazard. Walking off any edge falls below killY and respawns the player
 * at the last checkpoint touched (checkpoint 0 is the player's own spawn).
 */
export const GREYBOX_ARENA = {
  id: 'playground-v2',
  boxes: [
    box('floor-main', 'floor', [-15, -1, -15], [15, 0, 8]),
    box('floor-island', 'floor', [-6, -1, 10.5], [6, 0, 15]),
    box('step-low', 'platform', [5, 0, -2], [8, 1, 2]),
    box('platform-high', 'platform', [8, 0, -2], [11, 2, 2]),
    box('wall-west', 'wall', [-8, 0, -6], [-7.5, 3, 6]),
    box('floor-east', 'floor', [24, -1, -4], [30, 0, 4]),
  ],
  /** Index 0 stands for the player's own spawn; pads start at 1. */
  checkpoints: [
    { id: 'checkpoint-island', min: [-2, 0, 11.5], max: [2, 1, 14.5], respawn: [0, 1, 13] },
    { id: 'checkpoint-east', min: [25, 0, -2], max: [29, 1, 2], respawn: [27, 1, 0] },
  ],
  /** Below this height a player has fallen off the world. */
  killY: -10,
  /** Player centers when standing on the main floor (avatar is 2 tall). */
  spawns: Array.from({ length: 12 }, (_, slot) => ({
    id: `spawn-${slot}`, x: (slot % 4) * 2 - 3, y: 1, z: Math.floor(slot / 4) * 2 - 2,
  })),
} as const satisfies {
  id: string; boxes: readonly Box[]; checkpoints: readonly Checkpoint[]; killY: number;
  spawns: readonly { id: string; x: number; y: number; z: number }[];
};

/** Reservations retain their slot until the player actually leaves. */
export function availableSpawn(occupied: Iterable<number>): number | undefined {
  const used = new Set(occupied);
  const slot = GREYBOX_ARENA.spawns.findIndex((_, index) => !used.has(index));
  return slot < 0 ? undefined : slot;
}
