const TEST_SCALE = process.env.NODE_ENV === 'test'
  ? Math.max(0.01, Math.min(1, Number(process.env.SHORT_PARTY_TEST_SCALE ?? 1)))
  : 1;
const scaled = (milliseconds: number) => Math.round(milliseconds * TEST_SCALE);
export const SHORT_TIMING = {
  countdownMs: scaled(8_000),
  roundMs: scaled(140_000),
  transitionMs: scaled(12_000),
  resultsMs: scaled(15_000),
  totalMs: scaled(315_000),
};

export type ShortPartyPhase = 'countdown' | 'round' | 'cooldown' | 'transition' | 'results' | 'complete';
export type ShortPartyArenaId = 'dash' | 'dodge' | '';

export type ShortPartySnapshot = {
  phase: ShortPartyPhase;
  arenaId: ShortPartyArenaId;
  roundIndex: number;
  remainingMs: number;
};

/** Absolute server-owned timeline; late ticks never extend a phase or the match. */
export class ShortPartyClock {
  readonly dashStartsAt: number;
  readonly dashEndsAt: number;
  readonly dodgeStartsAt: number;
  readonly dodgeEndsAt: number;
  readonly endsAt: number;

  constructor(readonly startedAt: number) {
    this.dashStartsAt = startedAt + SHORT_TIMING.countdownMs;
    this.dashEndsAt = this.dashStartsAt + SHORT_TIMING.roundMs;
    this.dodgeStartsAt = this.dashEndsAt + SHORT_TIMING.transitionMs;
    this.dodgeEndsAt = this.dodgeStartsAt + SHORT_TIMING.roundMs;
    this.endsAt = this.dodgeEndsAt + SHORT_TIMING.resultsMs;
  }

  acceptsScoring(arenaId: ShortPartyArenaId, now: number): boolean {
    if (arenaId === 'dash') return now >= this.dashStartsAt && now < this.dashEndsAt;
    if (arenaId === 'dodge') return now >= this.dodgeStartsAt && now < this.dodgeEndsAt;
    return false;
  }

  snapshot(now: number, dashLocked: boolean): ShortPartySnapshot {
    const remaining = (end: number) => Math.max(0, Math.ceil((end - now) / 100) * 100);
    if (now < this.dashStartsAt) return { phase: 'countdown', arenaId: 'dash', roundIndex: 0, remainingMs: remaining(this.dashStartsAt) };
    if (now < this.dashEndsAt) return {
      phase: dashLocked ? 'cooldown' : 'round', arenaId: 'dash', roundIndex: 0, remainingMs: remaining(this.dashEndsAt),
    };
    if (now < this.dodgeStartsAt) return {
      phase: 'transition', arenaId: '', roundIndex: 1, remainingMs: remaining(this.dodgeStartsAt),
    };
    if (now < this.dodgeEndsAt) return {
      phase: 'round', arenaId: 'dodge', roundIndex: 1, remainingMs: remaining(this.dodgeEndsAt),
    };
    if (now < this.endsAt) return { phase: 'results', arenaId: 'dodge', roundIndex: 1, remainingMs: remaining(this.endsAt) };
    return { phase: 'complete', arenaId: '', roundIndex: 1, remainingMs: 0 };
  }
}
