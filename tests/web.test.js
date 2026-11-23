// Hakomado Feed (web/) の、D1 や fetch に触らない部分 (web/src/core.mjs)
'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const WEB = path.join(__dirname, '..', 'web');
const A = 'AAAAAAAAAAA';
const B = 'BBBBBBBBBBB';
const C = 'CCCCCCCCC-_';
let core;

before(async () => {
  // 拡張機能のスクリプトから src/gen/ext.mjs を作ってから読む (wrangler は要らない)
  execFileSync(process.execPath, [path.join(WEB, 'tools', 'build.js')]);
  core = await import(pathToFileURL(path.join(WEB, 'src', 'core.mjs')).href);
});

test('コードを読む: レイアウト・動画・ずれ・基準・名前', () => {
  const r = core.parseSubmission(`見てね #Hakomado u2x2.${A}${B}${C}~0,*1.5,-2 "箱企画"`);
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.set }, { layoutId: 'u2x2', ids: [A, B, C], offsets: [0, 1.5, -2], ref: 1, name: '箱企画', movie: null, main: null });
});

test('取り込み用リンクも読める (コードと同じ中身)', () => {
  const r = core.parseSubmission(`https://www.youtube.com/watch_videos?video_ids=${A},${B}&hkl=u1x2&title=名前&hakomado=1`);
  assert.equal(r.ok, true);
  assert.equal(r.set.layoutId, 'u1x2');
  assert.deepEqual([...r.set.ids], [A, B]);
  assert.equal(r.set.offsets, null);
  assert.equal(r.set.name, '名前');
});

test('読めないもの・知らないレイアウトは受け付けない', () => {
  assert.deepEqual(core.parseSubmission('こんにちは'), { ok: false, error: 'not_found' });
  assert.deepEqual(core.parseSubmission(''), { ok: false, error: 'not_found' });
  assert.deepEqual(core.parseSubmission(undefined), { ok: false, error: 'not_found' });
  assert.deepEqual(core.parseSubmission(`#Hakomado nosuch.${A}`), { ok: false, error: 'bad_layout' });
  // 今は無いレイアウト (外した 8+8) は置き換え先で受け付ける
  assert.equal(core.parseSubmission(`#Hakomado tl-m8s8-sw.${A}`).set.layoutId, 'u4x4');
  // hkl の無い watch_videos は Hakomado の共有リンクではない
  assert.deepEqual(core.parseSubmission(`https://www.youtube.com/watch_videos?video_ids=${A}`), { ok: false, error: 'not_found' });
});

test('動画の並びから作る (API・MCP): URL と ID を読み、レイアウトを省くと本数に合う均等のもの', () => {
  const r = core.buildSubmission({ videos: [`https://www.youtube.com/watch?v=${A}`, `https://youtu.be/${B}`, C, A], name: '名前' });
  assert.equal(r.ok, true);
  assert.deepEqual([...r.set.ids], [A, B, C]); // 同じ動画は 1 回だけ
  assert.equal(r.set.layoutId, 'u2x2');
  assert.equal(r.set.name, '名前');
  assert.equal(core.chooseLayout(1), 'u1x1');
  assert.equal(core.chooseLayout(2), 'u1x2');
  assert.equal(core.chooseLayout(16), 'u4x4');
  assert.equal(core.chooseLayout(14), 'u3x5'); // 15 枠の均等 (おすすめ)
  // text を渡せばコード・リンクとして読む
  assert.equal(core.buildSubmission({ text: `#Hakomado u1x2.${A}${B}` }).set.layoutId, 'u1x2');
});

test('動画の並びから作る: ずれと基準 (小数 1 桁に丸める)', () => {
  const r = core.buildSubmission({ videos: [A, B], layoutId: 'tl-pip1', offsets: [0, 2.25], ref: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.set, ids: [...r.set.ids], offsets: [...r.set.offsets] }, { layoutId: 'tl-pip1', ids: [A, B], offsets: [0, 2.3], ref: 1, name: '', movie: null, main: null });
});

