// Hakomado Feed の Worker:
// - /api/*: REST の API (D1 に投稿したセットを置く)。Authorization: Bearer <API_TOKEN> を付けると、
//   Turnstile と回数の制限なしで投稿でき (定期的なタスクなど)、合言葉なしで削除できる
// - /mcp: MCP の口 (mcp.mjs)。OAuth (oauth.mjs。claude.ai のコネクタなど) のトークンか API_TOKEN が要る
// - /authorize・/oauth/*・/.well-known/oauth-*: MCP の OAuth (oauth.mjs)
// - /auth/*: X でログイン (xauth.mjs。機能フラグ xLogin)。/me は自分の投稿の画面 (1 枚の画面を返す)
// - /s/:id: セットの画面 (1 枚の画面 public/index.html に OGP を入れて返す)。/post も同じ画面を返す
// - /config.js: 画面に渡す設定 (機能フラグ・Turnstile のサイトキー)
// - Cron (scheduled): 消えた動画の見直し (機能フラグ videoCheck)
// 機能フラグは features.mjs (wrangler.jsonc の vars.FEATURES)
// ほかのパス (一覧・投稿の画面、JS・CSS) は public/ の静的アセットとしてそのまま返る (wrangler.jsonc の run_worker_first)
import { TEXT_MAX, sha256Hex, sameHex, layoutList } from './core.mjs';
import { ApiError, DAY, listSets, listTags, getSet, createSet, deleteSet, countOpen, report, checkVideos, listMine, ownsSet, unlinkX } from './sets.mjs';
import { currentUser, xLoginStart, xLoginCallback, logout } from './xauth.mjs';
import { handleMcp } from './mcp.mjs';
import { features } from './features.mjs';
import { oauthReady, isOAuthPath, oauthProvider } from './oauth.mjs';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
const fail = (error, status = 400, extra = {}) => json({ error }, status, extra);

/**
 * 拡張機能のページ (chrome-extension://<ID>) からの呼び出しか。EXT_IDS (カンマ区切り) を設定していれば、その ID だけ。
 * 返すのはその Origin (CORS で許す相手)。ちがえば ''
 */
function extOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const id = origin.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1];
  if (!id) return '';
  const allow = String(env.EXT_IDS || '')
    .split(/[\s,]+/)
    .filter(Boolean);
  return !allow.length || allow.includes(id) ? origin : '';
}
const corsFor = (origin) => (origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {});

/** 接続元 (IP) を日ごとに変わるハッシュにする。IP そのものは保存しない */
async function clientKey(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const day = Math.floor(Date.now() / DAY);
  return (await sha256Hex(`${env.IP_SALT || 'hakomado'}:${day}:${ip}`)).slice(0, 32);
}

/**
 * トークン (Authorization: Bearer …) を見る。'none' = 付いていない / 'ok' = 正しい / 'bad' = 違う (または API_TOKEN を設定していない)。
 * 比べるのはハッシュどうし (かかる時間から中身を推し量られないように)
 */
async function auth(request, env) {
  const h = request.headers.get('authorization');
  if (!h) return 'none';
  const token = h.match(/^Bearer\s+(\S{1,256})$/i)?.[1];
  if (!token || !env.API_TOKEN) return 'bad';
  return sameHex(await sha256Hex(token), await sha256Hex(env.API_TOKEN)) ? 'ok' : 'bad';
}

const unauthorized = (body) =>
  new Response(JSON.stringify(body), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer realm="hakomado-feed"', 'cache-control': 'no-store' },
  });

/** POST の本文 (JSON) を読む。ほかのサイトのフォームから送られないよう JSON だけ受け付ける (送るには事前確認が要り、それには答えない) */
async function readJson(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return null;
  const text = await request.text();
  if (text.length > TEXT_MAX * 4) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Turnstile (荒らし対策の確認)。TURNSTILE_SECRET を設定していなければ確かめない */
async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) body.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    return !!(await r.json()).success;
  } catch {
    return false;
  }
}

/** 画面に渡す設定 (機能フラグと Turnstile のサイトキー) */
const publicConfig = (env) => ({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || '', features: features(env) });

