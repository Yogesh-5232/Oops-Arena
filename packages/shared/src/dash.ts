import type { Box } from './arena.js';

export const DASH_START_Z = 11;
export const DASH_GATES = [
  { z: 4, x: -6, halfWidth: 2.5 },
  { z: -4, x: 6, halfWidth: 2.5 },
  { z: -12, x: 0, halfWidth: 14.5 },
] as const;

export type DashStanding = {
  name: string;
  checkpoints: number;
  finishMs: number | null;
  /** Monotonic progress through the current gate segment, used for DNF ties. */
  progress: number;
};

export const DASH_BOXES: readonly Box[] = [
  { id: 'dash-floor', kind: 'floor', min: [-15, -1, -15], max: [15, 0, 15] },
  ...DASH_GATES.slice(0, -1).flatMap((gate, index) => [
    { id: `dash-wall-${index}-left`, kind: 'wall' as const, min: [-15, 0, gate.z - 0.15] as const, max: [gate.x - gate.halfWidth, 3, gate.z + 0.15] as const },
    { id: `dash-wall-${index}-right`, kind: 'wall' as const, min: [gate.x + gate.halfWidth, 0, gate.z - 0.15] as const, max: [15, 3, gate.z + 0.15] as const },
  ]),
];

export function dashSpawn(slot: number) {
  return { x: (slot % 6 - 2.5) * 2, y: 1, z: DASH_START_Z + Math.floor(slot / 6) * 1.5 };
}

/** Only forward crossings through the next gate count. */
export function crossesDashGate(
  index: number, before: { x: number; z: number }, after: { x: number; z: number },
): boolean {
  const gate = DASH_GATES[index];
  if (!gate || before.z < gate.z || after.z >= gate.z) return false;
  const fraction = (before.z - gate.z) / (before.z - after.z);
  const x = before.x + (after.x - before.x) * fraction;
  return Math.abs(x - gate.x) <= gate.halfWidth - 0.5;
}
