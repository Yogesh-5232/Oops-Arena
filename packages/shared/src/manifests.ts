import { GREYBOX_ARENA, type Box } from './arena.js';
import { HALF_EXTENTS } from './collision.js';
import { DASH_BOXES, DASH_GATES, DASH_START_Z, dashSpawn } from './dash.js';
import { DODGE_BOXES, DODGE_FINALE_RULES, DODGE_MOVERS, DODGE_RULES, dodgeHazards, dodgeSpawn, type DodgeRules } from './dodge.js';
import { LAVA_BOXES, LAVA_MOVERS, LAVA_PADS, LAVA_RULES, LAVA_TIERS, lavaBalconySpot, lavaLevel, lavaSpawn } from './lava.js';
import { MODE, MOVEMENT, NO_JUMP } from './movement.js';
import { MOVERS, type Mover } from './movers.js';
import { TEAM_BOXES, TEAM_GATES, TEAM_MOVERS, TEAM_RULES, laneX, plateCenter, teamSpawn } from './team.js';
import { INPUT_BUFFER, MAX_TICK_REWIND, TICK_MS } from './timing.js';

/**
 * Bump when messages, room state or step code change in a way an older client
 * cannot follow. Arena content and the rule data in BUILD_RULES are hashed into
 * the build id automatically; logic changes inside functions are not.
 */
export const PROTOCOL_VERSION = 7;

export type ArenaId = 'plaza' | 'dash' | 'dodge' | 'lava' | 'team' | 'finale';
type Vec3 = readonly [number, number, number];
type Spawn = { x: number; y: number; z: number };

/** A flat, non-solid floor decal (gate line or checkpoint pad). */
export type ArenaMarker = { readonly id: string; readonly kind: 'gate' | 'checkpoint' | 'plate'; readonly min: Vec3; readonly max: Vec3 };

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
  readonly hazards: 'none' | 'dodge' | 'lava' | 'team';
  /** Wave timing for 'dodge' hazards; omitted means DODGE_RULES. Lets a finale reuse the Dodge arena. */
  readonly dodge?: DodgeRules;
  /** Spawn for a slot (and team, in team arenas); undefined means the player's own plaza spawn. */
  readonly spawn?: (slot: number, team?: number) => Spawn;
};

const checkpointMarkers: ArenaMarker[] = GREYBOX_ARENA.checkpoints.map(pad => ({
  id: pad.id, kind: 'checkpoint', min: [pad.min[0], pad.min[1], pad.min[2]], max: [pad.max[0], pad.min[1] + 0.06, pad.max[2]],
}));
const gateMarkers: ArenaMarker[] = DASH_GATES.map((gate, index) => ({
  id: `dash-gate-${index}`, kind: 'gate',
  min: [gate.x - gate.halfWidth, 0.005, gate.z - 0.4], max: [gate.x + gate.halfWidth, 0.055, gate.z + 0.4],
}));

const lavaMarkers: ArenaMarker[] = LAVA_PADS.map(([x, y, z], index) => ({
  id: `lava-pad-${index + 1}`, kind: 'checkpoint', min: [x - 1.5, y - 1, z - 1], max: [x + 1.5, y - 0.94, z + 1],
}));

/** Pressure plates past each gate, and each lane's goal line. */
const teamMarkers: ArenaMarker[] = [0, 1].flatMap(team => [
  ...Array.from({ length: TEAM_GATES }, (_, gate): ArenaMarker => {
    const [x, z] = plateCenter(team, gate);
    const h = TEAM_RULES.plateHalf;
    return { id: `team-plate-${team}-${gate}`, kind: 'plate', min: [x - h, 0.005, z - h], max: [x + h, 0.055, z + h] };
  }),
  { id: `team-goal-${team}`, kind: 'gate', min: [laneX(team) - 4.5, 0.005, TEAM_RULES.goalZ - TEAM_RULES.cargoHalf[2] - 0.4], max: [laneX(team) + 4.5, 0.055, TEAM_RULES.goalZ - TEAM_RULES.cargoHalf[2]] },
]);

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
  lava: {
    id: 'lava', version: 1, name: 'Floor Is Lava',
    boxes: LAVA_BOXES, movers: LAVA_MOVERS, markers: lavaMarkers, hazards: 'lava', spawn: lavaSpawn,
  },
  team: {
    id: 'team', version: 1, name: 'Teamwork Madness',
    boxes: TEAM_BOXES, movers: TEAM_MOVERS, markers: teamMarkers, hazards: 'team', spawn: teamSpawn,
  },
  /** Full preset finale: a variation of Dodge Everything (same floor, faster waves with both hazard families). */
  finale: {
    id: 'finale', version: 1, name: 'Dodge Everything: Finale',
    boxes: DODGE_BOXES, movers: DODGE_MOVERS, markers: [], hazards: 'dodge', dodge: DODGE_FINALE_RULES, spawn: dodgeSpawn,
  },
} as const satisfies { readonly [Id in ArenaId]: ArenaManifest & { readonly id: Id } };

