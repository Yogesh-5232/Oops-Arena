import { playerAtMoverTick, type Mover, type Player } from '@chaos/shared';

type Position = Pick<Player, 'x' | 'y' | 'z'>;
type Snapshot = Position & Pick<Player, 'ground' | 'simTick' | 'respawns'> & { time: number };
const TELEPORT_DISTANCE = 3;

/** Interpolate delayed snapshots, with each rider sample carried by the mover we draw now. */
export class RemotePose {
  private readonly samples: Snapshot[] = [];
  private readonly next: Position = { x: 0, y: 0, z: 0 };

  push(player: Player, time: number): void {
    const { x, y, z, ground, simTick, respawns } = player;
    const last = this.samples.at(-1);
    if (last && (last.respawns !== respawns ||
      Math.max(Math.abs(last.x - x), Math.abs(last.y - y), Math.abs(last.z - z)) > TELEPORT_DISTANCE)) {
      this.samples.length = 0;
    }
    this.samples.push({ x, y, z, ground, simTick, respawns, time });
    if (this.samples.length > 12) this.samples.shift();
  }

  read(time: number, movers: readonly Mover[], worldTick: number, out: Position): boolean {
    while (this.samples.length > 1 && this.samples[1]!.time <= time) this.samples.shift();
    const first = this.samples[0];
    if (!first) return false;
    playerAtMoverTick(first, movers, worldTick, out);
    const second = this.samples[1];
    if (second && first.time < time) {
      // Blend across mount and dismount as well as ordinary rider movement.
      playerAtMoverTick(second, movers, worldTick, this.next);
      const alpha = (time - first.time) / (second.time - first.time);
      out.x += (this.next.x - out.x) * alpha;
      out.y += (this.next.y - out.y) * alpha;
      out.z += (this.next.z - out.z) * alpha;
    }
    return true;
  }
}
