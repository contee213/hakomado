// アーカイブ同期の「🎧 音で合わせる」の計算 (extension/audio-align.js)
// 合成した「声」で、コラボの各視点の音を作って確かめる:
//   各人の声 v_k(τ) → 自分の枠には直接、ほかの人の枠には通話の遅れ δ のあとで入る。
//   枠 i の配信は、さらに配信システムの遅れ D_i のぶん遅れて記録される (開始時刻で合わせたときに残るずれ)。
//   正しい直し方: 枠 j の補正値に (D_j − D_基準) を足す
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const A = load(['audio-align.js']).get('AudioAlign');

/** 決まった乱数 (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 声らしい包絡 (1 ミリ秒ごと): 話す・黙るをくり返し、話している間は音節ごとに大きさが変わる */
function voice(ms, r) {
  const v = new Float64Array(ms);
  let t = Math.floor(r() * 2000);
  while (t < ms) {
    const talk = 400 + r() * 2500;
    const end = Math.min(ms, t + talk);
    while (t < end) {
      const syl = 60 + r() * 180;
      const amp = 0.2 + r() * 0.8;
      for (let k = 0; k < syl && t < end; k++, t++) v[t] = amp * Math.sin((Math.PI * k) / syl);
      t += Math.floor(r() * 60);
    }
    t += Math.floor(600 + r() * 3000);
  }
  return v;
}

/**
 * 枠の記録を作る。
 * people[k] = 声、tile = 何人目の枠か、D = 配信システムの遅れ (ミリ秒)、callMs = 通話の遅れ、
 * startMs = その配信の開始時刻、from = 記録を始める再生位置 (秒)、ms = 記録する長さ
 * drop = サンプルが抜ける割合、jitter = 再生位置の読み取りの揺れ (秒)
 */
function makeTrack(people, tile, { D, callMs, startMs, from, ms, drop = 0, jitter = 0, noise = 0.02, seed = 1, rate = () => 1 }) {
  const r = rng(seed);
  const sr = 48000;
  const per = 48;
  const per_buf = 4096;
  const T0 = START + 1e6; // 世界の時刻の原点 (ミリ秒。声の配列の添字 0 に当たる)
  // 枠の音 (世界の時刻 τ): 本人の声 + ほかの人の声 (δ 遅れ) + 雑音
  const audio = (tau) => {
    let s = 0;
    for (let k = 0; k < people.length; k++) {
      const idx = Math.round(tau - T0 - (k === tile ? 0 : callMs));
      const v = people[k][idx];
      if (v) s += k === tile ? v : 0.7 * v;
    }
    return s + noise * r();
  };
  const bins = [];
  const marks = [];
  let total = 0;
  let mediaMs = from * 1000; // 再生位置
  let binsInBuf = 0;
  while (mediaMs < from * 1000 + ms) {
    // 実際の時刻 r = start + 再生位置。そこに入っている音 = 世界の時刻 r − D の音
    const realMs = startMs + mediaMs;
    const tau = realMs - D;
    // サンプルが抜けた: 再生位置だけ進んで、記録には入らない
    if (drop && r() < drop) {
      mediaMs += 1;
      continue;
    }
    // 速度 rate のとき、1 ビン (48 サンプル = 1 ミリ秒ぶんの音) で再生位置は rate ミリ秒進む
    const rt = rate(mediaMs - from * 1000);
    bins.push(audio(tau));
    total += per;
    mediaMs += rt;
    if (++binsInBuf * per >= per_buf) {
      binsInBuf = 0;
      marks.push([total, mediaMs / 1000 + (r() - 0.5) * 2 * jitter, rt]);
    }
  }
  return { sr, per, bins, marks };
}

const START = Date.UTC(2026, 10, 21, 10, 0, 0);

