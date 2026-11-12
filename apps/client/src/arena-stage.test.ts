import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ArenaStage, type StageView } from './arena-stage.js';

function fakeStage() {
  const live = new Set<StageView>();
  let built = 0;
  const stage = new ArenaStage(id => {
    built++;
    const view: StageView & { visible: boolean } = {
      id, visible: false,
      setVisible(visible) { this.visible = visible; },
      destroy() { assert.ok(live.delete(view), `${id} destroyed twice`); },
    };
    live.add(view);
    return view;
  });
  return { stage, live, built: () => built };
}

test('a prefetched arena is reused on transition and hidden until then', () => {
  const { stage, live, built } = fakeStage();
  stage.show('plaza');
  stage.prefetch('dash');
  assert.equal(built(), 2);
  assert.equal((stage.next as { visible?: boolean }).visible, false);
  const dash = stage.next;
  assert.equal(stage.show('dash'), dash, 'show must promote the prefetched tree');
  assert.equal(built(), 2);
  assert.equal(stage.next, undefined);
  assert.equal(live.size, 1, 'the previous arena must be destroyed');
  stage.prefetch('dash');
  assert.equal(built(), 2, 'the current arena needs nothing');
  stage.prefetch('dodge');
  assert.equal(live.size, 2);
  stage.prefetch('');
  assert.equal(stage.next, undefined, 'an empty id means nothing is next');
  assert.equal(live.size, 1, 'clearing the next arena must release its tree');
});

test('repeated Short Party transitions keep at most two trees and return to baseline', () => {
  const { stage, live } = fakeStage();
  stage.show('plaza');
  const sequence: Array<[show: string, next: string]> = [
    ['plaza', 'dash'], ['dash', 'plaza'], ['plaza', 'dodge'], ['dodge', 'plaza'], ['plaza', 'dash'],
  ];
  for (let match = 0; match < 200; match++) {
    for (const [show, next] of sequence) {
      stage.show(show);
      stage.prefetch(next);
      assert.ok(live.size <= 2);
    }
    stage.prefetch('dodge'); // a changed plan replaces the queued tree
    assert.ok(live.size <= 2);
  }
  stage.show('plaza');
  stage.prefetch('');
  stage.dispose();
  assert.equal(live.size, 0);
});
