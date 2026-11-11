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
  assert.equal(lobby.lockRoster('b'), undefined);
  assert.equal(lobby.admit('e'), true);
  assert.equal(lobby.lockRoster('b'), undefined);
  lobby.setReady('e', true);
  assert.equal(lobby.lockRoster('c'), undefined);
  const roster = lobby.lockRoster('b');
  assert.deepEqual(roster, ['b', 'c', 'd', 'e']);
  lobby.release('d');
  assert.equal(lobby.admit('f'), false);
  assert.deepEqual(roster, ['b', 'c', 'd', 'e']);
});
