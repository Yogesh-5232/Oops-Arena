import { GREYBOX_ARENA, type Box } from './arena.js';
import { MOVERS, type Mover } from './movers.js';
import { step, type Input, type Player } from './movement.js';
import { MAX_TICK_REWIND } from './timing.js';
export { INPUT_BUFFER, MAX_TICK_REWIND, TICK_MS } from './timing.js';
export { GREYBOX_ARENA, availableSpawn, type Box, type Checkpoint } from './arena.js';
export { HALF_EXTENTS, overlaps, sweepAxis } from './collision.js';
export { MOVERS, moverBox, moverCenter, moverKnocks, moverWarns, type Mover } from './movers.js';
export {
  MODE, MOVEMENT, NO_JUMP, resetToSpawn, spawnPlayer, step, type Input, type Player,
} from './movement.js';
export { DASH_BOXES, DASH_GATES, DASH_START_Z, dashSpawn, crossesDashGate, type DashStanding } from './dash.js';
export { DODGE_BOXES, DODGE_MOVERS, DODGE_RULES, dodgeHazards, dodgeSpawn, resolveDodgeHazards, type DodgeHazard } from './dodge.js';
export {
  ARENAS, ARENA_BUILD, BUILD_RULES, PROTOCOL_VERSION, arenaManifest, buildId, type ArenaId, type ArenaManifest, type ArenaMarker,
} from './manifests.js';
export type { DodgeStanding, ShortPartyResults, ShortPartyStanding } from './short-party.js';
export const CAPACITY = GREYBOX_ARENA.spawns.length;
export const PRESETS = { quick: 120, short: 315, standard: 540, full: 730 } as const;
/**
 * Repairs an input in place so it is always legal: nonfinite axes become 0,
 * the direction is shortened to at most length 1, jump is strictly boolean and
 * the tick is a whole number. Only ever call it on a copy; see {@link simulateInput}.
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
  input.tick = Number.isFinite(input.tick) && input.tick >= 0 ? Math.floor(input.tick) : 0;
}
const repaired: Input = { x: 0, z: 0, jump: false, tick: 0 };
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
  player: Player, command: Input, dt: number, boxes: readonly Box[] = GREYBOX_ARENA.boxes,
  spawn?: Pick<Player, 'x' | 'y' | 'z'>, tick = command.tick, movers: readonly Mover[] = MOVERS,
): void {
  repaired.x = command.x;
  repaired.z = command.z;
  repaired.jump = command.jump;
  repaired.tick = tick;
  sanitizeInput(repaired);
  step(player, repaired, dt, boxes, movers, spawn);
}

/**
 * The tick the server simulates an input at: the client's stamp, but never in
 * the future, never more than MAX_TICK_REWIND behind, and never before the
 * player's previous input (time only moves forward). A client lying about time
 * gains at most what 500 ms of lag would give it.
 */
export function clampInputTick(stamped: number, previous: number, serverTick: number): number {
  const earliest = Math.max(previous, serverTick - MAX_TICK_REWIND);
  return Math.min(serverTick, Math.max(earliest, Number.isFinite(stamped) ? Math.floor(stamped) : serverTick));
}

/**
 * Client side: the world tick to stamp on the next input. Consecutive inputs
 * advance one tick each so movers step evenly, re-anchoring to the clock's
 * estimate only when they drift more than two ticks apart.
 */
export function nextInputTick(previousSent: number | undefined, estimate: number): number {
  if (previousSent === undefined) return Math.max(0, Math.floor(estimate));
  const next = previousSent + 1;
  return Math.abs(next - estimate) > 2 ? Math.max(previousSent, Math.floor(estimate)) : next;
}