async function api(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'sets', id?, action?]
  const { method } = request;
  const feats = features(env);
  // 拡張機能からの短縮リンク (機能フラグ extShare): 拡張機能のページからは、投稿 (限定公開) と 1 件の読み出しだけ CORS で許す
  const ext = feats.extShare ? extOrigin(request, env) : '';
  const cors = corsFor(ext);
  if (method === 'OPTIONS') {
    const ok = ext && parts[1] === 'sets' && (parts.length === 2 || parts.length === 3);
    if (!ok) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
    });
  }
  const who = await auth(request, env);
  if (who === 'bad') return unauthorized({ error: 'bad_token' });
  const admin = who === 'ok';
  // X でログインしている人 (機能フラグ xLogin。トークン・拡張機能からの呼び出しでは見ない)
  const user = feats.xLogin && !admin && !ext ? await currentUser(request, env) : null;

  // 自分のこと (X でログイン): GET /api/me、GET /api/me/sets、POST /api/me/unlink (X との連携を消す)
  if (parts[1] === 'me') {
    if (parts.length === 2 && method === 'GET') {
      return json({ user: user && { username: user.username, name: user.name, avatar: user.avatar } });
    }
    if (!user) return fail('login', 401);
    if (parts[2] === 'sets' && parts.length === 3 && method === 'GET') return json(await listMine(env, user.xId, { page: url.searchParams.get('page') }));
    if (parts[2] === 'unlink' && parts.length === 3 && method === 'POST') {
      if (!(await readJson(request))) return fail('bad_request');
      const r = await unlinkX(env, user.xId);
      return json({ ok: true, ...r }, 200, await logout(request, env));
    }
    return fail('not_found', 404);
  }

  if (parts.length === 2 && method === 'GET') {
    if (parts[1] === 'config') return json(publicConfig(env));
    if (parts[1] === 'layouts') return json({ layouts: layoutList() });
    if (parts[1] === 'tags') return feats.tags ? json(await listTags(env)) : fail('disabled', 404);
  }
  if (parts[1] !== 'sets' || parts.length > 4) return fail('not_found', 404);

  if (parts.length === 2) {
    if (method === 'GET') {
      const q = url.searchParams;
      return json(await listSets(env, { sort: q.get('sort'), page: q.get('page'), tag: q.get('tag'), q: q.get('q') }, feats));
    }
    if (method !== 'POST') return fail('method', 405, cors);
    const body = await readJson(request);
    if (!body) return fail('bad_request', 400, cors);
    let source = 'web';
    if (admin) source = 'api';
    else if (ext) source = 'ext';
    else if (!(await verifyTurnstile(env, body.turnstile, request))) return fail('turnstile', 403);
    // 投稿フォーム・拡張機能からはコード・リンク (text) だけ。動画の並び (videos) で送れるのはトークンを使ったときだけ
    if (!admin && typeof body.text !== 'string') return fail('bad_request', 400, cors);
    // 拡張機能からは名前とコードだけ受け取る (投稿者の名前・タグは付けない。いつも限定公開)
    const input = source === 'ext' ? { text: body.text } : body;
    const r = await createSet(env, input, { who: admin ? null : await clientKey(request, env), source, feats, user: source === 'web' ? user : null });
    return json({ ...r, url: `${url.origin}/s/${r.id}` }, r.existed ? 200 : 201, cors);
  }

  const id = parts[2];
  if (parts.length === 3) {
    if (method !== 'GET') return fail('method', 405);
    const set = await getSet(env, id);
    if (!set) return fail('not_found', 404, cors);
    // own = ログインしている人の投稿 (合言葉なしで消せる)
    return json(user ? { ...set, own: await ownsSet(env, id, user.xId) } : set, 200, cors);
  }
  if (method !== 'POST') return fail('method', 405);
  // 削除・開く・通報も JSON だけ (ほかのサイトのフォームから、見に来た人の接続元で通報させられないように)
  const body = await readJson(request);
  if (!body) return fail('bad_request');
  if (parts[3] === 'delete') {
    await deleteSet(env, id, { key: body.key, admin, xId: user?.xId });
    return json({ ok: true });
  }
  if (parts[3] === 'open') {
    await countOpen(env, id, await clientKey(request, env));
    return json({ ok: true });
  }
  if (parts[3] === 'report') {
    await report(env, id, await clientKey(request, env));
    return json({ ok: true });
  }
  return fail('not_found', 404);
}

