// 右クリックのメニュー「Hakomado の空き枠に追加」の送り先 (extension/background.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readExt, EXT, plain } = require('./helpers/load');

const A = 'AAAAAAAAAAA';

/** background.js を、記録するだけの chrome.* の上で動かす */
function setup({ gridTabs = [], tabs = {}, answer = () => undefined } = {}) {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const log = { sent: [], created: [], updated: [], focused: [], menus: [] };
  const chrome = {
    action: { onClicked: on('action') },
    commands: { onCommand: on('command') },
    runtime: {
      id: 'self',
      getURL: (p) => `chrome-extension://self/${p}`,
      onInstalled: on('installed'),
      onMessage: on('message'),
      async sendMessage(msg) {
        log.sent.push(msg);
        const r = answer(msg);
        if (r === undefined) throw new Error('Could not establish connection. Receiving end does not exist.');
        return r;
      },
    },
    i18n: { getMessage: (k) => k },
    storage: { session: { get: async () => ({ gridTabs }) }, local: { set: async () => {} } },
    declarativeNetRequest: { updateDynamicRules: async () => {}, updateSessionRules: async () => {} },
    permissions: { onAdded: on('permissionsAdded'), onRemoved: on('permissionsRemoved'), contains: async () => false },
    tabs: {
      onRemoved: on('tabRemoved'),
      onUpdated: on('tabUpdated'),
      get: async (id) => {
        if (!tabs[id]) throw new Error('No tab');
        return { id, ...tabs[id] };
      },
      update: async (id, p) => log.updated.push([id, p]),
      create: async (p) => log.created.push(p),
    },
    windows: { update: async (id, p) => log.focused.push([id, p]) },
    contextMenus: {
      onClicked: on('menu'),
      removeAll: (cb) => cb(),
      create: (m) => log.menus.push(m),
    },
  };
  const ctx = vm.createContext({ console, URL, chrome });
  ctx.importScripts = (f) => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext(readExt('background.js'), ctx, { filename: 'background.js' });
  // 押した結果を待つ (onClicked は promise を返さないので、少し回す)
  const click = async (info, tab) => {
    listeners.menu(info, tab);
    for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r));
  };
  return { listeners, log, click };
}

test('manifest に contextMenus があり、メニューの名前が両方の言語にある', () => {
  assert.ok(JSON.parse(readExt('manifest.json')).permissions.includes('contextMenus'));
  for (const lang of ['ja', 'en']) assert.ok(JSON.parse(readExt(`_locales/${lang}/messages.json`)).menuAddToTile?.message);
});

test('インストール・更新のときにメニューを作る (リンク用と視聴ページ用)', () => {
  const { listeners, log } = setup();
  listeners.installed({ reason: 'update' });
  assert.deepEqual(log.menus.map((m) => [m.id, [...m.contexts]]), [
    ['hakomado-add-link', ['link']],
    ['hakomado-add-page', ['page', 'video']],
  ]);
  assert.ok(log.menus[0].targetUrlPatterns.includes('*://youtu.be/*'));
  assert.ok(log.menus[1].documentUrlPatterns.every((p) => /^\*:\/\/(www|m)\.youtube\.com\//.test(p)));
});

test('開いている画面のうち、同じウィンドウで最後に使ったタブに送り、そこに切り替える', async () => {
  const { log, click } = setup({
    gridTabs: [1, 2, 3],
    tabs: { 1: { windowId: 9, lastAccessed: 500 }, 2: { windowId: 5, lastAccessed: 100 }, 3: { windowId: 5, lastAccessed: 300 } },
    answer: (m) => (m.tabId === 3 ? { handled: true, result: 'added' } : undefined),
  });
  await click({ menuItemId: 'hakomado-add-link', linkUrl: `https://youtu.be/${A}` }, { windowId: 5 });
  assert.deepEqual(plain(log.sent), [{ type: 'add-video', tabId: 3, videoId: A }]);
  assert.deepEqual(plain(log.updated), [[3, { active: true }]]);
  assert.deepEqual(plain(log.focused), [[5, { focused: true }]]);
  assert.equal(log.created.length, 0);
});

test('返事が無ければ次の画面へ。どこも受け取らなければ新しいタブで #add= を開く', async () => {
  const { log, click } = setup({ gridTabs: [1, 7], tabs: { 1: { windowId: 5, lastAccessed: 1 } } });
  await click({ menuItemId: 'hakomado-add-page', pageUrl: `https://www.youtube.com/watch?v=${A}` }, { windowId: 5 });
  assert.deepEqual(log.sent.map((m) => m.tabId), [1], '閉じたタブ (7) には送らない');
  assert.deepEqual(plain(log.created), [{ url: `chrome-extension://self/grid.html#add=${A}`, windowId: 5 }]);
});

test('ショート (/shorts/) は short を付けて送る。新しいタブなら #add=<ID>&short', async () => {
  const sent = setup({ gridTabs: [3], tabs: { 3: { windowId: 5 } }, answer: () => ({ handled: true, result: 'added' }) });
  await sent.click({ menuItemId: 'hakomado-add-page', pageUrl: `https://www.youtube.com/shorts/${A}` }, { windowId: 5 });
  assert.deepEqual(plain(sent.log.sent), [{ type: 'add-video', tabId: 3, videoId: A, short: true }]);
  const opened = setup();
  await opened.click({ menuItemId: 'hakomado-add-link', linkUrl: `https://m.youtube.com/shorts/${A}` }, { windowId: 5 });
  assert.deepEqual(plain(opened.log.created), [{ url: `chrome-extension://self/grid.html#add=${A}&short`, windowId: 5 }]);
});

test('枠の中 (フレーム) で押したときはフレームの動画。動画でないリンクは何もしない', async () => {
  const { log, click } = setup();
  await click({ menuItemId: 'hakomado-add-page', pageUrl: 'chrome-extension://self/grid.html', frameUrl: `https://www.youtube.com/watch?v=${A}&hakomado=1` }, { windowId: 1 });
  assert.equal(log.created[0].url.endsWith(`#add=${A}`), true);
  await click({ menuItemId: 'hakomado-add-link', linkUrl: 'https://www.youtube.com/@someone' }, { windowId: 1 });
  await click({ menuItemId: 'other', linkUrl: `https://youtu.be/${A}` }, { windowId: 1 });
  assert.equal(log.created.length, 1);
});

test('ショートカットキーのスクリーンショットは、マルチビュー画面のタブで押したときだけ、そのタブに頼む', async () => {
  const manifest = JSON.parse(readExt('manifest.json'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.commands.screenshot);
  for (const lang of ['ja', 'en']) assert.ok(JSON.parse(readExt(`_locales/${lang}/messages.json`)).cmdScreenshot?.message);
  const { listeners, log } = setup({ gridTabs: [3], answer: () => ({}) });
  const press = async (command, tab) => {
    listeners.command(command, tab);
    for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r));
  };
  await press('screenshot', { id: 4 });
  await press('other', { id: 3 });
  assert.equal(log.sent.length, 0, 'ほかのタブ・ほかのコマンドでは何もしない');
  await press('screenshot', { id: 3 });
  assert.deepEqual(plain(log.sent), [{ type: 'screenshot', tabId: 3 }]);
});
