import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PrivateLobby } from './private-lobby.js';

test('a dropped host retains a seat during grace and the next player takes over on release', () => {
  const lobby = new PrivateLobby(4);
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.equal(lobby.admit(id), true);
    assert.equal(lobby.setReady(id, true), true);
  }
  lobby.setConnected('a', false);
  assert.equal(lobby.admit('e'), false);
  assert.equal(lobby.hostId, 'a');
  assert.equal(lobby.lockRoster('a'), undefined);
  lobby.release('a');
  assert.equal(lobby.hostId, 'b');
  assert.equal(lobby.admit('e'), true);
  lobby.setReady('e', true);
  assert.equal(lobby.lockRoster('c'), undefined);
  const roster = lobby.lockRoster('b');
  assert.deepEqual(roster, ['b', 'c', 'd', 'e']);
  lobby.release('d');
  assert.equal(lobby.admit('f'), false);
  assert.deepEqual(roster, ['b', 'c', 'd', 'e']);
});

test('two connected ready players can start either kind of private lobby', () => {
  for (const party of [false, true]) {
    const lobby = new PrivateLobby(4, party);
    assert.ok(lobby.admit('host'));
    assert.ok(lobby.setReady('host', true));
    assert.equal(lobby.lockRoster('host'), undefined);
    assert.ok(lobby.admit('guest'));
    assert.ok(lobby.setReady('guest', true));
    lobby.setConnected('guest', false);
    assert.equal(lobby.lockRoster('host'), undefined);
    lobby.setConnected('guest', true);
    assert.ok(lobby.setReady('guest', true));
    assert.deepEqual(lobby.lockRoster('host'), ['host', 'guest']);
  }
});

test('four ready players can race while an unready guest waits and the same group can rematch', () => {
  const lobby = new PrivateLobby(6);
  const racers = ['a', 'b', 'c', 'd'];
  for (const id of [...racers, 'waiting']) assert.ok(lobby.admit(id));
  for (const id of racers) assert.ok(lobby.setReady(id, true));
  const first = lobby.lockRoster('a')!;
  assert.deepEqual(first, racers);
  assert.equal(lobby.admit('late'), false);
  assert.equal(lobby.setReady('waiting', true), false);
  assert.ok(lobby.finishMatch(first));
  assert.equal(lobby.hostId, 'a');
  assert.equal(lobby.lockRoster('a'), undefined);
  assert.equal(lobby.admit('waiting'), false);
  for (const id of racers) assert.ok(lobby.setReady(id, true));
  const second = lobby.lockRoster('a')!;
  assert.deepEqual(second, racers);
  assert.notEqual(second, first);
  assert.equal(lobby.finishMatch(first), false);
  assert.ok(lobby.finishMatch(second));
  assert.ok(lobby.admit('late'));
});

test('the party starts and rematches as a whole, including a returning member', () => {
  const lobby = new PrivateLobby(6, true);
  const members = ['host', 'b', 'c', 'd', 'e'];
  for (const id of members) assert.ok(lobby.admit(id));
  for (const id of members.slice(0, 4)) assert.ok(lobby.setReady(id, true));
  assert.equal(lobby.lockRoster('host'), undefined, 'the fifth member must be ready too');
  assert.ok(lobby.setReady('e', true));
  lobby.setConnected('e', false);
  assert.equal(lobby.lockRoster('host'), undefined, 'the dropped member keeps their seat');
  lobby.setConnected('e', true);
  assert.equal(lobby.lockRoster('host'), undefined, 'reconnect clears readiness');
  assert.ok(lobby.setReady('e', true));
  const first = lobby.lockRoster('host')!;
  assert.deepEqual(first, members);
  assert.equal(lobby.admit('late'), false);
  assert.ok(lobby.finishMatch(first));
  assert.equal(lobby.readyCount, 0);
  for (const id of members) assert.ok(lobby.setReady(id, true));
  assert.deepEqual(lobby.lockRoster('host'), members);
});