async function mcp(request, env, url) {
  if (!env.API_TOKEN) return fail('not_found', 404); // トークンを設定するまでは閉じておく
  // ブラウザからの呼び出し (別のサイトの Origin) は受け付けない (DNS リバインディング対策)
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return fail('forbidden_origin', 403);
  if ((await auth(request, env)) !== 'ok') return unauthorized({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
  return handleMcp(request, env);
}

/** /s/:id: 画面 (public/index.html。中身の切り替えは画面の側) に、そのセットのタイトルと OGP を入れて返す。限定公開なら検索エンジンに載せない */
async function setPage(env, url, id) {
  const set = await getSet(env, id);
  if (!set) {
    const nf = await env.ASSETS.fetch(new URL('/404', url));
    return new Response(nf.body, { status: 404, headers: nf.headers });
  }
  const title = `${set.name || set.videos[0]?.title || 'Hakomado のセット'} | Hakomado`;
  const desc = `${set.ids.length} 本 · ${set.layoutName}${set.author ? ` · ${set.author}` : ''}`;
  const image = `https://i.ytimg.com/vi/${set.ids[0]}/hqdefault.jpg`;
  const page = await env.ASSETS.fetch(new URL('/', url));
  return new HTMLRewriter()
    .on('title', { element: (el) => el.setInnerContent(title) })
    .on('meta[property="og:title"]', { element: (el) => el.setAttribute('content', title) })
    .on('meta[property="og:description"], meta[name="description"]', { element: (el) => el.setAttribute('content', desc) })
    .on('meta[property="og:image"]', { element: (el) => el.setAttribute('content', image) })
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute('content', `${url.origin}/s/${id}`) })
    .on('head', { element: (el) => !set.listed && el.append('<meta name="robots" content="noindex">', { html: true }) })
    .transform(page);
}

/** /auth/*: X でログイン (機能フラグ xLogin) */
async function authRoute(request, env, url) {
  if (!features(env).xLogin) return fail('not_found', 404);
  if (url.pathname === '/auth/x/login' && request.method === 'GET') return xLoginStart(request, env);
  if (url.pathname === '/auth/x/callback' && request.method === 'GET') return xLoginCallback(request, env);
  // ログアウトは JSON の POST だけ (ほかのサイトから勝手にログアウトさせられないように)
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    if (!(await readJson(request))) return fail('bad_request');
    return json({ ok: true }, 200, await logout(request, env));
  }
  return fail('not_found', 404);
}

/** /config.js: 画面のスクリプトより先に読み込む設定 (同期で使えるように、スクリプトとして返す) */
const configScript = (env) =>
  new Response(`window.SETS_CONFIG = ${JSON.stringify(publicConfig(env)).replace(/</g, '\\u003c')};\n`, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' },
  });

/** OAuth を通さない部分 (API・画面・OAuth の設定が無いときの /mcp) */
async function appFetch(request, env) {
  const url = new URL(request.url);
  const isApi = url.pathname.startsWith('/api/');
  try {
    if (isApi) return await api(request, env, url);
    if (url.pathname === '/mcp') return await mcp(request, env, url);
    if (url.pathname === '/config.js') return configScript(env);
    if (url.pathname.startsWith('/auth/')) return await authRoute(request, env, url);
    const m = url.pathname.match(/^\/s\/([^/]+)\/?$/);
    if (m && (request.method === 'GET' || request.method === 'HEAD')) return await setPage(env, url, m[1]);
    // 投稿の画面も同じ 1 枚の画面 (public/index.html) で、中身を切り替えて出す
    if (/^\/(post|me)\/?$/.test(url.pathname)) return env.ASSETS.fetch(new URL('/', url));
    return env.ASSETS.fetch(request);
  } catch (e) {
    // 拡張機能からの投稿の失敗 (回数の制限など) も、拡張機能が読めるように CORS を付ける
    if (e instanceof ApiError) return fail(e.message, e.status, corsFor(features(env).extShare ? extOrigin(request, env) : ''));
    console.error(e);
    return isApi || url.pathname === '/mcp' ? fail('server', 500) : new Response('Server error', { status: 500 });
  }
}

export default {
  async fetch(request, env, ctx) {
    // MCP と OAuth の口は OAuthProvider に任せる (トークンを確かめてから /mcp を通し、ほかは appFetch に戻す)
    if (oauthReady(env) && isOAuthPath(new URL(request.url).pathname)) return oauthProvider(env, appFetch).fetch(request, env, ctx);
    return appFetch(request, env);
  },

  /** Cron (wrangler.jsonc の triggers): 消えた動画の見直し */
  async scheduled(controller, env, ctx) {
    if (!features(env).videoCheck) return;
    ctx.waitUntil(
      checkVideos(env).then(
        (r) => console.log('checkVideos', r),
        (e) => console.error('checkVideos', e),
      ),
    );
  },
};
