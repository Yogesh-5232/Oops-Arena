import { roundMsAt, type ArenaId, type Playlist, type RoundArenaId } from '@chaos/shared';

const TEST_SCALE = process.env.NODE_ENV === 'test'
  ? Math.max(0.01, Math.min(1, Number(process.env.SHORT_PARTY_TEST_SCALE ?? 1)))
  : 1;
const scaled = (milliseconds: number) => Math.round(milliseconds * TEST_SCALE);

export type PartyPhase = 'countdown' | 'round' | 'cooldown' | 'transition' | 'results' | 'complete';

export type PartySnapshot = {
  phase: PartyPhase;
  arenaId: ArenaId;
  /** The arena clients should load in the background now; '' when nothing is next. */
  nextArenaId: ArenaId | '';
  roundIndex: number;
  remainingMs: number;
};

export type ScheduledRound = { arenaId: RoundArenaId; startsAt: number; endsAt: number; lengthMs: number };

/** Absolute server-owned timeline for a playlist; late ticks never extend a phase or the match. */
export class PartyClock {
  readonly rounds: readonly ScheduledRound[];
  readonly endsAt: number;

  constructor(readonly startedAt: number, readonly playlist: Playlist) {
    let at = startedAt + scaled(playlist.countdownMs);
    this.rounds = playlist.rounds.map((arenaId, index) => {
      if (index > 0) at += scaled(playlist.transitionMs);
      const lengthMs = scaled(roundMsAt(playlist, index));
      const round = { arenaId, startsAt: at, endsAt: at + lengthMs, lengthMs };
      at = round.endsAt;
      return round;
    });
    this.endsAt = at + scaled(playlist.resultsMs);
  }

  acceptsScoring(roundIndex: number, now: number): boolean {
    const round = this.rounds[roundIndex];
    return Boolean(round && now >= round.startsAt && now < round.endsAt);
  }

  /** `locked(i)` is true once round i's outcome is fixed early (everyone finished): its remaining time is a cooldown. */
  snapshot(now: number, locked: (roundIndex: number) => boolean): PartySnapshot {
    const remaining = (end: number) => Math.max(0, Math.ceil((end - now) / 100) * 100);
    const last = this.rounds.length - 1;
    for (let index = 0; index <= last; index++) {
      const round = this.rounds[index]!;
      if (now < round.startsAt) {
        return index === 0
          ? { phase: 'countdown', arenaId: round.arenaId, nextArenaId: 'plaza', roundIndex: 0, remainingMs: remaining(round.startsAt) }
          : { phase: 'transition', arenaId: 'plaza', nextArenaId: round.arenaId, roundIndex: index, remainingMs: remaining(round.startsAt) };
      }
      if (now < round.endsAt) return {
        phase: locked(index) ? 'cooldown' : 'round', arenaId: round.arenaId, nextArenaId: 'plaza', roundIndex: index,
        remainingMs: remaining(round.endsAt),
      };
    }
    const final = this.rounds[last]!.arenaId;
    if (now < this.endsAt) return { phase: 'results', arenaId: final, nextArenaId: 'plaza', roundIndex: last, remainingMs: remaining(this.endsAt) };
    return { phase: 'complete', arenaId: 'plaza', nextArenaId: '', roundIndex: last, remainingMs: 0 };
  }
}
