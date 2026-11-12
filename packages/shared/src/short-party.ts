import type { DashStanding } from './dash.js';

export type DodgeStanding = { name: string; hits: number; active: boolean };

export type ShortPartyStanding = {
  place: number;
  name: string;
  dash: DashStanding | null;
  dodge: DodgeStanding | null;
  dashPoints: number;
  dodgePoints: number;
  totalPoints: number;
};

export type ShortPartyResults = { interrupted: boolean; rows: ShortPartyStanding[] };