/** The manifest for a replicated arena id. An empty id (state default) is the plaza. */
export function arenaManifest(id: string): ArenaManifest {
  return (ARENAS as Readonly<Record<string, ArenaManifest>>)[id || 'plaza'] ?? ARENAS.plaza;
}

/**
 * Rule data both sides simulate with beyond the arena manifests: timing, the
 * movement and collision constants, the whole plaza (spawns, checkpoint
 * respawns, kill height), Dash gates and the Dodge hazard tunables. The Dodge
 * schedule is also sampled over two waves for two seeds; it uses only exact
 * IEEE arithmetic and Math.imul, so every engine produces the same numbers.
 * Float-heavy step code (Math.hypot and friends) is deliberately not sampled:
 * engines may differ in the last bit, which prediction tolerates but a hash
 * would not.
 */
export const BUILD_RULES = {
  timing: { TICK_MS, INPUT_BUFFER, MAX_TICK_REWIND },
  movement: { MOVEMENT, MODE, NO_JUMP, HALF_EXTENTS },
  plaza: GREYBOX_ARENA,
  dash: { DASH_GATES, DASH_START_Z },
  dodge: {
    DODGE_RULES,
    schedule: [1, 0x5eed].map(seed => Array.from(
      { length: DODGE_RULES.waveTicks * 2 }, (_, tick) => dodgeHazards(seed, tick),
    ).filter(hazards => hazards.length > 0)),
  },
  finale: {
    DODGE_FINALE_RULES,
    schedule: [1, 0x5eed].map(seed => Array.from(
      { length: DODGE_FINALE_RULES.waveTicks * 2 }, (_, tick) => dodgeHazards(seed, tick, DODGE_FINALE_RULES),
    ).filter(hazards => hazards.length > 0)),
  },
  lava: {
    LAVA_RULES, LAVA_TIERS, LAVA_PADS,
    balcony: Array.from({ length: GREYBOX_ARENA.spawns.length }, (_, slot) => lavaBalconySpot(slot)),
    level: Array.from({ length: 161 }, (_, second) => lavaLevel(second * 30, 4800)),
  },
  team: {
    TEAM_RULES,
    redSpawns: Array.from({ length: GREYBOX_ARENA.spawns.length }, (_, slot) => teamSpawn(slot, 1)),
  },
};

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
 * Build identifier compared at admission. It covers the protocol version,
 * every manifest's content (collision boxes, movers, markers, sample spawns)
 * and BUILD_RULES, so a cached client with different arena or rule data is
 * rejected rather than predicting against rules the server does not use.
 */
export function buildId(
  arenas: Readonly<Record<string, ArenaManifest>> = ARENAS, protocol = PROTOCOL_VERSION, rules: unknown = BUILD_RULES,
): string {
  const content = Object.values(arenas)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(arena => ({
      id: arena.id, version: arena.version, hazards: arena.hazards, dodge: arena.dodge ?? null,
      boxes: arena.boxes, movers: arena.movers, markers: arena.markers,
      spawns: arena.spawn ? Array.from({ length: GREYBOX_ARENA.spawns.length }, (_, slot) => arena.spawn!(slot)) : null,
    }));
  return `p${protocol}-${fnv1a(JSON.stringify({ arenas: content, rules }))}`;
}

export const ARENA_BUILD = buildId();
