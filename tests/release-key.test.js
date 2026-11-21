// リリースの ZIP に入れる "key" (tools/release-key.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readExt } = require('./helpers/load');
const { publicKey, extensionId, injectKey } = require('../tools/release-key');

// README・CHROMEWEBSTORE.md に書いた ID。鍵を作り直したら、ここと文書を合わせて直す
const RELEASE_ID = 'lhafnnpnfpgogdbapeepkgohemnnifpp';

test('公開鍵は RSA の SubjectPublicKeyInfo で、決めた ID になる', () => {
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey(), 'base64'), format: 'der', type: 'spki' });
  assert.equal(key.asymmetricKeyType, 'rsa');
  assert.equal(extensionId(publicKey()), RELEASE_ID);
});

test('ID の決め方 (Chrome と同じ: SHA-256 の先頭 32 桁を a〜p に)', () => {
  const der = Buffer.from('test');
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  const id = extensionId(der.toString('base64'));
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(id, hex.replace(/./g, (h) => 'abcdefghijklmnop'[parseInt(h, 16)]));
});

test('リポジトリの manifest.json には key を入れない (開発用フォルダはフォルダの場所で決まる ID のまま)', () => {
  assert.equal('key' in JSON.parse(readExt('manifest.json')), false);
});

test('manifest.json に key を差し込む: ほかの項目はそのまま', () => {
  const src = readExt('manifest.json');
  const out = injectKey(src, publicKey());
  const a = JSON.parse(src);
  const b = JSON.parse(out);
  assert.equal(b.key, publicKey());
  delete b.key;
  assert.deepEqual(b, a);
  // もう一度差し込んでも 1 つだけ (置き換え)
  const again = injectKey(out, 'QUJD');
  assert.equal(JSON.parse(again).key, 'QUJD');
  assert.equal(again.match(/"key"/g).length, 1);
});

test('version の行が無い manifest は断る', () => {
  assert.throws(() => injectKey('{"name": "x"}', publicKey()));
});

test('リリースの workflow: ストア用の ZIP は key を差し込む前に作る', () => {
  const yml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../.github/workflows/release.yml'), 'utf8');
  const store = yml.indexOf('-chrome-web-store.zip" . -x');
  const inject = yml.indexOf('node tools/release-key.js inject');
  assert.ok(store > 0 && inject > 0, 'どちらの手順も見つからない');
  assert.ok(store < inject, 'ストア用の ZIP が key の差し込みより後に作られている');
  assert.match(yml, /gh release create [^\n]*-chrome-web-store\.zip/);
});
