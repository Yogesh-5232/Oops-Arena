import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { QuickMatch } from './quick-match.js';

test('the first tick past the cutoff publishes standings with the results phase', () => {
  const match = new QuickMatch<string[]>(123);
  const unexpectedRank = () => assert.fail('standings ranked too early or more than once');
  const result = ['first'];
  assert.deepEqual(match.advance(5_122, unexpectedRank, true), { phase: 'countdown' });
  assert.deepEqual(match.advance(5_123, unexpectedRank), { phase: 'round' });
  assert.equal(match.acceptsScoring(110_122), true);
  assert.equal(match.acceptsScoring(110_123), false);
  assert.deepEqual(match.advance(115_000, () => result), { phase: 'results', result });
  assert.deepEqual(match.advance(120_122, unexpectedRank), { phase: 'results', result });
  assert.deepEqual(match.advance(120_123, unexpectedRank), { phase: 'complete', result });
});

test('a stall past the entire results window finalizes without extending the match', () => {
  const match = new QuickMatch<string[]>(0);
  assert.deepEqual(match.advance(125_000, () => ['first']), { phase: 'complete', result: ['first'] });
  assert.equal(match.endsAt, 120_000);
});

test('early finish locks scoring and preserves standings through cooldown and results', () => {
  const match = new QuickMatch<string[]>(0);
  const result = ['first', 'second'];
  assert.deepEqual(match.advance(25_000, () => result, true), { phase: 'cooldown', result });
  assert.equal(match.acceptsScoring(25_000), false);
  assert.deepEqual(match.advance(110_000, () => assert.fail('already ranked')), { phase: 'results', result });
});
