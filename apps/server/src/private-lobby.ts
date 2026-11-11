import { CAPACITY } from '@chaos/shared';

const MIN_PLAYERS = 4;
type Seat = { connected: boolean; ready: boolean };

/** Room admission and readiness rules, keyed by the server-issued session ID. */
export class PrivateLobby {
  private readonly seats = new Map<string, Seat>();
  private roster?: readonly string[];

  constructor(readonly capacity = CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > CAPACITY) {
      throw new RangeError(`Capacity must be between ${MIN_PLAYERS} and ${CAPACITY}`);
    }
  }

  get hostId(): string | undefined {
    return this.seats.keys().next().value;
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
    if (this.roster || this.hostId !== requester || !this.seats.get(requester)?.connected) return;
    const eligible = [...this.seats].filter(([, seat]) => seat.connected && seat.ready);
    if (eligible.length < MIN_PLAYERS || eligible.length !== this.seats.size) return;
    this.roster = Object.freeze(eligible.map(([id]) => id));
    return this.roster;
  }
}
