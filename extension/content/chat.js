// hakomado: マルチビュー画面に埋め込まれたライブチャットから新着コメントを読み取り、
// 親 (拡張機能のページ) に postMessage で渡す。
// 普通に YouTube でチャットを開いたときは何もしない。
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (window.top === window || params.get('hakomado') !== '1') return;

  const PARENT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;

  // ---- 見た目 (投稿者アイコン): 狭い枠でもチャット欄を読みやすくする
  // (文字サイズは親画面が iframe ごと縮小する。ここで縮小すると YouTube のメニューの位置計算がずれて出なくなる)
  const lookStyle = document.createElement('style');
  document.documentElement.appendChild(lookStyle);

  function applyLook({ hideAvatars }) {
    let css = '';
    if (hideAvatars) {
      css += `
        yt-live-chat-text-message-renderer #author-photo,
        yt-live-chat-paid-message-renderer #author-photo,
        yt-live-chat-membership-item-renderer #author-photo { display: none !important; }`;
    }
    lookStyle.textContent = css;
  }

  applyLook({ hideAvatars: params.get('hakomado_noav') === '1' });
  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    if (e.data?.hakomado === 'chatLook') applyLook(e.data);
    else if (e.data?.hakomado === 'progress' && Number.isFinite(e.data.t)) {
      // アーカイブのチャットのリプレイ: 枠の再生位置を、YouTube の視聴ページが送るのと同じ形で、このページ自身に送る
      // (リプレイは YouTube 以外のページから来た知らせを受け付けないので、こちらで中継する)
      const id = typeof e.data.id === 'string' && /^[\w-]{11}$/.test(e.data.id) ? e.data.id : '';
      window.postMessage({ 'yt-player-video-progress': e.data.t, 'yt-player-video-id': id }, location.origin);
    }
  });
  const MESSAGE_TAGS = new Set(['YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER', 'YT-LIVE-CHAT-PAID-MESSAGE-RENDERER']);
  // 開いた直後に表示される過去ログは流さない
  const WARMUP_MS = 2500;

  let itemsEl = null;
  let observer = null;
  let attachedAt = 0;
  let pending = [];
  let flushScheduled = false;

  function segmentsOf(messageEl) {
    const segs = [];
    if (!messageEl) return segs;
    for (const node of messageEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) segs.push({ text: node.textContent });
      } else if (node.nodeName === 'IMG') {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        const tip = node.getAttribute('shared-tooltip-text') || (alt ? `:${alt}:` : '');
        if (/\/notoemoji\//.test(src) || (!src && alt && !/^[\w-]+$/.test(alt))) {
          // 普通の絵文字: alt に絵文字そのもの (😭 など) が入っているので文字として流す
          segs.push({ text: alt });
        } else if (src) {
          // メンバースタンプ・チャンネル独自の絵文字: alt は "chillwdog" のような名前なので画像で流す。
          // チャット欄用の 24px 画像なので、大きいサイズを取り直す
          segs.push({ img: src.replace(/=w\d+-h\d+/, '=w96-h96'), alt: tip, stamp: true });
        } else if (tip) {
          segs.push({ text: tip });
        }
      } else if (node.textContent) {
        segs.push({ text: node.textContent });
      }
    }
    return segs;
  }

  function parse(el) {
    const segments = segmentsOf(el.querySelector('#message'));
    const author = el.querySelector('#author-name')?.textContent?.trim() || '';
    const authorType = el.getAttribute('author-type') || '';
    let paid = null;
    if (el.tagName === 'YT-LIVE-CHAT-PAID-MESSAGE-RENDERER') {
      const amount = el.querySelector('#purchase-amount')?.textContent?.trim() || '';
      const color = getComputedStyle(el).getPropertyValue('--yt-live-chat-paid-message-primary-color').trim();
      paid = { amount, color };
      if (segments.length === 0) segments.push({ text: '' });
    }
    if (segments.length === 0) return null;
    return { segments, author, authorType, paid };
  }

  function queue(msg) {
    pending.push(msg);
    if (flushScheduled) return;
    flushScheduled = true;
    // 1 フレームにまとめて送る
    setTimeout(() => {
      flushScheduled = false;
      const messages = pending;
      pending = [];
      if (messages.length) window.parent.postMessage({ hakomado: 'chat', messages }, PARENT_ORIGIN);
    }, 50);
  }

  function onMutations(records) {
    if (performance.now() - attachedAt < WARMUP_MS) return;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || !MESSAGE_TAGS.has(node.tagName)) continue;
        // 描画直後は中身が空のことがあるので次のタスクで読む
        setTimeout(() => {
          const msg = parse(node);
          if (msg) queue(msg);
        }, 0);
      }
    }
  }

  function attach() {
    const el = document.querySelector('yt-live-chat-item-list-renderer #items');
    if (!el || el === itemsEl) return;
    observer?.disconnect();
    // 初めてチャット欄を見つけたら親に知らせる (YouTube の作りが変わって見つからなくなったことに気づけるように)
    if (!itemsEl) window.parent.postMessage({ hakomado: 'chatReady' }, PARENT_ORIGIN);
    itemsEl = el;
    attachedAt = performance.now();
    observer = new MutationObserver(onMutations);
    observer.observe(el, { childList: true });
  }

  // チャット欄は「上位のチャット / すべてのチャット」の切り替え等で作り直されるので定期的に付け直す
  attach();
  setInterval(() => {
    if (!itemsEl || !itemsEl.isConnected) attach();
  }, 1500);
})();
