// Worker の中身のうち、D1 や fetch に触らない部分 (tests/web.test.js から試せるように分けてある)
import { getLayout, LAYOUTS, layoutIdOf, formatShareCode, formatShareLink, parseShareCode, parseShareLink, shareName, videoIdFromUrl } from './gen/ext.mjs';

export const AUTHOR_MAX = 30;
export const TEXT_MAX = 2000; // 貼られたテキストの上限 (コード・リンクは長くても 1000 文字ほど)

/**
 * 貼られたテキスト (コード #Hakomado … か取り込み用リンク) を読む。
 * movie = 「🎬 本編」モードの本編の位置 (動画ごとの秒か null。本編モードでなければ null。そのとき offsets は null)、
 * main = 本編モードで、使う人が「本編にした」動画の番号 (無ければ null)
 * @returns {{ok: true, set: {layoutId: string, ids: string[], offsets: number[]|null, ref: number, name: string, movie: (number|null)[]|null, main: number|null}} | {ok: false, error: string}}
 */
export function parseSubmission(text) {
  const s = String(text ?? '').slice(0, TEXT_MAX);
  const got = parseShareCode(s) || parseShareLink(s);
  if (!got || !got.ids.length) return { ok: false, error: 'not_found' };
  // 知らないレイアウトは受け付けない (拡張機能は既定のレイアウトに置き換えて読むが、一覧の形が描けないため)。
  // 今は無いレイアウト (外した形) は、拡張機能と同じ置き換え先にする
  const layoutId = layoutIdOf(got.layoutId);
  if (!layoutId) return { ok: false, error: 'bad_layout' };
  const ref = Math.min(Math.max(0, got.ref | 0), got.ids.length - 1);
  const movie = got.movie || null;
  const main = movie && Number.isInteger(got.main) && got.main >= 0 && got.main < got.ids.length ? got.main : null;
  return { ok: true, set: { layoutId, ids: got.ids, offsets: got.offsets, ref, name: shareName(got.name), movie, main } };
}

export const MAX_VIDEOS = 16; // コードに入る本数 (拡張機能の共有と同じ)
const OFFSET_MAX = 86400; // 同期のずれ (秒) の上限

/** 本数に合う均等のレイアウト (layoutId を指定されなかったとき)。枠数が同じならおすすめ (1×2 と 2×1 なら 1×2) */
export function chooseLayout(n) {
  const uniform = LAYOUTS.filter((l) => l.group === 'uniform').sort(
    (a, b) => a.slots.length - b.slots.length || Number(b.recommended) - Number(a.recommended),
  );
  return (uniform.find((l) => l.slots.length >= n) || uniform[uniform.length - 1]).id;
}

/** レイアウトの一覧 (API・MCP で選べるように) */
export const layoutList = () =>
  LAYOUTS.map((l) => ({ id: l.id, name: l.name, kind: l.kind, slots: l.slots.length, mains: l.mains }));

/**
 * 投稿の中身を読む。text (コード・リンク) か、videos (動画の URL か ID の並び) + layoutId・name・offsets・ref のどちらか。
 * videos の形は一度コードにしてから parseSubmission で読み直す (どちらから来ても同じ確かめ方になるように)
 */
