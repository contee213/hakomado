// 同期の調整パネルの図の目盛り (extension/sync-chart.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const C = load(['sync-chart.js']).get('SyncChart');
const S = 1000;
const M = 60 * S;

test('近い開始どうしは同じ縮尺で並び、順番どおり', () => {
  const sc = C.scale([0, 36 * S]);
  assert.ok(sc.pos(0) < sc.pos(36 * S));
  assert.equal(sc.breaks.length, 0);
  // 0.39 秒の補正も、見える幅 (0.3% 以上) になる
  assert.ok(sc.pos(36 * S) - sc.pos(36 * S - 390) > 0.3);
});

test('1 分・10 分・30 分の差が混ざっても、どの開始も見分けられる (間は切れ目に)', () => {
  const starts = [0, -1 * M, 10 * M, 30 * M];
  const sc = C.scale(starts);
  assert.equal(sc.breaks.length, 2, '1 分の差はそのままの縮尺、10 分・30 分の前に切れ目');
  const xs = starts.map(sc.pos).sort((a, b) => a - b);
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k] - xs[k - 1] >= 8, `開始どうしが近すぎる: ${xs}`);
  // 補正 (数秒) も、補正を入れた開始と実際の開始の両方を渡せば、そのまわりで見える
  const withCorr = C.scale([...starts, 30 * M - 2 * S]);
  assert.ok(withCorr.pos(30 * M) - withCorr.pos(30 * M - 2 * S) > 1);
  // 全部 0〜100 に収まる
  for (const t of [-10 * M, 5 * M, 20 * M, 3 * 60 * M]) {
    assert.ok(sc.pos(t) >= 0 && sc.pos(t) <= 100);
  }
});

test('同じ開始だけなら、真ん中を広く取りすぎない (0 で割らない)', () => {
  const sc = C.scale([5 * S, 5 * S]);
  assert.ok(Number.isFinite(sc.pos(5 * S)));
  assert.ok(sc.pos(5 * S + 390) > sc.pos(5 * S));
  assert.equal(C.scale([]), null);
});

test('切れ目の中の時刻は、切れ目の中に収まる', () => {
  const sc = C.scale([0, 10 * M]);
  const [b] = sc.breaks;
  assert.ok(sc.pos(0) < sc.pos(5 * M) && sc.pos(5 * M) < sc.pos(10 * M));
  assert.ok(Math.abs(sc.pos(5 * M) - b) < 6);
});
