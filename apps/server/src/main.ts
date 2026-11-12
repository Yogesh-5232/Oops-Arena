import { randomInt } from 'node:crypto';
import { Server, Room, ServerError, matchMaker, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { schema, t } from '@colyseus/schema';
import {
  ARENA_BUILD, CAPACITY, INPUT_BUFFER, TICK_MS, availableSpawn, clampInputTick, resetToSpawn, simulateInput, spawnPlayer,
  type DashStanding, type DodgeStanding, type Input, type Player,
} from '@chaos/shared';
import { DashArenaRun } from './dash-arena.js';
import { DodgeArenaRun } from './dodge-arena.js';
import { LIVE_ARENA_RUNS, type ArenaRun } from './arena-run.js';
import { PrivateLobby } from './private-lobby.js';
import { ShortPartyClock } from './short-party-clock.js';
import { ShortScoreboard } from './short-scoreboard.js';

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
const Guest = schema({ name: t.string(), connected: t.boolean(), ready: t.boolean(), racing: t.boolean(), progress: t.number() });
const State = schema({
  tick: t.uint32(), players: t.map(Avatar), guests: t.map(Guest), phase: t.string(), hostId: t.string(),
  capacity: t.number(), code: t.string(), codeExpiresAt: t.float64(), remainingMs: t.number(), standings: t.string(),
  arenaId: t.string(), nextArenaId: t.string(), roundIndex: t.uint8(), arenaSeed: t.uint32(), arenaStartTick: t.uint32(),
});
/** One numbered input per client tick. float64 keeps client and server values bit-identical. */
const MoveInput = schema({ x: t.float64(), z: t.float64(), jump: t.boolean(), tick: t.uint32() });

/**
 * Admission check: a client built from different shared code (protocol or
 * arena manifests) would predict against rules the server does not run, so it
 * is turned away with a reload prompt instead of joining and rubber-banding.
 * Reconnects reuse an admitted seat within the same server process and skip it.
 */
function checkBuild(options: unknown): void {
  const build = (options as { build?: unknown } | undefined)?.build;
  if (build !== ARENA_BUILD) {
    throw new ServerError(426, 'This page is out of date with the game server. Reload to play.');
  }
}

function teleportPlayer(player: Player, spawn?: Pick<Player, 'x' | 'y' | 'z'>): void {
  resetToSpawn(player, spawn);
  player.respawns = (player.respawns + 1) % 256;
}

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
  /** Runs in matchmaking, before a seat is reserved, for create and every join. */
  static override async onAuth(_token: string, options: unknown) {
    checkBuild(options);
    return true;
  }
  onCreate(options?: unknown) {
    checkBuild(options);
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
        build: ARENA_BUILD, arenaRuns: LIVE_ARENA_RUNS.size, heapUsed: process.memoryUsage().heapUsed,
      }));
    }
    this.setPatchRate(50);
    this.setFixedTimestep(ctx => {
      const started = performance.now();
      const serverTick = ctx.tick;
      this.beforeTick(started, serverTick);
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
      this.afterTick(started, serverTick);
      tickMs = performance.now() - started;
    }, 30);
  }
  protected beforeTick(_now: number, _serverTick: number) {}
  protected afterTick(_now: number, _serverTick: number) {}
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
  private active?: {
    roster: readonly string[];
    names: Map<string, string>;
    clock: ShortPartyClock;
    scoreboard: ShortScoreboard;
    seed: number;
    dodgeStartTick: number;
    arena?: ArenaRun<DashStanding[] | DodgeStanding[]>;
    dash?: DashArenaRun;
    dodge?: DodgeArenaRun;
    dashLocked: boolean;
    dodgeLocked: boolean;
    interrupted: boolean;
  };

  override async onCreate(options: { capacity?: number; build?: string } = {}) {
    checkBuild(options);
    try { this.lobby = new PrivateLobby(options.capacity ?? CAPACITY); }
    catch { throw new ServerError(400, 'Capacity must be a whole number from 4 to 12.'); }
    this.roomId = allocateCode();
    this.state.code = this.roomId;
    this.codeDeadline = performance.now() + CODE_LIFETIME_MS;
    this.state.codeExpiresAt = Date.now() + CODE_LIFETIME_MS;
    this.state.phase = 'lobby';
    this.state.arenaId = 'plaza';
    this.state.nextArenaId = 'dash';
    this.state.capacity = this.maxClients = this.lobby.capacity;
    await this.setPrivate();
    super.onCreate(options);
    this.onMessage('ready', (client, value: unknown) => {
      if (typeof value === 'boolean' && this.lobby.setReady(client.sessionId, value)) {
        this.state.guests.get(client.sessionId)!.ready = value;
      }
    });
    this.onMessage('start', client => {
      const roster = this.lobby.lockRoster(client.sessionId);
      if (!roster) return;
      const startedAt = performance.now();
      const clock = new ShortPartyClock(startedAt);
      const startedTick = this.state.tick;
      const seed = randomInt(1, 0x7fffffff);
      const names = new Map<string, string>();
      roster.forEach(id => names.set(id, this.state.guests.get(id)!.name));
      const dash = new DashArenaRun();
      try {
        dash.setup({ roster, name: id => names.get(id) ?? id });
      } catch (error) {
        dash.dispose();
        this.lobby.finishMatch(roster);
        throw error;
      }
      const dodgeStartTick = startedTick + Math.round((clock.dodgeStartsAt - startedAt) / TICK_MS);
      this.active = {
        roster, names, clock, scoreboard: new ShortScoreboard([...names.values()]), seed, dodgeStartTick,
        arena: dash, dash, dashLocked: false, dodgeLocked: false, interrupted: false,
      };
      void this.lock();
      this.state.phase = 'countdown';
      this.state.arenaId = 'dash';
      this.state.nextArenaId = 'plaza';
      this.state.roundIndex = 0;
      this.state.arenaSeed = seed;
      this.state.arenaStartTick = startedTick + Math.round((clock.dashStartsAt - startedAt) / TICK_MS);
      this.state.standings = JSON.stringify(this.active.scoreboard.snapshot(false));
      this.state.remainingMs = 8000;
      roster.forEach(id => {
        const guest = this.state.guests.get(id)!;
        guest.racing = true;
        guest.progress = 0;
        const player = this.state.players.get(id)!;
        teleportPlayer(player, dash.spawn(player.slot));
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
    guest.progress = 0;
    this.state.guests.set(client.sessionId, guest);
    this.state.hostId = this.lobby.hostId ?? '';
  }

  override async onDrop(client: Client) {
    this.lobby.setConnected(client.sessionId, false);
    const guest = this.state.guests.get(client.sessionId);
    if (guest) guest.connected = guest.ready = false;
    this.active?.dodge?.setConnected(client.sessionId, false);
    await super.onDrop(client);
  }

  onReconnect(client: Client) {
    this.lobby.setConnected(client.sessionId, true);
    const guest = this.state.guests.get(client.sessionId);
    if (guest) guest.connected = true;
    this.active?.dodge?.setConnected(client.sessionId, true);
  }

  protected override remove(client: Client) {
    this.active?.dodge?.setConnected(client.sessionId, false);
    this.lobby.release(client.sessionId);
    this.state.guests.delete(client.sessionId);
    this.state.hostId = this.lobby.hostId ?? '';
    super.remove(client);
  }

  onDispose() {
    this.active?.dash?.dispose();
    this.active?.dodge?.dispose();
    this.active = undefined;
    CODES.delete(this.roomId);
  }

  protected override beforeTick(now: number, serverTick: number) {
    this.updateMatch(now, serverTick);
    this.active?.arena?.update(serverTick, now);
  }
  protected override afterTick(now: number, serverTick: number) { this.updateMatch(now, serverTick); }

  protected override canMove(id: string) {
    const guest = this.state.guests.get(id);
    return Boolean(guest?.connected && (!this.active ||
      (this.active.arena && guest.racing && (this.state.phase === 'round' || this.state.phase === 'cooldown'))));
  }

  protected override move(id: string, player: Player, input: Input, dt: number, now: number, serverTick: number) {
    const before = { x: player.x, y: player.y, z: player.z };
    const active = this.active;
    const arena = active?.arena;
    const inputTick = clampInputTick(input.tick, player.simTick, serverTick);
    simulateInput(
      player, input, dt, arena?.collisionBoxes, arena ? arena.spawn(player.slot) : undefined,
      inputTick, arena?.movers,
    );
    if (!active || !arena) return;
    const scoringDash = this.state.arenaId === 'dash' && !active.dashLocked;
    const scoringDodge = this.state.arenaId === 'dodge' && !active.dodgeLocked;
    if ((scoringDash || scoringDodge) && active.clock.acceptsScoring(this.state.arenaId as 'dash' | 'dodge', now)) {
      const roundStart = this.state.arenaId === 'dash' ? active.clock.dashStartsAt : active.clock.dodgeStartsAt;
      this.state.guests.get(id)!.progress = arena.playerStep(
        id, before, player, now - roundStart, inputTick,
      );
    }
  }

  private updateMatch(now: number, serverTick: number) {
    const active = this.active;
    if (!active) return;
    const { clock, roster } = active;
    if (!active.dodgeLocked && roster.filter(id => this.state.guests.has(id)).length < 2) {
      active.interrupted = true;
    }

    if (!active.dashLocked && active.dash && (active.dash.allFinished || now >= clock.dashEndsAt)) {
      active.scoreboard.recordDash(active.dash.rank());
      active.dashLocked = true;
      this.state.standings = JSON.stringify(active.scoreboard.snapshot(active.interrupted));
    }

    if (now >= clock.dashEndsAt && active.dash) {
      active.dash.dispose();
      active.dash = undefined;
      active.arena = undefined;
      for (const avatar of this.state.players.values()) teleportPlayer(avatar);
    }

    if (now >= clock.dodgeStartsAt && !active.dodge) {
      const dodge = new DodgeArenaRun();
      dodge.setup({
        roster,
        name: id => active.names.get(id) ?? id,
        seed: active.seed,
        startTick: active.dodgeStartTick,
        inactiveIds: roster.filter(id => !this.state.guests.get(id)?.connected),
      });
      active.dodge = dodge;
      active.arena = dodge;
      this.state.arenaStartTick = active.dodgeStartTick;
      for (const id of roster) {
        const guest = this.state.guests.get(id);
        const player = this.state.players.get(id);
        if (guest) guest.progress = 0;
        if (player) teleportPlayer(player, dodge.spawn(player.slot));
      }
    }

    if (!active.dodgeLocked && active.dodge && now >= clock.dodgeEndsAt) {
      active.scoreboard.recordDodge(active.dodge.rank());
      active.dodgeLocked = true;
      this.state.standings = JSON.stringify(active.scoreboard.snapshot(active.interrupted));
      active.dodge.dispose();
      active.dodge = undefined;
      active.arena = undefined;
    }

    const snapshot = clock.snapshot(now, active.dashLocked);
    this.state.phase = snapshot.phase;
    this.state.arenaId = snapshot.arenaId;
    this.state.nextArenaId = snapshot.nextArenaId;
    this.state.roundIndex = snapshot.roundIndex;
    this.state.remainingMs = snapshot.remainingMs;
    if (snapshot.phase !== 'complete') return;

    this.state.standings = JSON.stringify(active.scoreboard.snapshot(active.interrupted));
    this.lobby.finishMatch(roster);
    // Both runs are disposed at their cutoffs; this only guards a skipped cutoff.
    active.dash?.dispose();
    active.dodge?.dispose();
    this.active = undefined;
    for (const guest of this.state.guests.values()) guest.ready = guest.racing = false;
    for (const avatar of this.state.players.values()) teleportPlayer(avatar);
    this.state.arenaId = 'plaza';
    this.state.nextArenaId = 'dash';
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
