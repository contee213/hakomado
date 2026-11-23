// どの画面でも使うもの: API の呼び出し、レイアウトの形にサムネイルを並べた絵、文言
// 先に js/i18n.js と js/ext/ (拡張機能の layouts-generated.js・layouts.js・share-code.js) を読み込んでおく
/* global LAYOUTS, layoutIdOf, solveTracks, t, LANG, FEAT */
/* exported api, layoutPreview, setCard, tagLinks, errorText, el, savedKeys, saveKey, forgetKey, copyText, timeAgo */
'use strict';

/** API の error をその言語の文にする (知らないものはサーバーの問題として) */
const errorText = (code) => (t(`err_${code}`) === `err_${code}` ? t('err_server') : t(`err_${code}`));

/** API を呼ぶ。失敗したら Error (message = エラーの種類) を投げる */
async function api(path, body) {
  let r;
  try {
    r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('network');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'server');
  return data;
}

/** 要素を作る (文字は textContent で入れる) */
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

/** レイアウトの形に、各枠の動画のサムネイルを並べた絵 (拡張機能のレイアウトの定義をそのまま使う) */
function layoutPreview(layoutId, ids, { big = false } = {}) {
  const id = layoutIdOf(layoutId); // 今は無いレイアウトは置き換え先で描く
  const l = LAYOUTS.find((x) => x.id === id);
  const box = el('div', { class: 'layout', role: 'img', 'aria-label': t('count', ids.length) });
  if (!l) return box;
  const { colW, rowH, aspect } = solveTracks(l);
  const sum = (a, n) => a.slice(0, n).reduce((s, v) => s + v, 0);
  const W = sum(colW, colW.length);
  const H = sum(rowH, rowH.length);
  box.style.aspectRatio = String(aspect);
  l.slots.forEach(([x, y, w, h], k) => {
    const cell = el('div', { class: 'cell' });
    cell.style.left = `${(sum(colW, x) / W) * 100}%`;
    cell.style.top = `${(sum(rowH, y) / H) * 100}%`;
    cell.style.width = `${((sum(colW, x + w) - sum(colW, x)) / W) * 100}%`;
    cell.style.height = `${((sum(rowH, y + h) - sum(rowH, y)) / H) * 100}%`;
    const id = ids[k];
    if (id) {
      const img = el('img', { src: `https://i.ytimg.com/vi/${id}/${big ? 'hqdefault' : 'mqdefault'}.jpg`, alt: '', loading: 'lazy', decoding: 'async' });
      cell.append(img);
    } else {
      cell.classList.add('empty');
    }
    box.append(cell);
  });
  return box;
}

/** タグのリンク (一覧をそのタグで絞り込む)。機能フラグ tags がオフなら空 */
function tagLinks(tags) {
  if (!FEAT.tags) return [];
  return (tags || []).map((tag) => el('a', { class: 'tag', href: `/?tag=${encodeURIComponent(tag)}`, text: `#${tag}` }));
}

/** 一覧のカード */
function setCard(set) {
  const title = set.name || set.videos[0]?.title || t('unnamed');
  const meta = [t('count', set.ids.length), set.layoutName, set.author].filter(Boolean).join(' · ');
  const tags = FEAT.tags && set.tags?.length ? el('p', { class: 'card-tags', text: set.tags.map((x) => `#${x}`).join(' ') }) : null;
  const gone = set.dead ? el('p', { class: 'card-warn', text: t('goneBadge', set.dead) }) : null;
  return el(
    'a',
    { class: 'card', href: `/s/${set.id}` },
    layoutPreview(set.layoutId, set.ids),
    el('div', { class: 'card-body' }, el('h3', { class: 'card-title', text: title }), el('p', { class: 'card-meta', text: meta }), tags, gone),
  );
}

/** 何分前・何日前 */
function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const en = LANG === 'en';
  if (s < 60) return en ? 'just now' : 'たった今';
  if (s < 3600) return en ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 60)} 分前`;
  if (s < 86400) return en ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 3600)} 時間前`;
  if (s < 86400 * 30) return en ? `${Math.floor(s / 86400)} d ago` : `${Math.floor(s / 86400)} 日前`;
  return new Date(ms).toLocaleDateString(en ? 'en-US' : 'ja-JP');
}

// 投稿したセットの削除用の合言葉 (この端末のブラウザにだけ置く)
const KEYS = 'hakomado-feed:keys';
function savedKeys() {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function saveKey(id, key) {
  try {
    localStorage.setItem(KEYS, JSON.stringify({ ...savedKeys(), [id]: key }));
  } catch {
    // 保存できなくても、画面に出した合言葉で消せる
  }
}
function forgetKey(id) {
  try {
    const keys = savedKeys();
    delete keys[id];
    localStorage.setItem(KEYS, JSON.stringify(keys));
  } catch {
    // 何もしない
  }
}

/** クリップボードへ。できたら true */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
