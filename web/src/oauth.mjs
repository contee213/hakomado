// MCP の OAuth (claude.ai のコネクタ・クラウドの定期タスクからつなぐ用)。
// @cloudflare/workers-oauth-provider が OAuth 2.1 の口 (メタデータ・クライアントの登録・トークン) を受け持ち、
// /mcp には、ここで出したトークンか API_TOKEN (Claude Code・スクリプト用。今までどおり) を付けた呼び出しだけを通す。
// ログイン (/authorize) は Cloudflare Access の後ろに置き、Access の証明書 (JWT) のメールが OWNER_EMAIL の人だけに
// 許可の画面を出す。設定は wrangler.jsonc の vars (PUBLIC_ORIGIN・ACCESS_TEAM_DOMAIN・ACCESS_AUD) とシークレット
// (OWNER_EMAIL・API_TOKEN)、KV の OAUTH_KV。手順は README の「MCP」
import { OAuthProvider, AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { sha256Hex, sameHex } from './core.mjs';
import { verifyAccessJwt, accessKeys } from './access-jwt.mjs';
import { handleMcp } from './mcp.mjs';

export const OAUTH_PATHS = { authorize: '/authorize', token: '/oauth/token', register: '/oauth/register' };
const SCOPE = 'mcp';

const escape = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isLoopback = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/** OAuth を使えるか (KV と公開の URL がそろっているか)。そろっていなければ /mcp は API_TOKEN だけで動く */
export const oauthReady = (env) => !!(env.OAUTH_KV && env.PUBLIC_ORIGIN);

/** OAuth に関わるパスか (worker.mjs が、ここに回すかを決める) */
export const isOAuthPath = (path) =>
  path === '/mcp' || path === OAUTH_PATHS.authorize || path === OAUTH_PATHS.token || path === OAUTH_PATHS.register || path.startsWith('/.well-known/oauth-');

/** /mcp の本体: ブラウザからの別のサイトの呼び出しを断ってから MCP を処理する (トークンは OAuthProvider が確かめ済み) */
const mcpHandler = {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return new Response(JSON.stringify({ error: 'forbidden_origin' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    return handleMcp(request, env);
  },
};

/**
 * Access を通ったログインの人か。返すのはメールアドレス (だめなら null)。
 * 手元 (localhost) で ACCESS_TEAM_DOMAIN を空にしたときだけ、Access なしで通す (wrangler dev で試す用)
 */
async function signedInOwner(request, env) {
  const url = new URL(request.url);
  if (!env.ACCESS_TEAM_DOMAIN) return isLoopback(url.hostname) ? 'localhost' : null;
  if (!env.OWNER_EMAIL || !env.ACCESS_AUD) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const opts = { aud: env.ACCESS_AUD, issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, email: env.OWNER_EMAIL };
  try {
    return (await verifyAccessJwt(token, { ...opts, keys: await accessKeys(env.ACCESS_TEAM_DOMAIN) })).email;
  } catch (e) {
    if (e.message === 'unknown_key') {
      try {
        return (await verifyAccessJwt(token, { ...opts, keys: await accessKeys(env.ACCESS_TEAM_DOMAIN, { refresh: true }) })).email;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const page = (title, body, status = 200, headers = new Headers()) => {
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  // 許可したあとの戻り先 (claude.ai や手元のアプリ) へのリダイレクトを止めないよう、form-action は付けない
  headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  return new Response(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escape(title)} | Hakomado</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#222;background:#fafafa}
@media(prefers-color-scheme:dark){body{color:#eee;background:#16181c}}button{font:inherit;padding:.5rem 1.2rem;margin-right:.5rem;cursor:pointer}
.warn{border-left:4px solid #d93;padding:.2rem .8rem}</style>
<h1>${escape(title)}</h1>${body}</html>`,
    { status, headers },
  );
};

/** /authorize: Access のログインを確かめ、許可の画面を出す (GET)。許可・拒否を受ける (POST) */
async function authorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  const who = await signedInOwner(request, env);
  if (!who) return page('ログインできません', '<p>このサイトの持ち主だけが、MCP の接続を許可できます。</p>', 403);
  try {
    if (request.method === 'POST') {
      const form = await request.formData();
      const handle = String(form.get('handle') || '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE] });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: 'owner',
        metadata: { email: who },
        scope: approved.request.scope,
        props: { via: 'oauth' },
      });
      approved.headers.set('location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    if (request.method !== 'GET') return page('使えない呼び出し', '', 405);
    const req = await oauth.parseAuthRequest(request);
    const d = await oauth.describeConsent(req);
    const consent = await oauth.beginConsent(req);
    const from = d.clientDomain ? `<p>発行元: <strong>${escape(d.clientDomain)}</strong></p>` : '<p>このアプリは自分で名乗っています (名前は確かめられていません)。</p>';
    const local = d.redirectIsLoopback
      ? '<p class="warn">このパソコンのアプリに渡します。自分で接続を始めたときだけ許可してください。</p>'
      : '';
    return page(
      'MCP の接続の許可',
      `<p><strong>${escape(d.clientName || '名前のないアプリ')}</strong> が、Hakomado のセットの一覧・投稿・削除をしようとしています。</p>
${from}<p>許可すると <strong>${escape(d.redirectHost)}</strong> に接続のための鍵を渡します。</p>${local}
<p>ログイン: ${escape(who)}</p>
<form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}">
<button name="decision" value="approve">許可する</button><button name="decision" value="deny">やめる</button></form>`,
      200,
      consent.headers,
    );
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError || e instanceof CimdFetchError) {
      return page('接続を始められません', `<p>${escape(e instanceof AuthorizationError ? e.description || e.code : 'アプリの情報を取れませんでした。')}</p><p>接続をもう一度始めてください。</p>`, 400);
    }
    throw e;
  }
}

let cached = { key: '', provider: null };

/** OAuthProvider を作る (設定は環境ごとに違うので、最初の呼び出しで env から作って覚えておく) */
export function oauthProvider(env, appFetch) {
  const resource = `${env.PUBLIC_ORIGIN.replace(/\/+$/, '')}/mcp`;
  if (cached.key === resource) return cached.provider;
  const provider = new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: mcpHandler,
    defaultHandler: {
      fetch: (request, env2, ctx) => (new URL(request.url).pathname === OAUTH_PATHS.authorize ? authorize(request, env2) : appFetch(request, env2, ctx)),
    },
    authorizeEndpoint: OAUTH_PATHS.authorize,
    tokenEndpoint: OAUTH_PATHS.token,
    clientRegistrationEndpoint: OAUTH_PATHS.register,
    scopesSupported: [SCOPE],
    requiredScopes: [SCOPE],
    resourceMetadata: { resource, resource_name: 'Hakomado' },
    // 今までの API_TOKEN (Claude Code・スクリプト用) も /mcp で受け付ける
    resolveExternalToken: async ({ token, env: e }) => {
      if (!e.API_TOKEN || typeof token !== 'string' || token.length > 256) return null;
      return sameHex(await sha256Hex(token), await sha256Hex(e.API_TOKEN)) ? { props: { via: 'api_token' }, audience: resource } : null;
    },
  });
  cached = { key: resource, provider };
  return provider;
}
