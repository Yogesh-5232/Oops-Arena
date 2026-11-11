import { GREYBOX_ARENA, type Box } from './arena.js';
import { step, type Input, type Player } from './movement.js';
export { GREYBOX_ARENA, availableSpawn, type Box } from './arena.js';
export { HALF_EXTENTS, overlaps, sweepAxis } from './collision.js';
export { MODE, MOVEMENT, NO_JUMP, resetToSpawn, spawnPlayer, step, type Input, type Player } from './movement.js';
export { DASH_BOXES, DASH_GATES, DASH_START_Z, dashSpawn, crossesDashGate, type DashStanding } from './dash.js';
export const TICK_MS = 1000 / 30;
export const CAPACITY = GREYBOX_ARENA.spawns.length;
export const PRESETS = { quick: 120, short: 315, standard: 540, full: 730 } as const;
/** Inputs buffered per player before the oldest is dropped (about 270 ms at 30 Hz). */
export const INPUT_BUFFER = 8;
/**
 * Repairs an input in place so it is always legal: nonfinite axes become 0,
 * the direction is shortened to at most length 1, and jump is strictly
 * boolean. Only ever call it on a copy; see {@link simulateInput}.
 */
export function sanitizeInput(input: Input): void {
  if (!Number.isFinite(input.x)) input.x = 0;
  if (!Number.isFinite(input.z)) input.z = 0;
  const length = Math.hypot(input.x, input.z);
  if (length > 1) {
    input.x /= length;
    input.z /= length;
  }
  input.jump = input.jump === true;
}
const repaired: Input = { x: 0, z: 0, jump: false };
/**
 * The one per-input simulation, run by the server and by client prediction:
 * copy the received command, repair the copy, then step.
 *
 * The command is never repaired in place. Inputs are delta-encoded, so fields a
 * frame leaves out keep their previous value; repairing the received input
 * would make those kept fields hold repaired values (a released diagonal key
 * would move at 71% speed) while the client replays the raw ones.
 */
export function simulateInput(
  player: Player, command: Input, dt: number, boxes?: readonly Box[], spawn?: Pick<Player, 'x' | 'y' | 'z'>,
): void {
  repaired.x = command.x;
  repaired.z = command.z;
  repaired.jump = command.jump;
  sanitizeInput(repaired);
  step(player, repaired, dt, boxes, spawn);
}
