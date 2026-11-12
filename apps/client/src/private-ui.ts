import { ARENAS, DASH_GATES, LAVA_GATES, PLAYLISTS, playlistMs, type PartyResults, type PresetId } from '@chaos/shared';

type Guest = { name: string; ready: boolean; connected: boolean; racing: boolean; progress: number };
export type PrivateState = {
  code: string; codeExpiresAt: number; phase: string; hostId: string; capacity: number;
  arenaId: string; roundIndex: number; preset: string;
  remainingMs: number; standings: string;
  guests: { get(id: string): Guest | undefined; forEach(visit: (guest: Guest, id: string) => void): void };
};

export const privateEntry = document.querySelector<HTMLFormElement>('#private-entry')!;
export const createButton = document.querySelector<HTMLButtonElement>('#create-private')!;
export const joinCode = document.querySelector<HTMLInputElement>('#room-code')!;
export const capacity = document.querySelector<HTMLInputElement>('#capacity')!;
const panel = document.querySelector<HTMLElement>('#private-room')!;
const codeLabel = document.querySelector<HTMLElement>('#room-invite')!;
const phaseLabel = document.querySelector<HTMLElement>('#match-phase')!;
const guests = document.querySelector<HTMLElement>('#guests')!;
const readyButton = document.querySelector<HTMLButtonElement>('#ready')!;
const startButton = document.querySelector<HTMLButtonElement>('#start-match')!;
const results = document.querySelector<HTMLElement>('#match-results')!;
const resultsTitle = document.querySelector<HTMLElement>('#results-title')!;
const standings = document.querySelector<HTMLElement>('#standings')!;
const presetPicker = document.querySelector<HTMLSelectElement>('#preset')!;
const presetLabel = presetPicker.closest('label')!;
const SHORT_NAMES = { dash: 'Dash', lava: 'Lava', dodge: 'Dodge' };

for (const [id, playlist] of Object.entries(PLAYLISTS)) {
  const seconds = playlistMs(playlist) / 1000;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const arenas = playlist.rounds.map(arena => SHORT_NAMES[arena]).join(', ');
  presetPicker.add(new Option(`${playlist.name} · ${arenas} · ${duration}`, id));
}

const playlistOf = (preset: string) => PLAYLISTS[(Object.hasOwn(PLAYLISTS, preset) ? preset : 'short') as PresetId];
const arenaName = (id: string | undefined) => id ? ARENAS[id as keyof typeof ARENAS]?.name ?? id : '';
/** HUD line for the local racer during a round, from the arena's public progress number. */
function roundLine(arenaId: string, time: number, progress: number): string {
  const name = arenaName(arenaId);
  if (arenaId === 'dodge') return `${name} · ${time}s · ${progress} hits`;
  if (arenaId === 'lava') return progress < 0
    ? `${name} · ${time}s · caught by the lava, watching from the balcony`
    : `${name} · ${time}s · gate ${progress}/${LAVA_GATES}`;
  const checkpoints = DASH_GATES.length - 1;
  return `${name} · ${time}s · ${Math.min(checkpoints, progress)}/${checkpoints} checkpoints`;
}

export function privatePanel(ready: (value: boolean) => void, start: () => void, choosePreset: (value: string) => void) {
  let lastGuests = '';
  let lastStandings = '';
  let lastPhase = '';
  let lastPreset = '';
  let canAct = true;
  panel.hidden = false;
  startButton.onclick = start;
  presetPicker.onchange = () => choosePreset(presetPicker.value);
  return {
    setConnected(connected: boolean) {
      canAct = connected;
      if (!connected) readyButton.disabled = startButton.disabled = true;
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
      codeLabel.textContent = Date.now() >= state.codeExpiresAt
        ? `Room ${state.code} · invite expired` : `Room code: ${state.code}`;
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
      const playlist = playlistOf(state.preset);
      const round = `Round ${state.roundIndex + 1}/${playlist.rounds.length}`;
      phaseLabel.textContent = lobby
        ? `Plaza · ${playlist.name} · ${rows.length}/${state.capacity} guests · ${readyCount} ready (4 needed)`
        : state.phase === 'countdown' ? `${playlist.name} starts in ${time}s · ${arenaName(playlist.rounds[0])}`
        : state.phase === 'transition' ? `${round} · ${arenaName(playlist.rounds[state.roundIndex])} begins in ${time}s`
        : state.phase === 'results' ? `Final results · returning to plaza in ${time}s`
        : !me?.racing ? `Waiting for the party · ${time}s left`
        : state.phase === 'cooldown' ? `${arenaName(state.arenaId)} standings locked · ${time}s left`
        : roundLine(state.arenaId, time, me.progress);
      const host = sessionId === state.hostId;
      presetLabel.hidden = !lobby;
      presetPicker.disabled = !canAct || !host;
      // Follow the server only when its preset changes, so the host's pick is not undone by patches sent before the server applied it.
      if (state.preset !== lastPreset && Object.hasOwn(PLAYLISTS, state.preset)) presetPicker.value = lastPreset = state.preset;
      readyButton.hidden = !lobby;
      readyButton.disabled = !canAct || !me?.connected;
      readyButton.textContent = me?.ready ? 'Cancel ready' : 'Ready';
      readyButton.onclick = () => ready(!me?.ready);
      startButton.hidden = !lobby || !host;
      startButton.textContent = `Start ${playlist.name}`;
      startButton.disabled = !canAct || !me?.ready || readyCount < 4;
      results.hidden = !state.standings || !(state.phase === 'transition' || state.phase === 'results' || lobby);
      resultsTitle.textContent = state.phase === 'results' ? `${playlist.name} results`
        : lobby ? 'Last party results' : `Standings after ${arenaName(playlist.rounds[state.roundIndex - 1])}`;
      if (lastStandings === state.standings) return;
      lastStandings = state.standings;
      standings.replaceChildren();
      if (!state.standings) return;
      const result = JSON.parse(state.standings) as PartyResults;
      if (result.interrupted && (state.phase === 'results' || lobby)) resultsTitle.textContent = `${playlistOf(result.preset).name} interrupted`;
      for (const row of result.rows) {
        const entry = document.createElement('li');
        const rounds = row.rounds.map((round, index) => round?.summary ?? `${SHORT_NAMES[result.arenas[index]!] ?? 'Round'} pending`);
        entry.textContent = `${row.place}. ${row.name} — ${row.totalPoints} pts (${rounds.join(', ')})`;
        standings.append(entry);
      }
    },
    dispose() {
      panel.hidden = true;
      readyButton.onclick = startButton.onclick = null;
      presetPicker.onchange = null;
    },
  };
}
