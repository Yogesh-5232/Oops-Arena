import { ARENAS, DODGE_RULES, resolveDodgeHazards, type ArenaManifest, type DodgeStanding, type Player } from '@chaos/shared';
import { ArenaRunBase, type ArenaPosition, type ArenaSetup, type ArenaSpawn } from './arena-run.js';

/**
 * Seeded Dodge Everything run. The room controls its start and cutoff; hazard
 * positions are a pure function of seed and world tick, so there is no per-tick update.
 */
export class DodgeArenaRun extends ArenaRunBase<DodgeStanding[]> {
  /** The Dodge arena, or a variation of it such as the Full preset finale. */
  constructor(readonly manifest: ArenaManifest & { spawn: (slot: number) => ArenaSpawn } = ARENAS.dodge) {
    super();
  }
  private readonly racers = new Map<string, DodgeStanding>();
  private seed = 0;
  private startTick = 0;

  protected onSetup(context: ArenaSetup): void {
    this.seed = context.seed ?? 0;
    this.startTick = context.startTick ?? 0;
    const inactive = new Set(context.inactiveIds ?? []);
    context.roster.forEach(id => this.racers.set(id, { name: context.name(id), hits: 0, active: !inactive.has(id) }));
  }

  protected onPlayerStep(id: string, before: ArenaPosition, player: Player, _elapsedMs: number, worldTick: number): number {
    const racer = this.racers.get(id);
    if (!racer || !racer.active) return racer?.hits ?? 0;
    if (resolveDodgeHazards(player, before, this.seed, this.startTick, worldTick, this.manifest.dodge ?? DODGE_RULES)) racer.hits++;
    return racer.hits;
  }

  setConnected(id: string, connected: boolean): void {
    this.assertActive();
    const racer = this.racers.get(id);
    if (racer) racer.active = connected;
  }

  protected finished(): boolean { return false; }

  protected ranking(): DodgeStanding[] {
    return [...this.racers.values()]
      .map(racer => ({ ...racer }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.hits - b.hits || a.name.localeCompare(b.name));
  }

  protected onDispose(): void {
    this.racers.clear();
  }
}
