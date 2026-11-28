// URL の枠のサイトの範囲と、ヘッダーを外すルール (extension/web-site.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const WebSite = load(['web-site.js']).get('WebSite');

test('許可を求める範囲は、見るページのホスト名でなくドメインごと', () => {
  assert.equal(WebSite.siteDomain('www.example.com'), 'example.com');
  assert.equal(WebSite.siteDomain('live.example.com'), 'example.com');
  assert.equal(WebSite.siteDomain('example.com'), 'example.com');
  assert.equal(WebSite.siteDomain('Video.Example.COM.'), 'example.com');
  // 国別のドメインの登録の区切り (co.jp・ne.jp・com.au など) の下は 1 つ上まで
  assert.equal(WebSite.siteDomain('www.example.co.jp'), 'example.co.jp');
  assert.equal(WebSite.siteDomain('tv.sub.example.ne.jp'), 'example.ne.jp');
  assert.equal(WebSite.siteDomain('www.example.com.au'), 'example.com.au');
  // 2 文字の国別ドメインでも、区切りでなければ 2 つまで
  assert.equal(WebSite.siteDomain('www.example.jp'), 'example.jp');
  assert.equal(WebSite.siteDomain('abc.tv'), 'abc.tv');
  assert.equal(WebSite.pattern(new URL('https://live.example.co.jp/watch/1')), 'https://*.example.co.jp/*');
});

test('いろいろな人がサイトを置くドメインは、ほかの人のサイトまで許可しないようホスト名のまま', () => {
  assert.equal(WebSite.siteDomain('someone.github.io'), 'someone.github.io');
  assert.equal(WebSite.siteDomain('a.b.pages.dev'), 'a.b.pages.dev');
  assert.equal(WebSite.siteDomain('d1234.cloudfront.net'), 'd1234.cloudfront.net');
  assert.equal(WebSite.siteDomain('bucket.s3.amazonaws.com'), 'bucket.s3.amazonaws.com', 'S3 などの置き場所をまとめて許可しない');
  assert.equal(WebSite.siteDomain('x.azurewebsites.net'), 'x.azurewebsites.net');
  assert.equal(WebSite.siteDomain('pub-1.r2.dev'), 'pub-1.r2.dev');
  assert.equal(WebSite.siteDomain('192.168.0.1'), '192.168.0.1');
});

test('ルール: マルチビュー画面のタブの枠だけ。CSP は frame-ancestors だけのときに限って外す', () => {
  assert.deepEqual(plain(WebSite.frameRules([], [1], [3, 6])), []);
  assert.deepEqual(plain(WebSite.frameRules(['example.com'], [], [3, 6])), []);
  const [xfo, csp] = plain(WebSite.frameRules(['example.com', 'example.co.jp'], [7, 8], [3, 6]));
  for (const r of [xfo, csp]) {
    assert.deepEqual(r.condition.tabIds, [7, 8]);
    assert.deepEqual(r.condition.resourceTypes, ['sub_frame']);
    assert.deepEqual(r.condition.requestDomains, ['example.com', 'example.co.jp']);
  }
  assert.equal(xfo.id, 3);
  assert.deepEqual(xfo.action.responseHeaders, [{ header: 'x-frame-options', operation: 'remove' }]);
  assert.equal(csp.id, 6);
  assert.deepEqual(csp.action.responseHeaders, [{ header: 'content-security-policy', operation: 'remove' }]);
  assert.deepEqual(csp.condition.responseHeaders, [{ header: 'content-security-policy', values: ['*frame-ancestors*'] }]);
  assert.deepEqual(csp.condition.excludedResponseHeaders, [{ header: 'content-security-policy', values: plain(WebSite.CSP_PROTECTIVE) }]);
});

/** DNR のヘッダーの値の型 (* は何文字でも。大文字小文字は区別しない) で、CSP の値が外す対象になるか */
function strips(cspValue) {
  const [, csp] = WebSite.frameRules(['example.com'], [1], [3, 6]);
  const match = (pat) => new RegExp('^' + pat.split('*').map((s) => s.replace(/[.?+^$()[\]{}|\\]/g, '\\$&')).join('.*') + '$', 'i').test(cspValue);
  return csp.condition.responseHeaders[0].values.some(match) && !csp.condition.excludedResponseHeaders[0].values.some(match);
}

