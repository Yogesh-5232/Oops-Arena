import type { Box } from './arena.js';

/** Player body: a 1 x 2 x 1 box around its center. */
export const HALF_EXTENTS = [0.5, 1, 0.5] as const;
/**
 * Faces closer than this count as touching, not overlapping, so a player
 * standing on a floor can slide across it and along walls without snagging.
 */
const EPSILON = 1e-6;

export type Vec3 = [number, number, number];

/**
 * Moves `position` along one axis by up to `delta`, stopping flush against the
 * first box in the way. Sweeping the whole path (rather than testing only the
 * end point) means even a fast fall cannot pass through a thin box.
 *
 * Returns the index in `boxes` of the box that blocked the move, or -1. A
 * contact sets the coordinate exactly to the touching value, so both server and
 * client land on identical numbers instead of accumulating rounding.
 */
export function sweepAxis(position: Vec3, axis: 0 | 1 | 2, delta: number, boxes: readonly Box[]): number {
  if (delta === 0) return -1;
  const half = HALF_EXTENTS[axis];
  let limit = delta;
  let contact: number | undefined;
  let blocker = -1;
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index]!;
    if (!overlapsOtherAxes(position, axis, box)) continue;
    if (delta > 0) {
      const gap = box.min[axis] - (position[axis] + half);
      if (gap > -EPSILON && gap < limit) {
        limit = Math.max(gap, 0);
        contact = box.min[axis] - half;
        blocker = index;
      }
    } else {
      const gap = (position[axis] - half) - box.max[axis];
      if (gap > -EPSILON && gap < -limit) {
        limit = -Math.max(gap, 0);
        contact = box.max[axis] + half;
        blocker = index;
      }
    }
  }
  if (contact === undefined) {
    position[axis] += delta;
    return -1;
  }
  position[axis] = contact;
  return blocker;
}

function overlapsOtherAxes(position: Vec3, axis: number, box: Box): boolean {
  for (let other = 0; other < 3; other++) {
    if (other === axis) continue;
    const half = HALF_EXTENTS[other]!;
    if (position[other]! - half >= box.max[other]! - EPSILON) return false;
    if (position[other]! + half <= box.min[other]! + EPSILON) return false;
  }
  return true;
}

/** True when a player body at `position` overlaps `box` (touching faces do not count). */
export function overlaps(position: readonly [number, number, number], box: Box): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const half = HALF_EXTENTS[axis]!;
    if (position[axis]! - half >= box.max[axis]! - EPSILON) return false;
    if (position[axis]! + half <= box.min[axis]! + EPSILON) return false;
  }
  return true;
}
