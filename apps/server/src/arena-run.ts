import type { Box, Mover, Player } from '@chaos/shared';

export type ArenaSpawn = Pick<Player, 'x' | 'y' | 'z'>;
export type ArenaPosition = Pick<Player, 'x' | 'y' | 'z'>;

export type ArenaSetup = {
  roster: readonly string[];
  name: (id: string) => string;
  seed?: number;
  startTick?: number;
  inactiveIds?: readonly string[];
};

/** Server-owned gameplay for one arena within a match. Phase timing stays with the room. */
export interface ArenaRun<Result> {
  readonly collisionBoxes: readonly Box[];
  readonly movers: readonly Mover[];
  setup(context: ArenaSetup): void;
  spawn(slot: number): ArenaSpawn;
  /** Called once per server fixed tick while this arena run is active. */
  update(serverTick: number, now: number): void;
  /** Called after each authoritative movement step, including catch-up steps. Returns public room progress. */
  playerStep(id: string, before: ArenaPosition, after: Player, elapsedMs: number, worldTick: number): number;
  readonly allFinished: boolean;
  rank(): Result;
  /** Release all run-owned state. Must be safe to call more than once. */
  dispose(): void;
}
