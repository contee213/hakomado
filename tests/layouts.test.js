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

test('どの枠もほぼ 16:9 になる', () => {
  const get = setup();
  const solve = get('solveTracks');
  for (const l of get('LAYOUTS')) {
    const { colW, rowH } = solve(l);
    for (const [x, y, w, h] of l.slots) {
      const sw = colW.slice(x, x + w).reduce((a, b) => a + b, 0);
      const sh = rowH.slice(y, y + h).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sw / sh / (16 / 9) - 1) < 0.01, `${l.id} の枠 ${[x, y, w, h]} が ${(sw / sh).toFixed(3)}`);
    }
  }
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
