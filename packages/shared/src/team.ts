import type { Box } from './arena.js';
import { HALF_EXTENTS, overlaps } from './collision.js';
import type { Input, Player } from './movement.js';
import type { Mover } from './movers.js';

/**
 * Teamwork Madness: two mirrored lanes, Blue (team 0, x < 0) and Red (team 1,
 * x > 0), split by a wall. Each team pushes its crate from the start toward the
 * goal line (toward -z). The crate is server-owned and moves only along its
 * lane's center line; players collide with it like any box.
 *
 * Three gates stop each crate until a teammate opens them by standing on the
 * gate's pressure plate, which sits past the gate at the lane's outer edge. A
 * plate holds its gate open for a few seconds after the last touch, so a team
 * of one can still progress; a team that splits roles moves much faster.
 * Pushing contributions are capped at the smaller team's size, and a crate
 * nobody pushes rolls back slowly, never behind the last gate it cleared.
 */
export const TEAM_NAMES = ['Blue', 'Red'] as const;

export const TEAM_RULES = {
  /** |x| of each lane's center line. */
  laneCenter: 5,
  cargoStartZ: 14,
  /** The crate is delivered once its center reaches this z. */
  goalZ: -24,
  /** Gate lines the crate cannot cross while closed. */
  gates: [4, -6, -16],
  /** Crate half extents (2.4 x 1.6 x 2.4): taller than a jump, so it is pushed, not climbed. */
  cargoHalf: [1.2, 0.8, 1.2],
  /** Crate speed in units/s by capped pusher count (index = pushers). */
  pushSpeed: [0, 1.5, 2.1, 2.5, 2.8, 3, 3.2],
  /** Unpushed crates roll back this fast after rollbackDelayTicks without a pusher. */
  rollbackSpeed: 0.6,
  rollbackDelayTicks: 30,
  /** A plate keeps its gate open this long after the last touch (4 s). */
  plateLatchTicks: 120,
  /** Plate centers sit this far past their gate, at |x| = plateX. */
  plateOffset: 4,
  plateX: 8,
  plateHalf: 1,
  /** A pusher is within this gap of the crate's back face, pressing at least this hard toward the goal. */
  pushReach: 0.3,
  pushInput: 0.5,
} as const;

const R = TEAM_RULES;
export const TEAM_GATES = R.gates.length;

export const laneX = (team: number) => team === 1 ? R.laneCenter : -R.laneCenter;
export const plateCenter = (team: number, gate: number): [number, number] =>
  [team === 1 ? R.plateX : -R.plateX, R.gates[gate]! - R.plateOffset];

const box = (id: string, kind: Box['kind'], min: Box['min'], max: Box['max']): Box => ({ id, kind, min, max });
const LANE_FRONT = -31;
const LANE_BACK = 27;

export const TEAM_BOXES: readonly Box[] = [
  box('team-floor', 'floor', [-10.25, -1, LANE_FRONT], [10.25, 0, LANE_BACK]),
  box('team-divider', 'wall', [-0.25, 0, LANE_FRONT], [0.25, 3, LANE_BACK]),
  box('team-wall-w', 'wall', [-10.25, 0, LANE_FRONT], [-9.75, 3, LANE_BACK]),
  box('team-wall-e', 'wall', [9.75, 0, LANE_FRONT], [10.25, 3, LANE_BACK]),
  box('team-wall-back', 'wall', [-10.25, 0, LANE_BACK - 0.5], [10.25, 3, LANE_BACK]),
  box('team-wall-front', 'wall', [-10.25, 0, LANE_FRONT], [10.25, 3, LANE_FRONT + 0.5]),
];

/** A low bar sweeping across a lane: jump it or get knocked off the crate. Mirrored between lanes. */
function sweeper(team: number, z: number): Mover {
  const sign = team === 1 ? 1 : -1;
  const outer = [sign * 9.3, 0.4, z] as const;
  const inner = [sign * 0.7, 0.4, z] as const;
  return {
    id: `team-sweeper-${team}-${z}`, kind: 'pusher', size: [0.8, 0.8, 3], warnTicks: 21,
    legs: [
      { from: outer, to: outer, ticks: 45 },
      { from: outer, to: inner, ticks: 40, knocks: true },
      { from: inner, to: inner, ticks: 45 },
      { from: inner, to: outer, ticks: 40, knocks: true },
    ],
  };
}

export const TEAM_MOVERS: readonly Mover[] = [0, 1].flatMap(team => [sweeper(team, 9), sweeper(team, -13)]);

/** Start spot in the team's lane; 12 distinct spots per lane, behind the crate. */
export function teamSpawn(slot: number, team = 0) {
  return { x: laneX(team) + ((slot % 3) - 1) * 2.2, y: 1, z: 19 + Math.floor(slot / 3) * 1.6 };
}

export function cargoBox(team: number, z: number): Box {
  const [hx, hy, hz] = R.cargoHalf;
  const x = laneX(team);
  return box(`team-cargo-${team}`, 'platform', [x - hx, 0, z - hz], [x + hx, hy * 2, z + hz]);
}

/** Static lane boxes plus both crates at the given z. */
export function teamBoxes(cargo0: number, cargo1: number): readonly Box[] {
  return [...TEAM_BOXES, cargoBox(0, cargo0), cargoBox(1, cargo1)];
}

