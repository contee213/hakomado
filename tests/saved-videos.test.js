// 🔖 あとで見る (extension/history.js の SavedVideos): 書けたときだけ結果を返し、入れられなかったら知らせる (HAKO-58)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const vid = (n) => 'v' + String(n).padStart(10, '0');

function setup() {
  const env = load(['history.js']);
  const SavedVideos = env.get('SavedVideos');
  const errors = [];
  SavedVideos.onError((e, isQuota) => errors.push({ message: e.message, isQuota }));
  const local = env.chrome.storage.local;
  const set = local.set.bind(local);
  const fail = (message) => {
    local.set = async () => {
      throw new Error(message);
    };
  };
  const heal = () => {
    local.set = set;
  };
  return { SavedVideos, errors, fail, heal };
}

test('書けたときは saved / removed を返し、知らせない', async () => {
  const { SavedVideos, errors } = setup();
  assert.equal(await SavedVideos.toggle(vid(1), { title: 'A' }), 'saved');
  assert.deepEqual(plain((await SavedVideos.list()).map((h) => h.videoId)), [vid(1)]);
  assert.equal(await SavedVideos.toggle(vid(1)), 'removed');
  assert.equal(errors.length, 0);
});

test('入れようとして書けなかったら、saved を返さずに知らせる (保存できる量がいっぱいか見分ける)', async () => {
  const { SavedVideos, errors, fail, heal } = setup();
  fail('QUOTA_BYTES quota exceeded');
  assert.equal(await SavedVideos.toggle(vid(1), { title: 'A' }), undefined);
  assert.equal(await SavedVideos.add(vid(2), {}), undefined);
  assert.deepEqual(errors, [
    { message: 'QUOTA_BYTES quota exceeded', isQuota: true },
    { message: 'QUOTA_BYTES quota exceeded', isQuota: true },
  ]);
  fail('IO error');
  await SavedVideos.toggle(vid(3), {});
  assert.deepEqual(errors[2], { message: 'IO error', isQuota: false });
  // 失敗のあとも、続けて書ける (順番待ちが止まらない)
  heal();
  assert.equal(await SavedVideos.toggle(vid(4), {}), 'saved');
  assert.deepEqual(plain((await SavedVideos.list()).map((h) => h.videoId)), [vid(4)]);
});

test('外す・タイトルを足すのが書けなかったときは、知らせない (記録だけ)', async () => {
  const { SavedVideos, errors, fail } = setup();
  await SavedVideos.toggle(vid(1), {});
  fail('QUOTA_BYTES quota exceeded');
  assert.equal(await SavedVideos.toggle(vid(1)), undefined);
  await SavedVideos.update(vid(1), { title: 'B' });
  await SavedVideos.remove(vid(1));
  assert.equal(errors.length, 0);
});
