import * as pc from 'playcanvas';
import { LAVA_TIERS, dodgeHazards, lavaLevel, lavaWarning, moverCenter, moverWarns, type ArenaManifest, type Mover } from '@chaos/shared';
import type { StageView } from './arena-stage.js';

/** Materials alive right now, for leak checks in diagnostics builds. */
let liveMaterials = 0;
export const materialCount = () => liveMaterials;

export function createMaterial(color: pc.Color): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse.copy(color);
  material.update();
  liveMaterials++;
  return material;
}
export function destroyMaterial(material: pc.StandardMaterial): void {
  material.destroy();
  liveMaterials--;
}

export function solid(name: string, material: pc.StandardMaterial, scale: pc.Vec3, parent: pc.Entity): pc.Entity {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type: 'box', material });
  entity.setLocalScale(scale);
  parent.addChild(entity);
  return entity;
}

const BOX_COLORS = {
  floor: new pc.Color(0.4, 0.7, 0.45),
  platform: new pc.Color(0.85, 0.6, 0.35),
  wall: new pc.Color(0.55, 0.55, 0.65),
} as const;
const MARKER_COLORS = { gate: new pc.Color(1, 0.75, 0.15), checkpoint: new pc.Color(0.35, 0.75, 0.95) } as const;
const MOVER_COLORS = { ferry: new pc.Color(0.85, 0.6, 0.35), pusher: new pc.Color(0.75, 0.25, 0.25) } as const;
const WARNING_COLOR = new pc.Color(1, 0.85, 0.2);
const WARNING_GLOW = new pc.Color(0.4, 0.3, 0);
const DODGE_ACTIVE = new pc.Color(0.95, 0.15, 0.12);
const DODGE_GLOW = new pc.Color(0.3, 0, 0);
/** Dodge never shows more than two hazards at once (one sweeper or two drop zones). */
const MAX_DODGE_HAZARDS = 2;
const LAVA_COLOR = new pc.Color(1, 0.35, 0.05);
const LAVA_GLOW = new pc.Color(0.6, 0.12, 0);
const LAVA_RISING = new pc.Color(1, 0.6, 0.1);
const LAVA_RISING_GLOW = new pc.Color(0.9, 0.35, 0);
/** The lava pool covers the base floor; it is drawn from just under the floor up to the lava surface. */
const LAVA_HALF = LAVA_TIERS[0]!.half;
const LAVA_BOTTOM = -1;

/** Seeded or timed hazards for the live round, by arena tick. */
export type HazardClock = { seed: number; elapsedTicks: number; roundTicks: number };

type Tinted = { entity: pc.Entity; material: pc.StandardMaterial };
const scratch: [number, number, number] = [0, 0, 0];

function tint(material: pc.StandardMaterial, color: pc.Color, glow: pc.Color): void {
  if (material.diffuse.equals(color) && material.emissive.equals(glow)) return;
  material.diffuse.copy(color);
  material.emissive.copy(glow);
  material.update();
}

/**
 * One arena's entity tree, built from its manifest: the same boxes and movers
 * the simulation collides with, plus floor markers and seeded hazards. It owns
 * every entity and material it creates and frees them all on destroy.
 */
export class ArenaView implements StageView {
  readonly id: string;
  private readonly root: pc.Entity;
  private readonly materials: pc.StandardMaterial[] = [];
  private readonly movers: Array<Tinted & { mover: Mover }> = [];
  private readonly hazards: Tinted[] = [];
  private lava?: Tinted;

