// 🎚 音量バランス (volume-balance.js。HAKO-54) の計算の確かめ:
// - 保存した値の読み方 (normalize)
// - 主役のときのほかの枠の割合 (主役がミュートなら下げない)
// - 「大きさをそろえる」: 真ん中の大きさに合わせ、1 秒に 1 dB までしか動かさない。無音・話の合間・ミュートの枠は数えない
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readExt } = require('./helpers/load');

/** grid.js の代わりを用意して volume-balance.js を読み込む。tick は setInterval から取り出して手で回す */
function load(tiles) {
  const posted = [];
  let tick = null;
  const ctx = {
    MAX_TILES: 16,
    state: { tiles, volume: null },
    views: tiles.map(() => ({ player: {} })),
    isVisible: () => true,
    visibleIndexes: () => tiles.map((_, i) => i),
    tileFilled: (t) => !!(t.videoId || t.web),
    postToFrame: (frame, msg) => posted.push(msg),
    save: () => {},
    tr: (k) => k,
    document: { getElementById: () => null },
    performance: { now: () => 0 },
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {},
    Math,
    Number,
    Map,
    String,
  };
  vm.createContext(ctx);
  vm.runInContext(`${readExt('volume-balance.js')}\n;this.VB = VolumeBalance;`, ctx, { filename: 'volume-balance.js' });
  const VB = ctx.VB;
  ctx.state.volume = VB.normalize({});
  return { VB, ctx, posted, runTick: () => tick?.() };
}

const tile = (over = {}) => ({ videoId: 'aaaaaaaaaaa', web: '', muted: false, gain: 1, pan: 0, delay: 0, ...over });
const ms = (db) => 10 ** (db / 10);

test('保存した値: 知らない形は初期値、割合は 0〜1 の 5% 刻み、主役は枠の番号だけ', () => {
  const { VB } = load([tile()]);
  assert.deepEqual({ ...VB.normalize(undefined) }, { auto: false, focus: null, duck: 0.3 });
  assert.deepEqual({ ...VB.normalize({ auto: true, focus: 3, duck: 0.42 }) }, { auto: true, focus: 3, duck: 0.4 });
  assert.deepEqual({ ...VB.normalize({ auto: 'yes', focus: 99, duck: 5 }) }, { auto: false, focus: null, duck: 1 });
  assert.equal(VB.normalize({ focus: '2' }).focus, null);
});

test('主役: ほかの音を出している枠を割合まで下げ、主役がミュートなら下げない', () => {
  const tiles = [tile({ gain: 1.5 }), tile({ gain: 0.8 }), tile({ muted: true })];
  const { VB, ctx } = load(tiles);
  ctx.state.volume.focus = 0;
  ctx.state.volume.duck = 0.5;
  assert.equal(VB.gainOf(0), 1.5);
  assert.equal(VB.gainOf(1), 0.4);
  tiles[0].muted = true;
  assert.equal(VB.gainOf(1), 0.8);
});

test('大きさをそろえる: 真ん中の大きさへ 1 秒に 1 dB ずつ近づけ、上限で止まる', () => {
  const tiles = [tile(), tile({ videoId: 'bbbbbbbbbbb' }), tile({ videoId: 'ccccccccccc' })];
  const { VB, ctx, runTick } = load(tiles);
  ctx.state.volume.auto = true;
  VB.refresh(); // 1 秒ごとの見直しを始める
  const levels = [-20, -26, -32]; // 真ん中は -26 dB → 0 番は −6 dB、2 番は +6 dB にしたい
  for (let s = 0; s < 3; s++) levels.forEach((db, i) => VB.onLevel(i, { ok: true, ms: ms(db) }));
  runTick();
  const db = (g) => 20 * Math.log10(g);
  assert.ok(Math.abs(db(VB.gainOf(0)) + 1) < 1e-9, '1 秒目は 1 dB だけ下げる');
  assert.ok(Math.abs(db(VB.gainOf(1))) < 1e-9, '真ん中の枠はそのまま');
  assert.ok(Math.abs(db(VB.gainOf(2)) - 1) < 1e-9);
  for (let s = 0; s < 10; s++) runTick();
  assert.ok(Math.abs(db(VB.gainOf(0)) + 6) < 1e-6);
  assert.ok(Math.abs(db(VB.gainOf(2)) - 6) < 1e-6);
  // OFF にすると、つまみの値だけに戻る
  ctx.state.volume.auto = false;
  assert.equal(VB.gainOf(0), 1);
});

test('大きさをそろえる: 無音・話の合間は数えず、音を出している枠が 1 つなら倍率は 1、ミュートの枠は測らない', () => {
  const tiles = [tile(), tile({ videoId: 'bbbbbbbbbbb', muted: true })];
  const { VB, ctx, runTick } = load(tiles);
  ctx.state.volume.auto = true;
  VB.refresh();
  for (let s = 0; s < 5; s++) VB.onLevel(0, { ok: true, ms: ms(-30) });
  VB.onLevel(0, { ok: true, ms: ms(-70) }); // 無音
  VB.onLevel(0, { ok: true, ms: ms(-52) }); // 話の合間 (今より 20 dB 以上小さい)
  for (let s = 0; s < 5; s++) runTick();
  assert.equal(VB.gainOf(0), 1);
  assert.equal(VB.levelOn(0), true);
  assert.equal(VB.levelOn(1), false);
  // URL の枠は音量を変えられないので測らない
  tiles[1] = { videoId: null, web: 'https://example.com/', muted: false, gain: 1, pan: 0, delay: 0 };
  assert.equal(VB.levelOn(1), false);
});

test('大きさをそろえる: 別の動画にしたら、その枠は 1 から測り直す', () => {
  const tiles = [tile(), tile({ videoId: 'bbbbbbbbbbb' })];
  const { VB, ctx, runTick } = load(tiles);
  ctx.state.volume.auto = true;
  VB.refresh();
  for (let s = 0; s < 3; s++) {
    VB.onLevel(0, { ok: true, ms: ms(-10) });
    VB.onLevel(1, { ok: true, ms: ms(-30) });
  }
  for (let s = 0; s < 5; s++) runTick();
  assert.notEqual(VB.gainOf(0), 1);
  tiles[0].videoId = 'ddddddddddd';
  assert.equal(VB.gainOf(0), 1);
});
