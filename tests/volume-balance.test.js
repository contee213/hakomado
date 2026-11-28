// 🎚 音量バランス (volume-balance.js。HAKO-54) の計算の確かめ:
// - 保存した値の読み方 (normalize)
// - 主役のときのほかの枠の割合 (主役がミュートなら下げない)
// - 「大きさをそろえる」: 真ん中の大きさに合わせ、1 秒に 1 dB までしか動かさない。無音・話の合間は数えない
// - 同じ音を二度取らない: 保存してある波形が足りていれば測らない。届いた記録は波形に 1 回だけ足す。ライブはこの画面の間だけ覚える
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readExt } = require('./helpers/load');

const STEP = 0.1;
/** dB → 波形の 1 バイト (waves.js の quantize と同じ並べ方) */
const q = (db) => 1 + Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * 254);
/** dB の大きさが sec 秒続く波形 */
const wave = (db, sec) => new Uint8Array(Math.round(sec / STEP)).fill(q(db));

/** grid.js・waves.js の代わりを用意して volume-balance.js を読み込む。tick は setInterval から取り出して手で回す */
function load(tiles, { kinds = [], waves = {} } = {}) {
  const posted = [];
  const fed = [];
  const listeners = [];
  let tick = null;
  const Waves = {
    get: (id) => waves[id] || null,
    ensure: async (id) => waves[id] || (waves[id] = new Uint8Array(0)),
    onChange: (f) => listeners.push(f),
    feed: async (id, d) => {
      fed.push(id);
      waves[id] = Uint8Array.from([...(waves[id] || []), ...d.vals]);
      listeners.forEach((f) => f(id));
    },
    // 形の確かめは waves.js のものを使わず、テストの記録 (アーカイブは vals、ライブは本物の形) を通す
    validChunk: (d) => !!(d?.vals || d?.bins),
  };
  const ctx = {
    MAX_TILES: tiles.length,
    state: { tiles, volume: null },
    views: tiles.map(() => ({ player: {} })),
    Waves,
    tileKind: (i) => kinds[i] || 'archive',
    isVisible: () => true,
    visibleIndexes: () => tiles.map((_, i) => i),
    tileFilled: (t) => !!(t.videoId || t.web),
    postToFrame: (frame, msg) => posted.push(msg),
    save: () => {},
    tr: (k) => k,
    document: { getElementById: () => null },
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${readExt('volume-balance.js')}\n;this.VB = VolumeBalance;`, ctx, { filename: 'volume-balance.js' });
  const VB = ctx.VB;
  ctx.state.volume = VB.normalize({});
  return { VB, ctx, posted, fed, waves, runTick: () => tick?.() };
}

const tile = (over = {}) => ({ videoId: 'aaaaaaaaaaa', web: '', muted: false, gain: 1, pan: 0, delay: 0, ...over });
const db = (g) => 20 * Math.log10(g);
const turnOn = (VB, ctx) => {
  ctx.state.volume.auto = true;
  VB.refresh(); // 1 秒ごとの見直しを始める
};

test('保存した値: 知らない形は初期値、割合は 0〜1 の 5% 刻み、主役は枠の番号だけ', () => {
  const { VB } = load([tile()]);
  assert.deepEqual({ ...VB.normalize(undefined) }, { auto: false, focus: null, duck: 0.3, master: 1 });
  assert.deepEqual({ ...VB.normalize({ auto: true, focus: 0, duck: 0.42, master: 1.52 }) }, { auto: true, focus: 0, duck: 0.4, master: 1.5 });
  assert.deepEqual({ ...VB.normalize({ auto: 'yes', focus: 99, duck: 5, master: 9 }) }, { auto: false, focus: null, duck: 1, master: 2 });
  assert.equal(VB.normalize({ focus: '0' }).focus, null);
});

test('主役: ほかの音を出している枠を割合まで下げ、主役がミュートなら下げない', () => {
  const tiles = [tile({ gain: 1.5 }), tile({ gain: 0.8, videoId: 'bbbbbbbbbbb' }), tile({ muted: true, videoId: 'ccccccccccc' })];
  const { VB, ctx } = load(tiles);
  ctx.state.volume.focus = 0;
  ctx.state.volume.duck = 0.5;
  assert.equal(VB.gainOf(0), 1.5);
  assert.equal(VB.gainOf(1), 0.4);
  tiles[0].muted = true;
  assert.equal(VB.gainOf(1), 0.8);
});

test('全体の音量: そろえた倍率・主役の割合のうえに、全部の枠へ同じだけ掛ける', () => {
  const tiles = [tile({ gain: 1.2 }), tile({ videoId: 'bbbbbbbbbbb' })];
  const { VB, ctx } = load(tiles);
  ctx.state.volume.focus = 0;
  ctx.state.volume.master = 0.5;
  assert.equal(VB.gainOf(0), 0.6);
  assert.equal(VB.gainOf(1), 0.15);
});

test('保存してある波形が足りていれば測らず、真ん中の大きさへ 1 秒に 1 dB ずつ近づける', async () => {
  const tiles = [tile(), tile({ videoId: 'bbbbbbbbbbb' }), tile({ videoId: 'ccccccccccc' })];
  const waves = { aaaaaaaaaaa: wave(-20, 90), bbbbbbbbbbb: wave(-26, 90), ccccccccccc: wave(-32, 90) };
  const { VB, ctx, runTick } = load(tiles, { waves });
  turnOn(VB, ctx);
  for (let i = 0; i < 3; i++) assert.equal(VB.levelOn(i), false, '波形が 60 秒ぶん以上あるので、枠では測らない');
  runTick();
  assert.ok(Math.abs(db(VB.gainOf(0)) + 1) < 0.05, '1 秒目は 1 dB だけ下げる');
  assert.ok(Math.abs(db(VB.gainOf(1))) < 0.05, '真ん中の枠はそのまま');
  assert.ok(Math.abs(db(VB.gainOf(2)) - 1) < 0.05);
  for (let s = 0; s < 10; s++) runTick();
  assert.ok(Math.abs(db(VB.gainOf(0)) + 6) < 0.2);
  assert.ok(Math.abs(db(VB.gainOf(2)) - 6) < 0.2);
  // OFF にすると、つまみの値だけに戻る
  ctx.state.volume.auto = false;
  assert.equal(VB.gainOf(0), 1);
});

test('波形が足りない動画だけ枠で記録を頼み、届いた記録は波形に 1 回だけ足す。足りたら頼むのをやめる', async () => {
  const tiles = [tile(), tile({ videoId: 'bbbbbbbbbbb' })];
  const waves = { aaaaaaaaaaa: wave(-20, 90), bbbbbbbbbbb: wave(-30, 10) };
  const { VB, ctx, posted, fed, runTick } = load(tiles, { waves });
  turnOn(VB, ctx);
  assert.equal(VB.levelOn(0), false);
  assert.equal(VB.levelOn(1), true);
  VB.chunk(1, { vals: wave(-30, 55) });
  assert.deepEqual(fed, ['bbbbbbbbbbb'], '波形に足すのは 1 回だけ');
  posted.length = 0;
  runTick();
  assert.equal(VB.levelOn(1), false, '65 秒ぶんになったので、もう測らない');
  assert.ok(posted.some((m) => m.hakomado === 'mix' && m.level === false), '枠に記録をやめるよう知らせる');
});

test('無音・話の合間は数えず、音を出している枠が 1 つなら倍率は 1。ミュートの枠には記録を頼まない', () => {
  // 半分は -20 dB、残りは無音 (-70 dB) と話の合間 (-45 dB = 真ん中より 25 dB 小さい)
  const mixed = Uint8Array.from([...wave(-20, 40), ...wave(-70, 20), ...wave(-45, 10)]);
  const tiles = [tile(), tile({ videoId: 'bbbbbbbbbbb', muted: true })];
  const { VB, ctx, runTick } = load(tiles, { waves: { aaaaaaaaaaa: mixed, bbbbbbbbbbb: wave(-40, 90) } });
  turnOn(VB, ctx);
  for (let s = 0; s < 5; s++) runTick();
  assert.equal(VB.gainOf(0), 1, 'ほかに音を出している枠が無い');
  assert.equal(VB.levelOn(0), true, '音のあるところは 40 秒ぶん (無音・合間を除く) なので、まだ足りない');
  assert.equal(VB.levelOn(1), false);
  tiles[1].muted = false;
  for (let s = 0; s < 20; s++) runTick();
  assert.ok(Math.abs(db(VB.gainOf(0)) + 10) < 0.2, '-20 dB と -40 dB の真ん中 (-30 dB) へ');
});

test('ライブ・Twitch は波形に置かず、この画面の間だけ覚えて聞き続ける。別の動画にしたら倍率を 1 から', () => {
  const tiles = [tile({ videoId: 'livelive001' }), tile({ videoId: 'tw:somebody' })];
  const { VB, ctx, fed, runTick } = load(tiles, { kinds: ['live', 'live'] });
  turnOn(VB, ctx);
  assert.equal(VB.levelOn(0), true);
  const lv = (dbv) => 10 ** (dbv / 20);
  // 枠から届く本物の形: 48000 Hz で 48 サンプルごとの大きさ (0.1 秒 = 100 個)。再生位置は 24 時間を超えていても数える
  const live = (dbv) => ({ sr: 48000, per: 48, bins: new Float32Array(50 * 100).fill(lv(dbv)), marks: [[5000 * 48, 90000, 1]] });
  VB.chunk(0, live(-15));
  VB.chunk(1, live(-35));
  assert.deepEqual(fed, [], 'ライブは波形に足さない');
  for (let s = 0; s < 15; s++) runTick();
  assert.ok(Math.abs(db(VB.gainOf(0)) + 10) < 0.2);
  assert.ok(Math.abs(db(VB.gainOf(1)) - 10) < 0.2);
  assert.equal(VB.levelOn(0), true, 'ライブは聞き続ける');
  tiles[0].videoId = 'livelive002';
  assert.equal(VB.gainOf(0), 1);
});

test('URL の枠は音量を変えられないので、記録を頼まない', () => {
  const tiles = [{ videoId: null, web: 'https://example.com/', muted: false, gain: 1, pan: 0, delay: 0 }];
  const { VB, ctx } = load(tiles, { kinds: ['web'] });
  turnOn(VB, ctx);
  assert.equal(VB.levelOn(0), false);
  assert.equal(VB.gainOf(0), 1);
});
