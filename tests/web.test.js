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
  assert.deepEqual({ ...r.set }, { layoutId: 'u2x2', ids: [A, B, C], offsets: [0, 1.5, -2], ref: 1, name: '箱企画' });
});

test('取り込み用リンクも読める (コードと同じ中身)', () => {
  const r = core.parseSubmission(`https://www.youtube.com/watch_videos?video_ids=${A},${B}&hkl=u1x2&title=名前&hakomado=`);
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
  // text を渡せばコード・リンクとして読む
  assert.equal(core.buildSubmission({ text: `#Hakomado u1x2.${A}${B}` }).set.layoutId, 'u1x2');
});

test('動画の並びから作る: ずれと基準 (小数 1 桁に丸める)', () => {
  const r = core.buildSubmission({ videos: [A, B], layoutId: 'tl-pip1', offsets: [0, 2.25], ref: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.set, ids: [...r.set.ids], offsets: [...r.set.offsets] }, { layoutId: 'tl-pip1', ids: [A, B], offsets: [0, 2.3], ref: 1, name: '' });
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
  assert.match(s.link, /^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=A{11},B{11}&hkl=u2x2&hks=0,2&title=名前&hakomado=$/);
  assert.equal(s.layoutName, '2×2');
  assert.equal('delete_hash' in s || 'reports' in s, false);
});

test('機能フラグ: オブジェクト・JSON の文字列・カンマ区切りで決め、書いていないものはオフ', async () => {
  const { features } = await import(pathToFileURL(path.join(WEB, 'src', 'features.mjs')).href);
  assert.deepEqual(features({}), { unlisted: false, extShare: false, tags: false, search: false, videoCheck: false, en: false });
  assert.equal(features({ FEATURES: { tags: true, search: false } }).tags, true);
  assert.equal(features({ FEATURES: '{"search":true}' }).search, true);
  assert.equal(features({ FEATURES: 'tags, en' }).en, true);
  assert.equal(features({ FEATURES: 'not json {' }).tags, false);
  // 拡張機能の短縮リンクは限定公開で入れるので、unlisted がオフなら一緒にオフ
  assert.equal(features({ FEATURES: { extShare: true } }).extShare, false);
  assert.equal(features({ FEATURES: { extShare: true, unlisted: true } }).extShare, true);
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
  assert.equal(stg.vars.EXT_IDS, prod.vars.EXT_IDS);
});
