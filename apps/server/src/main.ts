import { randomInt } from 'node:crypto';
import { Server, Room, ServerError, matchMaker, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { schema, t } from '@colyseus/schema';
import {
  CAPACITY, DASH_BOXES, INPUT_BUFFER, TICK_MS, availableSpawn, clampInputTick, dashSpawn, resetToSpawn, simulateInput, spawnPlayer,
  type DashStanding, type Input, type Player,
} from '@chaos/shared';
import { DashRace } from './dash-race.js';
import { PrivateLobby } from './private-lobby.js';
import { QuickMatch } from './quick-match.js';

/**
 * Every field the shared step reads or writes (see Player in @chaos/shared), so
 * client prediction starts each replay from exactly the server's state.
 * float64 for continuous values so clients receive exactly what was simulated.
 */
const Avatar = schema({
  x: t.float64(), y: t.float64(), z: t.float64(),
  vx: t.float64(), vy: t.float64(), vz: t.float64(),
  grounded: t.boolean(), ground: t.uint8(), simTick: t.uint32(),
  jumpBuffer: t.uint8(), coyote: t.uint8(), mode: t.uint8(), modeTicks: t.uint8(), sinceJump: t.uint8(),
  shield: t.uint8(), checkpoint: t.uint8(), respawns: t.uint8(),
  faceX: t.float64(), faceZ: t.float64(),
  slot: t.uint8(),
});
const Guest = schema({ name: t.string(), connected: t.boolean(), ready: t.boolean(), racing: t.boolean(), checkpoints: t.number() });
const State = schema({
  tick: t.uint32(), players: t.map(Avatar), guests: t.map(Guest), phase: t.string(), hostId: t.string(),
  capacity: t.number(), code: t.string(), codeExpiresAt: t.float64(), remainingMs: t.number(), standings: t.string(),
});
/** One numbered input per client tick. float64 keeps client and server values bit-identical. */
const MoveInput = schema({ x: t.float64(), z: t.float64(), jump: t.boolean(), tick: t.uint32() });

class Playground extends Room {
  state = new State();
  maxClients = CAPACITY;
  /**
   * Disconnects a client that floods the socket (it counts input packets too).
   * Normal play sends 30 inputs plus at most one diagnostics request per second;
   * the headroom absorbs the catch-up burst after a brief network stall.
   */
  maxMessagesPerSecond = 150;
  /**
   * Each tick consumes exactly one buffered input per player, so sending extra
   * inputs never buys extra movement; overflow drops the oldest. A tick with no
   * input (packet gap, unfocused tab, reconnect window) stands still while gravity runs.
   */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: INPUT_BUFFER,
    // No `sanitize` option: it repairs the decoder's held input in place, which
    // corrupts delta-encoded fields. simulateInput repairs a copy instead.
    idle: { x: 0, z: 0, jump: false, tick: 0 },
  });
  private slots = new Map<string, number>();
  /**
   * Late inputs. When a player's buffer is empty (a stall or packet gap) the
   * server WAITS: it does not step that player, and the tick is owed to it as
   * one catch-up credit (at most MAX_CATCH_UP_CREDIT). When the late inputs
   * arrive as a burst, each credit lets one extra input run in a tick, draining
   * the backlog back to the cushion. Waiting runs nothing the client did not
   * also predict, so short stalls cause no corrections, even mid-dive or
   * mid-jump (stepping with an empty input there would keep a dive flying and
   * jump timers counting that the client never saw).
   *
   * Waiting is rationed by a per-player allowance: up to WAIT_ALLOWANCE ticks
   * at once, refilling WAIT_REFILL_PER_TICK per tick. A real stall spends it
   * once in a while. A client that trickles single inputs with pauses (to hang
   * in the air) needs a wait on almost every tick, runs out, and is then stepped
   * with an empty input so gravity acts like for anyone else. Those steps earn
   * no credit, so player steps never exceed elapsed ticks.
   */
  private credits = new Map<string, number>();
  private waitAllowance = new Map<string, number>();
  private inputAges = process.env.PLAYGROUND_TELEMETRY === '1' ? new Map<string, number>() : undefined;
  onCreate() {
    let tickMs = 0;
    let inputBacklog = 0;
    // Room totals: player-ticks spent waiting for a late input, player-ticks
    // stepped with an empty input after giving up, and extra catch-up inputs run.
    let waitedTicks = 0;
    let idleTicks = 0;
    let catchUps = 0;
    if (this.inputAges) {
      this.onMessage('diagnostics', client => ({
        seats: this.state.players.size, connected: this.clients.length, tickMs, inputBacklog,
        inputAgeMs: this.inputAges?.get(client.sessionId) ?? null,
        waitedTicks, idleTicks, catchUps,
      }));
    }
    this.setPatchRate(50);
    this.setFixedTimestep(ctx => {
      const started = performance.now();
      this.beforeTick(started);
      const serverTick = ctx.tick;
      this.state.tick = serverTick;
      inputBacklog = 0;
      for (const [id, player] of this.state.players) {
        const inputs = this.inputs.get(id);
        if (!this.canMove(id)) {
          while (inputs.size > 0) inputs.next();
          this.credits.delete(id);
          continue;
        }
        inputBacklog = Math.max(inputBacklog, inputs.size);
        const credit = this.credits.get(id) ?? 0;
        const allowance = Math.min(WAIT_ALLOWANCE, (this.waitAllowance.get(id) ?? WAIT_ALLOWANCE) + WAIT_REFILL_PER_TICK);
        this.waitAllowance.set(id, allowance);
        if (inputs.size === 0) {
          if (allowance >= 1) {
            this.waitAllowance.set(id, allowance - 1);
            this.credits.set(id, Math.min(credit + 1, MAX_CATCH_UP_CREDIT));
            waitedTicks++;
          } else {
            this.move(id, player, IDLE, ctx.dt, started, serverTick);
            idleTicks++;
          }
          continue;
        }
        let input = inputs.next()!;
        this.move(id, player, input, ctx.dt, started, serverTick);
        // Catch up only above a one-input cushion: draining to empty would let
        // ordinary jitter cause stand-still ticks, which others see as stutter.
        if (credit > 0 && inputs.size > CATCH_UP_CUSHION) {
          input = inputs.next()!;
          this.move(id, player, input, ctx.dt, started, serverTick);
          this.credits.set(id, credit - 1);
          catchUps++;
        }
        // Measure the received stamp before clamping it to the rewind window.
        this.inputAges?.set(id, Math.max(0, serverTick - input.tick) * TICK_MS);
      }
      this.afterTick(started);
      tickMs = performance.now() - started;
    }, 30);
  }
  protected beforeTick(_now: number) {}
  protected afterTick(_now: number) {}
  protected canMove(_id: string): boolean { return true; }
  protected move(_id: string, player: Player, input: Input, dt: number, _now: number, serverTick: number) {
    simulateInput(player, input, dt, undefined, undefined, clampInputTick(input.tick, player.simTick, serverTick));
  }
  onJoin(client: Client) {
    const slot = availableSpawn(this.slots.values());
    if (slot === undefined) throw new Error('No spawn slots available');
    const avatar = new Avatar();
    Object.assign(avatar, spawnPlayer(slot), { simTick: this.state.tick });
    this.slots.set(client.sessionId, slot);
    this.state.players.set(client.sessionId, avatar);
  }
  async onDrop(client: Client) {
    this.inputAges?.delete(client.sessionId);
    // The SDK discards this client's buffered inputs on drop, so nothing stale replays.
    try { await this.allowReconnection(client, 30); }
    catch { this.remove(client); }
  }
  onLeave(client: Client) { this.remove(client); }
  protected remove(client: Client) {
    this.inputAges?.delete(client.sessionId);
    this.slots.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.credits.delete(client.sessionId);
    this.waitAllowance.delete(client.sessionId);
  }
}
const CODES = new Set<string>();
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LIFETIME_MS = Number(process.env.PRIVATE_CODE_TTL_MS ?? 30 * 60_000);
if (!Number.isSafeInteger(CODE_LIFETIME_MS) || CODE_LIFETIME_MS <= 0) {
  throw new RangeError('PRIVATE_CODE_TTL_MS must be a positive whole number of milliseconds');
}
function allocateCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (CODES.has(code));
  CODES.add(code);
  return code;
}

