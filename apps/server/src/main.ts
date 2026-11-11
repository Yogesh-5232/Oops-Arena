import { Server, Room, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { schema, t } from '@colyseus/schema';
import { CAPACITY, GREYBOX_ARENA, INPUT_BUFFER, availableSpawn, simulateInput, type Input } from '@chaos/shared';

// float64 so clients receive exactly what the server simulated; prediction compares against it.
const Avatar = schema({ x: t.float64(), y: t.float64(), z: t.float64(), vy: t.float64() });
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
   * Catch-up credit: one per tick a player had no input (a stall or packet gap).
   * When the late inputs arrive as a burst, each credit lets one extra input run
   * in a tick, so the backlog drains back instead of adding latency forever.
   * Inputs simulated never exceed ticks elapsed, so sending faster still gains
   * nothing; the cap bounds catch-up to a brief double-speed stretch.
   */
  private credits = new Map<string, number>();
  onCreate() {
    let tickMs = 0;
    let inputBacklog = 0;
    if (process.env.PLAYGROUND_TELEMETRY === '1') {
      this.onMessage('diagnostics', () => ({
        seats: this.state.players.size, connected: this.clients.length, tickMs, inputBacklog,
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
        if (inputs.size === 0) {
          simulateInput(player, IDLE, ctx.dt);
          this.credits.set(id, Math.min(credit + 1, MAX_CATCH_UP_CREDIT));
          continue;
        }
        simulateInput(player, inputs.next()!, ctx.dt);
        // Catch up only above a one-input cushion: draining to empty would let
        // ordinary jitter cause stand-still ticks, which others see as stutter.
        if (credit > 0 && inputs.size > CATCH_UP_CUSHION) {
          simulateInput(player, inputs.next()!, ctx.dt);
          this.credits.set(id, credit - 1);
        }
      }
      tickMs = performance.now() - started;
    }, 30);
  }
  onJoin(client: Client) {
    const slot = availableSpawn(this.slots.values());
    if (slot === undefined) throw new Error('No spawn slots available');
    const spawn = GREYBOX_ARENA.spawns[slot]!;
    const avatar = new Avatar();
    avatar.y = spawn.y;
    avatar.x = spawn.x;
    avatar.z = spawn.z;
    avatar.vy = 0;
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
  }
}
const IDLE: Input = { x: 0, z: 0, jump: false };
/** At most this many owed ticks are remembered: the input buffer's length, about 270 ms. */
const MAX_CATCH_UP_CREDIT = INPUT_BUFFER;
/** Inputs left waiting after a catch-up, absorbing ordinary network jitter. */
const CATCH_UP_CUSHION = 1;
const server = new Server({ transport: new WebSocketTransport() });
server.define('playground', Playground);
await server.listen(Number(process.env.PORT ?? 2568));
console.log('Playground server listening');
