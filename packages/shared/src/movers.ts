/**
 * Moving boxes whose position is a pure function of the world tick, so the
 * server and every client compute exactly the same pose for the same tick and
 * nothing about them needs to be replicated.
 *
 * A player's step evaluates movers at the tick stamped on that player's input
 * (see Input.tick), the moment the player saw. Riding and getting hit are then
 * predicted exactly instead of rubber-banding.
 */
import type { Box } from './arena.js';

/** One leg of a mover's loop: from `from` to `to` (box centers) over `ticks` ticks. */
type Leg = { readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number]; readonly ticks: number; readonly knocks?: boolean };

export type Mover = {
  readonly id: string;
  readonly kind: 'ferry' | 'pusher';
  /** Box size (width, height, depth). */
  readonly size: readonly [number, number, number];
  /** The loop, played back to back forever starting at tick 0. Holds are legs with from === to. */
  readonly legs: readonly Leg[];
  /** Ticks before a knocking leg during which the mover shows a warning. */
  readonly warnTicks: number;
};

const ticksFor = (distance: number, unitsPerSecond: number) => Math.round((distance / unitsPerSecond) * 30);

const FERRY_A = [16.5, -0.5, 0] as const;
const FERRY_B = [22.5, -0.5, 0] as const;
const FERRY_TRAVEL = ticksFor(6, 2.5);
const PUSHER_REST = [-9, 1, -10.5] as const;
const PUSHER_OUT = [1, 1, -10.5] as const;

/**
 * Ferry: a 3 x 1 x 3 deck flush with the floors, shuttling across the east pit
 * (main floor edge at x 15, east ledge from x 24) at 2.5 units a second with a
 * one-second pause at each end.
 *
 * Pusher: a 1.5 x 2 x 3 block in the south lane. It rests for a second, glowing
 * for the last 0.7 s, slams 10 units east at 12 units a second (knocking anyone
 * in its way), holds briefly and slides back at 10 units a second. A 3 s loop.
 */
export const MOVERS: readonly Mover[] = [
  {
    id: 'ferry-east', kind: 'ferry', size: [3, 1, 3], warnTicks: 0,
    legs: [
      { from: FERRY_A, to: FERRY_A, ticks: 30 },
      { from: FERRY_A, to: FERRY_B, ticks: FERRY_TRAVEL },
      { from: FERRY_B, to: FERRY_B, ticks: 30 },
      { from: FERRY_B, to: FERRY_A, ticks: FERRY_TRAVEL },
    ],
  },
  {
    id: 'pusher-south', kind: 'pusher', size: [1.5, 2, 3], warnTicks: 21,
    legs: [
      { from: PUSHER_REST, to: PUSHER_REST, ticks: 30 },
      { from: PUSHER_REST, to: PUSHER_OUT, ticks: ticksFor(10, 12), knocks: true },
      { from: PUSHER_OUT, to: PUSHER_OUT, ticks: 5 },
      { from: PUSHER_OUT, to: PUSHER_REST, ticks: ticksFor(10, 10) },
    ],
  },
];

const loopTicks = (mover: Mover) => mover.legs.reduce((sum, leg) => sum + leg.ticks, 0);

/** Where in the loop `tick` falls: the leg and how many ticks into it. */
function legAt(mover: Mover, tick: number): { leg: Leg; into: number; index: number } {
  let t = ((Math.floor(tick) % loopTicks(mover)) + loopTicks(mover)) % loopTicks(mover);
  for (let index = 0; index < mover.legs.length; index++) {
    const leg = mover.legs[index]!;
    if (t < leg.ticks) return { leg, into: t, index };
    t -= leg.ticks;
  }
  return { leg: mover.legs[0]!, into: 0, index: 0 };
}

/**
 * Center of `mover` at `tick`. Integer ticks give exact, identical poses on
 * every machine; a fractional tick (used only for drawing) interpolates.
 */
export function moverCenter(mover: Mover, tick: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const whole = Math.floor(tick);
  const { leg, into } = legAt(mover, whole);
  const fraction = (into + (tick - whole)) / leg.ticks;
  for (let axis = 0; axis < 3; axis++) out[axis] = leg.from[axis]! + (leg.to[axis]! - leg.from[axis]!) * fraction;
  return out;
}

/** The mover's box at `tick`. */
export function moverBox(mover: Mover, tick: number): Box {
  const center = moverCenter(mover, tick);
  return {
    id: mover.id, kind: 'platform',
    min: [center[0] - mover.size[0] / 2, center[1] - mover.size[1] / 2, center[2] - mover.size[2] / 2],
    max: [center[0] + mover.size[0] / 2, center[1] + mover.size[1] / 2, center[2] + mover.size[2] / 2],
  };
}

/** True while the step from tick - 1 to tick is part of a knocking leg. */
export function moverKnocks(mover: Mover, tick: number): boolean {
  return legAt(mover, tick - 1).leg.knocks === true;
}

/** True during the warning before a knocking leg (drawing only). */
export function moverWarns(mover: Mover, tick: number): boolean {
  if (mover.warnTicks === 0) return false;
  const { index, into, leg } = legAt(mover, tick);
  const next = mover.legs[(index + 1) % mover.legs.length]!;
  return next.knocks === true && leg.ticks - into <= mover.warnTicks;
}
