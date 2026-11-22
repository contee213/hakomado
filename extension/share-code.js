// hakomado: 視聴セットのコード (#Hakomado …)・取り込み用リンク・1 行 1 本のテキストの読み書き
// 画面 (DOM) に触らない関数だけをここに置く (grid.js から切り出し。tests/ から読み込んで試せるように)。
// 読み込む順: grid.html で grid.js より前。background.js も importScripts で読む (右クリックのメニューで videoIdFromUrl を使う)。
// parseVideoLines は呼ばれたときに grid.js の resolveVideoId と favorites.js の Favorites を使う
/* exported SHARE_TAG, SHARE_CODE_RE, shareName, videoIdFromUrl, formatShareCode, parseShareCode, formatShareLink, parseShareLink, formatXPostUrl, parseWatchVideosLink, youtubePlaylistId, parseVideoLines, metaOn */
/* global resolveVideoId, Favorites */
'use strict';

// 動画 ID (11 文字)。grid.js の ID_RE と同じ形 (名前がぶつからないよう別の名前)
const SHARE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * YouTube の動画・配信の URL から動画 ID を取り出す (問い合わせはしない。チャンネルの URL などは null)。
 * watch?v=… / live/… / shorts/… / embed/… (www・m・music) と youtu.be/… を読む
 */
function videoIdFromUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return SHARE_ID_RE.test(id) ? id : null;
  }
  if (host !== 'youtube.com') return null;
  if (url.pathname === '/watch') {
    const v = url.searchParams.get('v');
    return v && SHARE_ID_RE.test(v) ? v : null;
  }
  return url.pathname.match(/^\/(?:live|shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] || null;
}

const SHARE_TAG = 'Hakomado';
const SHARE_NAME_MAX = 40; // 再生リストの名前と同じ
// 「~…」はアーカイブの同期のずれ (動画の並び順に「,」区切りの秒。「*」の付いた動画が同期の基準)、
// 続く「 "…"」は名前。以前の版はコードの直後で読むのをやめるので、ずれや名前が無視されるだけで読める
const SHARE_CODE_RE =
  /#?Hakomado\s+([a-z0-9-]{1,24})\.((?:[A-Za-z0-9_-]{11}){1,16})(?:~([-+*\d.,]{1,240}))?(?![A-Za-z0-9_-])(?: "([^"\r\n]{1,40})")?/i;

