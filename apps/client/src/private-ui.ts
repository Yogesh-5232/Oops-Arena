import type { DashStanding } from '@chaos/shared';

type Guest = { name: string; ready: boolean; connected: boolean; racing: boolean; checkpoints: number };
export type PrivateState = {
  code: string; codeExpiresAt: number; phase: string; hostId: string; capacity: number; party: boolean;
  remainingMs: number; standings: string;
  guests: { get(id: string): Guest | undefined; forEach(visit: (guest: Guest, id: string) => void): void };
};

export const privateEntry = document.querySelector<HTMLFormElement>('#private-entry')!;
export const createButton = document.querySelector<HTMLButtonElement>('#create-private')!;
export const createPartyButton = document.querySelector<HTMLButtonElement>('#create-party')!;
export const joinCode = document.querySelector<HTMLInputElement>('#room-code')!;
export const capacity = document.querySelector<HTMLInputElement>('#capacity')!;
const panel = document.querySelector<HTMLElement>('#private-room')!;
const codeLabel = document.querySelector<HTMLElement>('#room-invite')!;
const renewButton = document.querySelector<HTMLButtonElement>('#renew-invite')!;
const phaseLabel = document.querySelector<HTMLElement>('#match-phase')!;
const guests = document.querySelector<HTMLElement>('#guests')!;
const readyButton = document.querySelector<HTMLButtonElement>('#ready')!;
const startButton = document.querySelector<HTMLButtonElement>('#start-match')!;
const results = document.querySelector<HTMLElement>('#match-results')!;
const resultsTitle = document.querySelector<HTMLElement>('#results-title')!;
const standings = document.querySelector<HTMLElement>('#standings')!;

export function privatePanel(ready: (value: boolean) => void, start: () => void, renew: () => void) {
  let lastGuests = '';
  let lastStandings = '';
  let lastPhase = '';
  let canAct = true;
  panel.hidden = false;
  startButton.onclick = start;
  renewButton.onclick = renew;
  return {
    setConnected(connected: boolean) {
      canAct = connected;
      if (!connected) readyButton.disabled = startButton.disabled = renewButton.disabled = true;
    },
    render(state: PrivateState, sessionId: string) {
      if (!state.code) return;
      const me = state.guests.get(sessionId);
      const lobby = state.phase === 'lobby';
      const time = Math.ceil(state.remainingMs / 1000);
      if (state.phase !== lastPhase && (lobby || state.phase === 'results') && document.pointerLockElement) {
        document.exitPointerLock();
      }
      lastPhase = state.phase;
      const inviteExpired = Date.now() >= state.codeExpiresAt;
      const host = sessionId === state.hostId;
      codeLabel.textContent = `${state.party ? 'Party' : 'Room'} code: ${state.code}${inviteExpired ? ' · invite expired' : ''}`;
      renewButton.hidden = !(state.party && lobby && host && inviteExpired);
      renewButton.disabled = !canAct || !me?.connected;
      let readyCount = 0;
      const rows: string[] = [];
      state.guests.forEach((guest, id) => {
        if (guest.connected && guest.ready) readyCount++;
        const label = guest.connected ? guest.ready ? 'Ready' : 'Not ready' : 'Reconnecting';
        rows.push(`${guest.name}${id === sessionId ? ' (you)' : ''}${id === state.hostId ? ' · Host' : ''} — ${lobby ? label : guest.racing ? 'Racer' : 'Waiting'}`);
      });
      const guestText = rows.join('\n');
      if (guestText !== lastGuests) {
        lastGuests = guestText;
        guests.replaceChildren(...rows.map(label => {
          const row = document.createElement('li');
          row.textContent = label;
          return row;
        }));
      }
      guests.hidden = !lobby;
      const requiredReady = state.party ? Math.max(4, rows.length) : 4;
      phaseLabel.textContent = lobby
        ? `${state.party ? 'Party' : 'Plaza'} · ${rows.length}/${state.capacity} guests · ${readyCount} ready (${requiredReady} needed)`
        : state.phase === 'countdown' ? `Race starts in ${time}s`
        : state.phase === 'results' ? `Returning to plaza in ${time}s`
        : !me?.racing ? `Waiting for next race · ${time}s left`
        : state.phase === 'cooldown' ? `Standings locked · ${time}s left`
        : `Dash · ${Math.max(0, time - 10)}s to finish · ${Math.min(2, me.checkpoints)}/2 checkpoints`;
      readyButton.hidden = !lobby;
      readyButton.disabled = !canAct || !me?.connected;
      readyButton.textContent = me?.ready ? 'Cancel ready' : 'Ready';
      readyButton.onclick = () => ready(!me?.ready);
      startButton.hidden = !lobby || !host;
      startButton.disabled = !canAct || !me?.ready || readyCount < requiredReady;
      results.hidden = !state.standings || !(state.phase === 'results' || lobby);
      if (lastStandings === state.standings) return;
      lastStandings = state.standings;
      standings.replaceChildren();
      if (!state.standings) return;
      const result = JSON.parse(state.standings) as { interrupted: boolean; rows: DashStanding[] };
      resultsTitle.textContent = result.interrupted ? 'Race interrupted' : 'Race results';
      for (const row of result.rows) {
        const entry = document.createElement('li');
        entry.textContent = row.finishMs === null
          ? `${row.name} — DNF (${row.checkpoints}/2 checkpoints)`
          : `${row.name} — ${(row.finishMs / 1000).toFixed(2)}s`;
        standings.append(entry);
      }
    },
    dispose() {
      panel.hidden = true;
      readyButton.onclick = startButton.onclick = renewButton.onclick = null;
    },
  };
}
