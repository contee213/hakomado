// Cloudflare Access が付ける証明書 (Cf-Access-Jwt-Assertion ヘッダーの JWT) を確かめる。
// /authorize (OAuth のログイン) の前に Access を置き、ここで「Access を通った本人か」を見る。
// 依存パッケージは使わない (Workers と Node の WebCrypto だけで動き、テストから直接呼べるように)

const b64urlBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/**
 * JWT を確かめて中身 (claims) を返す。だめなら Error を投げる (メッセージは理由。画面には出さない)
 * @param {string} token
 * @param {{ keys: JsonWebKey[], aud: string, issuer: string, email?: string, now?: number }} opts
 *   keys = Access の公開鍵 (https://<チーム>.cloudflareaccess.com/cdn-cgi/access/certs の keys)
 *   aud = Access のアプリの AUD、issuer = https://<チーム>.cloudflareaccess.com、email = 通してよいメールアドレス (省くと見ない)
 */
export async function verifyAccessJwt(token, { keys, aud, issuer, email, now = Date.now() / 1000 }) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('no_token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  let header, claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new Error('malformed');
  }
  if (header.alg !== 'RS256') throw new Error('alg');
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown_key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('signature');
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud || !auds.includes(aud)) throw new Error('aud');
  if (claims.iss !== issuer) throw new Error('iss');
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) throw new Error('expired');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) throw new Error('not_yet');
  if (email !== undefined) {
    if (typeof claims.email !== 'string' || claims.email.toLowerCase() !== String(email).trim().toLowerCase()) throw new Error('email');
  }
  return claims;
}

let certCache = { url: '', at: 0, keys: [] };

/** Access の公開鍵を取る (5 分だけ覚えておく。知らない鍵 ID が来たら取り直す) */
export async function accessKeys(teamDomain, { refresh = false } = {}) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (!refresh && certCache.url === url && Date.now() - certCache.at < 5 * 60 * 1000) return certCache.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error('certs');
  const { keys } = await r.json();
  certCache = { url, at: Date.now(), keys: Array.isArray(keys) ? keys : [] };
  return certCache.keys;
}