test('動画の並びから作る: 読めないものは種類ごとのエラー', () => {
  const err = (input) => core.buildSubmission(input).error;
  assert.equal(err({ videos: ['https://example.com/'] }), 'bad_video');
  assert.equal(err({ videos: [] }), 'not_found');
  assert.equal(err({ videos: Array.from({ length: 17 }, (_, k) => `${'A'.repeat(9)}${String(k).padStart(2, '0')}`) }), 'too_many_videos');
  assert.equal(err({ videos: [A, B], offsets: [1] }), 'bad_offsets');
  assert.equal(err({ videos: [A], offsets: [1e9] }), 'bad_offsets');
  assert.equal(err({ videos: [A], ref: 3 }), 'bad_offsets');
  assert.equal(err({ videos: [A], layoutId: 'nosuch' }), 'bad_layout');
  assert.equal(err({ videos: [A], layoutId: 'u2x2.x' }), 'bad_layout');
  assert.equal(err({}), 'bad_request');
  assert.equal(err(null), 'bad_request');
});

test('同じセットかどうかは名前を除いて見る', () => {
  const a = core.parseSubmission(`#Hakomado u2x2.${A}${B} "名前1"`).set;
  const b = core.parseSubmission(`#Hakomado u2x2.${A}${B} "名前2"`).set;
  const c = core.parseSubmission(`#Hakomado u2x2.${B}${A}`).set;
  const d = core.parseSubmission(`https://www.youtube.com/watch_videos?video_ids=${A},${B}&hkl=u2x2&hakomado=`).set;
  assert.equal(core.canonical(a), core.canonical(b));
  assert.equal(core.canonical(a), core.canonical(d));
  assert.notEqual(core.canonical(a), core.canonical(c));
});

test('投稿者の名前: 改行・制御文字を除いて 30 文字まで', () => {
  assert.equal(core.cleanAuthor('  あ\nい\u0000う  '), 'あ い う');
  assert.equal(core.cleanAuthor('x'.repeat(50)).length, 30);
  assert.equal(core.cleanAuthor(null), '');
});

test('合言葉: ランダムな文字列とハッシュの比べ方', async () => {
  const k = core.randomToken(16);
  assert.match(k, /^[A-Za-z0-9]{16}$/);
  assert.notEqual(core.randomToken(16), k);
  const h = await core.sha256Hex(k);
  assert.equal(core.sameHex(await core.sha256Hex(k), h), true);
  assert.equal(core.sameHex(await core.sha256Hex(`${k}x`), h), false);
  assert.equal(core.sameHex(undefined, h), false);
});

test('D1 の行を画面に渡す形: コードとリンクを作り、秘密は出さない', () => {
  const row = {
    id: 'abcdEFGH',
    layout: 'u2x2',
    ids: JSON.stringify([A, B]),
    offsets: JSON.stringify([0, 2]),
    ref: 0,
    name: '名前',
    author: '作者',
    videos: JSON.stringify([{ title: 't1', channel: 'c1' }, { title: 't2', channel: 'c2' }]),
    opens: 3,
    reports: 1,
    hidden: 0,
    delete_hash: 'secret',
    created_at: 1,
  };
  const s = core.rowToSet(row);
  assert.equal(s.code, `#Hakomado u2x2.${A}${B}~0,2 "名前"`);
  assert.match(s.link, /^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=A{11},B{11}&hkl=u2x2&hks=0,2&title=名前&hakomado=1$/);
  assert.equal(s.layoutName, '2×2');
  assert.equal('delete_hash' in s || 'reports' in s, false);
  // 名前の無いセットのリンクは title= が仮の名前 (Hakomado) で hakomado=0。読み戻しても (投稿し直しても) 名前は付かない
  const unnamed = core.rowToSet({ ...row, name: '' });
  assert.match(unnamed.link, /&title=Hakomado&hakomado=0$/);
  assert.equal(core.parseSubmission(unnamed.link).set.name, '');
});

