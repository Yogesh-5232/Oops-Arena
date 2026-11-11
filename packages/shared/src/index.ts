import { GREYBOX_ARENA } from './arena.js';
export { GREYBOX_ARENA, availableSpawn } from './arena.js';
export const TICK_MS = 1000 / 30;
export const CAPACITY = GREYBOX_ARENA.spawns.length;
export const PRESETS = { quick: 120, short: 315, standard: 540, full: 730 } as const;
export type Input = { x: number; z: number; jump: boolean };
export type Player = { x: number; y: number; z: number; vy: number };
/** Inputs buffered per player before the oldest is dropped (about 270 ms at 30 Hz). */
export const INPUT_BUFFER = 8;
/**
 * Repairs an input in place so it is always legal: nonfinite axes become 0 and
 * the direction is shortened to at most length 1. Only ever call it on a copy;
 * see {@link simulateInput}.
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
export function simulateInput(player: Player, command: Input, dt: number): void {
  repaired.x = command.x;
  repaired.z = command.z;
  repaired.jump = command.jump;
  sanitizeInput(repaired);
  step(player, repaired, dt);
}
export function step(player: Player, input: Input, dt: number): void {
  const { bounds, standingHeight } = GREYBOX_ARENA;
  player.x = Math.max(bounds.minX, Math.min(bounds.maxX, player.x + input.x * 6 * dt));
  player.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, player.z + input.z * 6 * dt));
  if (input.jump && player.y <= standingHeight) player.vy = 7;
  player.vy -= 20 * dt;
  player.y = Math.max(standingHeight, player.y + player.vy * dt);
  if (player.y === standingHeight) player.vy = 0;
}
