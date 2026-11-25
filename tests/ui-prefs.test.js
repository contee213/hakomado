// 画面の小さな覚え (extension/ui-prefs.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

function setup({ seed, legacy } = {}) {
  const env = load(['ui-prefs.js']);
  if (seed) env.chrome.storage.local._seed(seed);
  const ls = env.get('localStorage');
  for (const [k, v] of Object.entries(legacy || {})) ls.setItem(k, v);
  return { U: env.get('UiPrefs'), env, ls };
}

test('覚えたものは chrome.storage.local の ui:<名前> に置き、読み直せる', async () => {
  const { U, env, ls } = setup();
  await U.load();
  assert.equal(U.get('libScope'), undefined);
  U.set('libScope', 'all');
  U.set('libKinds', ['live', 'short']);
  U.set('syncDock', { floating: false });
  await new Promise((r) => setTimeout(r));
  const saved = env.chrome.storage.local._dump();
  assert.equal(saved['ui:libScope'], 'all');
  assert.deepEqual(plain(saved['ui:libKinds']), ['live', 'short']);
  assert.deepEqual(plain(saved['ui:syncDock']), { floating: false });
  assert.equal(ls.getItem('hakomado.libScope'), null, 'localStorage には書かない');

  const again = load(['ui-prefs.js']);
  again.chrome.storage.local._seed(saved);
  const U2 = again.get('UiPrefs');
  await U2.load();
  assert.equal(U2.get('libScope'), 'all');
  assert.deepEqual(plain(U2.get('libKinds')), ['live', 'short']);
});

test('知らない名前は読み書きしない', async () => {
  const { U, env } = setup();
  await U.load();
  U.set('lang', 'en');
  await new Promise((r) => setTimeout(r));
  assert.equal(U.get('lang'), undefined);
  assert.deepEqual(plain(env.chrome.storage.local._dump()), {});
});

test('以前の版の localStorage の覚えを引き継ぎ、localStorage から消す (タブの位置は引き継がずに消す。表示言語は残す)', async () => {
  const { U, env, ls } = setup({
    legacy: {
      'hakomado.lang': 'en',
      'hakomado.settingsTab': 'channels',
      'hakomado.libTab': 'saved',
      'hakomado.libScope': 'all',
      'hakomado.libKinds': '["video"]',
      'hakomado.libPlaylist': 'p1',
      'hakomado.shareTab': 'code',
      'hakomado.shareImgLabels': '1',
      'hakomado.shareAuthor': 'TK',
      'hakomado.syncDock': '{"floating":true,"x":10,"y":20}',
    },
  });
  await U.load();
  assert.equal(U.get('settingsTab'), undefined, 'タブの位置は sessionStorage に置くので引き継がない');
  assert.equal(U.get('libScope'), 'all');
  assert.deepEqual(plain(U.get('libKinds')), ['video']);
  assert.equal(U.get('shareImgLabels'), true);
  assert.deepEqual(plain(U.get('syncDock')), { floating: true, x: 10, y: 20 });
  const saved = env.chrome.storage.local._dump();
  assert.equal(saved['ui:libPlaylist'], 'p1');
  assert.equal(saved['ui:shareAuthor'], 'TK');
  for (const n of ['settingsTab', 'libTab', 'libScope', 'libKinds', 'libPlaylist', 'shareTab', 'shareImgLabels', 'shareAuthor', 'syncDock']) {
    assert.equal(ls.getItem('hakomado.' + n), null, `${n} は localStorage から消す`);
  }
  assert.equal(ls.getItem('hakomado.lang'), 'en', '表示言語は localStorage に残す');
});

test('引き継ぐときは chrome.storage にあるほうを使い、壊れた値は引き継がない', async () => {
  const { U, env, ls } = setup({
    seed: { 'ui:libScope': 'star' },
    legacy: { 'hakomado.libScope': 'all', 'hakomado.libKinds': '{broken', 'hakomado.shareImgLabels': '0' },
  });
  await U.load();
  assert.equal(U.get('libScope'), 'star');
  assert.equal(U.get('libKinds'), undefined);
  assert.equal(U.get('shareImgLabels'), false);
  const saved = env.chrome.storage.local._dump();
  assert.equal(saved['ui:libScope'], 'star');
  assert.equal('ui:libKinds' in saved, false);
  assert.equal(ls.getItem('hakomado.libKinds'), null, '壊れた値も localStorage からは消す');
});

test('ほかのタブで変わったら覚え直す', async () => {
  const { U, env } = setup({ seed: { 'ui:shareAuthor': 'A' } });
  await U.load();
  await env.chrome.storage.local.set({ 'ui:shareAuthor': 'B' });
  assert.equal(U.get('shareAuthor'), 'B');
  await env.chrome.storage.local.remove('ui:shareAuthor');
  assert.equal(U.get('shareAuthor'), undefined);
});
