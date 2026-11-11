// A TCP relay that makes a local game server feel far away. It carries both the
// matchmaking HTTP requests and the WebSocket, delaying each direction by half
// the round trip plus random jitter.
//
// WebSocket runs over TCP, so a lost packet is never skipped: TCP resends it and
// everything behind it waits (head-of-line blocking). "Loss" is therefore modeled
// as an occasional stall that also holds back every later chunk, and delivery
// order is always preserved.
//
//   npm run lag -- --rtt 100 --jitter 20 --loss 1
//   then open http://localhost:5173/?server=http://localhost:2569&diagnostics
import net from 'node:net';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

/** Starts the relay and resolves once it is listening. */
export async function startLagProxy({
  port = 2569, targetHost = '127.0.0.1', targetPort = 2568,
  rttMs = 100, jitterMs = 0, lossPct = 0, stallMs = 250, random = Math.random,
} = {}) {
  const sockets = new Set();
  // "up" is client to server (inputs), "down" is server to client (state updates).
  const stats = { chunks: 0, stalls: 0, up: { chunks: 0, stalls: 0 }, down: { chunks: 0, stalls: 0 } };
  // One ordered, delayed pipe per direction.
  const pipe = (from, to, direction) => {
    const queue = [];
    let lastAt = 0;
    let timer;
    let ended = false;
    const pump = () => {
      timer = undefined;
      const now = performance.now();
      while (queue.length && queue[0].at <= now) to.write(queue.shift().chunk);
      if (queue.length) timer = setTimeout(pump, queue[0].at - now);
      else if (ended) to.end();
    };
    from.on('data', chunk => {
      stats.chunks++;
      stats[direction].chunks++;
      let at = performance.now() + rttMs / 2 + random() * jitterMs;
      if (random() * 100 < lossPct) {
        at += stallMs;
        stats.stalls++;
        stats[direction].stalls++;
      }
      lastAt = Math.max(lastAt, at); // never overtake an earlier chunk
      queue.push({ at: lastAt, chunk });
      if (!timer) timer = setTimeout(pump, lastAt - performance.now());
    });
    from.on('end', () => {
      ended = true;
      if (!timer) pump();
    });
  };
  const server = net.createServer(client => {
    const upstream = net.connect(targetPort, targetHost);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.setNoDelay(true);
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
      socket.on('close', () => sockets.delete(socket));
    }
    pipe(client, upstream, 'up');
    pipe(upstream, client, 'down');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return {
    stats,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '2569' },
      target: { type: 'string', default: '2568' },
      rtt: { type: 'string', default: '100' },
      jitter: { type: 'string', default: '0' },
      loss: { type: 'string', default: '0' },
    },
  });
  const options = {
    port: Number(values.port), targetPort: Number(values.target),
    rttMs: Number(values.rtt), jitterMs: Number(values.jitter), lossPct: Number(values.loss),
  };
  await startLagProxy(options);
  console.log(`Lag relay on :${options.port} -> :${options.targetPort} · ${options.rttMs} ms round trip`
    + ` · up to ${options.jitterMs} ms jitter each way · ${options.lossPct}% of chunks stall 250 ms`);
  console.log(`Open http://localhost:5173/?server=http://localhost:${options.port}&diagnostics`);
}
