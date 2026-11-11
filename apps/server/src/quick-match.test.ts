import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { QuickMatch } from './quick-match.js';

test('Quick Chaos uses fixed boundaries even when the server tick is late', () => {
  const match = new QuickMatch<string[]>(123);
  assert.equal(match.phaseAt(5_122), 'countdown');
  assert.equal(match.phaseAt(5_123), 'round');
  assert.equal(match.acceptsScoring(110_122), true);
  assert.equal(match.acceptsScoring(110_123), false);
  assert.equal(match.phaseAt(110_123), 'results');
  assert.equal(match.phaseAt(120_122), 'results');
  assert.equal(match.phaseAt(120_123), 'complete');
  assert.deepEqual(match.finalize(125_000, () => ['first']), ['first']);
  assert.equal(match.phaseAt(125_000), 'complete');
});

test('early finish finalizes once and leaves a playable cooldown until results', () => {
  const match = new QuickMatch<string[]>(0);
  const rank = () => ['first', 'second'];
  assert.equal(match.finalize(4_999, rank, true), undefined);
  assert.equal(match.finalize(25_000, rank), undefined);
  assert.deepEqual(match.finalize(25_000, rank, true), ['first', 'second']);
  assert.equal(match.phaseAt(25_000), 'cooldown');
  assert.equal(match.acceptsScoring(25_000), false);
  assert.equal(match.phaseAt(110_000), 'results');
  assert.deepEqual(match.finalize(110_000, () => assert.fail('already finalized')), match.result);
  assert.equal(match.endsAt, 120_000);
});
