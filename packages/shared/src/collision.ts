import type { Box } from './arena.js';

/** Bounds of the upright capsule, measured from its center. */
export const HALF_EXTENTS = [0.5, 1, 0.5] as const;
const RADIUS = HALF_EXTENTS[0];
const HALF_SEGMENT = HALF_EXTENTS[1] - RADIUS;
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
  let limit = delta;
  let contact: number | undefined;
  let blocker = -1;
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index]!;
    // Intersect the rounded box (expanded by the capsule) with the line
    // along this sweep. At a corner the contact is closer than the full radius.
    let radiusSquared = RADIUS * RADIUS;
    for (let other = 0; other < 3; other++) {
      if (other === axis) continue;
      const gap = segmentGap(position[other]!, box, other);
      radiusSquared -= gap * gap;
    }
    if (radiusSquared <= EPSILON * EPSILON) continue;
    const half = Math.sqrt(radiusSquared) + (axis === 1 ? HALF_SEGMENT : 0);
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

function segmentGap(center: number, box: Box, axis: number): number {
  const half = axis === 1 ? HALF_SEGMENT : 0;
  return Math.max(box.min[axis]! - (center + half), center - half - box.max[axis]!, 0);
}

/** True when the capsule penetrates the box. Tangent contact does not count. */
export function overlaps(position: readonly [number, number, number], box: Box): boolean {
  const x = segmentGap(position[0], box, 0);
  const y = segmentGap(position[1], box, 1);
  const z = segmentGap(position[2], box, 2);
  return x * x + y * y + z * z < (RADIUS - EPSILON) ** 2;
}
