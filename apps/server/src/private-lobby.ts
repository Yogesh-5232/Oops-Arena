import { CAPACITY } from '@chaos/shared';

const MIN_CAPACITY = 4;
type Seat = { connected: boolean; ready: boolean };

/** Room admission and readiness rules, keyed by the server-issued session ID. */
export class PrivateLobby {
  private readonly seats = new Map<string, Seat>();
  private roster?: readonly string[];
  readonly minimumReady = 2;

  constructor(
    readonly capacity = CAPACITY,
    private readonly keepPartyTogether = false,
  ) {
    if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > CAPACITY) {
      throw new RangeError(`Capacity must be between ${MIN_CAPACITY} and ${CAPACITY}`);
    }
  }

  get hostId(): string | undefined {
    return this.seats.keys().next().value;
  }

  get readyCount(): number {
    return [...this.seats.values()].filter(seat => seat.connected && seat.ready).length;
  }

  admit(id: string): boolean {
    if (this.roster || this.seats.has(id) || this.seats.size >= this.capacity) return false;
    this.seats.set(id, { connected: true, ready: false });
    return true;
  }

  setConnected(id: string, connected: boolean): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    seat.connected = connected;
    if (!connected) seat.ready = false;
  }

  setReady(id: string, ready: boolean): boolean {
    const seat = this.seats.get(id);
    if (this.roster || !seat?.connected) return false;
    seat.ready = ready;
    return true;
  }

  /** Call for an intentional leave or when the reconnect reservation expires. */
  release(id: string): void {
    this.seats.delete(id);
  }

  lockRoster(requester: string): readonly string[] | undefined {
    if (this.roster || this.hostId !== requester) return;
    const host = this.seats.get(requester);
    if (!host?.connected || !host.ready) return;
    const eligible = [...this.seats].filter(([, seat]) => seat.connected && seat.ready);
    if (eligible.length < this.minimumReady) return;
    if (this.keepPartyTogether && eligible.length !== this.seats.size) return;
    this.roster = Object.freeze(eligible.map(([id]) => id));
    return this.roster;
  }

  /** Reopen the lobby after the room completes this match. */
  finishMatch(roster: readonly string[]): boolean {
    if (this.roster !== roster) return false;
    this.roster = undefined;
    for (const seat of this.seats.values()) seat.ready = false;
    return true;
  }
}