class PrivateDash extends Playground {
  private lobby!: PrivateLobby;
  private sequence = 0;
  private codeDeadline = 0;
  private active?: { roster: readonly string[]; clock: QuickMatch<DashStanding[]>; race: DashRace; interrupted: boolean };

  override async onCreate(options: { capacity?: number } = {}) {
    try { this.lobby = new PrivateLobby(options.capacity ?? CAPACITY); }
    catch { throw new ServerError(400, 'Capacity must be a whole number from 4 to 12.'); }
    this.roomId = allocateCode();
    this.state.code = this.roomId;
    this.codeDeadline = performance.now() + CODE_LIFETIME_MS;
    this.state.codeExpiresAt = Date.now() + CODE_LIFETIME_MS;
    this.state.phase = 'lobby';
    this.state.capacity = this.maxClients = this.lobby.capacity;
    await this.setPrivate();
    super.onCreate();
    this.onMessage('ready', (client, value: unknown) => {
      if (typeof value === 'boolean' && this.lobby.setReady(client.sessionId, value)) {
        this.state.guests.get(client.sessionId)!.ready = value;
      }
    });
    this.onMessage('start', client => {
      const roster = this.lobby.lockRoster(client.sessionId);
      if (!roster) return;
      const clock = new QuickMatch<DashStanding[]>(performance.now());
      const race = new DashRace(roster, id => this.state.guests.get(id)!.name);
      this.active = { roster, clock, race, interrupted: false };
      void this.lock();
      this.state.phase = 'countdown';
      this.state.standings = '';
      this.state.remainingMs = 5000;
      roster.forEach(id => {
        const guest = this.state.guests.get(id)!;
        guest.racing = true;
        guest.checkpoints = 0;
        const player = this.state.players.get(id)!;
        resetToSpawn(player, dashSpawn(player.slot));
      });
    });
  }

