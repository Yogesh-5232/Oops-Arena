import { Server, Room, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { schema, t } from '@colyseus/schema';
import { CAPACITY, GREYBOX_ARENA, INPUT_BUFFER, availableSpawn, sanitizeInput, step, type Input } from '@chaos/shared';

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
    sanitize: input => sanitizeInput(input as Input),
    idle: { x: 0, z: 0, jump: false },
  });
  private slots = new Map<string, number>();
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
        step(player, inputs.next() ?? IDLE, ctx.dt);
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
  }
}
const IDLE: Input = { x: 0, z: 0, jump: false };
const server = new Server({ transport: new WebSocketTransport() });
server.define('playground', Playground);
await server.listen(Number(process.env.PORT ?? 2568));
console.log('Playground server listening');
