import type { DashStanding, DodgeStanding, ShortPartyResults, ShortPartyStanding } from '@chaos/shared';

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

function dashTie(row: DashStanding): string {
  return row.finishMs === null
    ? `dnf:${row.checkpoints}:${row.progress.toFixed(6)}`
    : `finish:${row.finishMs}`;
}

/** Server-owned two-round placement points and cumulative Short Party standings. */
export class ShortScoreboard {
  private dashRows?: readonly DashStanding[];
  private dodgeRows?: readonly DodgeStanding[];
  private readonly dashPoints = new Map<string, number>();
  private readonly dodgePoints = new Map<string, number>();

  constructor(private readonly names: readonly string[]) {}

  recordDash(rows: readonly DashStanding[]): void {
    if (this.dashRows) return;
    this.dashRows = rows.map(row => ({ ...row }));
    for (const [row, points] of award(rows, dashTie)) this.dashPoints.set(row.name, points);
  }

  recordDodge(rows: readonly DodgeStanding[]): void {
    if (this.dodgeRows) return;
    this.dodgeRows = rows.map(row => ({ ...row }));
    for (const [row, points] of award(rows, value => value.active ? `hits:${value.hits}` : 'inactive')) {
      this.dodgePoints.set(row.name, points);
    }
  }

  snapshot(interrupted: boolean): ShortPartyResults {
    const rows: ShortPartyStanding[] = this.names.map(name => ({
      place: 0,
      name,
      dash: this.dashRows?.find(row => row.name === name) ?? null,
      dodge: this.dodgeRows?.find(row => row.name === name) ?? null,
      dashPoints: this.dashPoints.get(name) ?? 0,
      dodgePoints: this.dodgePoints.get(name) ?? 0,
      totalPoints: (this.dashPoints.get(name) ?? 0) + (this.dodgePoints.get(name) ?? 0),
    }));
    rows.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    let previous: number | undefined;
    let place = 0;
    rows.forEach((row, index) => {
      if (row.totalPoints !== previous) place = index + 1;
      row.place = place;
      previous = row.totalPoints;
    });
    return { interrupted, rows };
  }
}
