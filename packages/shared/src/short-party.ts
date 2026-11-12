import type { DashStanding } from './dash.js';
import type { ArenaId } from './manifests.js';

export type DodgeStanding = { name: string; hits: number; active: boolean };

/** Lava round result. `gate` counts tiers climbed; `outMs` is when the lava caught the player in the closing stretch. */
export type LavaStanding = { name: string; gate: number; falls: number; outMs: number | null; active: boolean };

/** Teamwork round result: every member shares the team's outcome. `progress` is the crate's course fraction. */
export type TeamStanding = { name: string; team: number; deliveredMs: number | null; progress: number; active: boolean };

export type RoundStanding = DashStanding | DodgeStanding | LavaStanding | TeamStanding;

const singleRound = { countdownMs: 5_000, roundMs: 105_000, transitionMs: 0, resultsMs: 10_000 };

/** One playlist's timing. `finaleMs`, when set, is the last round's length instead of `roundMs`. */
type PlaylistSpec = {
  name: string; rounds: readonly Exclude<ArenaId, 'plaza'>[];
  countdownMs: number; roundMs: number; finaleMs?: number; transitionMs: number; resultsMs: number;
};

/** Private match presets that the room can run. Timings are the server's cutoffs. */
export const PLAYLISTS = {
  short: {
    name: 'Short Party', rounds: ['dash', 'dodge'],
    countdownMs: 8_000, roundMs: 140_000, transitionMs: 12_000, resultsMs: 15_000,
  },
  dash: { name: 'Dash Only', rounds: ['dash'], ...singleRound },
  lava: { name: 'Lava Only', rounds: ['lava'], ...singleRound },
  dodge: { name: 'Dodge Only', rounds: ['dodge'], ...singleRound },
  team: { name: 'Teamwork Only', rounds: ['team'], ...singleRound },
  standard: {
    name: 'Standard Party', rounds: ['dash', 'lava', 'dodge'],
    countdownMs: 8_000, roundMs: 160_000, transitionMs: 15_000, resultsMs: 22_000,
  },
  /** All four games, then the Dodge finale variation, scored like any other round. */
  full: {
    name: 'Full Party', rounds: ['dash', 'lava', 'team', 'finale'],
    countdownMs: 8_000, roundMs: 170_000, finaleMs: 150_000, transitionMs: 12_000, resultsMs: 26_000,
  },
} as const satisfies Record<string, PlaylistSpec>;
export type PresetId = keyof typeof PLAYLISTS;
export type Playlist = (typeof PLAYLISTS)[PresetId];
export type RoundArenaId = Playlist['rounds'][number];

/** Length of round `index` in a playlist: the finale's own length for the last round when it has one. */
export function roundMsAt(playlist: Playlist, index: number): number {
  const spec: PlaylistSpec = playlist;
  return index === playlist.rounds.length - 1 && spec.finaleMs !== undefined ? spec.finaleMs : playlist.roundMs;
}

export function playlistMs(playlist: Playlist): number {
  const rounds = playlist.rounds.length;
  let total = playlist.countdownMs + (rounds - 1) * playlist.transitionMs + playlist.resultsMs;
  for (let index = 0; index < rounds; index++) total += roundMsAt(playlist, index);
  return total;
}

/** One round's result for one player: a short display line and the placement points. */
export type RoundResult = { arenaId: RoundArenaId; summary: string; points: number };

export type PartyStanding = {
  place: number;
  name: string;
  /** By round index; null until that round is scored. */
  rounds: (RoundResult | null)[];
  totalPoints: number;
};

export type PartyResults = {
  interrupted: boolean;
  preset: PresetId;
  arenas: RoundArenaId[];
  rows: PartyStanding[];
};
