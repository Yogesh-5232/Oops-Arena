import {
  ARENAS, TEAM_GATES, TEAM_RULES, TICK_MS, cargoProgress, gateBit, isPushing, newCargo, plateUnder, resolveCargo, stepCargo,
  teamBoxes, teamSpawn, type Box, type Cargo, type Input, type Player, type TeamStanding,
} from '@chaos/shared';
import { ArenaRunBase, type ArenaPosition, type ArenaSetup, type ArenaSpawn, type TeamObjective } from './arena-run.js';

type Member = { name: string; team: number; active: boolean };

/**
 * Teamwork Madness run. Unlike the other arenas it has world state of its own:
 * two server-owned crates and their gate plates. Each tick, `update` moves the
 * crates from the pushes recorded during the previous tick's player steps; the
 * room replicates the result (`objective`) and clients collide with it.
 */
export class TeamArenaRun extends ArenaRunBase<TeamStanding[]> {
  readonly manifest = ARENAS.team;
  private readonly members = new Map<string, Member>();
  private cargo: [Cargo, Cargo] = [newCargo(), newCargo()];
  private deliveredTick: [number | null, number | null] = [null, null];
  private readonly pushers: [Set<string>, Set<string>] = [new Set(), new Set()];
  /** Ticks each gate stays open, by team then gate. */
  private latches = [Array<number>(TEAM_GATES).fill(0), Array<number>(TEAM_GATES).fill(0)];
  /** Pushers that count per team: the smaller team's connected size, at least one. */
  private cap = 1;
  private startTick = 0;
  /** Collision world for this room's crates, rebuilt only when a crate moves. */
  private world: readonly Box[] = teamBoxes(TEAM_RULES.cargoStartZ, TEAM_RULES.cargoStartZ);

  protected onSetup(context: ArenaSetup): void {
    this.startTick = context.startTick ?? 0;
    const inactive = new Set(context.inactiveIds ?? []);
    context.roster.forEach((id, index) => this.members.set(id, {
      name: context.name(id), team: (context.teams?.(id) ?? index % 2) === 1 ? 1 : 0, active: !inactive.has(id),
    }));
    this.updateCap();
  }

  override spawn(slot: number, id?: string): ArenaSpawn {
    this.assertActive();
    return teamSpawn(slot, (id && this.members.get(id)?.team) || 0);
  }

  override boxes(): readonly Box[] {
    return this.world;
  }

  protected override onUpdate(serverTick: number): void {
    // Before the round starts and once a crate is delivered, the crates stay put.
    if (serverTick < this.startTick || this.finished()) return;
    const [before0, before1] = [this.cargo[0].z, this.cargo[1].z];
    for (const team of [0, 1] as const) {
      const latches = this.latches[team]!;
      const cargo = this.cargo[team];
      stepCargo(cargo, Math.min(this.pushers[team].size, this.cap), gate => latches[gate]! > 0, TICK_MS / 1000);
      if (cargo.delivered && this.deliveredTick[team] === null) this.deliveredTick[team] = serverTick;
      for (let gate = 0; gate < TEAM_GATES; gate++) if (latches[gate]! > 0) latches[gate]!--;
      this.pushers[team].clear();
    }
    if (this.cargo[0].z !== before0 || this.cargo[1].z !== before1) this.world = teamBoxes(this.cargo[0].z, this.cargo[1].z);
  }

  /** Public progress: the player's team crate, as a percentage of the course. */
  protected onPlayerStep(
    id: string, _before: ArenaPosition, player: Player, _elapsedMs: number, _worldTick: number, input?: Pick<Input, 'x' | 'z'>,
  ): number {
    resolveCargo(player, this.cargo[0].z, this.cargo[1].z);
    const member = this.members.get(id);
    if (!member) return 0;
    const cargo = this.cargo[member.team]!;
    if (member.active && !this.finished()) {
      const gate = plateUnder(player, member.team);
      if (gate >= 0) this.latches[member.team]![gate] = TEAM_RULES.plateLatchTicks;
      if (input && isPushing(player, input, member.team, cargo.z)) this.pushers[member.team]!.add(id);
    }
    return Math.floor(cargoProgress(cargo.z) * 100);
  }

  objective(): TeamObjective {
    this.assertActive();
    let gates = 0;
    this.latches.forEach((latches, team) => latches.forEach((ticks, gate) => { if (ticks > 0) gates |= gateBit(team, gate); }));
    return { cargo0: this.cargo[0].z, cargo1: this.cargo[1].z, gates };
  }

  setConnected(id: string, connected: boolean): void {
    this.assertActive();
    const member = this.members.get(id);
    if (!member) return;
    member.active = connected;
    if (!connected) this.pushers[member.team]!.delete(id);
    this.updateCap();
  }

  /** The round is decided once either crate is delivered. */
  protected finished(): boolean {
    return this.cargo[0].delivered || this.cargo[1].delivered;
  }

  protected ranking(): TeamStanding[] {
    return [...this.members.values()]
      .map(member => {
        const delivered = this.deliveredTick[member.team as 0 | 1];
        return {
          name: member.name, team: member.team, active: member.active,
          deliveredMs: delivered === null ? null : Math.round((delivered - this.startTick) * TICK_MS),
          progress: cargoProgress(this.cargo[member.team as 0 | 1].z),
        };
      })
      .sort((a, b) => Number(b.active) - Number(a.active)
        || Number(b.deliveredMs !== null) - Number(a.deliveredMs !== null)
        || (a.deliveredMs ?? 0) - (b.deliveredMs ?? 0)
        || b.progress - a.progress
        || a.team - b.team
        || a.name.localeCompare(b.name));
  }

  protected onDispose(): void {
    this.members.clear();
    this.pushers.forEach(set => set.clear());
  }

  private updateCap(): void {
    const sizes = [0, 0];
    for (const member of this.members.values()) if (member.active) sizes[member.team]!++;
    this.cap = Math.max(1, Math.min(sizes[0]!, sizes[1]!));
  }
}
