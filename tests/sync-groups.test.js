// アーカイブの同期再生の同期グループの分け方 (extension/sync-groups.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const G = load(['sync-groups.js']).get('SyncGroups');
const H = 3600e3;
/** [i, 始まり (時), 終わり (時)] か [i] (ライブ) */
const tiles = (...list) => list.map(([i, s, e]) => ({ i, range: s == null ? null : [s * H, e * H] }));
const run = (t, manual = [], prev = []) => {
  const r = G.assign(t, new Map(manual), new Map(prev));
  return { groups: plain(Object.fromEntries(r.groups)), excluded: plain(Object.fromEntries(r.excluded)) };
};

test('時間帯が重なる枠どうしを自動でまとめる (A・B と C・D)', () => {
  const r = run(tiles([0, 0, 2], [1, 1, 3], [2, 10, 12], [3, 11, 13]));
  assert.deepEqual(r.groups, { 1: [0, 1], 2: [2, 3] });
  assert.deepEqual(r.excluded, {});
});

test('重なりはつながりでまとめる (A と B、B と C が重なれば 1 つ)', () => {
  const r = run(tiles([0, 0, 2], [1, 1.5, 4], [2, 3, 5]));
  assert.deepEqual(r.groups, { 1: [0, 1, 2] });
});

test('重なる相手が無い枠・ライブは入れない', () => {
  const r = run(tiles([0, 0, 2], [1, 1, 3], [2, 10, 12], [3]));
  assert.deepEqual(r.groups, { 1: [0, 1] });
  assert.deepEqual(r.excluded, { 2: 'alone', 3: 'live' });
});

test('手で決めた枠は、その番号へ (0 = 同期しない)。残りは自動でまとめる', () => {
  // 4 本とも重なっているが、C・D をグループ 2 へ
  const t = tiles([0, 0, 2], [1, 0, 2], [2, 0, 2], [3, 0, 2]);
  assert.deepEqual(run(t, [[2, 2], [3, 2]]).groups, { 1: [0, 1], 2: [2, 3] });
  // 1 本だけ外すと、残りの 3 本はまとまったまま
  const r = run(t, [[3, 0]]);
  assert.deepEqual(r.groups, { 1: [0, 1, 2] });
  assert.deepEqual(r.excluded, { 3: 'manual' });
  // ライブも手で入れられる (🎬 本編モード用)
  assert.deepEqual(run(tiles([0, 0, 2], [1]), [[0, 3], [1, 3]]).groups, { 3: [0, 1] });
});

test('番号は前回の分け方を保つ', () => {
  const t = tiles([0, 0, 2], [1, 1, 3], [2, 10, 12], [3, 11, 13]);
  // 前回は C・D が 1、A・B が 2 だった → そのまま
  assert.deepEqual(run(t, [], [[0, 2], [1, 2], [2, 1], [3, 1]]).groups, { 1: [2, 3], 2: [0, 1] });
  // A・B (グループ 1) を閉じて E・F を足しても、C・D は 2 のまま。E・F は空いた 1 へ
  const t2 = tiles([2, 10, 12], [3, 11, 13], [4, 20, 21], [5, 20, 22]);
  assert.deepEqual(run(t2, [], [[0, 1], [1, 1], [2, 2], [3, 2]]).groups, { 1: [4, 5], 2: [2, 3] });
  // 手で使っている番号は、新しいまとまりに使わない
  const t3 = tiles([0, 0, 2], [1, 0, 2], [2, 10, 12], [3, 10, 12]);
  assert.deepEqual(run(t3, [[0, 1], [1, 1]]).groups, { 1: [0, 1], 2: [2, 3] });
});

test('グループは 4 組まで (あふれた分は入れない)', () => {
  const t = tiles(...[0, 1, 2, 3, 4].flatMap((k) => [[k * 2, k * 10, k * 10 + 1], [k * 2 + 1, k * 10, k * 10 + 1]]));
  const r = run(t);
  assert.deepEqual(Object.keys(r.groups), ['1', '2', '3', '4']);
  assert.deepEqual(r.excluded, { 8: 'full', 9: 'full' });
});

test('グループの中はレイアウトの順', () => {
  const t = tiles([5, 0, 2], [1, 0, 2], [3, 0, 2]);
  // 前回まとまっていたグループの 1 本を、同じ番号に手で決めても、残りはそのグループのまま
  assert.deepEqual(run(t, [[3, 1]], [[5, 1], [1, 1], [3, 1]]).groups, { 1: [5, 1, 3] });
});