test('機能フラグ: オブジェクト・JSON の文字列・カンマ区切りで決め、書いていないものはオフ', async () => {
  const { features } = await import(pathToFileURL(path.join(WEB, 'src', 'features.mjs')).href);
  assert.deepEqual(features({}), { unlisted: false, tags: false, search: false, videoCheck: false, en: false, xLogin: false });
  assert.equal(features({ FEATURES: { tags: true, search: false } }).tags, true);
  assert.equal(features({ FEATURES: '{"search":true}' }).search, true);
  assert.equal(features({ FEATURES: 'tags, en' }).en, true);
  assert.equal(features({ FEATURES: 'not json {' }).tags, false);
  // X でログインは、X のアプリ (クライアント ID・シークレット) と公開の URL がそろうまで出さない
  assert.equal(features({ FEATURES: { xLogin: true } }).xLogin, false);
  assert.equal(features({ FEATURES: { xLogin: true }, X_CLIENT_ID: 'id', X_CLIENT_SECRET: 's', PUBLIC_ORIGIN: 'https://a.example' }).xLogin, true);
});

test('X でログイン: 戻り先はこのサイトの中だけ・Cookie の読み方・アイコンの URL', async () => {
  const x = await import(pathToFileURL(path.join(WEB, 'src', 'xauth.mjs')).href);
  assert.equal(x.safeReturn('/s/abcdEFGH?x=1'), '/s/abcdEFGH?x=1');
  assert.equal(x.safeReturn('/authorize?client_id=a&state=b'), '/authorize?client_id=a&state=b');
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '', undefined, '/a\nb', 'x'.repeat(3000)]) {
    assert.equal(x.safeReturn(bad), '/', String(bad));
  }
  assert.equal(x.readCookie('a=1; __Host-hk_session=abc; b=2', x.COOKIE), 'abc');
  assert.equal(x.readCookie('x__Host-hk_session=abc', x.COOKIE), '');
  assert.equal(x.readCookie(undefined, x.COOKIE), '');
  assert.equal(x.cleanAvatar('https://pbs.twimg.com/profile_images/1/abc_normal.jpg'), 'https://pbs.twimg.com/profile_images/1/abc_bigger.jpg');
  assert.equal(x.cleanAvatar('https://evil.example/a.jpg'), '');
  assert.equal(x.cleanAvatar('javascript:alert(1)'), '');
});

test('タグ: 空白・カンマで区切り、# を取って小文字に。5 個・20 文字まで', () => {
  assert.deepEqual(core.cleanTags('#Utawaku  コラボ,ＡＢＣ utawaku'), { ok: true, tags: ['utawaku', 'コラボ', 'abc'] });
  assert.deepEqual(core.cleanTags(['a b', 'c']), { ok: true, tags: ['a', 'b', 'c'] });
  assert.deepEqual(core.cleanTags(undefined), { ok: true, tags: [] });
  assert.deepEqual(core.cleanTags('a b c d e f'), { ok: false, error: 'bad_tags' });
  assert.deepEqual(core.cleanTags('x'.repeat(21)), { ok: false, error: 'bad_tags' });
  assert.deepEqual(core.cleanTags({}), { ok: false, error: 'bad_tags' });
  assert.deepEqual(core.cleanTags('<b>"x"</b>'), { ok: true, tags: ['bx/b'] });
});

test('検索: 語ごとに LIKE の形にし、% _ \\ は逃がす。検索用の文字列は小文字', () => {
  assert.deepEqual(core.searchTerms('  Zoo  100%_ok '), ['%zoo%', '%100\\%\\_ok%']);
  assert.deepEqual(core.searchTerms('a\\b'), ['%a\\\\b%']);
  assert.deepEqual(core.searchTerms('a b c d e f'), ['%a%', '%b%', '%c%', '%d%', '%e%']);
  assert.deepEqual(core.searchTerms(null), []);
  assert.equal(core.searchText({ name: 'Name', author: 'Me', tags: ['t'], videos: [{ title: 'ＡB', channel: 'Ch' }] }), 'name me t ab ch');
});

test('同じセットのまとめ方: 公開は名前を除いて、限定公開は名前も含めて (公開とは混ぜない)', () => {
  const a = core.parseSubmission(`#Hakomado u2x2.${A}${B} "名前1"`).set;
  const b = core.parseSubmission(`#Hakomado u2x2.${A}${B} "名前2"`).set;
  assert.equal(core.canonKey(a, true), core.canonKey(b, true));
  assert.notEqual(core.canonKey(a, false), core.canonKey(b, false));
  assert.notEqual(core.canonKey(a, true), core.canonKey(a, false));
  assert.match(core.canonKey(a, false), /^u:/);
});

