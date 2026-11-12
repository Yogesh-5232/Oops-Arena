import { GREYBOX_ARENA, type Box } from './arena.js';

export const PLAZA_PORTALS = ([
  { preset: 'dash', x: 0, z: 6.1 },
  { preset: 'dodge', x: -13.4, z: -3.5 },
  { preset: 'lava', x: 0, z: -12.1 },
  { preset: 'team', x: 13.4, z: -3.5 },
] as const).map(portal => ({ ...portal, yaw: Math.atan2(-portal.x, -3.5 - portal.z) }));

// Collision bounds enter the build hash, so round away cross-engine trig differences.
const bound = (value: number) => Math.round(value * 1e6) / 1e6;

export const PLAZA_BOXES: readonly Box[] = [
  GREYBOX_ARENA.boxes[0],
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
