import * as pc from 'playcanvas';
import { dodgeHazards, moverCenter, moverWarns, type ArenaManifest, type Mover } from '@chaos/shared';
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
  }

  setVisible(visible: boolean): void { this.root.enabled = visible; }

  /**
   * Poses movers at a (possibly fractional) world tick and, while a Dodge round
   * is live, its seeded hazards at the elapsed arena tick.
   */
  pose(tick: number, dodge?: { seed: number; elapsedTicks: number }): void {
    for (const { mover, entity, material } of this.movers) {
      entity.setPosition(...moverCenter(mover, tick, scratch));
      const warning = moverWarns(mover, Math.floor(tick));
      tint(material, warning ? WARNING_COLOR : MOVER_COLORS[mover.kind], warning ? WARNING_GLOW : pc.Color.BLACK);
    }
    if (this.hazards.length === 0) return;
    const live = dodge ? dodgeHazards(dodge.seed, dodge.elapsedTicks) : [];
    this.hazards.forEach(({ entity, material }, index) => {
      const hazard = live[index];
      entity.enabled = Boolean(hazard);
      if (!hazard) return;
      entity.setLocalScale(this.size(hazard.min, hazard.max));
      entity.setPosition(...this.center(hazard.min, hazard.max));
      const warning = hazard.phase === 'warning';
      tint(material, warning ? WARNING_COLOR : DODGE_ACTIVE, warning ? WARNING_GLOW : DODGE_GLOW);
    });
  }

  destroy(): void {
    this.root.destroy();
    for (const material of this.materials) destroyMaterial(material);
    this.materials.length = this.movers.length = this.hazards.length = 0;
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
