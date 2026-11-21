// テスト用: ブラウザ向けのスクリプト (extension/ の素の JavaScript) を node:vm の中で読み込む。
// - grid.html と同じく、読み込んだスクリプトは 1 つの環境を共有する (最上位の const / function が次のスクリプトから見える)
// - chrome.* / navigator.locks / localStorage などは小さな代わりを渡す (保存はメモリの中だけ)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'extension');

/** chrome.storage.local の代わり (メモリの中。書き込むと onChanged を呼ぶ) */
function fakeStorageArea(areaName, listeners) {
  let data = {};
  const keysOf = (keys) => (keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys));
  const fire = (changes) => {
    if (Object.keys(changes).length) for (const fn of listeners) fn(changes, areaName);
  };
  return {
    async get(keys) {
      const out = {};
      for (const k of keysOf(keys)) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      fire(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of keysOf(keys)) {
        if (k in data) changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      fire(changes);
    },
    async clear() {
      data = {};
    },
    /** テスト用: 今の中身をそのまま見る / 入れる */
    _dump: () => structuredClone(data),
    _seed: (items) => {
      data = { ...data, ...structuredClone(items) };
    },
  };
}

function fakeChrome({ uiLanguage = 'ja' } = {}) {
  const listeners = new Set();
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  return {
    storage: {
      local: fakeStorageArea('local', listeners),
      session: fakeStorageArea('session', listeners),
      onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    },
    runtime: { getManifest: () => manifest, id: 'test' },
    i18n: { getUILanguage: () => uiLanguage },
  };
}

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/**
 * extension/ のスクリプトを順に読み込む。
 * @param {string[]} files extension/ からの相対パス
 * @param {{lang?: string, globals?: object}} [opts] lang = ブラウザの表示言語、globals = 足す (差し替える) グローバル
 * @returns {{get: (expr: string) => any, ctx: object, chrome: object}} get = 環境の中で式を評価する (最上位の const も読める)
 */
function load(files, { lang = 'ja', globals = {} } = {}) {
  const chrome = fakeChrome({ uiLanguage: lang });
  const ctx = vm.createContext({
    console,
    URL,
    URLSearchParams,
    AbortSignal,
    Blob,
    TextEncoder,
    TextDecoder,
    structuredClone,
    setTimeout,
    clearTimeout,
    chrome,
    navigator: {
      language: lang,
      // ロックは順番に実行するだけ (テストは 1 つの「タブ」しか無い)
      locks: { request: (_name, fn) => Promise.resolve().then(fn) },
    },
    localStorage: fakeLocalStorage(),
    // i18n.js の最後の applyI18n() 用 (日本語のときは lang を入れるだけ)
    document: { documentElement: {}, querySelectorAll: () => [] },
    ...globals,
  });
  ctx.globalThis = ctx;
  for (const f of files) {
    const file = path.join(EXT, f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return { get: (expr) => vm.runInContext(expr, ctx), ctx, chrome };
}

/** vm の中で作った値を、この環境の普通の値にする (assert.deepStrictEqual は別の環境の Array / Object を別物と見るため) */
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** extension/ のファイルの中身 */
const readExt = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

module.exports = { load, plain, readExt, ROOT, EXT };