export function buildSubmission(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'bad_request' };
  if (typeof input.text === 'string') return parseSubmission(input.text);
  if (!Array.isArray(input.videos)) return { ok: false, error: 'bad_request' };
  const ids = [];
  for (const v of input.videos) {
    const s = String(v ?? '').trim();
    const id = /^[A-Za-z0-9_-]{11}$/.test(s) ? s : videoIdFromUrl(s);
    if (!id) return { ok: false, error: 'bad_video' };
    if (!ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return { ok: false, error: 'not_found' };
  if (ids.length > MAX_VIDEOS) return { ok: false, error: 'too_many_videos' };
  let offsets = [];
  if (input.offsets != null) {
    if (!Array.isArray(input.offsets) || input.offsets.length !== ids.length) return { ok: false, error: 'bad_offsets' };
    offsets = input.offsets.map(Number);
    if (!offsets.every((o) => Number.isFinite(o) && Math.abs(o) <= OFFSET_MAX)) return { ok: false, error: 'bad_offsets' };
    offsets = offsets.map((o) => Math.round(o * 10) / 10); // コードには小数 1 桁まで
  }
  const ref = input.ref == null ? 0 : Number(input.ref);
  if (!Number.isInteger(ref) || ref < 0 || ref >= ids.length) return { ok: false, error: 'bad_offsets' };
  const layoutId = input.layoutId == null || input.layoutId === '' ? chooseLayout(ids.length) : String(input.layoutId);
  if (!/^[a-z0-9-]{1,24}$/i.test(layoutId)) return { ok: false, error: 'bad_layout' };
  return parseSubmission(formatShareCode(layoutId, ids, offsets, ref, shareName(input.name)));
}

/** 同じセットかどうかを見るための形 (名前は入れない: 名前だけ違うものは同じセットとして 1 件にまとめる) */
export const canonical = (set) => formatShareCode(set.layoutId, set.ids, set.offsets || [], set.ref, '', set.movie || null, set.main ?? -1);

/**
 * D1 の canon (UNIQUE) に入れる値。公開のものは名前を除いて 1 件にまとめる。
 * 限定公開は名前も含めて、限定公開どうしでだけまとめる (付けた名前のままのリンクになるように。
 * 公開のものとは混ぜないので、限定公開のつもりで作ったものが一覧に出ることも無い)
 */
export const canonKey = (set, listed) =>
  listed ? canonical(set) : `u:${formatShareCode(set.layoutId, set.ids, set.offsets || [], set.ref, set.name || '', set.movie || null, set.main ?? -1)}`;

/**
 * D1 の offsets 列に入れる値。同期のずれは配列、「🎬 本編」モードの本編の位置は {movie: [...]} (列を増やさずに入れる。
 * 「本編にした」動画があれば {movie: [...], main: 番号})。どちらも無ければ null
 */
export const offsetsColumn = (set) =>
  set.movie
    ? JSON.stringify(set.main != null ? { movie: set.movie, main: set.main } : { movie: set.movie })
    : set.offsets
      ? JSON.stringify(set.offsets)
      : null;

export const TAGS_MAX = 5;
export const TAG_LEN = 20;

/**
 * タグを読む。配列か、空白・カンマで区切った文字列。頭の # は取り、英字は小文字にする。
 * @returns {{ok: true, tags: string[]} | {ok: false, error: 'bad_tags'}}
 */
export function cleanTags(input) {
  if (input == null || input === '') return { ok: true, tags: [] };
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? [input] : null;
  if (!parts) return { ok: false, error: 'bad_tags' };
  const tags = [];
  for (const p of parts) {
    for (const raw of String(p ?? '').normalize('NFKC').split(/[\s,、#]+/)) {
      const t = raw.replace(/[\u0000-\u001f\u007f<>"'`]/g, '').toLowerCase();
      if (!t) continue;
      if ([...t].length > TAG_LEN) return { ok: false, error: 'bad_tags' };
      if (!tags.includes(t)) tags.push(t);
    }
  }
  if (tags.length > TAGS_MAX) return { ok: false, error: 'bad_tags' };
  return { ok: true, tags };
}

/** 検索用の文字列 (名前・投稿者・タグ・動画のタイトル・チャンネル名) */
export const searchText = ({ name, author, tags, videos }) =>
  [name, author, ...(tags || []), ...(videos || []).flatMap((v) => [v.title, v.channel])]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLowerCase();

/** 検索の語 (空白で区切る。5 語まで、1 語 40 文字まで)。LIKE ? ESCAPE '\' に使えるよう % _ \ を逃がした形 */
export function searchTerms(q) {
  return String(q ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((t) => `%${t.slice(0, 40).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

/** 投稿者の名前 (任意)。改行・前後の空白を除いて短く */
export const cleanAuthor = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AUTHOR_MAX);

const ALNUM = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見分けにくい文字 (0 O 1 l I o) は使わない

/** ランダムな文字列 (セットの ID・削除用の合言葉) */
export function randomToken(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALNUM[b % ALNUM.length]).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 長さが同じ 16 進の文字列を、かかる時間が中身によらないように比べる */
export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** D1 の行を画面に渡す形にする (削除用の合言葉のハッシュ・通報の数は出さない) */
export function rowToSet(row) {
  const ids = JSON.parse(row.ids);
  const col = row.offsets ? JSON.parse(row.offsets) : null;
  const movie = col && !Array.isArray(col) && Array.isArray(col.movie) ? col.movie : null;
  const offsets = Array.isArray(col) ? col : null;
  const main = movie && Number.isInteger(col.main) && col.main >= 0 && col.main < ids.length ? col.main : null;
  return {
    id: row.id,
    layoutId: row.layout,
    layoutName: getLayout(row.layout).name,
    ids,
    offsets,
    movie, // 「🎬 本編」モードの本編の位置 (動画ごとの秒か null)。本編モードでなければ null
    main, // 本編モードで「本編にした」動画の番号 (無ければ null)
    ref: row.ref,
    name: row.name,
    author: row.author,
    videos: JSON.parse(row.videos),
    opens: row.opens,
    listed: row.listed !== 0, // false = リンクを知っている人だけ (限定公開)
    tags: row.tags ? JSON.parse(row.tags) : [],
    dead: row.dead || 0, // 見直しで見つからなかった動画の数 (videos の該当するものに gone: true)
    source: row.source || 'web', // web = 投稿フォーム / api = トークンを使った API・MCP
    createdAt: row.created_at,
    code: formatShareCode(row.layout, ids, offsets || [], row.ref, row.name, movie, main ?? -1),
    link: formatShareLink(row.layout, ids, offsets || [], row.ref, row.name, 'Hakomado', false, movie, main ?? -1),
  };
}
