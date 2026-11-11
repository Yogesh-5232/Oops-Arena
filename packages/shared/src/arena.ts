export const GREYBOX_ARENA = {
  id: 'playground-v1',
  floor: { width: 30, depth: 30, thickness: 1 },
  bounds: { minX: -14, maxX: 14, minZ: -14, maxZ: 14 },
  standingHeight: 1,
  spawns: Array.from({ length: 12 }, (_, slot) => ({
    id: `spawn-${slot}`, x: (slot % 4) * 2 - 3, y: 1, z: Math.floor(slot / 4) * 2 - 2,
  })),
} as const;

/** Reservations retain their slot until the player actually leaves. */
export function availableSpawn(occupied: Iterable<number>): number | undefined {
  const used = new Set(occupied);
  const slot = GREYBOX_ARENA.spawns.findIndex((_, index) => !used.has(index));
  return slot < 0 ? undefined : slot;
}
