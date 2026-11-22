// X でログイン (機能フラグ xLogin)。OAuth 2.0 (認可コード + PKCE、クライアントシークレットあり)。
// - /auth/x/login?return=/path: X の許可の画面へ。/auth/x/callback: 戻ってきたら X のユーザーを確かめ、ログインの Cookie を出す
// - /auth/logout (POST、JSON): ログアウト
// X から取るのは ID・ユーザー名・表示名・アイコンの URL だけ。X のアクセストークンは使い終わったらすぐ無効にし、持たない。
// ログインの状態は D1 の sessions (Cookie の値のハッシュだけを持つ)。30 日で切れる。
// 設定: vars X_CLIENT_ID・PUBLIC_ORIGIN、シークレット X_CLIENT_SECRET。コールバックの URL は <PUBLIC_ORIGIN>/auth/x/callback
import { randomToken, sha256Hex } from './core.mjs';
import { refreshXHandle } from './sets.mjs';

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const LOGIN_MS = 10 * 60 * 1000;
export const COOKIE = '__Host-hk_session';
const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const X_TOKEN = 'https://api.x.com/2/oauth2/token';
const X_REVOKE = 'https://api.x.com/2/oauth2/revoke';
const X_ME = 'https://api.x.com/2/users/me?user.fields=profile_image_url';

/** ログインのあとに戻る先。このサイトの中のパス (/ で始まり、// や /\ で始まらない) だけ。だめなら / */
export function safeReturn(v) {
  if (typeof v !== 'string' || v.length > 2000) return '/';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || /[\u0000-\u001f]/.test(v)) return '/';
  return v;
}

/** Cookie のヘッダーから 1 つ取る */
export function readCookie(header, name) {
  for (const part of String(header || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

const sessionCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** X のアイコンの URL (pbs.twimg.com のものだけ。少し大きいものにする) */
export function cleanAvatar(url) {
  if (typeof url !== 'string' || !/^https:\/\/pbs\.twimg\.com\/[\w./-]+$/.test(url)) return '';
  return url.replace(/_normal(\.\w+)$/, '_bigger$1');
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function challengeOf(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export const xLoginReady = (env) => !!(env.X_CLIENT_ID && env.X_CLIENT_SECRET && env.PUBLIC_ORIGIN);
const origin = (env) => env.PUBLIC_ORIGIN.replace(/\/+$/, '');
const callbackUrl = (env) => `${origin(env)}/auth/x/callback`;

/** /auth/x/login: X の許可の画面へ送る */
export async function xLoginStart(request, env) {
  const url = new URL(request.url);
  // Cookie とコールバックは公開の URL (PUBLIC_ORIGIN) のもの。別のホスト (workers.dev) から来たら、そちらに移ってから始める
  if (url.origin !== origin(env)) return Response.redirect(`${origin(env)}${url.pathname}${url.search}`, 302);
  const state = randomToken(32);
  const verifier = randomToken(64);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM x_login WHERE created_at < ?').bind(now - LOGIN_MS),
    env.DB.prepare('INSERT INTO x_login (state_hash, verifier, return_to, created_at) VALUES (?, ?, ?, ?)').bind(
      await sha256Hex(state),
      verifier,
      safeReturn(url.searchParams.get('return')),
      now,
    ),
  ]);
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: env.X_CLIENT_ID,
    redirect_uri: callbackUrl(env),
    scope: 'users.read tweet.read',
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
  });
  return new Response(null, { status: 302, headers: { location: `${X_AUTHORIZE}?${q}`, 'cache-control': 'no-store' } });
}

const basicAuth = (env) => `Basic ${btoa(`${encodeURIComponent(env.X_CLIENT_ID)}:${encodeURIComponent(env.X_CLIENT_SECRET)}`)}`;

/** /auth/x/callback: X から戻ってきた。ユーザーを確かめてログインの Cookie を出し、元の画面へ戻す */
export async function xLoginCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const fail = (reason) => {
    console.warn('x login failed', reason);
    return Response.redirect(`${origin(env)}/?login=failed`, 302);
  };
  if (!state || state.length > 200) return fail('state');
  const stateHash = await sha256Hex(state);
  const row = await env.DB.prepare('SELECT verifier, return_to, created_at FROM x_login WHERE state_hash = ?').bind(stateHash).first();
  if (!row) return fail('unknown_state');
  await env.DB.prepare('DELETE FROM x_login WHERE state_hash = ?').bind(stateHash).run(); // 1 回だけ使える
  if (Date.now() - row.created_at > LOGIN_MS) return fail('expired');
  if (!code || url.searchParams.get('error')) return Response.redirect(`${origin(env)}${row.return_to}`, 302); // X の画面でやめた

  const tokenRes = await fetch(X_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basicAuth(env) },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(env), code_verifier: row.verifier, client_id: env.X_CLIENT_ID }),
  });
  if (!tokenRes.ok) return fail(`token ${tokenRes.status}`);
  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) return fail('no_token');
  const meRes = await fetch(X_ME, { headers: { authorization: `Bearer ${accessToken}` } });
  // X のアクセストークンはもう使わないので無効にする (失敗してもログインは続ける)
  const revoke = fetch(X_REVOKE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basicAuth(env) },
    body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token', client_id: env.X_CLIENT_ID }),
  }).catch(() => {});
  if (!meRes.ok) {
    await revoke;
    return fail(`me ${meRes.status}`);
  }
  const me = (await meRes.json()).data;
  await revoke;
  if (!me || !/^\d{1,30}$/.test(String(me.id)) || !/^\w{1,15}$/.test(String(me.username))) return fail('me_shape');

  await refreshXHandle(env, String(me.id), String(me.username));
  const sid = randomToken(32);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (id_hash, x_id, username, name, avatar, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      await sha256Hex(sid),
      String(me.id),
      String(me.username),
      String(me.name || '').slice(0, 50),
      cleanAvatar(me.profile_image_url),
      now,
      now + SESSION_MS,
    ),
  ]);
  return new Response(null, {
    status: 302,
    headers: { location: `${origin(env)}${row.return_to}`, 'set-cookie': sessionCookie(sid, SESSION_MS / 1000), 'cache-control': 'no-store' },
  });
}

/** ログインしている人 ({ xId, username, name, avatar }) か null */
export async function currentUser(request, env) {
  const sid = readCookie(request.headers.get('cookie'), COOKIE);
  if (!sid || sid.length > 100 || !env.DB) return null;
  const row = await env.DB.prepare('SELECT x_id, username, name, avatar FROM sessions WHERE id_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(sid), Date.now())
    .first();
  return row ? { xId: row.x_id, username: row.username, name: row.name, avatar: row.avatar } : null;
}

/** ログアウト: この Cookie のログインを消す。返すのは Cookie を消すヘッダー */
export async function logout(request, env) {
  const sid = readCookie(request.headers.get('cookie'), COOKIE);
  if (sid && sid.length <= 100) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256Hex(sid)).run();
  return { 'set-cookie': sessionCookie('', 0) };
}
