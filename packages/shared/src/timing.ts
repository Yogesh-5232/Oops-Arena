/** Server simulation step: 30 ticks per second. */
export const TICK_MS = 1000 / 30;
/** Inputs buffered per player before the oldest is dropped (about 270 ms at 30 Hz). */
export const INPUT_BUFFER = 8;
/**
 * How far behind the server's own tick an input's tick may be: about 500 ms,
 * enough for a 180 ms round trip plus a stall. Older ticks are moved forward.
 */
export const MAX_TICK_REWIND = 15;
