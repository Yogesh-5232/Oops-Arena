import { PRESETS } from '@chaos/shared';

const COUNTDOWN_MS = 5_000;
const ROUND_MS = 105_000;
const END_MS = PRESETS.quick * 1_000;

export type QuickSnapshot<Result> =
  | { phase: 'countdown' | 'round' }
  | { phase: 'cooldown' | 'results' | 'complete'; result: Result };

/** Server-owned Quick Chaos timeline. Pass timestamps from the same monotonic clock. */
export class QuickMatch<Result> {
  readonly roundStartsAt: number;
  readonly roundEndsAt: number;
  readonly endsAt: number;
  private finalResult?: { value: Result };

  constructor(startedAt: number) {
    this.roundStartsAt = startedAt + COUNTDOWN_MS;
    this.roundEndsAt = this.roundStartsAt + ROUND_MS;
    this.endsAt = startedAt + END_MS;
  }

  /** Check before scoring every competitive action, even if the room tick ran late. */
  acceptsScoring(now: number): boolean {
    return now >= this.roundStartsAt && now < this.roundEndsAt && !this.finalResult;
  }

  /** Publish this snapshot as one room update. Rank from server-owned race progress. */
  advance(now: number, rank: () => Result, allFinished = false): QuickSnapshot<Result> {
    if (now < this.roundStartsAt) return { phase: 'countdown' };
    if (!this.finalResult && now < this.roundEndsAt && !allFinished) return { phase: 'round' };
    this.finalResult ??= { value: rank() };
    const phase = now >= this.endsAt ? 'complete' : now >= this.roundEndsAt ? 'results' : 'cooldown';
    return { phase, result: this.finalResult.value };
  }
}