test('🎬 本編モードのセット: 読む・同じセットの判定・D1 の列 ({movie}) から戻す', () => {
  const r = core.parseSubmission(`#Hakomado u2x2.${A}${B} "コマンドー" ~!754.2,*`);
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.set, ids: [...r.set.ids], movie: [...r.set.movie] }, { layoutId: 'u2x2', ids: [A, B], offsets: null, ref: 1, name: 'コマンドー', movie: [754.2, null], main: null });
  const plainSet = core.parseSubmission(`#Hakomado u2x2.${A}${B}`).set;
  assert.notEqual(core.canonical(r.set), core.canonical(plainSet), '本編の位置が違えば別のセット');
  assert.equal(core.offsetsColumn(r.set), JSON.stringify({ movie: [754.2, null] }));
  assert.equal(core.offsetsColumn({ offsets: [0, 2] }), '[0,2]');
  assert.equal(core.offsetsColumn({ offsets: null }), null);
  const s = core.rowToSet({ id: 'abcdEFGH', layout: 'u2x2', ids: JSON.stringify([A, B]), offsets: core.offsetsColumn(r.set), ref: 1, name: 'コマンドー', author: '', videos: '[{},{}]', opens: 0, created_at: 1 });
  assert.equal(s.offsets, null);
  assert.deepEqual(s.movie, [754.2, null]);
  assert.equal(s.code, `#Hakomado u2x2.${A}${B} "コマンドー" ~!754.2,*`);
  assert.match(s.link, /&hkm=754\.2,\*&/);
});

test('🎬 「本編にした」動画: 読む・同じセットの判定・D1 の列 ({movie, main}) から戻す', () => {
  const r = core.parseSubmission(`#Hakomado u2x2.${A}${B} "同時視聴" ~!0,*120,*0`);
  assert.equal(r.ok, true);
  assert.equal(r.set.main, 0);
  assert.equal(r.set.ref, 1);
  const noMain = core.parseSubmission(`#Hakomado u2x2.${A}${B} "同時視聴" ~!0,*120`).set;
  assert.notEqual(core.canonical(r.set), core.canonical(noMain), '本編にした動画が違えば別のセット');
  assert.equal(core.offsetsColumn(r.set), JSON.stringify({ movie: [0, 120], main: 0 }));
  const s = core.rowToSet({ id: 'abcdEFGH', layout: 'u2x2', ids: JSON.stringify([A, B]), offsets: core.offsetsColumn(r.set), ref: 1, name: '同時視聴', author: '', videos: '[{},{}]', opens: 0, created_at: 1 });
  assert.equal(s.main, 0);
  assert.equal(s.code, `#Hakomado u2x2.${A}${B} "同時視聴" ~!0,*120,*0`, 'Feed のコードから読んだ拡張機能にも印が届く');
  assert.match(s.link, /&hkm=0,\*120,\*0&/);
  // 以前に入れた行 ({movie} だけ) は main = null
  const old = core.rowToSet({ id: 'abcdEFGH', layout: 'u2x2', ids: JSON.stringify([A, B]), offsets: JSON.stringify({ movie: [0, 120] }), ref: 1, name: '', author: '', videos: '[{},{}]', opens: 0, created_at: 1 });
  assert.equal(old.main, null);
});

test('D1 の行: 公開範囲・タグ・消えた動画の数 (前の版の行は公開・タグなし)', () => {
  const base = { id: 'abcdEFGH', layout: 'u1x1', ids: JSON.stringify([A]), offsets: null, ref: 0, name: '', author: '', videos: '[{}]', opens: 0, created_at: 1 };
  assert.deepEqual([core.rowToSet(base).listed, core.rowToSet(base).tags, core.rowToSet(base).dead], [true, [], 0]);
  const s = core.rowToSet({ ...base, listed: 0, tags: '["x"]', dead: 1 });
  assert.deepEqual([s.listed, s.tags, s.dead], [false, ['x'], 1]);
});

