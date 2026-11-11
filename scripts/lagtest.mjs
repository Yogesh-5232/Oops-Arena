// Phase 2 network check: drive a predicting player and a watching player through
// the lag relay at 40, 100 and 180 ms round trips (with jitter and stalls), and
// report how often prediction was corrected and how smoothly the watcher saw it.
//
//   npm run build && npm run lagtest
//
// Fails only if prediction does not settle exactly on the server's state; the
// correction and smoothness numbers are measurements to record, not gates yet.
import { strict as assert } from 'node:assert';
import { Client } from '@colyseus/sdk';
import { startLagProxy } from './lag-proxy.mjs';
import { delay, drivePrediction, startBuiltServer, until } from './netcheck.mjs';

const PROFILES = [
  { name: 'near', rttMs: 40, jitterMs: 5, lossPct: 0 },
  { name: 'typical', rttMs: 100, jitterMs: 20, lossPct: 1 },
  { name: 'far', rttMs: 180, jitterMs: 40, lossPct: 2 },
  // Same delay and jitter without stalls: separates what jitter costs from what stalls cost.
  { name: 'far, no stalls', rttMs: 180, jitterMs: 40, lossPct: 0 },
];
const serverPort = Number(process.env.LAGTEST_PORT ?? 2611);
const relayPort = serverPort + 1;
const FRAMES = Number(process.env.LAGTEST_FRAMES ?? 600); // about 10 s of walking and hopping per profile

const server = await startBuiltServer(serverPort);
const results = [];
try {
  for (const profile of PROFILES) {
    const relay = await startLagProxy({ port: relayPort, targetPort: serverPort, ...profile });
    const client = new Client(`http://localhost:${relayPort}`);
    const mover = await client.joinOrCreate('playground');
    const watcher = await client.joinById(mover.roomId);
    try {
      await until(() => [mover, watcher].every(room => room.state.players?.size === 2), 'both players replicated', 10000);
      await delay(500); // let the clocks measure the round trip
      const run = await drivePrediction(mover, FRAMES, watcher, { ackTimeout: 15000 });
      assert.deepEqual(run.predicted, run.server, `${profile.name}: prediction must settle exactly on the server state`);
      results.push({
        profile: `${profile.name} (${profile.rttMs} ms ±${profile.jitterMs}, ${profile.lossPct}% stalls)`,
        // Send-to-acknowledgement time: network round trip plus the server's input
        // queue and the wait for the next 20 Hz update, so above the relay setting.
        inputAckMs: Math.round(mover.clock.smoothedRtt()),
        corrections: `${run.corrections} of ${run.reconciles}`,
        worstCorrection: run.worst.toFixed(3),
        othersSeeFrozen: `${run.remote.smoothFrozen} of ${run.remote.frames}`,
        rawFrozen: `${run.remote.rawFrozen} of ${run.remote.frames}`,
        stallsUpDown: `${relay.stats.up.stalls} / ${relay.stats.down.stalls}`,
      });
    } finally {
      await watcher.leave();
      await mover.leave();
      await relay.close();
    }
  }
  console.table(results);
  console.log('PASS: prediction settled exactly on the server state at every profile');
} finally {
  await server.stop();
}