let cached = { cargo0: NaN, cargo1: NaN, boxes: TEAM_BOXES };
/**
 * teamBoxes for client prediction, cached on the last crate positions so
 * replays between state patches allocate nothing. The server keeps its own
 * copy per arena run instead, since several rooms share one process.
 */
export function teamWorld(cargo0: number, cargo1: number): readonly Box[] {
  if (cargo0 !== cached.cargo0 || cargo1 !== cached.cargo1) cached = { cargo0, cargo1, boxes: teamBoxes(cargo0, cargo1) };
  return cached.boxes;
}

/**
 * A crate that moved into a player pushes it out of the nearest side. Run after
 * the movement step on the server and in prediction, like resolveLava.
 */
export function resolveCargo(player: Player, cargo0: number, cargo1: number): void {
  for (const [team, z] of [[0, cargo0], [1, cargo1]] as const) {
    const crate = cargoBox(team, z);
    if (!overlaps([player.x, player.y, player.z], crate)) continue;
    const [hx, , hz] = HALF_EXTENTS;
    const outX = Math.min(crate.max[0] + hx - player.x, player.x - (crate.min[0] - hx));
    const outZ = Math.min(crate.max[2] + hz - player.z, player.z - (crate.min[2] - hz));
    if (outZ <= outX) player.z = player.z < z ? crate.min[2] - hz : crate.max[2] + hz;
    else player.x = player.x < laneX(team) ? crate.min[0] - hx : crate.max[0] + hx;
  }
}

/** True when the player is pressed against the back of its team's crate, pushing toward the goal. */
export function isPushing(player: Player, input: Pick<Input, 'x' | 'z'>, team: number, cargoZ: number): boolean {
  // Judge the direction the step actually used: sanitizeInput shortens inputs longer than 1.
  const length = Math.hypot(input.x, input.z);
  if (!(input.z / Math.max(1, length) <= -R.pushInput)) return false;
  const gap = player.z - HALF_EXTENTS[2] - (cargoZ + R.cargoHalf[2]);
  return gap >= -0.05 && gap <= R.pushReach &&
    Math.abs(player.x - laneX(team)) <= R.cargoHalf[0] + HALF_EXTENTS[0] &&
    player.y - HALF_EXTENTS[1] < R.cargoHalf[1] * 2;
}

/** The gate whose plate the player stands on in its own lane, or -1. */
export function plateUnder(player: Player, team: number): number {
  if (!player.grounded || Math.abs(player.y - HALF_EXTENTS[1]) > 1e-6) return -1;
  for (let gate = 0; gate < TEAM_GATES; gate++) {
    const [x, z] = plateCenter(team, gate);
    if (Math.abs(player.x - x) <= R.plateHalf && Math.abs(player.z - z) <= R.plateHalf) return gate;
  }
  return -1;
}

/** Server-owned crate state for one team. */
export type Cargo = {
  z: number;
  /** Gates the whole crate has cleared; its rollback checkpoint. */
  passed: number;
  /** Ticks since the last push. */
  idle: number;
  delivered: boolean;
};

export const newCargo = (): Cargo => ({ z: R.cargoStartZ, passed: 0, idle: 0, delivered: false });

/** Fraction of the course the crate has covered, 0 to 1. */
export function cargoProgress(z: number): number {
  return Math.max(0, Math.min(1, (R.cargoStartZ - z) / (R.cargoStartZ - R.goalZ)));
}

/**
 * One server tick of crate motion. `pushers` is already capped to the smaller
 * team's size; `open(gate)` says whether that gate's plate is holding it open.
 */
export function stepCargo(cargo: Cargo, pushers: number, open: (gate: number) => boolean, dt: number): void {
  if (cargo.delivered) return;
  const [, , hz] = R.cargoHalf;
  const count = Math.min(Math.max(0, Math.floor(pushers)), R.pushSpeed.length - 1);
  if (count > 0) {
    cargo.idle = 0;
    const before = cargo.z;
    cargo.z -= R.pushSpeed[count]! * dt;
    // A closed gate stops a crate whose front has not reached it yet; once the front is through, it can finish crossing.
    const gate = R.gates[cargo.passed];
    if (gate !== undefined && !open(cargo.passed) && before >= gate + hz - 1e-9) cargo.z = Math.max(cargo.z, gate + hz);
    while (cargo.passed < TEAM_GATES && cargo.z <= R.gates[cargo.passed]! - hz) cargo.passed++;
    if (cargo.z <= R.goalZ) {
      cargo.z = R.goalZ;
      cargo.delivered = true;
    }
    return;
  }
  if (++cargo.idle <= R.rollbackDelayTicks) return;
  const checkpoint = cargo.passed === 0 ? R.cargoStartZ : R.gates[cargo.passed - 1]! - hz;
  cargo.z = Math.min(checkpoint, cargo.z + R.rollbackSpeed * dt);
}

/** Bit for a team's gate in the replicated gate mask. */
export const gateBit = (team: number, gate: number) => 1 << (team * TEAM_GATES + gate);

/**
 * Team for each roster position: alternate down the roster after rotating it by
 * the match number, so with an odd roster the extra side changes hands across
 * rematches and sizes never differ by more than one.
 */
export function assignTeams(roster: readonly string[], rotation: number): Map<string, number> {
  const teams = new Map<string, number>();
  const n = roster.length;
  roster.forEach((id, index) => teams.set(id, (((index + rotation) % n) + n) % n % 2));
  return teams;
}
