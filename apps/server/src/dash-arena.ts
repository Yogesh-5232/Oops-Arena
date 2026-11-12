import { ARENAS, type DashStanding, type Player } from '@chaos/shared';
import { DashRace } from './dash-race.js';
import { ArenaRunBase, type ArenaPosition, type ArenaSetup } from './arena-run.js';

/** Dash-specific setup, authoritative progress recording, ranking, and cleanup. */
export class DashArenaRun extends ArenaRunBase<DashStanding[]> {
  readonly manifest = ARENAS.dash;
  private race?: DashRace;

  protected onSetup(context: ArenaSetup): void {
    this.race = new DashRace(context.roster, context.name);
  }

  protected onPlayerStep(id: string, before: ArenaPosition, after: Player, elapsedMs: number): number {
    return this.race!.record(id, before, after, elapsedMs);
  }

  protected finished(): boolean { return this.race!.allFinished; }

  protected ranking(): DashStanding[] { return this.race!.standings(); }

  protected onDispose(): void {
    this.race?.dispose();
    this.race = undefined;
  }
}
