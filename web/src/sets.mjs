// セットの読み書き (D1)。REST の API (worker.mjs) と MCP (mcp.mjs) の両方から使う。
// 失敗は ApiError (code = エラーの種類、status = HTTP の状態) で投げる
import { buildSubmission, canonKey, cleanAuthor, cleanTags, searchText, searchTerms, randomToken, sha256Hex, sameHex, rowToSet } from './core.mjs';

export const PAGE = 24; // 一覧の 1 回分
const MAX_PAGE = 50; // これより先は出さない (深いページのたびに大きく読まないように)
const POSTS_PER_HOUR = 10; // 同じ接続元からの投稿の上限 (トークンを使った投稿には掛けない)
const HIDE_REPORTS = 3; // 通報がこれだけ集まったら一覧・ページから隠す
export const DAY = 24 * 60 * 60 * 1000;
export const SET_ID_RE = /^[A-Za-z0-9]{8}$/;

export class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
}

/**
 * 一覧 (公開のものだけ。限定公開・隠したもの・動画が全部消えたものは出さない)。
 * tag = タグで絞り込む (機能フラグ tags)、q = 検索の語 (機能フラグ search)。オフの機能の指定は無視する
 */
export async function listSets(env, { sort, page, tag, q } = {}, feats = {}) {
  const popular = sort === 'popular';
  const p = Math.min(MAX_PAGE, Math.max(0, Number.parseInt(page ?? 0, 10) || 0));
  const order = popular ? 'opens DESC, created_at DESC' : 'created_at DESC';
  const where = ['hidden = 0', 'listed = 1', 'dead < json_array_length(ids)'];
  const args = [];
  const t = feats.tags && tag ? cleanTags(String(tag)) : null;
  if (t && (!t.ok || t.tags.length !== 1)) return { sets: [], more: false };
  if (t) {
    where.push('id IN (SELECT set_id FROM set_tags WHERE tag = ?)');
    args.push(t.tags[0]);
  }
  if (feats.search) {
    for (const term of searchTerms(q)) {
      where.push("search LIKE ? ESCAPE '\\'");
      args.push(term);
    }
  }
  const { results } = await env.DB.prepare(`SELECT * FROM sets WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...args, PAGE + 1, p * PAGE)
    .all();
  return { sets: results.slice(0, PAGE).map(rowToSet), more: results.length > PAGE && p < MAX_PAGE };
}

/** よく使われているタグ (公開のセットの分。多い順に 30 個) */
export async function listTags(env) {
  const { results } = await env.DB.prepare(
    `SELECT t.tag AS tag, COUNT(*) AS n FROM set_tags t JOIN sets s ON s.id = t.set_id
     WHERE s.hidden = 0 AND s.listed = 1 GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 30`,
  ).all();
  return { tags: results.map((r) => ({ tag: r.tag, count: r.n })) };
}

const getRow = (env, id) =>
  SET_ID_RE.test(String(id)) ? env.DB.prepare('SELECT * FROM sets WHERE id = ? AND hidden = 0').bind(id).first() : null;

/** 隠していないセット。無ければ null */
export async function getSet(env, id) {
  const row = await getRow(env, id);
  return row ? rowToSet(row) : null;
}

/**
 * 動画があるかを YouTube の oEmbed で確かめ、タイトルとチャンネル名を取る。
 * 見つからない (404・400) 動画があれば null。埋め込みが禁止 (401・403) や YouTube の不調は、あるものとして名前を空にする
 */
async function fetchVideos(ids) {
  const list = await Promise.all(ids.map(oembed));
  if (list.some((v) => v === null)) return null;
  return list.map((v) => v || { title: '', channel: '' });
}

/** 動画 1 本の oEmbed。見つからない (404・400) なら null、確かめられない (YouTube の不調など) なら false */
async function oembed(id) {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'HakomadoSets/1.0' } });
    if (r.status === 404 || r.status === 400) return null;
    if (r.status === 401 || r.status === 403) return { title: '', channel: '' }; // 埋め込みの禁止など。あるものとする
    if (!r.ok) return false;
    const d = await r.json();
    return { title: String(d.title || '').slice(0, 200), channel: String(d.author_name || '').slice(0, 100) };
  } catch {
    return false;
  }
}

const CHECK_EVERY = 7 * DAY; // 同じセットを見直す間隔

/**
 * 消えた動画の見直し (Cron。機能フラグ videoCheck)。長く見直していないセットから、動画 budget 本分まで oEmbed で確かめ、
 * 見つからない動画に gone: true を付けて、その数を dead に入れる (戻ってきた動画は外す)。
 * 確かめられなかった動画 (YouTube の不調) があるセットは、時刻を進めずに次に回す
 * @returns {Promise<{sets: number, videos: number, dead: number}>}
 */
export async function checkVideos(env, { budget = 40 } = {}) {
  const now = Date.now();
  const { results } = await env.DB.prepare('SELECT id, ids, videos FROM sets WHERE hidden = 0 AND checked_at < ? ORDER BY checked_at LIMIT 20')
    .bind(now - CHECK_EVERY)
    .all();
  const out = { sets: 0, videos: 0, dead: 0 };
  const updates = [];
  for (const row of results) {
    const ids = JSON.parse(row.ids);
    if (out.videos + ids.length > budget && out.sets > 0) break;
    out.videos += ids.length;
    const got = await Promise.all(ids.map(oembed));
    if (got.some((v) => v === false)) continue;
    const videos = JSON.parse(row.videos).map((v, k) => {
      const { gone, ...rest } = v || {};
      return got[k] === null ? { ...rest, gone: true } : rest;
    });
    const dead = got.filter((v) => v === null).length;
    out.sets++;
    out.dead += dead;
    updates.push(env.DB.prepare('UPDATE sets SET videos = ?, dead = ?, checked_at = ? WHERE id = ?').bind(JSON.stringify(videos), dead, now, row.id));
  }
  if (updates.length) await env.DB.batch(updates);
  return out;
}

/**
 * セットを投稿する。input = { text } か { videos, layoutId, name, offsets, ref } と author・tags・unlisted。
 * who = 接続元のハッシュ (回数を制限する)。null ならトークンを使った投稿 (制限しない)。
 * source = web (投稿フォーム) / api (トークン) / ext (拡張機能の短縮リンク。いつも限定公開)。
 * feats = 機能フラグ (オフの機能の指定は無視する: unlisted がオフならいつも公開、tags がオフならタグなし)
 * @returns {Promise<{id: string, deleteKey?: string, existed?: boolean, listed: boolean}>}
 */
export async function createSet(env, input, { who, source = who ? 'web' : 'api', feats = {} }) {
  const parsed = buildSubmission(input);
  if (!parsed.ok) throw new ApiError(parsed.error);
  const tagsIn = feats.tags ? cleanTags(input.tags) : { ok: true, tags: [] };
  if (!tagsIn.ok) throw new ApiError(tagsIn.error);
  const tags = tagsIn.tags;
  const listed = !(feats.unlisted && (source === 'ext' || input.unlisted === true));
  const now = Date.now();

  // 同じセットがもうあれば、それを返す (公開は名前を除いて同じもの、限定公開は名前も同じ限定公開のもの。core.mjs の canonKey)。
  // 新しく作らないので回数には数えない
  const set = parsed.set;
  const canon = canonKey(set, listed);
  const existing = await env.DB.prepare('SELECT id, hidden FROM sets WHERE canon = ?').bind(canon).first();
  if (existing) {
    if (existing.hidden) throw new ApiError('hidden', 409);
    return { id: existing.id, existed: true, listed };
  }
  if (who) {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM post_log WHERE who = ? AND at > ?').bind(who, now - DAY / 24).first();
    if (recent.n >= POSTS_PER_HOUR) throw new ApiError('too_many', 429);
  }

  const videos = await fetchVideos(set.ids);
  if (!videos) throw new ApiError('missing_video');
  const author = cleanAuthor(input.author);

  const id = randomToken(8);
  const deleteKey = randomToken(16);
  const statements = [
    env.DB.prepare(
      `INSERT INTO sets (id, canon, layout, ids, offsets, ref, name, author, videos, delete_hash, created_at, source, listed, tags, search)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      canon,
      set.layoutId,
      JSON.stringify(set.ids),
      set.offsets ? JSON.stringify(set.offsets) : null,
      set.ref,
      set.name,
      author,
      JSON.stringify(videos),
      await sha256Hex(deleteKey),
      now,
      source,
      listed ? 1 : 0,
      JSON.stringify(tags),
      searchText({ name: set.name, author, tags, videos }),
    ),
    ...tags.map((t) => env.DB.prepare('INSERT INTO set_tags (tag, set_id) VALUES (?, ?)').bind(t, id)),
    // 古い記録は投稿のついでに消す (どれも 1 日あれば足りる)
    env.DB.prepare('DELETE FROM post_log WHERE at < ?').bind(now - DAY),
    env.DB.prepare('DELETE FROM open_log WHERE day < ?').bind(Math.floor(now / DAY) - 1),
  ];
  if (who) statements.push(env.DB.prepare('INSERT INTO post_log (who, at) VALUES (?, ?)').bind(who, now));
  try {
    await env.DB.batch(statements);
  } catch (e) {
    // 同じセットがほぼ同時に投稿された (canon の UNIQUE) なら、先に入ったほうを返す
    const won = await env.DB.prepare('SELECT id FROM sets WHERE canon = ? AND hidden = 0').bind(canon).first();
    if (won) return { id: won.id, existed: true, listed };
    throw e;
  }
  return { id, deleteKey, listed };
}

