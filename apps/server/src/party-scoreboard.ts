import {
  DASH_GATES, LAVA_GATES, TEAM_NAMES,
  type DashStanding, type DodgeStanding, type LavaStanding, type TeamStanding, type PartyResults, type PartyStanding, type PresetId,
  type RoundArenaId, type RoundResult, type RoundStanding,
} from '@chaos/shared';

type Scoring<Row> = {
  tie(row: Row): string;
  summary(row: Row): string;
  /** Overrides placement points for arenas where rank-averaging is unfair (team rounds). */
  award?(rows: readonly Row[], tie: (row: Row) => string): Map<Row, number>;
};

/**
 * Team round points, fixed so team size never changes them: placement
 * averaging would give a losing 5-player team 5 points but a losing 4-player
 * team 4 in the same 9-player match. A win-to-loss gap of 6 is also smaller
 * than an individual round's 10, so one team result cannot swing the board
 * more than a solo round.
 */
export const TEAM_POINTS = { win: 10, loss: 4, draw: 7, dnf: 2 } as const;

/** Rows arrive ranked best first. A team whose opponents have all disconnected wins rather than draws. */
function awardTeams(rows: readonly TeamStanding[], tie: (row: TeamStanding) => string): Map<TeamStanding, number> {
  const active = rows.filter(row => tie(row) !== 'inactive');
  const outcomes = [...new Set(active.map(tie))];
  const unopposed = new Set(active.map(row => row.team)).size < 2;
  const points = new Map<TeamStanding, number>();
  for (const row of rows) {
    const outcome = outcomes.indexOf(tie(row));
    points.set(row, outcome < 0 ? TEAM_POINTS.dnf
      : outcomes.length < 2 ? unopposed ? TEAM_POINTS.win : TEAM_POINTS.draw
      : outcome === 0 ? TEAM_POINTS.win : TEAM_POINTS.loss);
  }
  return points;
}

/** Dodge rounds (the arena and its finale variation) rank by fewest hits; only the label differs. */
const dodgeScoring = (label: string): Scoring<DodgeStanding> => ({
  tie: row => row.active ? `hits:${row.hits}` : 'inactive',
  summary: row => row.active ? `${label} ${row.hits} hits` : `${label} DNF`,
});

/** Per-arena tie keys (equal keys share placement points) and one-line result summaries. */
const SCORING: { [Id in RoundArenaId]: Scoring<{ dash: DashStanding; dodge: DodgeStanding; lava: LavaStanding; team: TeamStanding; finale: DodgeStanding }[Id]> } = {
  dash: {
    tie: row => row.finishMs === null ? `dnf:${row.checkpoints}:${row.progress.toFixed(6)}` : `finish:${row.finishMs}`,
    summary: row => row.finishMs === null
      ? `Dash DNF ${Math.min(row.checkpoints, DASH_GATES.length - 1)}/${DASH_GATES.length - 1}`
      : `Dash ${(row.finishMs / 1000).toFixed(1)}s`,
  },
  dodge: dodgeScoring('Dodge'),
  // The finale is regular score weighting: same placement points as any round.
  finale: dodgeScoring('Finale'),
  lava: {
    tie: row => row.active ? `${row.outMs ?? 'alive'}:${row.gate}:${row.falls}` : 'inactive',
    summary: row => !row.active ? 'Lava DNF'
      : row.outMs !== null ? `Lava out at ${Math.floor(row.outMs / 1000)}s`
      : row.gate === LAVA_GATES ? 'Lava summit' : `Lava gate ${row.gate}/${LAVA_GATES}`,
  },
  // Team members share their team's outcome and its fixed points (see TEAM_POINTS).
  team: {
    award: awardTeams,
    tie: row => row.active ? `${row.deliveredMs ?? 'open'}:${row.progress.toFixed(3)}` : 'inactive',
    summary: row => {
      const team = TEAM_NAMES[row.team] ?? 'Team';
      return !row.active ? 'Teamwork DNF'
        : row.deliveredMs !== null ? `Teamwork ${team} delivered ${(row.deliveredMs / 1000).toFixed(1)}s`
        : `Teamwork ${team} ${Math.round(row.progress * 100)}%`;
    },
  },
};

/** Placement points from an ordered ranking; tied rows share the average rank's points. */
function award<T>(rows: readonly T[], tieKey: (row: T) => string): Map<T, number> {
  const points = new Map<T, number>();
  let first = 0;
  while (first < rows.length) {
    let after = first + 1;
    const key = tieKey(rows[first]!);
    while (after < rows.length && tieKey(rows[after]!) === key) after++;
    const averageRank = (first + 1 + after) / 2;
    const value = rows.length < 2 ? 12 : 2 + Math.round(10 * (rows.length - averageRank) / (rows.length - 1));
    for (let index = first; index < after; index++) points.set(rows[index]!, value);
    first = after;
  }
  return points;
}

/** Server-owned placement points per round and cumulative standings for one party match. */
export class PartyScoreboard {
  private readonly rounds: (Map<string, RoundResult> | undefined)[];

  constructor(
    private readonly names: readonly string[], private readonly preset: PresetId, private readonly arenas: readonly RoundArenaId[],
  ) {
    this.rounds = arenas.map(() => undefined);
  }

  /** Scores round `index` from its ranked rows. Only the first call per round counts. */
  record(index: number, rows: readonly RoundStanding[]): void {
    const arenaId = this.arenas[index];
    if (!arenaId || this.rounds[index]) return;
    const scoring = SCORING[arenaId] as Scoring<RoundStanding>;
    const results = new Map<string, RoundResult>();
    for (const [row, points] of (scoring.award ?? award)(rows, scoring.tie)) results.set(row.name, { arenaId, summary: scoring.summary(row), points });
    this.rounds[index] = results;
  }

  snapshot(interrupted: boolean): PartyResults {
    const rows: PartyStanding[] = this.names.map(name => {
      const rounds = this.rounds.map(round => round?.get(name) ?? null);
      return { place: 0, name, rounds, totalPoints: rounds.reduce((sum, round) => sum + (round?.points ?? 0), 0) };
    });
    rows.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    let previous: number | undefined;
    let place = 0;
    rows.forEach((row, index) => {
      if (row.totalPoints !== previous) place = index + 1;
      row.place = place;
      previous = row.totalPoints;
    });
    return { interrupted, preset: this.preset, arenas: [...this.arenas], rows };
  }
}
