import { ARENAS, resolveLava, type LavaStanding, type Player } from '@chaos/shared';
import { ArenaRunBase, type ArenaPosition, type ArenaSetup } from './arena-run.js';

/**
 * Floor Is Lava run. The lava height is a pure function of the arena tick, so
 * like Dodge there is no per-tick update; each authoritative step resolves gates
 * and lava contact with the same function client prediction runs.
 */
export class LavaArenaRun extends ArenaRunBase<LavaStanding[]> {
  readonly manifest = ARENAS.lava;
  private readonly racers = new Map<string, LavaStanding>();
  private startTick = 0;
  private roundTicks = 0;

  protected onSetup(context: ArenaSetup): void {
    this.startTick = context.startTick ?? 0;
    this.roundTicks = context.roundTicks ?? 0;
    const inactive = new Set(context.inactiveIds ?? []);
    context.roster.forEach(id => this.racers.set(id, {
      name: context.name(id), gate: 0, falls: 0, outMs: null, active: !inactive.has(id),
    }));
  }

  /** Public progress: the gate reached, or -1 once the lava has caught the player in the closing stretch. */
  protected onPlayerStep(id: string, _before: ArenaPosition, player: Player, elapsedMs: number, worldTick: number): number {
    const event = resolveLava(player, worldTick - this.startTick, this.roundTicks);
    const racer = this.racers.get(id);
    if (!racer) return 0;
    if (racer.active && racer.outMs === null) {
      racer.gate = Math.max(racer.gate, player.checkpoint);
      if (event === 'respawn') racer.falls++;
      if (event === 'out') racer.outMs = Math.floor(elapsedMs);
    }
    return racer.outMs === null ? racer.gate : -1;
  }

  setConnected(id: string, connected: boolean): void {
    this.assertActive();
    const racer = this.racers.get(id);
    if (racer) racer.active = connected;
  }

  protected finished(): boolean { return false; }

  protected ranking(): LavaStanding[] {
    return [...this.racers.values()]
      .map(racer => ({ ...racer }))
      .sort((a, b) => Number(b.active) - Number(a.active)
        || Number(a.outMs !== null) - Number(b.outMs !== null)
        || (b.outMs ?? 0) - (a.outMs ?? 0)
        || b.gate - a.gate
        || a.falls - b.falls
        || a.name.localeCompare(b.name));
  }

  protected onDispose(): void {
    this.racers.clear();
  }
}
