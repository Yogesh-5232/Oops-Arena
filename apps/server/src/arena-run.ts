import type { ArenaManifest, Player } from '@chaos/shared';

export type ArenaSpawn = Pick<Player, 'x' | 'y' | 'z'>;
export type ArenaPosition = Pick<Player, 'x' | 'y' | 'z'>;

export type ArenaSetup = {
  /** The room that owns the run; diagnostics count live runs per owner. */
  owner: string;
  roster: readonly string[];
  name: (id: string) => string;
  seed?: number;
  startTick?: number;
  inactiveIds?: readonly string[];
};

/**
 * Server-owned gameplay for one arena within a match. Phase timing stays with
 * the room. Collision and movers come from `manifest`, the same data the
 * client predicts and draws with.
 */
export interface ArenaRun<Result> {
  readonly manifest: ArenaManifest;
  setup(context: ArenaSetup): void;
  spawn(slot: number): ArenaSpawn;
  /** Called once per server fixed tick while this arena run is active. */
  update(serverTick: number, now: number): void;
  /** Called after each authoritative movement step, including catch-up steps. Returns public room progress. */
  playerStep(id: string, before: ArenaPosition, after: Player, elapsedMs: number, worldTick: number): number;
  readonly allFinished: boolean;
  rank(): Result;
  /** Release all run-owned state. Must be safe to call more than once. */
  dispose(): void;
}

/** Every arena run between setup and dispose, with the room that owns it. */
const live = new Map<ArenaRun<unknown>, string>();

/** Live arena runs for one room, or for the whole process when no owner is given. */
export function liveArenaRuns(owner?: string): number {
  if (owner === undefined) return live.size;
  let count = 0;
  for (const runOwner of live.values()) if (runOwner === owner) count++;
  return count;
}

/**
 * The run lifecycle shared by every arena: set up exactly once, refuse all
 * gameplay calls unless active, dispose idempotently, and stay registered as
 * live in between so leaks show up in diagnostics and tests.
 */
export abstract class ArenaRunBase<Result> implements ArenaRun<Result> {
  abstract readonly manifest: ArenaManifest & { spawn: (slot: number) => ArenaSpawn };
  private lifecycle: 'new' | 'active' | 'disposed' = 'new';

  setup(context: ArenaSetup): void {
    if (this.lifecycle !== 'new') throw new Error(`${this.manifest.name} run can only be set up once`);
    this.onSetup(context);
    this.lifecycle = 'active';
    live.set(this, context.owner);
  }

  spawn(slot: number): ArenaSpawn {
    this.assertActive();
    return this.manifest.spawn(slot);
  }

  update(serverTick: number, now: number): void {
    this.assertActive();
    this.onUpdate(serverTick, now);
  }

  playerStep(id: string, before: ArenaPosition, after: Player, elapsedMs: number, worldTick: number): number {
    this.assertActive();
    return this.onPlayerStep(id, before, after, elapsedMs, worldTick);
  }

  get allFinished(): boolean {
    this.assertActive();
    return this.finished();
  }

  rank(): Result {
    this.assertActive();
    return this.ranking();
  }

  dispose(): void {
    if (this.lifecycle === 'disposed') return;
    const wasActive = this.lifecycle === 'active';
    this.lifecycle = 'disposed';
    live.delete(this);
    if (wasActive) this.onDispose();
  }

  protected assertActive(): void {
    if (this.lifecycle !== 'active') throw new Error(`${this.manifest.name} run is not active`);
  }

  protected abstract onSetup(context: ArenaSetup): void;
  /** Per-tick world state beyond the shared simulation; most arenas have none. */
  protected onUpdate(_serverTick: number, _now: number): void {}
  protected abstract onPlayerStep(
    id: string, before: ArenaPosition, after: Player, elapsedMs: number, worldTick: number,
  ): number;
  protected abstract finished(): boolean;
  protected abstract ranking(): Result;
  protected abstract onDispose(): void;
}