  constructor(parent: pc.Entity, readonly manifest: ArenaManifest) {
    this.id = manifest.id;
    this.root = new pc.Entity(`arena-${manifest.id}-v${manifest.version}`);
    this.root.enabled = false;
    parent.addChild(this.root);
    const shared = new Map<string, pc.StandardMaterial>();
    const sharedMaterial = (key: string, color: pc.Color) => {
      let material = shared.get(key);
      if (!material) shared.set(key, material = this.own(createMaterial(color)));
      return material;
    };
    for (const piece of manifest.boxes) {
      const entity = solid(piece.id, sharedMaterial(piece.kind, BOX_COLORS[piece.kind]), this.size(piece.min, piece.max), this.root);
      entity.setPosition(...this.center(piece.min, piece.max));
    }
    for (const marker of manifest.markers) {
      const entity = solid(marker.id, sharedMaterial(marker.kind, MARKER_COLORS[marker.kind]), this.size(marker.min, marker.max), this.root);
      entity.setPosition(...this.center(marker.min, marker.max));
    }
    for (const mover of manifest.movers) {
      const material = this.own(createMaterial(MOVER_COLORS[mover.kind]));
      this.movers.push({ mover, material, entity: solid(mover.id, material, new pc.Vec3(...mover.size), this.root) });
    }
    if (manifest.hazards === 'dodge') {
      for (let index = 0; index < MAX_DODGE_HAZARDS; index++) {
        const material = this.own(createMaterial(DODGE_ACTIVE));
        const entity = solid(`dodge-hazard-${index}`, material, new pc.Vec3(1, 1, 1), this.root);
        entity.enabled = false;
        this.hazards.push({ entity, material });
      }
    }
    if (manifest.hazards === 'lava') {
      const material = this.own(createMaterial(LAVA_COLOR));
      material.emissive.copy(LAVA_GLOW);
      material.update();
      this.lava = { material, entity: solid('lava-pool', material, new pc.Vec3(1, 1, 1), this.root) };
    }
  }

  setVisible(visible: boolean): void { this.root.enabled = visible; }

  /**
   * Poses movers at a (possibly fractional) world tick and, while a round is
   * live, its hazards at the elapsed arena tick: Dodge's seeded hazards or the
   * Lava surface. Outside a live round, lava rests at its starting level.
   */
  pose(tick: number, live?: HazardClock): void {
    for (const { mover, entity, material } of this.movers) {
      entity.setPosition(...moverCenter(mover, tick, scratch));
      const warning = moverWarns(mover, Math.floor(tick));
      tint(material, warning ? WARNING_COLOR : MOVER_COLORS[mover.kind], warning ? WARNING_GLOW : pc.Color.BLACK);
    }
    if (this.lava) {
      const elapsed = live ? Math.max(0, live.elapsedTicks) : 0;
      const roundTicks = live?.roundTicks ?? 1;
      const top = lavaLevel(elapsed, roundTicks);
      this.lava.entity.setLocalScale(LAVA_HALF * 2, top - LAVA_BOTTOM, LAVA_HALF * 2);
      this.lava.entity.setPosition(0, (top + LAVA_BOTTOM) / 2, 0);
      const rising = Boolean(live) && lavaWarning(Math.floor(elapsed), roundTicks);
      tint(this.lava.material, rising ? LAVA_RISING : LAVA_COLOR, rising ? LAVA_RISING_GLOW : LAVA_GLOW);
    }
    if (this.hazards.length === 0) return;
    const active = live ? dodgeHazards(live.seed, live.elapsedTicks) : [];
    this.hazards.forEach(({ entity, material }, index) => {
      const hazard = active[index];
      entity.enabled = Boolean(hazard);
      if (!hazard) return;
      // Plain numbers: this runs every frame, so it allocates nothing.
      const [x0, y0, z0] = hazard.min;
      const [x1, y1, z1] = hazard.max;
      entity.setLocalScale(x1 - x0, y1 - y0, z1 - z0);
      entity.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const warning = hazard.phase === 'warning';
      tint(material, warning ? WARNING_COLOR : DODGE_ACTIVE, warning ? WARNING_GLOW : DODGE_GLOW);
    });
  }

  destroy(): void {
    this.root.destroy();
    for (const material of this.materials) destroyMaterial(material);
    this.materials.length = this.movers.length = this.hazards.length = 0;
    this.lava = undefined;
  }

  private own(material: pc.StandardMaterial): pc.StandardMaterial {
    this.materials.push(material);
    return material;
  }
  private size(min: readonly number[], max: readonly number[]): pc.Vec3 {
    return new pc.Vec3(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  }
  private center(min: readonly number[], max: readonly number[]): [number, number, number] {
    return [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
  }
}
