import { PRESETS } from '@chaos/shared';

const COUNTDOWN_MS = 5_000;
const ROUND_MS = 105_000;
const END_MS = PRESETS.quick * 1_000;

export type QuickPhase = 'countdown' | 'round' | 'cooldown' | 'results' | 'complete';

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

  phaseAt(now: number): QuickPhase {
    if (now >= this.endsAt) return 'complete';
    if (now >= this.roundEndsAt) return 'results';
    if (now < this.roundStartsAt) return 'countdown';
    return this.finalResult ? 'cooldown' : 'round';
  }

  /** Check before scoring every competitive action, even if the room tick ran late. */
  acceptsScoring(now: number): boolean {
    return this.phaseAt(now) === 'round';
  }

  get result(): Result | undefined {
    return this.finalResult?.value;
  }

  finalize(now: number, rank: () => Result, allFinished = false): Result | undefined {
    if (this.finalResult) return this.finalResult.value;
    if (now < this.roundStartsAt || (now < this.roundEndsAt && !allFinished)) return;
    const value = rank();
    this.finalResult = { value };
    return value;
  }
}
