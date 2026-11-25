// ファイルの枠のファイルの見分け (extension/local-files.js)。持ち手の保存 (IndexedDB) は E2E とブラウザで確かめる
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const LocalFiles = load(['local-files.js'], { globals: { crypto: globalThis.crypto } }).get('LocalFiles');

test('動画ファイルらしいか: MIME タイプか拡張子で見る', () => {
  assert.equal(LocalFiles.isVideo('movie.mp4', 'video/mp4'), true);
  assert.equal(LocalFiles.isVideo('movie.MKV', ''), true); // type が空のこともある
  assert.equal(LocalFiles.isVideo('clip', 'video/quicktime'), true);
  assert.equal(LocalFiles.isVideo('song.mp3', 'audio/mpeg'), false);
  assert.equal(LocalFiles.isVideo('memo.txt', 'text/plain'), false);
  assert.equal(LocalFiles.isVideo('', ''), false);
});

test('ID は視聴セッションに残せる形 (f と数字)', () => {
  for (let k = 0; k < 20; k++) assert.match(LocalFiles.newId(), /^f\d{1,20}$/);
});