test('XSS 対策の指定が入った CSP は外さない', () => {
  assert.equal(strips("frame-ancestors 'none'"), true);
  assert.equal(strips("frame-ancestors 'self'; report-uri https://example.com/r"), true);
  assert.equal(strips("upgrade-insecure-requests; frame-ancestors 'none'"), true);
  assert.equal(strips("default-src 'self'; frame-ancestors 'none'"), false);
  assert.equal(strips("script-src 'nonce-abc'; frame-ancestors 'self'"), false);
  assert.equal(strips("frame-ancestors 'self'; object-src 'none'"), false);
  assert.equal(strips("frame-ancestors 'self'; base-uri 'self'"), false);
  assert.equal(strips("frame-ancestors 'self'; require-trusted-types-for 'script'"), false);
  assert.equal(strips("script-src 'self'"), false); // frame-ancestors が無ければ外す理由が無い
});

test('拡大: 動画の部分を、縦横の比を変えずに画面にぴったり映し、余りは等しく分ける', () => {
  // 動画の部分が画面の中に置かれた位置 (ページの左上から) へ、拡大と移動を逆にかけると画面の端と端に来る
  const at = (z, x, y) => [z.tx + x * z.s, z.ty + y * z.s];
  const z = plain(WebSite.fitZoom({ x: 24, y: 116, width: 440, height: 248 }, 880, 496));
  assert.equal(z.s, 2);
  assert.deepEqual(at(z, 24, 116), [0, 0]);
  assert.deepEqual(at(z, 24 + 440, 116 + 248), [880, 496]);
  assert.deepEqual([z.x, z.y, z.w, z.h], [24, 116, 440, 248]);
  // 比が違えば、はみ出さない側に合わせ、余りを上下に分ける
  const w = plain(WebSite.fitZoom({ x: 0, y: 80, width: 745, height: 300 }, 745, 420));
  assert.equal(w.s, 1);
  assert.deepEqual(at(w, 0, 80), [0, 60]);
  assert.deepEqual(at(w, 745, 380), [745, 360]);
  // すでに画面いっぱいなら、何も変えない
  assert.deepEqual(plain(WebSite.fitZoom({ x: 0, y: 0, width: 635, height: 357 }, 635, 357)), { s: 1, tx: 0, ty: 0, x: 0, y: 0, w: 635, h: 357 });
});

test('映像が映っている部分に合わせる (要素の比が違えば、余白を除く)', () => {
  // Prime Video: 縦に長い要素 (463×4748) の真ん中に 16:9 の映像
  const p = plain(WebSite.pictureRect({ x: 0, y: 0, width: 463, height: 4748 }, 1280, 720, 'contain'));
  assert.equal(p.width, 463);
  assert.ok(Math.abs(p.height - 260.4375) < 1e-6);
  assert.ok(Math.abs(p.y - (4748 - 260.4375) / 2) < 1e-6);
  // 横に長い要素なら左右の余白を除く
  assert.deepEqual(plain(WebSite.pictureRect({ x: 10, y: 0, width: 800, height: 225 }, 1600, 900, 'contain')), { x: 210, y: 0, width: 400, height: 225 });
  // scale-down は元の大きさより大きくしない
  assert.deepEqual(plain(WebSite.pictureRect({ x: 0, y: 0, width: 800, height: 600 }, 320, 180, 'scale-down')), { x: 240, y: 210, width: 320, height: 180 });
  // 引き伸ばし・切り抜き・大きさが分からないときは要素のまま
  const r = { x: 1, y: 2, width: 300, height: 400 };
  assert.equal(WebSite.pictureRect(r, 1280, 720, 'cover'), r);
  assert.equal(WebSite.pictureRect(r, 1280, 720, 'fill'), r);
  assert.equal(WebSite.pictureRect(r, 0, 0, 'contain'), r);
});

test('広げるのは画面の中で大きめの動画だけ (おすすめの小さな試聴は広げない)', () => {
  assert.equal(WebSite.bigEnough({ width: 528, height: 297 }, 528, 297), true);
  assert.equal(WebSite.bigEnough({ width: 208, height: 117 }, 528, 297), true); // 狭い枠で小さく置かれた本編 (15%)
  assert.equal(WebSite.bigEnough({ width: 120, height: 68 }, 528, 297), false);
  assert.equal(WebSite.bigEnough({ width: 100, height: 100 }, 0, 0), false);
});
