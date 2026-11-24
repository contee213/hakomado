// hakomado: Twitch の公式の埋め込みチャット欄 (www.twitch.tv/embed/<チャンネル>/chat) を Hakomado の枠に入れたとき、
// 新しく出たコメントを読み取り、親 (マルチビュー画面) に渡す (弾幕用。YouTube の content/chat.js と同じ形 {hakomado: 'chat', messages})。
// 親は、それを Twitch のプレイヤーの中 (content/twitch-player.js) に回して弾幕にする。
// - twitch.tv の任意の権限を許可したときだけ、background.js が登録する。マルチビュー画面の枠に直接入ったときだけ動く
// - 読むのは画面に出たコメントの文字・絵文字 (エモート) の画像・投稿者の名前だけ。どこにも送らない
(() => {
  'use strict';

  const PARENT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  const anc = location.ancestorOrigins;
  if (window.top === window || !anc || anc.length !== 1 || anc[0] !== PARENT_ORIGIN) return;
  if (!/^\/embed\/[^/]+\/chat\/?$/.test(location.pathname)) return;
  ErrLog.install('twitch');

  const channel = location.pathname.split('/')[2].toLowerCase();
  // 投稿者の種類 (弾幕の色分け)。バッジの画像の ID で見分ける (名前は表示言語で変わるため)
  const BADGE_MOD = '/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/';
  const BADGE_BROADCASTER = '/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/';
  // 開いた直後に表示される過去のコメントは流さない
  const WARMUP_MS = 2500;
  const startedAt = performance.now();
  let pending = [];
  let flushTimer = 0;
  let ready = false;

  /** コメントの本文を、文字と絵文字の画像の並びにする */
  function segmentsOf(body) {
    const segs = [];
    if (!body) return segs;
    const parts = body.querySelectorAll('.text-fragment, .mention-fragment, a, img.chat-line__message--emote');
    let last = null;
    for (const el of parts) {
      if (last && last.contains(el)) continue; // 入れ子の分は 2 回読まない
      last = el;
      if (el.tagName === 'IMG') {
        // チャット欄用の小さい画像 (1.0) を、大きいもの (2.0) にする
        const src = (el.getAttribute('src') || '').replace(/#.*$/, '').replace(/\/1\.0$/, '/2.0');
        if (src) segs.push({ img: src, alt: el.getAttribute('alt') || '', stamp: true });
      } else if (el.textContent) {
        segs.push({ text: el.textContent });
      }
    }
    return segs;
  }

  function parse(line) {
    const segments = segmentsOf(line.querySelector('[data-a-target="chat-line-message-body"]'));
    if (!segments.length) return null;
    const author = line.querySelector('.chat-author__display-name')?.textContent?.trim() || '';
    const badges = [...line.querySelectorAll('img.chat-badge')].map((b) => b.getAttribute('src') || '');
    const user = (line.getAttribute('data-a-user') || '').toLowerCase();
    let authorType = '';
    if (user === channel || badges.some((s) => s.includes(BADGE_BROADCASTER))) authorType = 'owner';
    else if (badges.some((s) => s.includes(BADGE_MOD))) authorType = 'moderator';
    return { segments, author, authorType, paid: null };
  }

  function queue(msg) {
    pending.push(msg);
    if (flushTimer) return;
    // 少しまとめて送る
    flushTimer = setTimeout(() => {
      flushTimer = 0;
      const messages = pending.slice(-50);
      pending = [];
      if (messages.length) window.parent.postMessage({ hakomado: 'chat', messages }, PARENT_ORIGIN);
    }, 50);
  }

  const observer = new MutationObserver((records) => {
    if (!ready && document.querySelector('.chat-line__message, [data-a-target="chat-scroller"]')) {
      ready = true;
      // チャット欄が見つかったことを親に知らせる (Twitch の作りが変わって見つからなくなったことに気づけるように)
      window.parent.postMessage({ hakomado: 'chatReady' }, PARENT_ORIGIN);
    }
    if (performance.now() - startedAt < WARMUP_MS) return;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const lines = node.matches('.chat-line__message') ? [node] : node.querySelectorAll('.chat-line__message');
        for (const line of lines) {
          const msg = parse(line);
          if (msg) queue(msg);
        }
      }
    }
  });
  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
