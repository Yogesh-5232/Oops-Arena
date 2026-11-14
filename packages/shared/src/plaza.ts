import { GREYBOX_ARENA, type Box } from './arena.js';

export const PLAZA_PORTALS = ([
  { preset: 'dash', x: -6.2, z: -7.8, yaw: 0.27 },
  { preset: 'dodge', x: -8.3, z: 3.3, yaw: 0.26 },
  { preset: 'lava', x: 6.2, z: -7.8, yaw: -0.27 },
  { preset: 'team', x: 8.3, z: 3.3, yaw: -0.26 },
] as const);

export const PLAZA_BOOTH = {
  x: 0, z: -9, width: 3.8, depth: 2.6, height: 2.35,
} as const;

export const PLAZA_PLANTERS = [
  [-4.2, -8.6], [4.2, -8.6], [-11.7, -0.7], [11.7, -0.7], [-5.8, 6.5], [5.8, 6.5],
] as const;

export const PLAZA_RAIL_X = 14.2;

const booth = PLAZA_BOOTH;

// Collision bounds enter the build hash, so round away cross-engine trig differences.
const bound = (value: number) => Math.round(value * 1e6) / 1e6;

export const PLAZA_BOXES: readonly Box[] = [
  GREYBOX_ARENA.boxes[0],
  {
    id: 'plaza-booth', kind: 'wall',
    min: [booth.x - booth.width / 2, 0, booth.z - booth.depth / 2],
    max: [booth.x + booth.width / 2, booth.height, booth.z + booth.depth / 2],
  },
  ...PLAZA_PLANTERS.map(([x, z], index): Box => ({
    id: `plaza-planter-${index}`, kind: 'wall',
    min: [bound(x - 0.69), 0, bound(z - 0.58)],
    max: [bound(x + 0.69), 0.9, bound(z + 0.58)],
  })),
  ...[-PLAZA_RAIL_X, PLAZA_RAIL_X].map((x, index): Box => ({
    id: `plaza-rail-${index}`, kind: 'wall',
    min: [bound(x - 0.17), 0, -10.17],
    max: [bound(x + 0.17), 1.08, 6.17],
  })),
  ...PLAZA_PORTALS.flatMap(portal => {
    const cos = Math.cos(portal.yaw);
    const sin = Math.sin(portal.yaw);
    const solid = (part: string, x: number, z: number, halfX: number, halfZ: number, height: number): Box => {
      const cx = portal.x + cos * x + sin * z;
      const cz = portal.z - sin * x + cos * z;
      const dx = Math.abs(cos) * halfX + Math.abs(sin) * halfZ;
      const dz = Math.abs(sin) * halfX + Math.abs(cos) * halfZ;
      return {
        id: `portal-${portal.preset}-${part}`, kind: 'wall',
        min: [bound(cx - dx), 0, bound(cz - dz)], max: [bound(cx + dx), height, bound(cz + dz)],
      };
    };
    // Match the posts and divide the angled back panel into narrow collision boxes.
    return [
      solid('left', -1.34, 0, 0.27, 0.4, 2.3),
      solid('right', 1.34, 0, 0.27, 0.4, 2.3),
      ...Array.from({ length: 6 }, (_, index) => solid(`panel-${index}`, (index - 2.5) * 0.36, -0.32, 0.18, 0.04, 2.24)),
    ];
  }),
];

export function plazaPortalAt(x: number, z: number): (typeof PLAZA_PORTALS)[number] | undefined {
  return PLAZA_PORTALS.find(portal => {
    const dx = x - portal.x;
    const dz = z - portal.z;
    const across = dx * Math.cos(portal.yaw) - dz * Math.sin(portal.yaw);
    const forward = dx * Math.sin(portal.yaw) + dz * Math.cos(portal.yaw);
    return Math.abs(across) <= 0.95 && forward >= 0.25 && forward <= 1.65;
  });
}
