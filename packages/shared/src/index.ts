import { GREYBOX_ARENA } from './arena.js';
export { GREYBOX_ARENA, availableSpawn } from './arena.js';
export const TICK_MS = 1000 / 30;
export const CAPACITY = GREYBOX_ARENA.spawns.length;
export const PRESETS = { quick: 120, short: 315, standard: 540, full: 730 } as const;
export type Input = { x: number; z: number; jump: boolean };
export type Player = { x: number; y: number; z: number; vy: number };
export function parseInput(value: unknown): Input | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Record<string, unknown>;
  if (typeof input.x !== 'number' || typeof input.z !== 'number' || !Number.isFinite(input.x) || !Number.isFinite(input.z) || typeof input.jump !== 'boolean') return;
  const length = Math.max(1, Math.hypot(input.x, input.z));
  return { x: input.x / length, z: input.z / length, jump: input.jump };
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