  override onAuth() {
    if (this.active) throw new ServerError(4000, 'This race has already started.');
    if (performance.now() >= this.codeDeadline) throw new ServerError(4000, 'This room code expired.');
    return true;
  }

  override onJoin(client: Client) {
    if (!this.lobby.admit(client.sessionId)) throw new ServerError(4000, 'This lobby is closed or full.');
    super.onJoin(client);
    const guest = new Guest();
    guest.name = `Guest ${++this.sequence}`;
    guest.connected = true;
    guest.ready = guest.racing = false;
    guest.checkpoints = 0;
    this.state.guests.set(client.sessionId, guest);
    this.state.hostId = this.lobby.hostId ?? '';
  }

  override async onDrop(client: Client) {
    this.lobby.setConnected(client.sessionId, false);
    const guest = this.state.guests.get(client.sessionId);
    if (guest) guest.connected = guest.ready = false;
    await super.onDrop(client);
  }

  onReconnect(client: Client) {
    this.lobby.setConnected(client.sessionId, true);
    const guest = this.state.guests.get(client.sessionId);
    if (guest) guest.connected = true;
  }

  protected override remove(client: Client) {
    this.lobby.release(client.sessionId);
    this.state.guests.delete(client.sessionId);
    this.state.hostId = this.lobby.hostId ?? '';
    super.remove(client);
  }

  onDispose() { CODES.delete(this.roomId); }

  protected override beforeTick(now: number) { this.updateMatch(now); }
  protected override afterTick(now: number) { this.updateMatch(now); }

