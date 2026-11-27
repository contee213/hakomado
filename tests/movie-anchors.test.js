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

test('見当の印: guess で記録すると見当、ふつうに記録し直すと決めた値。消しても「本編にした」の印は残る', async () => {
  const { M, env } = setup();
  await M.load();
  await M.set(vid(1), 10, { guess: true });
  assert.equal(M.get(vid(1)), 10);
  assert.equal(M.isGuess(vid(1)), true);
  await M.set(vid(1), 12.5);
  assert.equal(M.isGuess(vid(1)), false, '使う人が決めた値は見当ではない');
  await M.setMain(vid(1), true);
  assert.equal(M.isMain(vid(1)), true);
  assert.equal(M.get(vid(1)), 12.5, '本編にしても位置はそのまま');
  await M.remove(vid(1));
  assert.equal(M.get(vid(1)), null);
  assert.equal(M.isMain(vid(1)), true, '位置を消しても本編の印は残る');
  assert.ok(env.chrome.storage.local._dump().movieAnchors[vid(1)]);
  await M.setMain(vid(1), false);
  assert.equal(M.isMain(vid(1)), false);
  assert.equal(env.chrome.storage.local._dump().movieAnchors[vid(1)], undefined, '何も無くなったら消える');
});

test('読み込むとき: 本編の印だけの項目も読む。見当の印は位置があるときだけ', async () => {
  const { M } = setup({ movieAnchors: { [vid(1)]: { m: 1, at: 1 }, [vid(2)]: { g: 1, at: 1 }, [vid(3)]: { s: 5, g: 1, m: 1 } } });
  await M.load();
  assert.equal(M.isMain(vid(1)), true);
  assert.equal(M.get(vid(1)), null);
  assert.equal(M.isGuess(vid(2)), false);
  assert.equal(M.get(vid(2)), null);
  assert.equal(M.isGuess(vid(3)), true);
  assert.equal(M.isMain(vid(3)), true);
});

test('画面のタイマーの区間 (HAKO-49): 作品の一覧・未定なら 1 本目を入れる・選ぶ・手で決め直すと選んだ印を外す', async () => {
  const { M, env } = setup();
  await M.load();
  // 1 本目は 608.54 秒に 00:00:00 から、途中で止めて 1000 秒に 00:06:00 から続き、2 本目は 2096.65 秒に 00:00:00 から
  await M.addSections(vid(1), [
    [608.543, 0],
    [1000, 360],
  ]);
  await M.addSections(vid(1), [[2096.65, 0]]);
  assert.deepEqual(plain(M.works(vid(1))), [
    { n: 1, at: 608.54, zero: 608.54 },
    { n: 2, at: 2096.65, zero: 2096.65 },
  ]);
  assert.equal(M.get(vid(1)), 608.54, '未定だったので 1 本目の 0:00 が入る');
  assert.equal(M.selected(vid(1)), 1);
  assert.equal(M.select(vid(1), 2), 2096.65);
  assert.equal(M.get(vid(1)), 2096.65);
  assert.equal(M.selected(vid(1)), 2);
  assert.equal(M.select(vid(1), 9), null, '無い作品は選べない');
  await M.set(vid(1), 700);
  assert.equal(M.selected(vid(1)), null, '手で決め直したら選んだ印は外す');
  assert.equal(M.works(vid(1)).length, 2, '見つけた区間は残す');
  const saved = env.chrome.storage.local._dump().movieAnchors[vid(1)];
  assert.deepEqual(plain(saved.w), [
    [608.54, 0],
    [1000, 360],
    [2096.65, 0],
  ]);
});

test('画面のタイマーの区間: 00:00:00 から始まらないタイマー・決まっている位置は変えない・おかしな値は捨てる', async () => {
  const { M } = setup({ movieAnchors: { [vid(2)]: { s: 10, at: 1 } } });
  await M.load();
  // 26:20 (1580 秒) から動き出した → 本編の 0:00 は 1832.3 − 1580 = 252.3
  await M.addSections(vid(1), [[1832.3, 1580], ['x', 1], [-5, 0], [5, -1], [3]]);
  assert.deepEqual(plain(M.works(vid(1))), [{ n: 1, at: 1832.3, zero: 252.3 }]);
  assert.equal(M.get(vid(1)), 252.3);
  await M.addSections(vid(2), [[500, 0]]);
  assert.equal(M.get(vid(2)), 10, '手で決めた位置があれば変えない');
  assert.equal(M.selected(vid(2)), null);
  await M.addSections('bad', [[1, 0]]);
  assert.deepEqual(plain(M.works('bad')), []);
});
