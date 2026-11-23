// 🎬 本編モードの、動画ごとの本編の位置 (extension/movie-anchors.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const vid = (n) => 'v' + String(n).padStart(10, '0');

function setup(seed) {
  const env = load(['movie-anchors.js']);
  if (seed) env.chrome.storage.local._seed(seed);
  return { M: env.get('MovieAnchors'), env };
}

test('読み込むときは正しい形のものだけ。決めていない動画は null (0 とは区別する)', async () => {
  const { M } = setup({
    movieAnchors: { [vid(1)]: { s: 754.234, at: 5 }, [vid(2)]: { s: 0 }, bad: { s: 3 }, [vid(3)]: { s: 'x' }, [vid(4)]: null, [vid(5)]: { s: 1e9 } },
  });
  await M.load();
  assert.equal(M.get(vid(1)), 754.23, '0.01 秒単位');
  assert.equal(M.get(vid(2)), 0, '0 も意味のある値 (配信の始まりと同時に本編が始まった)');
  assert.equal(M.get('bad'), null);
  assert.equal(M.get(vid(3)), null);
  assert.equal(M.get(vid(4)), null);
  assert.equal(M.get(vid(5)), 7 * 86400, '1 週間分までに収める');
  assert.equal(M.get(vid(9)), null);
  assert.equal(M.get(undefined), null);
});

test('記録する・消す: 負の値も入る。おかしな ID は無視', async () => {
  const { M, env } = setup();
  await M.load();
  await M.set(vid(1), 12.345);
  await M.set(vid(2), -3);
  await M.set(vid(3), 0);
  await M.set('bad', 5);
  assert.equal(M.get(vid(1)), 12.35, '0.01 秒単位');
  assert.equal(M.get(vid(2)), -3);
  assert.equal(M.get(vid(3)), 0);
  let saved = env.chrome.storage.local._dump().movieAnchors;
  assert.deepEqual(Object.keys(saved).sort(), [vid(1), vid(2), vid(3)]);
  await M.remove(vid(1));
  assert.equal(M.get(vid(1)), null);
  saved = env.chrome.storage.local._dump().movieAnchors;
  assert.deepEqual(Object.keys(saved).sort(), [vid(2), vid(3)]);
});

test('覚えておくのは新しく決めた 1000 本まで', async () => {
  const seed = {};
  for (let i = 0; i < 1000; i++) seed[vid(i)] = { s: 1, at: i + 1 };
  const { M, env } = setup({ movieAnchors: seed });
  await M.load();
  await M.set(vid(5000), 3);
  const saved = env.chrome.storage.local._dump().movieAnchors;
  assert.equal(Object.keys(saved).length, 1000);
  assert.ok(saved[vid(5000)]);
  assert.equal(saved[vid(0)], undefined, 'いちばん古いものから忘れる');
});

test('ほかのタブで変わったら、変わった動画だけを知らせる', async () => {
  const { M, env } = setup({ movieAnchors: { [vid(1)]: { s: 1, at: 1 }, [vid(2)]: { s: 2, at: 1 } } });
  await M.load();
  const got = [];
  M.onChange((ids) => got.push(plain(ids).sort()));
  await env.chrome.storage.local.set({ movieAnchors: { [vid(1)]: { s: 1, at: 1 }, [vid(3)]: { s: 0, at: 2 } } });
  assert.deepEqual(got, [[vid(2), vid(3)]]);
  assert.equal(M.get(vid(2)), null);
  assert.equal(M.get(vid(3)), 0);
  await env.chrome.storage.local.set({ other: 1 });
  assert.equal(got.length, 1);
});
