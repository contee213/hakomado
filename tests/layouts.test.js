// レイアウトの定義 (extension/layouts.js, layouts-generated.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

function setup() {
  const env = load(['layouts-generated.js', 'layouts.js']);
  return (name) => env.get(name);
}

test('id は重ならず、枠は最大 16', () => {
  const get = setup();
  const L = get('LAYOUTS');
  const ids = L.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(get('MAX_SLOTS'), 16);
  for (const l of L) assert.ok(l.slots.length >= 1 && l.slots.length <= 16, l.id);
});

test('枠は格子からはみ出さず、PinP 以外は重ならない', () => {
  const L = setup()('LAYOUTS');
  for (const l of L) {
    const used = new Set();
    for (const [x, y, w, h] of l.slots) {
      assert.ok(x >= 0 && y >= 0 && w >= 1 && h >= 1 && x + w <= l.cols && y + h <= l.rows, `${l.id} の枠 ${[x, y, w, h]}`);
      if (l.overlap) continue;
      for (let i = x; i < x + w; i++) {
        for (let j = y; j < y + h; j++) {
          assert.ok(!used.has(`${i},${j}`), `${l.id} で枠が重なる (${i},${j})`);
          used.add(`${i},${j}`);
        }
      }
    }
    // 均等とメイン + サブは隙間なく埋める
    if (!l.overlap) assert.equal(used.size, l.cols * l.rows, `${l.id} に隙間がある`);
  }
});

test('どの枠もほぼ 16:9 になる (縦長は 9:16)', () => {
  const get = setup();
  const solve = get('solveTracks');
  for (const l of get('LAYOUTS')) {
    const { colW, rowH } = solve(l);
    const target = l.group === 'vertical' ? 9 / 16 : 16 / 9;
    for (const [x, y, w, h] of l.slots) {
      const sw = colW.slice(x, x + w).reduce((a, b) => a + b, 0);
      const sh = rowH.slice(y, y + h).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sw / sh / target - 1) < 0.01, `${l.id} の枠 ${[x, y, w, h]} が ${(sw / sh).toFixed(3)}`);
    }
  }
});

test('縦長: 基準位置は無く、どれも 16:9 の画面を 50% 以上使う', () => {
  const get = setup();
  const solve = get('solveTracks');
  const V = get('LAYOUTS').filter((l) => l.group === 'vertical');
  assert.equal(V.map((l) => l.id).join(','), 'v1x3,v1x4,v1x5,v1x6,v2x4,v2x5,v2x6,v2x7,v2x8');
  for (const l of V) {
    assert.equal(l.anchor, undefined);
    assert.equal(l.mains, 0);
    const { aspect } = solve(l);
    // 映像の面積 / 画面の面積 = 全体の縦横比と画面の縦横比の小さいほう / 大きいほう
    const used = Math.min(aspect, 16 / 9) / Math.max(aspect, 16 / 9);
    assert.ok(used >= 0.5, `${l.id} は ${(used * 100).toFixed(1)}%`);
  }
  // 3 枚を横に並べると 27:16 で、画面の 95% ほど
  assert.ok(Math.abs(solve(get('getLayout')('v1x3')).aspect - 27 / 16) < 0.01);
});

test('メイン + サブ・PinP は 4 つの基準位置がそろっている', () => {
  const get = setup();
  const L = get('LAYOUTS');
  const keys = new Set(L.filter((l) => l.anchor).map((l) => l.key));
  for (const key of keys) {
    for (const a of get('ANCHORS')) assert.ok(get('layoutFor')(key, a), `${key} の ${a}`);
  }
});

test('getLayout: 知らない id は既定のレイアウト', () => {
  const get = setup();
  const getLayout = get('getLayout');
  assert.equal(getLayout('u3x3').id, 'u3x3');
  assert.equal(getLayout('nope').id, get('DEFAULT_LAYOUT_ID'));
  assert.equal(getLayout(undefined).id, 'u2x2');
});

test('layoutFor: 均等は基準位置に関係なくそのまま、無い形は null', () => {
  const layoutFor = setup()('layoutFor');
  assert.equal(layoutFor('u2x2', 'br').id, 'u2x2');
  assert.equal(layoutFor('pip2', 'br').id, 'br-pip2');
  assert.equal(layoutFor('nope', 'tl'), null);
});

