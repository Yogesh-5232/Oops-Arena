import { ARENAS, type DashStanding, type Player } from '@chaos/shared';
import { DashRace } from './dash-race.js';
import { LIVE_ARENA_RUNS, type ArenaPosition, type ArenaRun, type ArenaSetup, type ArenaSpawn } from './arena-run.js';

/** Dash-specific setup, authoritative progress recording, ranking, and cleanup. */
export class DashArenaRun implements ArenaRun<DashStanding[]> {
  readonly manifest = ARENAS.dash;
  readonly collisionBoxes = ARENAS.dash.boxes;
  readonly movers = ARENAS.dash.movers;
  private race?: DashRace;
  private lifecycle: 'new' | 'active' | 'disposed' = 'new';

  setup(context: ArenaSetup): void {
    if (this.lifecycle !== 'new') throw new Error('Dash arena run can only be set up once');
    this.race = new DashRace(context.roster, context.name);
    this.lifecycle = 'active';
    LIVE_ARENA_RUNS.add(this);
  }

  spawn(slot: number): ArenaSpawn {
    this.assertActive();
    return this.manifest.spawn(slot);
  }

  /** Dash has no additional per-tick world state beyond the shared simulation. */
  update(_serverTick: number, _now: number): void {
    this.assertActive();
  }

  playerStep(id: string, before: ArenaPosition, after: Player, elapsedMs: number, _worldTick: number): number {
    this.assertActive();
    return this.race!.record(id, before, after, elapsedMs);
  }

  get allFinished(): boolean {
    this.assertActive();
    return this.race!.allFinished;
  }

  rank(): DashStanding[] {
    this.assertActive();
    return this.race!.standings();
  }

  dispose(): void {
    if (this.lifecycle === 'disposed') return;
    this.race?.dispose();
    this.race = undefined;
    this.lifecycle = 'disposed';
    LIVE_ARENA_RUNS.delete(this);
  }

  private assertActive(): void {
    if (this.lifecycle !== 'active' || !this.race) throw new Error('Dash arena run is not active');
  }
}
