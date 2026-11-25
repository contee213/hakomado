// 配信状況の取得結果を、ブラウザを閉じても残す (extension/favorites.js の「取得の負荷を抑える」の節。HAKO-2)
// - チャンネルの RSS・Twitch のページ・動画の状態・制限中の待ち時間は chrome.storage.local に置く
// - ブラウザを開き直した (chrome.storage.session が空になった) あとも、間隔のうちなら取りに行かない
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const CH = 'UC' + 'a'.repeat(22);
const CH2 = 'UC' + 'b'.repeat(22);
const VID = 'abcdefghijk';
const VID2 = 'bcdefghijkl';
const MIN = 60e3;

function setup({ favs = [{ channelId: CH, name: 'A' }] } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    throw new Error('取りに行かないはず: ' + url);
  };
  const env = load(['i18n.js', 'presets.js', 'addons.js', 'favorites.js', 'share-code.js'], {
    globals: { fetch, ReadableStream, Response, ErrLog: { warnFetch() {} }, DOMParser: class {} },
  });
  env.chrome.permissions = { contains: async () => false };
  env.chrome.storage.local._seed({ favorites: favs, presetsDeclined: true });
  return { F: env.get('Favorites'), calls, local: env.chrome.storage.local, session: env.chrome.storage.session };
}

const feed = (at, items) => ({ at, items });
const item = (videoId, { at = Date.now() - 2 * 3600e3, views = 100, title = 't' } = {}) => ({ videoId, title, at, views });

test('RSS は chrome.storage.local に置き、開き直しても 30 分のうちなら最近の配信を取りに行かない', async () => {
  const { F, calls, local } = setup();
  local._seed({ ['feed:' + CH]: feed(Date.now() - 10 * MIN, [item(VID)]), ['feed:UULF:' + CH]: feed(Date.now() - 10 * MIN, []) });
  const list = plain(await F.fetchArchives(CH));
  assert.deepEqual(list.map((v) => v.videoId), [VID]);
  assert.equal(calls.length, 0);
});

test('制限中の待ち時間は chrome.storage.local に残り、開き直しても明けるまで取りに行かない', async () => {
  const { F, calls, local } = setup();
  local._seed({ fetchBackoff: { backoff: { step: 1, until: Date.now() + 5 * MIN } } });
  await assert.rejects(F.fetchArchives(CH, { force: true }), /制限/);
  assert.equal(calls.length, 0);
});

test('前回の結果 (peekStatuses): 取りに行かず、何も書き込まずに、残している RSS と動画の状態で決める', async () => {
  const { F, calls, local } = setup();
  local._seed({
    ['feed:' + CH]: feed(Date.now() - 3 * 3600e3, [item(VID), item(VID2)]),
    videoStates: {
      [VID]: { state: 'ended', kind: 'live', at: Date.now() - 3 * 3600e3 },
      [VID2]: { state: 'live', kind: 'live', title: '配信', startAt: Date.now() - 2 * 3600e3, at: Date.now() - 3 * 3600e3 },
    },
  });
  const before = JSON.stringify(local._dump());
  const st = plain((await F.peekStatuses([{ channelId: CH }])).get(CH));
  assert.equal(st.state, 'live');
  assert.equal(st.videoId, VID2);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(local._dump()), before, '何も書き込まない');
});

test('前回の結果: 6 時間より前に確かめた「配信中」は使わない。RSS が無いチャンネルは入れない', async () => {
  const { F, local } = setup({ favs: [{ channelId: CH, name: 'A' }, { channelId: CH2, name: 'B' }] });
  local._seed({
    ['feed:' + CH]: feed(Date.now() - 24 * 3600e3, [item(VID, { at: Date.now() - 20 * 3600e3 })]),
    videoStates: { [VID]: { state: 'live', kind: 'live', at: Date.now() - 7 * 3600e3 } },
  });
  const prevs = await F.peekStatuses([{ channelId: CH }, { channelId: CH2 }]);
  assert.equal(plain(prevs.get(CH)).state, 'offline');
  assert.equal(prevs.has(CH2), false);
});