/** 削除。key = 削除用の合言葉。admin (トークンを使った API・MCP) なら合言葉なしで消せる */
export async function deleteSet(env, id, { key, admin = false }) {
  if (!SET_ID_RE.test(String(id))) throw new ApiError('not_found', 404);
  const row = await env.DB.prepare('SELECT delete_hash FROM sets WHERE id = ?').bind(id).first();
  if (!row) throw new ApiError('not_found', 404);
  if (!admin && (typeof key !== 'string' || !sameHex(await sha256Hex(key), row.delete_hash))) throw new ApiError('bad_key', 403);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sets WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM open_log WHERE set_id = ?').bind(id),
    env.DB.prepare('DELETE FROM report_log WHERE set_id = ?').bind(id),
    env.DB.prepare('DELETE FROM set_tags WHERE set_id = ?').bind(id),
  ]);
}

/** 「Hakomado で開く」を押した回数 (人気順に使う)。同じ接続元からは 1 日 1 回だけ数える */
export async function countOpen(env, id, who) {
  if (!(await getRow(env, id))) throw new ApiError('not_found', 404);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO open_log (set_id, who, day) VALUES (?, ?, ?)')
    .bind(id, who, Math.floor(Date.now() / DAY))
    .run();
  if (r.meta.changes) await env.DB.prepare('UPDATE sets SET opens = opens + 1 WHERE id = ?').bind(id).run();
}

/** 通報。同じ接続元からは 1 セットに 1 回だけ数え、HIDE_REPORTS 件で隠す */
export async function report(env, id, who) {
  if (!(await getRow(env, id))) throw new ApiError('not_found', 404);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO report_log (set_id, who, at) VALUES (?, ?, ?)').bind(id, who, Date.now()).run();
  if (r.meta.changes) {
    await env.DB.prepare('UPDATE sets SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?')
      .bind(HIDE_REPORTS, id)
      .run();
  }
}
