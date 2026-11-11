import { Server, Room, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { schema, t } from '@colyseus/schema';
import { CAPACITY, INPUT_BUFFER, availableSpawn, simulateInput, spawnPlayer, type Input } from '@chaos/shared';

/**
 * Every field the shared step reads or writes (see Player in @chaos/shared), so
 * client prediction starts each replay from exactly the server's state.
 * float64 for continuous values so clients receive exactly what was simulated.
 */
const Avatar = schema({
  x: t.float64(), y: t.float64(), z: t.float64(),
  vx: t.float64(), vy: t.float64(), vz: t.float64(),
  grounded: t.boolean(),
  jumpBuffer: t.uint8(), coyote: t.uint8(), mode: t.uint8(), modeTicks: t.uint8(), sinceJump: t.uint8(),
  faceX: t.float64(), faceZ: t.float64(),
  slot: t.uint8(),
});
const State = schema({ players: t.map(Avatar) });
/** One numbered input per client tick. float64 keeps client and server values bit-identical. */
const MoveInput = schema({ x: t.float64(), z: t.float64(), jump: t.boolean() });

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
    idle: { x: 0, z: 0, jump: false },
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
  onCreate() {
    let tickMs = 0;
    let inputBacklog = 0;
    // Room totals: player-ticks spent waiting for a late input, player-ticks
    // stepped with an empty input after giving up, and extra catch-up inputs run.
    let waitedTicks = 0;
    let idleTicks = 0;
    let catchUps = 0;
    if (process.env.PLAYGROUND_TELEMETRY === '1') {
      this.onMessage('diagnostics', () => ({
        seats: this.state.players.size, connected: this.clients.length, tickMs, inputBacklog,
        waitedTicks, idleTicks, catchUps,
      }));
    }
    this.setPatchRate(50);
    this.setFixedTimestep(ctx => {
      const started = performance.now();
      inputBacklog = 0;
      for (const [id, player] of this.state.players) {
        const inputs = this.inputs.get(id);
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
            simulateInput(player, IDLE, ctx.dt);
            idleTicks++;
          }
          continue;
        }
        simulateInput(player, inputs.next()!, ctx.dt);
        // Catch up only above a one-input cushion: draining to empty would let
        // ordinary jitter cause stand-still ticks, which others see as stutter.
        if (credit > 0 && inputs.size > CATCH_UP_CUSHION) {
          simulateInput(player, inputs.next()!, ctx.dt);
          this.credits.set(id, credit - 1);
          catchUps++;
        }
      }
      tickMs = performance.now() - started;
    }, 30);
  }
  onJoin(client: Client) {
    const slot = availableSpawn(this.slots.values());
    if (slot === undefined) throw new Error('No spawn slots available');
    const avatar = new Avatar();
    Object.assign(avatar, spawnPlayer(slot));
    this.slots.set(client.sessionId, slot);
    this.state.players.set(client.sessionId, avatar);
  }
  async onDrop(client: Client) {
    // The SDK discards this client's buffered inputs on drop, so nothing stale replays.
    try { await this.allowReconnection(client, 30); }
    catch { this.remove(client); }
  }
  onLeave(client: Client) { this.remove(client); }
  private remove(client: Client) {
    this.slots.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.credits.delete(client.sessionId);
    this.waitAllowance.delete(client.sessionId);
  }
}
const IDLE: Input = { x: 0, z: 0, jump: false };
/** The most ticks a player can be owed: the input buffer's length, about 270 ms. */
const MAX_CATCH_UP_CREDIT = INPUT_BUFFER;
/** Longest single wait for late inputs: about 270 ms, enough for a TCP retransmit stall. */
const WAIT_ALLOWANCE = INPUT_BUFFER;
/** Allowance regained per tick: one waited tick per four, so a full wait refills in about a second. */
const WAIT_REFILL_PER_TICK = 1 / 4;
/** Inputs left waiting after a catch-up, absorbing ordinary network jitter. */
const CATCH_UP_CUSHION = 1;
const server = new Server({ transport: new WebSocketTransport() });
server.define('playground', Playground);
await server.listen(Number(process.env.PORT ?? 2568));
console.log('Playground server listening');