function scenario({ n, D, callMs, ms = 90000, drop = 0, jitter = 0, seed = 7, silent = false, rate, quiet }) {
  const r = rng(seed);
  const total = ms + 60000;
  const people = Array.from({ length: n }, () => (silent ? new Float64Array(total) : voice(total, r)));
  // quiet = {person, from, gain}: その人が、記録の from ミリ秒目からは黙る (gain = それまでの声の大きさ)
  if (quiet) {
    const v = people[quiet.person];
    for (let t = 0; t < v.length; t++) v[t] = t >= 10000 + quiet.from ? 0 : v[t] * (quiet.gain ?? 1);
  }
  // どの枠も、世界の時刻 T0+10 秒 〜 から記録する。開始時刻はばらばら (1 分ずつ)
  return people.map((_, i) => {
    const startMs = START + i * 60000;
    const realFrom = START + 1e6 + 10000 + D[i]; // 世界の時刻 T0+10s の音が入っている実時刻
    const from = (realFrom - startMs) / 1000;
    return { track: makeTrack(people, i, { D: D[i], callMs, startMs, from, ms, drop, jitter, seed: seed + i * 13, rate: i ? rate : undefined }), startMs, off: 0 };
  });
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b} の差が ${tol} を超えた`);

test('2 人: 中間 (配信システムの遅れの差) を既定にし、それぞれの声に合わせる値も出す', async () => {
  const items = scenario({ n: 2, D: [0, -1600], callMs: 300 });
  const r = await A.analyze(items, 0);
  assert.equal(r.ok, true);
  near(r.deltas[1], -1.6, 0.02, '中間');
  assert.equal(r.deltas[0], 0);
  assert.ok(r.z[1] >= A.Z_OK);
  near(r.two.mid, -1.6, 0.02, 'two.mid');
  near(r.two.refVoice, -1.3, 0.02, '基準の人の声'); // 基準の人の声は、相手の枠に δ 遅れて入る
  near(r.two.otherVoice, -1.9, 0.02, '相手の声');
});

test('2 人: 基準を後ろの枠にしても、向きと声の割り当てが合う', async () => {
  const items = scenario({ n: 2, D: [0, -1600], callMs: 300 });
  const r = await A.analyze(items, 1);
  assert.equal(r.ok, true);
  near(r.deltas[0], 1.6, 0.02, '中間');
  assert.equal(r.deltas[1], 0);
  near(r.two.refVoice, 1.9, 0.02, '基準 (枠 1) の人の声');
  near(r.two.otherVoice, 1.3, 0.02, '相手 (枠 0) の声');
});

test('4 人: 第三者の声のピークで、全部の枠を合わせる (実測と同じくらいのずれ)', async () => {
  const D = [0, 6197, 2174, 506];
  const items = scenario({ n: 4, D, callMs: 250 });
  const r = await A.analyze(items, 0);
  assert.equal(r.ok, true);
  for (let k = 1; k < 4; k++) near(r.deltas[k], D[k] / 1000, 0.02, `枠 ${k}`);
  assert.equal(r.two, null, '2 枠のときだけ選択肢を出す');
});

test('2 人: 片方がよく話していて、後半はその人しか話さなくても、中間で合わせる (実測で決められなかった形)', async () => {
  // 枠 1 の人は小さい声で、前半だけ話す → 全体では枠 0 の人の声のピークがずっと強く、後半だけで測るとそのピークしか出ない
  const items = scenario({ n: 2, D: [0, -1600], callMs: 315, quiet: { person: 1, from: 45000 }, seed: 5 });
  const r = await A.analyze(items, 0);
  assert.equal(r.ok, true, JSON.stringify(r.pairs));
  near(r.deltas[1], -1.6, 0.02, '中間');
  near(r.two.refVoice, -1.285, 0.02, '基準の人の声');
});

test('配信の遅れの差が 1 分を超える枠も合わせる (実測: 5 人のコラボで 63 秒)', async () => {
  const D = [0, 8300, -63300];
  const r = await A.analyze(scenario({ n: 3, D, callMs: 250, ms: 150000 }), 0);
  assert.equal(r.ok, true);
  near(r.deltas[1], 8.3, 0.02, '枠 1');
  near(r.deltas[2], -63.3, 0.02, '枠 2');
});

test('7 枠 (スペクトルを持っておかず、基準との組と隣どうしの組だけ): 全部の枠を合わせる', async () => {
  const D = [0, 1200, -800, 2500, 400, -1900, 3100];
  const r = await A.analyze(scenario({ n: 7, D, callMs: 250 }), 0);
  assert.equal(r.ok, true);
  for (let k = 1; k < 7; k++) near(r.deltas[k], D[k] / 1000, 0.02, `枠 ${k}`);
  assert.ok(r.pairs.length < 21, '全部の組 (21) は突き合わせない');
});

test('サンプルが抜けても、再生位置の読み取りが揺れても合う', async () => {
  const items = scenario({ n: 2, D: [0, 2500], callMs: 280, drop: 0.005, jitter: 0.006, seed: 11 });
  const r = await A.analyze(items, 0);
  assert.equal(r.ok, true);
  near(r.deltas[1], 2.5, 0.03, '中間');
});

test('同期が速度を変えて詰めている区間があっても合う', async () => {
  // 枠 1 は、20〜50 秒の間だけ 5% 速く再生した (同期のずれを詰めるとき)
  const items = scenario({ n: 2, D: [0, 800], callMs: 300, rate: (t) => (t >= 20000 && t < 50000 ? 1.05 : 1), seed: 21 });
  const r = await A.analyze(items, 0);
  assert.equal(r.ok, true);
  near(r.deltas[1], 0.8, 0.03, '中間');
});

test('声が無い (雑音だけ) なら、合わせない', async () => {
  const items = scenario({ n: 2, D: [0, 1000], callMs: 300, silent: true });
  const r = await A.analyze(items, 0);
  assert.equal(r.ok, false);
  assert.equal(r.deltas[1], null);
});

test('記録が短すぎれば、合わせない', async () => {
  const items = scenario({ n: 2, D: [0, 1000], callMs: 300, ms: 20000 });
  const r = await A.analyze(items, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'short');
});

test('ピークの選び方', () => {
  assert.deepEqual({ ...A.pick([{ lag: 500, z: 9 }, { lag: 200, z: 8 }]) }, { lag: 350, z: 8, kind: 'pair', lo: 200, hi: 500 });
  const t = A.pick([{ lag: 840, z: 9 }, { lag: 210, z: 7 }, { lag: 480, z: 7 }]);
  assert.equal(t.kind, 'triple');
  assert.equal(t.lag, 480);
  assert.equal(A.pick([{ lag: 840, z: 9 }, { lag: 210, z: 7 }, { lag: 480, z: 7 }], false).kind, 'pair', '2 人のときは 3 つ目を採らない');
  assert.equal(A.pick([{ lag: 100, z: 9 }, { lag: 5000, z: 6 }]).kind, 'single');
  assert.equal(A.pick([{ lag: 100, z: 9 }, { lag: 400, z: 3 }]).kind, 'single', '2 つ目が弱ければ 1 つ目');
  // 実測: 片方の人がよく話していると 2 つ目は 1 つ目の半分より弱いが、雑音 (3 つ目) よりはっきり強い
  assert.equal(A.pick([{ lag: -1306, z: 15.8 }, { lag: -1935, z: 6.8 }, { lag: -12550, z: 3 }]).kind, 'pair');
  assert.equal(A.pick([{ lag: -1306, z: 15.8 }, { lag: -1935, z: 6.8 }, { lag: -12550, z: 5 }]).kind, 'single', '雑音と同じくらいなら声とみなさない');
  // 1 つ目の左右に対称に出る偽のピーク (音節の周期) は声とみなさない。本当の 2 人目の声が弱くてもそちらを採る
  const side = A.pick([{ lag: -1285, z: 16.9 }, { lag: -1482, z: 6.6 }, { lag: -1089, z: 5.6 }, { lag: -1911, z: 6.4 }, { lag: 9000, z: 3 }], false);
  assert.equal(side.kind, 'pair');
  assert.equal(side.lo, -1911);
  assert.equal(A.pick([{ lag: -1285, z: 16.9 }, { lag: -1482, z: 6.6 }, { lag: -1089, z: 5.6 }, { lag: 9000, z: 3 }], false).kind, 'single');
  assert.equal(A.pick([]), null);
});

test('全部の組を解く: 外れた組は除く', () => {
  const pairs = [
    { i: 0, j: 1, lag: 1000, w: 8 },
    { i: 0, j: 2, lag: 3000, w: 8 },
    { i: 1, j: 2, lag: 2005, w: 8 },
    { i: 0, j: 3, lag: 500, w: 8 },
    { i: 1, j: 3, lag: -500, w: 8 },
    { i: 2, j: 3, lag: 9000, w: 8 }, // 外れ
  ];
  const { x, dropped } = A.solve(4, pairs, 0);
  near(x[1], 1000, 5, '枠 1');
  near(x[2], 3000, 5, '枠 2');
  near(x[3], 500, 5, '枠 3');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].lag, 9000);
});

test('基準とつながらない枠は null', () => {
  const { x } = A.solve(3, [{ i: 0, j: 1, lag: 100, w: 5 }], 0);
  assert.equal(x[0], 0);
  assert.equal(x[1], 100);
  assert.equal(x[2], null);
});

test('確かさ: 強い組は ◎、ほかの組からも同じ答えになれば上がる、どの組にも支えられなければ △', () => {
  // 基準 0。枠 1 は基準との組が強い。枠 2 は基準との組が弱い (使われない) が、枠 1 との組で決まる
  const used = [
    { i: 0, j: 1, lag: 1000, z: 12 },
    { i: 1, j: 2, lag: 500, z: 7 },
  ];
  assert.deepEqual([...A.grades(3, 0, [0, 1000, 1500], used)], [null, 3, 1]);
  // 3 つの組がそろって同じ答え → 基準との組が中くらいでも ◎
  const used3 = [
    { i: 0, j: 1, lag: 1000, z: 7 },
    { i: 0, j: 2, lag: 1500, z: 7 },
    { i: 1, j: 2, lag: 505, z: 7 },
  ];
  assert.deepEqual([...A.grades(3, 0, [0, 1000, 1500], used3)], [null, 3, 3]);
  // 決まらなかった枠は null
  assert.deepEqual([...A.grades(2, 0, [0, null], [])], [null, null]);
  // 3 枠以上で、支える組がどれも「1 人の声だけのピーク」なら ○ まで (その人の声は通話の遅れぶん片寄る)
  const singles = used3.map((p) => ({ ...p, z: 15, kind: 'single' }));
  assert.deepEqual([...A.grades(3, 0, [0, 1000, 1500], singles)], [null, 2, 2]);
  assert.deepEqual([...A.grades(3, 0, [0, 1000, 1500], [...singles.slice(0, 2), { ...singles[2], kind: 'triple' }])], [null, 3, 3]);
});

test('analyze は枠ごとの確かさも返す', async () => {
  const r = await A.analyze(scenario({ n: 2, D: [0, -1600], callMs: 300 }), 0);
  assert.equal(r.grade[0], null, '基準には付けない');
  assert.ok([1, 2, 3].includes(r.grade[1]));
  const weak = await A.analyze(scenario({ n: 2, D: [0, 1000], callMs: 300, silent: true }), 0);
  assert.deepEqual([...weak.grade], [null, null]);
});

test('Worker (audio-align-worker.js): 受け取った記録を計算して、同じ id で返す', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const dir = path.join(__dirname, '..', 'extension');
  const sent = [];
  const ctx = vm.createContext({ setTimeout, console, Float64Array, Uint8Array, Float32Array, Math, Promise });
  ctx.self = ctx;
  ctx.postMessage = (m) => sent.push(m);
  ctx.importScripts = (f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  vm.runInContext(fs.readFileSync(path.join(dir, 'audio-align-worker.js'), 'utf8'), ctx, { filename: 'audio-align-worker.js' });
  const items = scenario({ n: 2, D: [0, -1600], callMs: 300 });
  await ctx.onmessage({ data: { id: 7, items, ref: 0 } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 7);
  near(sent[0].res.deltas[1], -1.6, 0.02, 'Worker の結果');
  await ctx.onmessage({ data: { id: 8, items: null, ref: 0 } });
  assert.equal(sent[1].id, 8);
  assert.ok(sent[1].error, '計算できなければ error を返す');
});
