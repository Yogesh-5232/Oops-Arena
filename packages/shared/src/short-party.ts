import type { DashStanding } from './dash.js';
import type { ArenaId } from './manifests.js';

export type DodgeStanding = { name: string; hits: number; active: boolean };

/** Lava round result. `gate` counts tiers climbed; `outMs` is when the lava caught the player in the closing stretch. */
export type LavaStanding = { name: string; gate: number; falls: number; outMs: number | null; active: boolean };

export type RoundStanding = DashStanding | DodgeStanding | LavaStanding;

/** Private match presets that the room can run. Timings are the server's cutoffs. */
export const PLAYLISTS = {
  short: {
    name: 'Short Party', rounds: ['dash', 'dodge'],
    countdownMs: 8_000, roundMs: 140_000, transitionMs: 12_000, resultsMs: 15_000,
  },
  standard: {
    name: 'Standard Party', rounds: ['dash', 'lava', 'dodge'],
    countdownMs: 8_000, roundMs: 160_000, transitionMs: 15_000, resultsMs: 22_000,
  },
} as const satisfies Record<string, {
  name: string; rounds: readonly Exclude<ArenaId, 'plaza'>[];
  countdownMs: number; roundMs: number; transitionMs: number; resultsMs: number;
}>;
export type PresetId = keyof typeof PLAYLISTS;
export type Playlist = (typeof PLAYLISTS)[PresetId];
export type RoundArenaId = Playlist['rounds'][number];

export function playlistMs(playlist: Playlist): number {
  const rounds = playlist.rounds.length;
  return playlist.countdownMs + rounds * playlist.roundMs + (rounds - 1) * playlist.transitionMs + playlist.resultsMs;
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