/** コードや画像に入れる名前 (「"」と改行は入れない) */
const shareName = (s) => String(s || '').replace(/["\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SHARE_NAME_MAX);

/**
 * 視聴セットのコードを作る。ids = 動画 (並び順)、offs = 動画ごとのずれ (秒)、refK = 同期の基準の番号、name = 名前。
 * ずれのある動画があるか、同期の基準が先頭以外のときだけ「~…」を付ける (先頭が基準なら印は省く)
 */
function formatShareCode(layoutId, ids, offs = [], refK = 0, name = '') {
  const tail = shareTail(ids, offs, refK);
  const n = shareName(name);
  return `#${SHARE_TAG} ${layoutId}.${ids.join('')}${tail ? `~${tail}` : ''}${n ? ` "${n}"` : ''}`;
}

/** 同期のずれ (コードの「~」の後ろ・リンクの hks=)。ずれのある動画があるか、基準が先頭以外のときだけ。無ければ '' */
function shareTail(ids, offs = [], refK = 0) {
  const o = ids.map((_, k) => offs[k] || 0);
  return o.some(Boolean) || refK > 0 ? o.map((v, k) => (k === refK && k > 0 ? '*' : '') + String(v)).join(',') : '';
}

/**
 * コードと同じ中身を取り込み用リンクの形にする (共有画像の QR 用)。スマホのカメラで読むと YouTube の一時的な
 * 再生リストとして開け、Hakomado ではコードと同じように (レイアウト・ずれごと) 読める:
 *   https://www.youtube.com/watch_videos?video_ids=ID,ID,…&hkl=<レイアウト>&hks=<ずれ>&title=<名前>&hakomado=
 * - title= は YouTube のリストの名前になる (無いと「Untitled List」)。Hakomado でも名前として読む
 *   (QR を小さくするため、名前は hakomado= には入れない。name が空なら title = fallback)。
 *   日本語などは %E3… にせずそのまま入れる (3 倍の長さになって QR が大きくなるため。開くときにブラウザが直す)。
 *   URL の区切りになる文字・空白だけ % にする。ascii = true なら名前を全部 % にする (X の本文に入れるとき。
 *   X は URL の途中の日本語でリンクを切るため。X は URL を長さに関係なく 23 文字に数えるので、長くなってもよい)
 * - hkl・hks・hakomado は YouTube には無視される。hakomado= は空でも付ける: 取り込みのルールの目印
 */
function formatShareLink(layoutId, ids, offs = [], refK = 0, name = '', fallback = '', ascii = false) {
  const tail = shareTail(ids, offs, refK);
  const title = shareName(name) || fallback;
  const pct = (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  const enc = ascii
    ? encodeURIComponent(title).replace(/[!'()*]/g, pct)
    : title.replace(/[\s%&#+'<>"]/g, pct);
  return `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}&hkl=${layoutId}${tail ? `&hks=${tail}` : ''}${title ? `&title=${enc}` : ''}&hakomado=`;
}

/**
 * X の投稿画面を開く URL (文章と URL を入れた状態で開く。画像は渡せない。投稿するかは利用者が決める)。
 * X は URL を長さに関係なく 23 文字に数える
 */
function formatXPostUrl(text, url) {
  const q = new URLSearchParams({ text });
  if (url) q.set('url', url);
  return `https://x.com/intent/post?${q}`;
}

// ---- 貼られたテキストの読み取り

/**
 * テキストの中の視聴セットのコード (#Hakomado …) を読む。無ければ null。
 * 同じ動画が 2 回あれば 1 回目だけ使う。offsets = 動画ごとの同期のずれ (コードに入っていなければ null)、
 * ref = 同期の基準にする動画の番号、name = 名前 (入っていなければ '')
 * @returns {{ids: string[], layoutId: string, offsets: number[]|null, ref: number, name: string}|null}
 */
function parseShareCode(text) {
  const code = text.match(SHARE_CODE_RE);
  if (!code) return null;
  return { ...shareIds(code[2].match(/.{11}/g), code[3]), layoutId: code[1], name: (code[4] || '').trim() };
}

/** 動画の並びとずれ (「,」区切り) を読む。同じ動画が 2 回あれば 1 回目だけ (ずれも 1 回目のもの) */
function shareIds(list, tailText) {
  const tail = tailText ? tailText.split(',') : null;
  const ids = [];
  const offsets = [];
  let ref = 0;
  list.forEach((id, k) => {
    if (ids.includes(id)) return;
    const t = tail?.[k] ?? '';
    if (t.startsWith('*')) ref = ids.length;
    ids.push(id);
    offsets.push(Number(t.replace('*', '')) || 0);
  });
  return { ids, offsets: tail ? offsets : null, ref };
}

const SHARE_LINK_RE = /https:\/\/(?:www\.|m\.)?youtube\.com\/watch_videos\?[^\s"'<>]+/i;

/**
 * テキストの中の、コードと同じ中身の取り込み用リンク (formatShareLink。hkl= の付いたもの) を読む。無ければ null。
 * 戻り値は parseShareCode と同じ形
 */
function parseShareLink(text) {
  const m = String(text).match(SHARE_LINK_RE);
  if (!m) return null;
  let url;
  try {
    url = new URL(m[0]);
  } catch {
    return null;
  }
  const p = url.searchParams;
  const layoutId = p.get('hkl') || '';
  const tail = p.get('hks');
  const list = (p.get('video_ids') || '').split(',');
  if (!/^[a-z0-9-]{1,24}$/i.test(layoutId) || (tail != null && !/^[-+*\d.,]{1,240}$/.test(tail))) return null;
  if (list.length > 16 || !list.every((id) => SHARE_ID_RE.test(id))) return null;
  return { ...shareIds(list, tail), layoutId, name: shareName(p.get('hakomado') || p.get('title')) };
}

/**
 * 取り込み用リンク (YouTube の https://www.youtube.com/watch_videos?video_ids=ID,ID,…&title=名前&hakomado=名前) を読む。
 * 名前は hakomado= が優先、空なら title= (YouTube のリストの名前)。
 * YouTube はこの URL を名前の無い一時的な再生リストとして開くので、Hakomado を入れていない人にもそのまま見られる
 * (hakomado= は YouTube には無視される)。違う URL なら null
 * @returns {{ids: string[], name: string}|null}
 */
function parseWatchVideosLink(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^((www|m)\.)?youtube\.com$/.test(url.hostname) || url.pathname !== '/watch_videos') return null;
  const ids = (url.searchParams.get('video_ids') || '').split(',').map((s) => s.trim()).filter((id) => SHARE_ID_RE.test(id));
  return { ids: [...new Set(ids)], name: (url.searchParams.get('hakomado') || url.searchParams.get('title') || '').trim() };
}


/** YouTube の再生リストの URL (https://www.youtube.com/playlist?list=…) なら、その ID。違えば null */
function youtubePlaylistId(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^((www|m|music)\.)?youtube\.com$/.test(url.hostname) || url.pathname !== '/playlist') return null;
  const id = url.searchParams.get('list') || '';
  return /^[\w-]{10,64}$/.test(id) ? id : null;
}


/**
 * 1 行に 1 本のテキストを読む (再生リストのテキスト形式。playlistText で書き出したものもそのまま読める)。
 *   # playlist=名前        … meta.playlist (再生リストの名前)
 *   # sync=on              … meta.sync (同期再生する)
 *   # layout=2x2           … meta.layout (レイアウト)
 *   https://www.youtube.com/watch?v=ID  ~*1.5  # 名前
 * - 各行の最初の語を URL / 動画 ID / @チャンネル名 として読む。続く「~秒」は同期のずれ (「~*秒」なら同期の基準)、
 *   行の後ろの「# …」はその配信の名前 (label)
 * - 取り込み用リンク・YouTube の再生リストの URL の行は、中の動画をすべて読む
 *   (リンクや再生リストの名前は meta.playlist に入れる。先に書いたものが優先)
 * - # で始まる行は説明。「# 名前=値」の形なら meta に入れる
 * 同じ動画は 1 回だけ。max 本読んだところでやめ、まだ残っていれば tooMany
 * @returns {Promise<{items: {videoId: string, label?: string, offset?: number}[], ref: string|null,
 *   hasOffsets: boolean, meta: Record<string, string>, bad: number, tooMany: boolean}>}
 */
async function parseVideoLines(text, max, onProgress) {
  const meta = {};
  const setMeta = (k, v) => {
    if (v && !(k in meta)) meta[k] = v;
  };
  const tokens = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith('#')) {
      const m = s.match(/^#\s*(\w+)\s*=\s*(.+)$/);
      if (m) setMeta(m[1].toLowerCase(), m[2].trim());
      continue;
    }
    const t = s.split(/\s+/)[0];
    const link = parseWatchVideosLink(t);
    if (link) {
      tokens.push(...link.ids.map((id) => ({ t: id, label: '', offset: null, ref: false })));
      setMeta('playlist', link.name);
      continue;
    }
    const listId = youtubePlaylistId(t);
    if (listId) {
      try {
        const yl = await Favorites.fetchYouTubePlaylist(listId);
        if (!yl.ids.length) throw new Error('empty');
        tokens.push(...yl.ids.map((id) => ({ t: id, label: '', offset: null, ref: false })));
        setMeta('playlist', yl.name);
      } catch {
        tokens.push({ t, label: '', offset: null, ref: false }); // 読めなかった行として数える
      }
      continue;
    }
    let rest = s.slice(t.length);
    const off = rest.match(/^\s+~(\*?)([-+]?\d+(?:\.\d+)?)?(?=\s|$)/);
    if (off) rest = rest.slice(off[0].length);
    const label = (rest.match(/^\s+#\s*(.*)$/)?.[1] || '').replace(/\s+/g, ' ').trim();
    tokens.push({ t, label, offset: off ? Number(off[2]) || 0 : null, ref: !!off?.[1] });
  }
  const items = [];
  let ref = null;
  let hasOffsets = false;
  let bad = 0;
  let k = 0;
  for (; k < tokens.length && items.length < max; k++) {
    onProgress?.(k + 1, tokens.length);
    try {
      const id = await resolveVideoId(tokens[k].t);
      const { label, offset } = tokens[k];
      if (items.some((h) => h.videoId === id)) continue;
      const h = { videoId: id };
      if (label) h.label = label;
      if (offset != null) {
        hasOffsets = true;
        h.offset = offset;
      }
      if (tokens[k].ref && !ref) ref = id;
      items.push(h);
    } catch {
      bad++;
    }
  }
  return { items, ref, hasOffsets, meta, bad, tooMany: k < tokens.length };
}

/** 「# sync=…」の値が ON か */
const metaOn = (v) => /^(on|1|true|yes)$/i.test(String(v ?? '').trim());
