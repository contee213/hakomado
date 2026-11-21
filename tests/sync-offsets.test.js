// アーカイブの同期のずれ (extension/sync-offsets.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const vid = (n) => 'v' + String(n).padStart(10, '0');

function setup(seed) {
  const env = load(['sync-offsets.js']);
  if (seed) env.chrome.storage.local._seed(seed);
  return { S: env.get('SyncOffsets'), env };
}

test('読み込むときは正しい形のものだけ', async () => {
  const { S } = setup({
    syncOffsets: { [vid(1)]: { o: 1.234, at: 5 }, [vid(2)]: { o: 0 }, bad: { o: 3 }, [vid(3)]: { o: 'x' }, [vid(4)]: null, [vid(5)]: { o: 1e9 } },
  });
  await S.load();
  assert.equal(S.get(vid(1)), 1.23);
  assert.equal(S.get(vid(2)), 0);
  assert.equal(S.get('bad'), 0);
  assert.equal(S.get(vid(3)), 0);
  assert.equal(S.get(vid(4)), 0);
  assert.equal(S.get(vid(5)), 86400, '1 日分までに収める');
  assert.equal(S.get(undefined), 0);
});

test('記録する: 0.01 秒単位・0 なら消す・おかしな ID は無視', async () => {
  const { S, env } = setup();
  await S.load();
  await S.set(vid(1), 2.345);
  await S.set(vid(2), -1);
  await S.set('bad', 5);
  assert.equal(S.get(vid(1)), 2.35);
  let saved = env.chrome.storage.local._dump().syncOffsets;
  assert.deepEqual(Object.keys(saved).sort(), [vid(1), vid(2)]);
  assert.equal(saved[vid(2)].o, -1);
  await S.set(vid(1), 0);
  assert.equal(S.get(vid(1)), 0);
  saved = env.chrome.storage.local._dump().syncOffsets;
  assert.deepEqual(Object.keys(saved), [vid(2)]);
});

test('覚えておくのは新しく調整した 1000 本まで', async () => {
  const seed = {};
  for (let i = 0; i < 1000; i++) seed[vid(i)] = { o: 1, at: i + 1 };
  const { S, env } = setup({ syncOffsets: seed });
  await S.load();
  await S.set(vid(5000), 3);
  const saved = env.chrome.storage.local._dump().syncOffsets;
  assert.equal(Object.keys(saved).length, 1000);
  assert.ok(saved[vid(5000)]);
  assert.equal(saved[vid(0)], undefined, 'いちばん古いものから忘れる');
});

test('ほかのタブで変わったら、変わった動画だけを知らせる', async () => {
  const { S, env } = setup({ syncOffsets: { [vid(1)]: { o: 1, at: 1 }, [vid(2)]: { o: 2, at: 1 } } });
  await S.load();
  const got = [];
  S.onChange((ids) => got.push(plain(ids).sort()));
  await env.chrome.storage.local.set({ syncOffsets: { [vid(1)]: { o: 1, at: 1 }, [vid(3)]: { o: 3, at: 2 } } });
  assert.deepEqual(got, [[vid(2), vid(3)]]);
  assert.equal(S.get(vid(2)), 0);
  assert.equal(S.get(vid(3)), 3);
  // 関係の無い項目の変更では呼ばない
  await env.chrome.storage.local.set({ other: 1 });
  assert.equal(got.length, 1);
});
