import { type Box } from './arena.js';
import { MODE, MOVEMENT, NO_JUMP, type Player } from './movement.js';
import type { Mover } from './movers.js';

export const DODGE_BOXES: readonly Box[] = [
  { id: 'dodge-floor', kind: 'floor', min: [-12, -1, -12], max: [12, 0, 12] },
];
export const DODGE_MOVERS: readonly Mover[] = [];

export type DodgeHazard = {
  id: string;
  family: 'sweeper' | 'drop';
  phase: 'warning' | 'active';
  min: readonly [number, number, number];
  max: readonly [number, number, number];
};

const WAVE_TICKS = 180;
const WARNING_START = 60;
const ACTIVE_START = 105;
const ACTIVE_END = 165;
const PLAYER_HALF = [0.5, 1, 0.5] as const;

export function dodgeSpawn(slot: number) {
  return { x: (slot % 4) * 5 - 7.5, y: 1, z: Math.floor(slot / 4) * 5 - 5 };
}

function seeded(seed: number, wave: number, part: number): number {
  let value = (seed ^ Math.imul(wave + 1, 0x9e3779b1) ^ Math.imul(part + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function dropCenters(seed: number, wave: number): Array<[number, number]> {
  const cells = [-8, -4, 0, 4, 8];
  const first = seeded(seed, wave, 1);
  const x0 = cells[first % cells.length]!;
  const z0 = cells[(first >>> 4) % cells.length]!;
  const second = seeded(seed, wave, 2);
  let x1 = cells[second % cells.length]!;
  let z1 = cells[(second >>> 4) % cells.length]!;
  if (x1 === x0 && z1 === z0) x1 = cells[(cells.indexOf(x1) + 2) % cells.length]!;
  return [[x0, z0], [x1, z1]];
}

/** Seeded six-second sequence of 1.5-second warnings, two-second hazards, and recovery. */
export function dodgeHazards(seed: number, elapsedTicks: number): DodgeHazard[] {
  if (elapsedTicks < 0) return [];
  const wave = Math.floor(elapsedTicks / WAVE_TICKS);
  const into = elapsedTicks - wave * WAVE_TICKS;
  if (into < WARNING_START || into >= ACTIVE_END) return [];
  const warning = into < ACTIVE_START;
  const family = seeded(seed, wave, 0) % 2 === 0 ? 'sweeper' : 'drop';
  if (family === 'sweeper') {
    const progress = warning ? 0 : (into - ACTIVE_START) / (ACTIVE_END - ACTIVE_START - 1);
    const z = 10 - 20 * progress;
    return [{
      id: `sweeper-${wave}`, family, phase: warning ? 'warning' : 'active',
      min: [-11, 0, z - 0.45], max: [11, warning ? 0.08 : 0.8, z + 0.45],
    }];
  }
  return dropCenters(seed, wave).map(([x, z], index) => ({
    id: `drop-${wave}-${index}`, family, phase: warning ? 'warning' as const : 'active' as const,
    min: [x - 1.5, warning ? 0.02 : 0, z - 1.5] as const,
    max: [x + 1.5, warning ? 0.08 : 4, z + 1.5] as const,
  }));
}

type Position = Pick<Player, 'x' | 'y' | 'z'>;

function segmentHitsBox(before: Position, after: Position, hazard: DodgeHazard): boolean {
  let enter = 0;
  let leave = 1;
  const start = [before.x, before.y, before.z];
  const end = [after.x, after.y, after.z];
  for (let axis = 0; axis < 3; axis++) {
    const min = hazard.min[axis]! - PLAYER_HALF[axis]!;
    const max = hazard.max[axis]! + PLAYER_HALF[axis]!;
    const delta = end[axis]! - start[axis]!;
    if (Math.abs(delta) < 1e-9) {
      if (start[axis]! < min || start[axis]! > max) return false;
      continue;
    }
    let a = (min - start[axis]!) / delta;
    let b = (max - start[axis]!) / delta;
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a);
    leave = Math.min(leave, b);
    if (enter > leave) return false;
  }
  return true;
}

/** Same deterministic hit and recovery step is used by prediction and authority. */
export function resolveDodgeHazards(
  player: Player, before: Position, seed: number, arenaStartTick: number, worldTick: number,
): boolean {
  if (player.shield > 0 || player.mode === MODE.stunned) return false;
  const elapsed = worldTick - arenaStartTick;
  const now = dodgeHazards(seed, elapsed).filter(hazard => hazard.phase === 'active');
  const prior = dodgeHazards(seed, elapsed - 1).filter(hazard => hazard.phase === 'active');
  const previousById = new Map(prior.map(hazard => [hazard.id, hazard]));
  const hit = now.find(hazard => {
    const previous = previousById.get(hazard.id);
    const swept = previous ? {
      ...hazard,
      min: hazard.min.map((value, axis) => Math.min(value, previous.min[axis]!)) as unknown as DodgeHazard['min'],
      max: hazard.max.map((value, axis) => Math.max(value, previous.max[axis]!)) as unknown as DodgeHazard['max'],
    } : hazard;
    return segmentHitsBox(before, player, swept);
  });
  if (!hit) return false;

  const centerX = (hit.min[0] + hit.max[0]) / 2;
  const centerZ = (hit.min[2] + hit.max[2]) / 2;
  let dx = player.x - centerX;
  let dz = player.z - centerZ;
  let length = Math.hypot(dx, dz);
  if (length < 0.01) {
    const direction = seeded(seed, Math.floor(Math.max(0, elapsed)), worldTick) % 4;
    dx = direction === 0 ? 1 : direction === 1 ? -1 : 0;
    dz = direction === 2 ? 1 : direction === 3 ? -1 : 0;
    length = 1;
  }
  player.vx = dx / length * MOVEMENT.knockSpeed * 0.8;
  player.vz = dz / length * MOVEMENT.knockSpeed * 0.8;
  player.vy = MOVEMENT.knockLift * 0.65;
  player.mode = MODE.stunned;
  player.modeTicks = 0;
  player.shield = MOVEMENT.shieldTicks;
  player.jumpBuffer = 0;
  player.coyote = 0;
  player.sinceJump = NO_JUMP;
  player.grounded = false;
  player.ground = 0;
  return true;
}
