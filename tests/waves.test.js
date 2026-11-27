// 全編の音の波形 (extension/waves.js。同期の調整の「〰 波形」の帯。HAKO-39)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const W = load(['idb-cache.js', 'waves.js']).get('Waves');

/** 音の記録 1 回分を作る: start 秒から rate 倍速で n ビン (1 ビン = per サンプル)。印は 4096 サンプルごとと最後 */
function chunk({ start, rate = 1, n, sr = 48000, per = 48, total0 = 0, level = () => 0.1 }) {
  const bins = new Float32Array(n);
  for (let j = 0; j < n; j++) bins[j] = level(start + ((j + 0.5) * per * rate) / sr);
  const marks = [];
  const end = total0 + n * per;
  for (let s = total0 + 4096; s < end; s += 4096) marks.push([s, start + ((s - total0) * rate) / sr, rate]);
  marks.push([end, start + (n * per * rate) / sr, rate]);
  return { sr, per, bins, marks };
}

test('音の大きさ → 1〜255 (dB で並べる。0 は使わない)', () => {
  assert.equal(W.quantize(0), 1);
  assert.equal(W.quantize(1e-6), 1);
  assert.equal(W.quantize(1), 255);
  assert.ok(W.quantize(0.1) > W.quantize(0.01));
  assert.ok(W.quantize(0.01) > 1);
});

test('等速の記録は、再生位置 0.1 秒ごとにまとまる', () => {
  // 10 秒から 1 秒分 (1000 ビン): 位置の番号 100〜109
  const steps = W.stepsOf(chunk({ start: 10, n: 1000 }));
  assert.deepEqual([...steps.keys()].sort((a, b) => a - b), [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  for (const [, [, n]] of steps) assert.ok(n >= 99 && n <= 101);
});

test('16 倍速の記録は、16 倍の長さの位置に広がる', () => {
  // 100 秒から 1 秒分 → 再生位置 100〜116 秒 (番号 1000〜1159)
  const steps = W.stepsOf(chunk({ start: 100, rate: 16, n: 1000 }));
  const ks = [...steps.keys()];
  assert.equal(Math.min(...ks), 1000);
  assert.equal(Math.max(...ks), 1159);
  assert.equal(ks.length, 160);
});

test('大きい音の区間は、その位置だけ大きくなる', () => {
  const steps = W.stepsOf(chunk({ start: 0, rate: 16, n: 1000, level: (t) => (t >= 5 && t < 6 ? 0.5 : 0.01) }));
  const avg = (k) => steps.get(k)[0] / steps.get(k)[1];
  assert.ok(avg(55) > 0.4);
  assert.ok(avg(20) < 0.02);
});

test('形の合わない記録は捨てる', () => {
  assert.equal(W.stepsOf(null).size, 0);
  assert.equal(W.stepsOf({ sr: 0, per: 48, bins: [1], marks: [[48, 1, 1]] }).size, 0);
  assert.equal(W.stepsOf({ sr: 48000, per: 48, bins: [], marks: [] }).size, 0);
});

test('記録のある割合と、最初の抜け (短い抜けは数えない)', () => {
  const vals = new Uint8Array(1000); // 100 秒
  for (let k = 0; k < 300; k++) vals[k] = 10; // 0〜30 秒
  vals[150] = 0; // 15 秒の 0.1 秒だけの抜け (広告の切れ目など)
  for (let k = 500; k < 1000; k++) vals[k] = 10; // 50〜100 秒
  assert.equal(W.firstGap(vals, 0, 100), 30);
  assert.equal(W.firstGap(vals, 50, 100), null);
  assert.ok(Math.abs(W.coverage(vals, 0, 100) - 0.799) < 0.01);
  assert.equal(W.coverage(vals, 50, 100), 1);
  assert.equal(W.firstGap(new Uint8Array(0), 0, 10), 0);
});
