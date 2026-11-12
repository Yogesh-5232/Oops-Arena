import { GREYBOX_ARENA, type Box } from './arena.js';
import { DASH_BOXES, DASH_GATES, dashSpawn } from './dash.js';
import { DODGE_BOXES, DODGE_MOVERS, dodgeSpawn } from './dodge.js';
import { MOVERS, type Mover } from './movers.js';

/**
 * Bump when messages, room state or simulation rules change in a way an older
 * client cannot follow. Arena content changes are caught by the manifest hash.
 */
export const PROTOCOL_VERSION = 1;

export type ArenaId = 'plaza' | 'dash' | 'dodge';
type Vec3 = readonly [number, number, number];
type Spawn = { x: number; y: number; z: number };

/** A flat, non-solid floor decal (gate line or checkpoint pad). */
export type ArenaMarker = { readonly id: string; readonly kind: 'gate' | 'checkpoint'; readonly min: Vec3; readonly max: Vec3 };

/**
 * Everything the server simulates and the client draws for one arena. The
 * server collides with `boxes` and `movers`; the client renders the same lists,
 * so geometry cannot drift between them within one build.
 */
export type ArenaManifest = {
  readonly id: ArenaId;
  /** Bump with any content or rule change for this arena. */
  readonly version: number;
  readonly name: string;
  readonly boxes: readonly Box[];
  readonly movers: readonly Mover[];
  readonly markers: readonly ArenaMarker[];
  /** Seeded per-match hazards drawn and resolved from the match seed. */
  readonly hazards: 'none' | 'dodge';
  /** Spawn for a slot; undefined means the player's own plaza spawn. */
  readonly spawn?: (slot: number) => Spawn;
};

const checkpointMarkers: ArenaMarker[] = GREYBOX_ARENA.checkpoints.map(pad => ({
  id: pad.id, kind: 'checkpoint', min: [pad.min[0], pad.min[1], pad.min[2]], max: [pad.max[0], pad.min[1] + 0.06, pad.max[2]],
}));
const gateMarkers: ArenaMarker[] = DASH_GATES.map((gate, index) => ({
  id: `dash-gate-${index}`, kind: 'gate',
  min: [gate.x - gate.halfWidth, 0.005, gate.z - 0.4], max: [gate.x + gate.halfWidth, 0.055, gate.z + 0.4],
}));

export const ARENAS = {
  plaza: {
    id: 'plaza', version: 1, name: 'Plaza',
    boxes: GREYBOX_ARENA.boxes, movers: MOVERS, markers: checkpointMarkers, hazards: 'none',
  },
  dash: {
    id: 'dash', version: 1, name: 'Ultimate Obstacle Dash',
    boxes: DASH_BOXES, movers: MOVERS, markers: gateMarkers, hazards: 'none', spawn: dashSpawn,
  },
  dodge: {
    id: 'dodge', version: 1, name: 'Dodge Everything',
    boxes: DODGE_BOXES, movers: DODGE_MOVERS, markers: [], hazards: 'dodge', spawn: dodgeSpawn,
  },
} as const satisfies { readonly [Id in ArenaId]: ArenaManifest & { readonly id: Id } };

/** The manifest for a replicated arena id. An empty id (state default) is the plaza. */
export function arenaManifest(id: string): ArenaManifest {
  return (ARENAS as Readonly<Record<string, ArenaManifest>>)[id || 'plaza'] ?? ARENAS.plaza;
}

/** FNV-1a over a canonical JSON string: stable across Node and browsers. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Build identifier compared at admission. It covers the protocol version and
 * every manifest's content (collision boxes, movers, markers, sample spawns),
 * so a cached client with different arena data is rejected rather than
 * predicting against geometry the server does not use.
 */
export function buildId(arenas: Readonly<Record<string, ArenaManifest>> = ARENAS, protocol = PROTOCOL_VERSION): string {
  const content = Object.values(arenas)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(arena => ({
      id: arena.id, version: arena.version, hazards: arena.hazards,
      boxes: arena.boxes, movers: arena.movers, markers: arena.markers,
      spawns: arena.spawn ? Array.from({ length: GREYBOX_ARENA.spawns.length }, (_, slot) => arena.spawn!(slot)) : null,
    }));
  return `p${protocol}-${fnv1a(JSON.stringify(content))}`;
}

export const ARENA_BUILD = buildId();