/** wrangler.jsonc を読む (コメントを除く。文字列の中の // はそのまま) */
function readWranglerConfig() {
  const src = require('node:fs').readFileSync(path.join(WEB, 'wrangler.jsonc'), 'utf8');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      const j = src.indexOf('"', i + 1); // 設定の文字列に \" は無い
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

test('wrangler.jsonc: ステージングは本番とずれず、本番の D1・ドメイン・名前を使わない', () => {
  const prod = readWranglerConfig();
  const stg = prod.env.staging;
  assert.notEqual(stg.name, prod.name);
  // routes は上から引き継ぐので、空にしていないと本番のドメインがステージングに付く
  assert.deepEqual(stg.routes, []);
  assert.equal(stg.d1_databases.length, prod.d1_databases.length);
  assert.notEqual(stg.d1_databases[0].database_id, prod.d1_databases[0].database_id);
  assert.notEqual(stg.d1_databases[0].database_name, prod.d1_databases[0].database_name);
  assert.equal(stg.d1_databases[0].binding, prod.d1_databases[0].binding);
  assert.equal(stg.d1_databases[0].migrations_dir, prod.d1_databases[0].migrations_dir);
  // vars は引き継がないので、本番にある名前はステージングにも全部書く (機能フラグの中身は違ってもいい)
  assert.deepEqual(Object.keys(stg.vars).sort(), Object.keys(prod.vars).sort());
  // kv_namespaces も引き継がない。OAuth の KV・公開の URL・Access のアプリは本番と分ける
  assert.deepEqual(stg.kv_namespaces.map((k) => k.binding), prod.kv_namespaces.map((k) => k.binding));
  assert.notEqual(stg.kv_namespaces[0].id, prod.kv_namespaces[0].id);
  assert.notEqual(stg.vars.PUBLIC_ORIGIN, prod.vars.PUBLIC_ORIGIN);
  assert.notEqual(stg.vars.ACCESS_AUD, prod.vars.ACCESS_AUD);
  // OAuth の口は Worker を通す (静的アセットに取られないように)
  for (const p of ['/mcp', '/authorize', '/oauth/*', '/.well-known/oauth-*', '/auth/*', '/me']) assert.ok(prod.assets.run_worker_first.includes(p), p);
});

// ---- Access の証明書 (web/src/access-jwt.mjs)
const b64url = (buf) => Buffer.from(buf).toString('base64url');
async function signedJwt(claims, { kid = 'k1', key } = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

test('Access の証明書: 署名・AUD・発行元・期限・メールを確かめる', async () => {
  const { verifyAccessJwt } = await import(pathToFileURL(path.join(WEB, 'src', 'access-jwt.mjs')).href);
  const gen = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pair = await gen();
  const other = await gen();
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const now = 1_800_000_000;
  const iss = 'https://team.cloudflareaccess.com';
  const good = { aud: ['AUD1'], iss, email: 'Owner@Example.com', exp: now + 600, iat: now };
  const opts = { keys: [jwk], aud: 'AUD1', issuer: iss, email: 'owner@example.com', now };
  const claims = await verifyAccessJwt(await signedJwt(good, { key: pair.privateKey }), opts);
  assert.equal(claims.email, 'Owner@Example.com'); // メールは大文字小文字を区別しない
  const fails = async (token, o, reason) => assert.rejects(verifyAccessJwt(token, { ...opts, ...o }), { message: reason });
  await fails(await signedJwt(good, { key: other.privateKey }), {}, 'signature'); // ほかの鍵で署名したもの
  await fails(await signedJwt(good, { key: pair.privateKey, kid: 'nope' }), {}, 'unknown_key');
  await fails(await signedJwt({ ...good, aud: ['AUD2'] }, { key: pair.privateKey }), {}, 'aud');
  await fails(await signedJwt(good, { key: pair.privateKey }), { aud: '' }, 'aud'); // AUD を設定していなければ通さない
  await fails(await signedJwt({ ...good, iss: 'https://evil.example' }, { key: pair.privateKey }), {}, 'iss');
  await fails(await signedJwt({ ...good, exp: now - 120 }, { key: pair.privateKey }), {}, 'expired');
  await fails(await signedJwt({ ...good, email: 'someone@example.com' }, { key: pair.privateKey }), {}, 'email');
  await fails('a.b', {}, 'malformed');
  await fails(undefined, {}, 'no_token');
  const [h, b] = (await signedJwt(good, { key: pair.privateKey })).split('.');
  await fails(`${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b}.`, {}, 'alg'); // 署名なしは通さない
  assert.ok(h);
});