  protected override canMove(id: string) {
    const guest = this.state.guests.get(id);
    return Boolean(guest?.connected && (!this.active ||
      (guest.racing && (this.state.phase === 'round' || this.state.phase === 'cooldown'))));
  }

  protected override move(id: string, player: Player, input: Input, dt: number, now: number, serverTick: number) {
    const before = { x: player.x, z: player.z };
    const active = this.active;
    simulateInput(
      player, input, dt, active ? DASH_BOXES : undefined, active ? dashSpawn(player.slot) : undefined,
      clampInputTick(input.tick, player.simTick, serverTick),
    );
    if (!active) return;
    if (active.clock.acceptsScoring(now)) {
      this.state.guests.get(id)!.checkpoints = active.race.record(id, before, player, now - active.clock.roundStartsAt);
    }
  }

  private updateMatch(now: number) {
    const active = this.active;
    if (!active) return;
    const { clock, race, roster } = active;
    if (!this.state.standings && !race.allFinished && roster.filter(id => this.state.guests.has(id)).length < 2) {
      active.interrupted = true;
    }
    const snapshot = clock.advance(now, () => race.standings(), race.allFinished || active.interrupted);
    const remaining = Math.max(0, Math.ceil((clock.endsAt - now) / 100) * 100);
    if ('result' in snapshot && !this.state.standings) {
      this.state.standings = JSON.stringify({ interrupted: active.interrupted, rows: snapshot.result });
    }
    if (snapshot.phase !== 'complete') {
      this.state.phase = snapshot.phase;
      this.state.remainingMs = snapshot.phase === 'countdown' ? Math.max(0, remaining - 115_000) : remaining;
      return;
    }
    this.lobby.finishMatch(roster);
    this.active = undefined;
    for (const guest of this.state.guests.values()) guest.ready = guest.racing = false;
    for (const avatar of this.state.players.values()) resetToSpawn(avatar);
    this.state.phase = 'lobby';
    this.state.remainingMs = 0;
    void this.unlock();
  }
}
const IDLE: Input = { x: 0, z: 0, jump: false, tick: 0 };
/** The most ticks a player can be owed: the input buffer's length, about 270 ms. */
const MAX_CATCH_UP_CREDIT = INPUT_BUFFER;
/** Longest single wait for late inputs: about 270 ms, enough for a TCP retransmit stall. */
const WAIT_ALLOWANCE = INPUT_BUFFER;
/** Allowance regained per tick: one waited tick per four, so a full wait refills in about a second. */
const WAIT_REFILL_PER_TICK = 1 / 4;
/** Inputs left waiting after a catch-up, absorbing ordinary network jitter. */
const CATCH_UP_CUSHION = 1;
// The public SDK route calls this controller before looking up a room.
// A process-wide bucket also works when all guests share a tunnel or proxy.
const invokeMatchmaking = matchMaker.controller.invokeMethod.bind(matchMaker.controller);
let lookupWindowEnds = 0;
let lookups = 0;
matchMaker.controller.invokeMethod = async (method, roomId, options, auth) => {
  if (method === 'joinById' && /^[2-9A-Z]{6}$/.test(roomId)) {
    const now = performance.now();
    if (now >= lookupWindowEnds) {
      lookupWindowEnds = now + 60_000;
      lookups = 0;
    }
    if (++lookups > 120) throw new ServerError(429, 'Too many room code attempts. Try again shortly.');
  }
  try {
    return await invokeMatchmaking(method, roomId, options, auth);
  } catch (error) {
    // The SDK's HTTP matchmaking route uses the error code as the response status.
    if (error instanceof ServerError && (error.code < 400 || error.code > 599)) {
      throw new ServerError(400, error.message);
    }
    throw error;
  }
};
const server = new Server({ transport: new WebSocketTransport() });
server.define('playground', Playground);
server.define('private-dash', PrivateDash);
await server.listen(Number(process.env.PORT ?? 2568));
console.log('Playground server listening');
