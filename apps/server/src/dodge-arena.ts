import { ARENAS, resolveDodgeHazards, type DodgeStanding, type Player } from '@chaos/shared';
import { LIVE_ARENA_RUNS, type ArenaPosition, type ArenaRun, type ArenaSetup, type ArenaSpawn } from './arena-run.js';

/** Seeded Dodge Everything run. The room controls its start and cutoff. */
export class DodgeArenaRun implements ArenaRun<DodgeStanding[]> {
  readonly manifest = ARENAS.dodge;
  readonly collisionBoxes = ARENAS.dodge.boxes;
  readonly movers = ARENAS.dodge.movers;
  private readonly racers = new Map<string, DodgeStanding>();
  private lifecycle: 'new' | 'active' | 'disposed' = 'new';
  private seed = 0;
  private startTick = 0;

  setup(context: ArenaSetup): void {
    if (this.lifecycle !== 'new') throw new Error('Dodge arena run can only be set up once');
    this.seed = context.seed ?? 0;
    this.startTick = context.startTick ?? 0;
    const inactive = new Set(context.inactiveIds ?? []);
    context.roster.forEach(id => this.racers.set(id, { name: context.name(id), hits: 0, active: !inactive.has(id) }));
    this.lifecycle = 'active';
    LIVE_ARENA_RUNS.add(this);
  }

  spawn(slot: number): ArenaSpawn {
    this.assertActive();
    return this.manifest.spawn(slot);
  }

  /** Hazard positions are a pure function of seed and world tick. */
  update(_serverTick: number, _now: number): void {
    this.assertActive();
  }

  playerStep(id: string, before: ArenaPosition, player: Player, _elapsedMs: number, worldTick: number): number {
    this.assertActive();
    const racer = this.racers.get(id);
    if (!racer || !racer.active) return racer?.hits ?? 0;
    if (resolveDodgeHazards(player, before, this.seed, this.startTick, worldTick)) racer.hits++;
    return racer.hits;
  }

  setConnected(id: string, connected: boolean): void {
    this.assertActive();
    const racer = this.racers.get(id);
    if (racer) racer.active = connected;
  }

  get allFinished(): boolean {
    this.assertActive();
    return false;
  }

  rank(): DodgeStanding[] {
    this.assertActive();
    return [...this.racers.values()]
      .map(racer => ({ ...racer }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.hits - b.hits || a.name.localeCompare(b.name));
  }

  dispose(): void {
    if (this.lifecycle === 'disposed') return;
    this.racers.clear();
    this.lifecycle = 'disposed';
    LIVE_ARENA_RUNS.delete(this);
  }

  private assertActive(): void {
    if (this.lifecycle !== 'active') throw new Error('Dodge arena run is not active');
  }
}
