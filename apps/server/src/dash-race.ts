import { DASH_GATES, DASH_START_Z, crossesDashGate, type DashStanding } from '@chaos/shared';

type Position = { x: number; z: number };
type Racer = { standing: DashStanding; progress: number; order: number };

export class DashRace {
  private readonly racers = new Map<string, Racer>();
  private nextFinish = 0;

  constructor(roster: readonly string[], name: (id: string) => string) {
    roster.forEach(id => this.racers.set(id, {
      standing: { name: name(id), checkpoints: 0, finishMs: null }, progress: 0, order: Infinity,
    }));
  }

  record(id: string, before: Position, after: Position, elapsedMs: number): number {
    const racer = this.racers.get(id);
    if (!racer) return 0;
    const standing = racer.standing;
    if (standing.finishMs !== null) return standing.checkpoints;
    const gate = DASH_GATES[standing.checkpoints]!;
    const segmentStart = DASH_GATES[standing.checkpoints - 1]?.z ?? DASH_START_Z;
    const fraction = Math.max(0, Math.min(1, (segmentStart - after.z) / (segmentStart - gate.z)));
    racer.progress = Math.max(racer.progress, standing.checkpoints + fraction);
    if (crossesDashGate(standing.checkpoints, before, after)) {
      standing.checkpoints++;
      if (standing.checkpoints === DASH_GATES.length) {
        standing.finishMs = Math.floor(elapsedMs);
        racer.order = this.nextFinish++;
      }
    }
    return standing.checkpoints;
  }

  get allFinished(): boolean {
    return this.nextFinish === this.racers.size;
  }

  standings(): DashStanding[] {
    return [...this.racers.values()]
      .sort((a, b) => a.order - b.order || b.standing.checkpoints - a.standing.checkpoints || b.progress - a.progress)
      .map(racer => ({ ...racer.standing }));
  }
}
