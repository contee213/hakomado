// アドオン (extension/addons.js と addons/ のファイル)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, plain, readExt, EXT } = require('./helpers/load');

const ADDON_FILES = fs.readdirSync(path.join(EXT, 'addons')).filter((f) => f.endsWith('.js')).map((f) => `addons/${f}`);
const env = () => load(['i18n.js', 'addons.js', ...ADDON_FILES]);

test('addons/ のファイルは全部 grid.html で addons.js の後・favorites.js の前に読み込む', () => {
  const scripts = [...readExt('grid.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const f of ADDON_FILES) {
    assert.ok(scripts.includes(f), `${f} を読み込んでいない`);
    assert.ok(scripts.indexOf('addons.js') < scripts.indexOf(f) && scripts.indexOf(f) < scripts.indexOf('favorites.js'), f);
  }
});

test('アドオンのアクセス先は manifest.json の権限に書いてある', () => {
  const manifest = JSON.parse(readExt('manifest.json'));
  const declared = new Set([...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])]);
  const addons = env().get('Addons.list()');
  assert.ok(addons.length >= 1);
  for (const a of addons) {
    for (const o of a.origins) assert.ok(declared.has(o), `${a.id} の ${o} が manifest.json に無い`);
    assert.ok(Array.isArray(a.name) && a.name.length === 2 && Array.isArray(a.note) && a.note.length === 2, `${a.id} の名前・説明が [ja, en] の組ではない`);
    if (a.type === 'schedule') assert.equal(typeof a.fetchEntries, 'function', a.id);
  }
});

test('ON / OFF: 書いていなければ初期値。初期値と同じにしたら設定から消す。知らない形は捨てる', () => {
  const e = env();
  const A = e.get('Addons');
  A.setStates('');
  assert.equal(A.isOn('holodule'), true, 'ホロジュールは初期値で ON');
  const off = A.withState('', 'holodule', false);
  assert.equal(off, 'holodule:off');
  A.setStates(off);
  assert.equal(A.isOn('holodule'), false);
  assert.deepEqual(plain(A.enabled('schedule').map((a) => a.id)), []);
  assert.equal(A.withState(off, 'holodule', true), '', '初期値に戻したら書かない');
  A.setStates('holodule:maybe,<bad>:on,,nosuch:on');
  assert.equal(A.isOn('holodule'), true);
  assert.equal(A.isOn('nosuch'), false, '登録されていないものは ON にならない');
});

test('アドオンが取りに行けるのは origins の中だけ', () => {
  const A = env().get('Addons');
  const h = A.list().find((a) => a.id === 'holodule');
  assert.equal(A.allowed(h, 'https://schedule.hololive.tv/lives'), true);
  assert.equal(A.allowed(h, 'https://schedule.hololive.tv.example.com/'), false);
  assert.equal(A.allowed(h, 'https://www.youtube.com/'), false);
});

test('登録の誤り (id の重複・origins の形) は止める', () => {
  const A = env().get('Addons');
  assert.throws(() => A.register({ id: 'holodule', origins: [] }));
  assert.throws(() => A.register({ id: 'x', origins: ['https://example.com/'] }));
  assert.throws(() => A.register({ id: 'Bad id', origins: [] }));
});