test('前回の結果: Twitch は残しているチャンネルのページから。6 時間より前のページの「配信中」は使わない', async () => {
  const { F, calls, local } = setup({ favs: [{ channelId: 'tw:abc', name: 'abc' }, { channelId: 'tw:old', name: 'old' }] });
  const page = { name: 'abc', icon: '', live: { title: 'やってる' }, vods: [] };
  local._seed({ 'twpage:abc': { at: Date.now() - 3600e3, page }, 'twpage:old': { at: Date.now() - 7 * 3600e3, page } });
  const prevs = await F.peekStatuses([{ channelId: 'tw:abc' }, { channelId: 'tw:old' }]);
  assert.equal(prevs.get('tw:abc').state, 'live');
  assert.equal(prevs.get('tw:abc').videoId, 'tw:abc');
  assert.equal(prevs.get('tw:old').state, 'offline');
  assert.equal(calls.length, 0);
});

test('開き直す前に確かめたきりの「配信中」は、確かめ直せなければ配信中とみなさない (自動再生で終わった配信を入れない)', async () => {
  const { F, calls, local } = setup();
  const now = Date.now();
  local._seed({
    ['feed:' + CH]: feed(now - 5 * MIN, [item(VID)]),
    ['feed:UULF:' + CH]: feed(now - 5 * MIN, []),
    ['feed:UUSH:' + CH]: feed(now - 5 * MIN, []),
    videoStates: { [VID]: { state: 'live', kind: 'live', title: '昨日の配信', startAt: now - 20 * 3600e3, at: now - 18 * 3600e3 } },
  });
  // 動画のページを確かめる件数が 0 (自動再生の残りの件数を使い切ったとき)
  const st = plain(await F.fetchStatus({ channelId: CH, name: 'A' }, { auto: true, budget: { watch: 0 } }));
  assert.equal(st.state, 'offline');
  assert.deepEqual(calls, []);
});

test('pruneCache: 合わせて上限を超えたら、古く取ったものから消す', async () => {
  const { F, local } = setup({ favs: [{ channelId: CH, name: 'A' }, { channelId: CH2, name: 'B' }] });
  const now = Date.now();
  const big = [item(VID, { title: 'x'.repeat(5000) })];
  local._seed({ ['feed:' + CH]: feed(now - 2 * MIN, big), ['feed:' + CH2]: feed(now - MIN, big) });
  await F.pruneCache({ maxBytes: 7000 });
  const keys = Object.keys(local._dump()).filter((k) => k.startsWith('feed:'));
  assert.deepEqual(keys, ['feed:' + CH2]);
});

test('pruneCache: 一覧に無いチャンネルの分と 3 日より前の分を消し、ほかは残す', async () => {
  const { F, local } = setup({ favs: [{ channelId: CH, name: 'A' }, { channelId: 'tw:abc', name: 'abc' }] });
  const now = Date.now();
  local._seed({
    ['feed:' + CH]: feed(now, []),
    ['feed:UULF:' + CH]: feed(now - 4 * 24 * 3600e3, []),
    ['feed:' + CH2]: feed(now, []),
    ['feed:UUSH:' + CH2]: feed(now, []),
    'twpage:abc': { at: now, page: {} },
    'twpage:gone': { at: now, page: {} },
  });
  await F.pruneCache();
  const keys = Object.keys(local._dump()).filter((k) => /^(feed|twpage):/.test(k)).sort();
  assert.deepEqual(keys, ['feed:' + CH, 'twpage:abc']);
});

test('開き直しても、終わった配信・先の配信予定は動画のページを取り直さない (RSS が間隔のうちなら通信なし)', async () => {
  const { F, calls, local } = setup();
  const now = Date.now();
  local._seed({
    ['feed:' + CH]: feed(now - 5 * MIN, [item(VID), item(VID2, { views: 0, at: now - 3600e3 })]),
    ['feed:UULF:' + CH]: feed(now - 5 * MIN, []),
    ['feed:UUSH:' + CH]: feed(now - 5 * MIN, []),
    videoStates: {
      [VID]: { state: 'ended', kind: 'live', at: now - 3 * 3600e3 },
      [VID2]: { state: 'upcoming', kind: 'live', title: '予定', startAt: now + 30 * 3600e3, at: now - 3600e3 },
    },
  });
  const st = plain(await F.fetchStatus({ channelId: CH, name: 'A' }));
  assert.equal(st.state, 'upcoming');
  assert.equal(st.videoId, VID2);
  assert.deepEqual(calls, []);
});