test('おすすめ: 枠数 × メインの数 (均等は別) ごとにちょうど 1 つ', () => {
  const get = setup();
  const L = get('LAYOUTS').filter((l) => !l.anchor || l.anchor === 'tl');
  const groups = new Map();
  for (const l of L) {
    if (l.group === 'vertical') continue; // 縦長は、縦長を使っているときだけ選ぶのでおすすめは無い
    const g = `${l.slots.length}-${l.group === 'uniform' ? 'u' : l.mains}`;
    groups.set(g, (groups.get(g) || 0) + (l.recommended ? 1 : 0));
  }
  for (const [g, n] of groups) assert.equal(n, 1, `${g} のおすすめが ${n} 個`);
  for (const key of get('RECOMMENDED_LAYOUT_KEYS')) assert.ok(get('layoutFor')(key, 'tl'), key);
  // 1〜16 本のどれにもおすすめがある
  for (let n = 1; n <= 16; n++) assert.ok(L.some((l) => l.recommended && l.slots.length === n), `${n} 本`);
});

test('layoutIdOf: 今は無いレイアウトは置き換え先、知らない id は null', () => {
  const get = setup();
  const of = get('layoutIdOf');
  assert.equal(of('u3x3'), 'u3x3');
  assert.equal(of('br-pip2'), 'br-pip2');
  assert.equal(of('tl-m8s8-sw'), 'u4x4');
  assert.equal(of('br-m8s8-sw'), 'u4x4');
  assert.equal(of('nope'), null);
  assert.equal(of(undefined), null);
  assert.equal(get('getLayout')('tl-m8s8-sw').id, 'u4x4');
});

test('おすすめタブ: 1〜16 本のどれにも 1 つ以上あり、どれもおすすめの中から', () => {
  const get = setup();
  const L = get('LAYOUTS').filter((l) => !l.anchor || l.anchor === 'tl');
  for (const key of get('TAB_LAYOUT_KEYS')) {
    const l = get('layoutFor')(key, 'tl');
    assert.ok(l && l.tab && l.recommended, key);
  }
  for (let n = 1; n <= 16; n++) assert.ok(L.some((l) => l.tab && l.slots.length === n), `${n} 本`);
});

test('「＋」「−」のレイアウト (resizeLayoutFor): 枠数がちょうど合い、メイン枠が一番多い形になる', () => {
  const get = setup();
  const L = get('LAYOUTS');
  const resize = get('resizeLayoutFor');
  const byId = (id) => L.find((l) => l.id === id);
  // 枠数ごとに決まる形 (縦長・PinP 以外はどこから押してもここに乗る)
  const ladder = ['u1x1', 'u1x2', 'tl-m1s2-sw', 'u2x2', 'tl-m2s3-st', 'u2x3', 'tl-m4s3-sw', 'tl-m4s4-sw', 'u3x3', 'tl-m6s4-st', 'tl-m3s8-st', 'u3x4', 'tl-m4s9-sw', 'tl-m8s6-sw', 'u3x5', 'u4x4'];
  const tl = (l) => ({ ...l, anchor: l.anchor || 'tl' });
  for (const base of L.filter((l) => l.group === 'uniform' || l.group === 'main')) {
    for (const k of [base.slots.length - 1, base.slots.length + 1]) {
      if (k < 1 || k > 16) continue;
      const got = resize(k, base.anchor ? base : tl(base));
      assert.equal(got.slots.length, k, `${base.id} → ${k} 枠`);
      if (base.anchor === 'tl' || !base.anchor) assert.equal(got.id, ladder[k - 1], `${base.id} → ${k} 枠`);
    }
  }
  // 段の上では ＋ してから − すれば元に戻る
  for (let k = 1; k < 16; k++) {
    const up = resize(k + 1, tl(byId(ladder[k - 1])));
    assert.equal(resize(k, tl(up)).id, ladder[k - 1], `${ladder[k - 1]} ＋ −`);
  }
  // 基準位置は今のまま
  assert.equal(resize(5, byId('br-m1s3-sw')).id, 'br-m2s3-st');
  // 縦長は縦長を優先し、無い枠数では他の形
  assert.equal(resize(4, byId('v1x3')).id, 'v1x4');
  assert.equal(resize(3, byId('v1x4')).id, 'v1x3');
  assert.equal(resize(2, byId('v1x3')).group, 'uniform');
  // PinP は PinP のまま (4 枠には PinP が無いのでメイン + サブ)
  assert.equal(resize(3, byId('tl-pip1')).id, 'tl-pip2');
  assert.equal(resize(4, byId('tl-pip3')).slots.length, 4);
  // クルーズ中 (3 枠以上) は均等を選ばない
  assert.equal(resize(4, tl(byId('tl-m1s2-sw')), { cruise: true }).group, 'main');
});
