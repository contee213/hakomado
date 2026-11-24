// hakomado: エラーの記録 (「? 使い方」の「不具合の報告」で見て、GitHub で報告・コピーできる)
// - 記録するもの: この拡張機能のコードで起きた例外・Promise の失敗・console.error と、「hakomado:」で始まる console.warn
// - 置き場所は chrome.storage.local の 1 キーだけ。新しい順に最大 MAX 件、KEEP_MS より古いものは捨てる。
//   同じ場所・同じ内容は 1 件にまとめて回数を数えるので、同じエラーが何度出ても増えない (多くても 100KB ほど)
// - 書き込むのは service worker だけ (複数のタブ・iframe が同時に書いて記録を壊さないように)。
//   ほかの場所 (マルチビュー画面・枠の中の YouTube) は数秒ごとにまとめて service worker に送る
// - 外には送らない。報告はユーザーが中身を見てから自分で GitHub に出す
/* exported ErrLog */
'use strict';

const ErrLog = (() => {
  const KEY = 'errorLog';
  const MAX = 100;
  const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
  const MSG_MAX = 500;
  const MSG_TYPE = 'hakomado-errlog';
  const SOURCES = ['grid', 'background', 'watch', 'chat'];
  const KINDS = ['warn', 'error', 'exception', 'rejection'];
  const ORIGIN = `chrome-extension://${chrome.runtime.id}/`;

  let source = '';
  let installed = false;
  let pending = []; // まだ書いていない / 送っていない記録
  let timer = 0;
  let writing = Promise.resolve();
  const original = { warn: console.warn.bind(console), error: console.error.bind(console) };

  /** 1 つの値を短い文字列にする (Error は名前とメッセージ、スタックは先頭の数行だけ) */
  function str(v) {
    if (v instanceof Error || (v && typeof v === 'object' && 'message' in v && 'stack' in v)) {
      const head = `${v.name || 'Error'}: ${v.message}`;
      const stack = String(v.stack || '')
        .split('\n')
        .slice(1, 4)
        .map((l) => l.trim().replace(ORIGIN, ''))
        .join(' ← ');
      return stack ? `${head} (${stack})` : head;
    }
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  }

  function clip(text) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    return t.length > MSG_MAX ? t.slice(0, MSG_MAX - 1) + '…' : t;
  }

  function add(kind, parts) {
    const msg = clip(parts.map(str).join(' '));
    if (!msg) return;
    pending.push({ src: source, kind, msg, t: Date.now() });
    if (pending.length > MAX) pending = pending.slice(-MAX);
    if (!timer) timer = setTimeout(flush, source === 'background' ? 1000 : 3000);
  }

  function flush() {
    timer = 0;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    if (source === 'background') {
      save(batch);
      return;
    }
    try {
      // 拡張機能を再読み込みした後の古い枠などでは送れない (そのときは捨てる)
      chrome.runtime.sendMessage({ type: MSG_TYPE, entries: batch }).catch(() => {});
    } catch {
      /* Extension context invalidated */
    }
  }

  /** 記録に足す (service worker だけが呼ぶ。順番に 1 つずつ書く) */
  function save(batch) {
    writing = writing
      .then(async () => {
        const { [KEY]: old } = await chrome.storage.local.get(KEY);
        const now = Date.now();
        const list = (Array.isArray(old) ? old : []).filter((e) => e && now - e.t < KEEP_MS && e.t <= now + 60000);
        for (const b of batch) {
          const same = list.find((e) => e.src === b.src && e.kind === b.kind && e.msg === b.msg);
          if (same) {
            same.n = (same.n || 1) + 1;
            same.t = Math.max(same.t, b.t);
          } else {
            list.push({ src: b.src, kind: b.kind, msg: b.msg, t: b.t, n: 1 });
          }
        }
        list.sort((a, b) => b.t - a.t);
        await chrome.storage.local.set({ [KEY]: list.slice(0, MAX) });
      })
      .catch((e) => original.warn('hakomado: エラーの記録を保存できませんでした', e));
  }

  /** ほかの場所から届いた記録を確かめてから足す (中身は信用せず、形と長さをそろえる) */
  function receive(msg, sender) {
    if (sender.id !== chrome.runtime.id || !Array.isArray(msg.entries)) return;
    const fromGrid = sender.url?.startsWith(ORIGIN + 'grid.html');
    const batch = [];
    for (const e of msg.entries.slice(0, MAX)) {
      if (!e || typeof e.msg !== 'string' || !KINDS.includes(e.kind) || !SOURCES.includes(e.src)) continue;
      // 枠の中 (YouTube) から届いたものは grid / background を名乗れない
      if (!fromGrid && (e.src === 'grid' || e.src === 'background')) continue;
      const t = Number.isFinite(e.t) ? Math.min(e.t, Date.now()) : Date.now();
      batch.push({ src: e.src, kind: e.kind, msg: clip(e.msg), t });
    }
    if (batch.length) save(batch);
  }

  /** この拡張機能のコードで起きたものか (枠の中では YouTube 自身のエラーも届くので、それは除く) */
  const ours = (...texts) => source === 'grid' || source === 'background' || texts.some((t) => String(t || '').includes(ORIGIN));

  /**
   * 記録を始める。src = 'grid' | 'background' | 'watch' | 'chat'
   * (枠の中では、マルチビュー画面に入れた枠のときだけ呼ぶ)
   */
  function install(src) {
    if (installed || !SOURCES.includes(src)) return;
    installed = true;
    source = src;
    console.warn = (...args) => {
      original.warn(...args);
      if (typeof args[0] === 'string' && args[0].startsWith('hakomado:')) add('warn', args);
    };
    console.error = (...args) => {
      original.error(...args);
      add('error', args);
    };
    // (テストの仮の環境には addEventListener が無いことがある)
    globalThis.addEventListener?.('error', (e) => {
      if (!ours(e.filename, e.error?.stack)) return;
      const where = e.filename ? ` (${e.filename.replace(ORIGIN, '')}:${e.lineno}:${e.colno})` : '';
      add('exception', [e.error instanceof Error ? e.error : String(e.message || 'error') + where]);
    });
    globalThis.addEventListener?.('unhandledrejection', (e) => {
      if (!ours(e.reason?.stack)) return;
      add('rejection', [e.reason]);
    });
    if (src === 'background') {
      chrome.runtime.onMessage.addListener((msg, sender) => {
        if (msg?.type === MSG_TYPE) receive(msg, sender);
        return false;
      });
    } else if (typeof document !== 'undefined') {
      // 閉じる・隠れるときに、たまっている分を送る
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
      globalThis.addEventListener('pagehide', flush);
    }
  }

  async function list() {
    const { [KEY]: v } = await chrome.storage.local.get(KEY);
    return Array.isArray(v) ? v : [];
  }

  function clear() {
    pending = [];
    return chrome.storage.local.remove(KEY);
  }

  // マルチビュー画面では読み込んだ時点で始める (拡張機能のページはインラインのスクリプトを書けないので、ここで呼ぶ)
  if (typeof document !== 'undefined' && globalThis.location?.href?.startsWith(ORIGIN + 'grid.html')) install('grid');

  /** fetch が通信の段階で失敗した (オフライン・回線が一時的に切れた・別のサイトに転送されて CORS で止まったなど) */
  const isNetworkError = (e) => e instanceof TypeError && /fetch|network/i.test(e.message);

  /**
   * 取得の失敗を知らせる。通信できなかっただけ (isNetworkError) のときは警告にしない
   * (次の確認でやり直すので不具合ではない。警告にすると chrome://extensions のエラーにも残る)
   */
  function warnFetch(msg, ...args) {
    const e = args[args.length - 1];
    if (isNetworkError(e)) console.info(msg, '(通信できなかったので、あとでやり直します)', ...args);
    else console.warn(msg, ...args);
  }

  return { install, list, clear, isNetworkError, warnFetch, KEY, MSG_TYPE };
})();
