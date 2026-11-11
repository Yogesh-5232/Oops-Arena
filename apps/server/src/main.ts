import { Server, Room, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { schema, t } from '@colyseus/schema';
import { CAPACITY, GREYBOX_ARENA, availableSpawn, TICK_MS, parseInput, step, type Input } from '@chaos/shared';

const Avatar = schema({ x: t.number(), y: t.number(), z: t.number(), vy: t.number() });
const State = schema({ players: t.map(Avatar) });

class Playground extends Room {
  state = new State();
  maxClients = CAPACITY;
  private commands = new Map<string, { input: Input; received: number }>();
  private rates = new Map<string, { start: number; count: number }>();
  private slots = new Map<string, number>();
  onCreate() {
    let tickMs = 0;
    let inputAgeMs: number | null = null;
    if (process.env.PLAYGROUND_TELEMETRY === '1') {
      this.onMessage('diagnostics', () => ({
        seats: this.state.players.size, connected: this.clients.length, tickMs, inputAgeMs,
      }));
    }
    this.setPatchRate(50);
    this.onMessage('input', (client, raw: unknown) => {
      const now = performance.now();
      let rate = this.rates.get(client.sessionId);
      if (!rate || now - rate.start >= 1000) {
        rate = { start: now, count: 0 };
        this.rates.set(client.sessionId, rate);
      }
      if (++rate.count > 60) return;
      const input = parseInput(raw);
      if (!input) return;
      const previous = this.commands.get(client.sessionId);
      input.jump ||= previous?.input.jump ?? false;
      this.commands.set(client.sessionId, { input, received: now });
    });
    this.onMessage('clear-input', client => this.commands.delete(client.sessionId));
    this.setFixedTimestep(() => {
      const now = performance.now();
      inputAgeMs = null;
      for (const [id, player] of this.state.players) {
        const command = this.commands.get(id);
        if (command) inputAgeMs = Math.max(inputAgeMs ?? 0, now - command.received);
        const input = command && now - command.received < 250
          ? command.input : { x: 0, z: 0, jump: false };
        step(player, input, TICK_MS / 1000);
        input.jump = false;
      }
      tickMs = performance.now() - now;
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
    this.commands.delete(client.sessionId);
    try { await this.allowReconnection(client, 30); }
    catch { this.remove(client); }
  }
  onLeave(client: Client) { this.remove(client); }
  private remove(client: Client) {
    this.slots.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.commands.delete(client.sessionId);
    this.rates.delete(client.sessionId);
  }
}
const server = new Server({ transport: new WebSocketTransport() });
server.define('playground', Playground);
await server.listen(Number(process.env.PORT ?? 2568));
console.log('Playground server listening');
