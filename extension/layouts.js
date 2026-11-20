// レイアウトの定義
// cols × rows の格子の上に、枠 (slot) を [列, 行, 横幅, 縦幅] で置く (0 始まり、単位は格子のマス)。
// slots の並び順 = 枠の番号。メイン枠を先に並べるので、1 番から順にメイン → サブになる。
// 種類 (group):
//  - uniform: 均等 (全部同じ大きさ)
//  - main: メイン + サブ。tools/gen-layouts.js が計算した形 (layouts-generated.js)
//  - pip: PinP。メイン 1 枠の中に小窓 (メインの 1/5) を 1〜3 個重ねる
// main と pip は、基準位置 (anchor: tl / bl / tr / br = メインを置く角) ごとにある。
// 計算した形は左上 (tl) が基準で、他は反転して作る。サブ・小窓はメインと反対側に来る
// (PinP は基準が左上なら小窓が右下)
// kind: uniform = 均等 / pip = PinP / main は focus = メイン重視 (サブが小さい)・balance = バランス (サブが大きい)・single = 1 種類だけ
/* exported LAYOUTS, ANCHORS, DEFAULT_LAYOUT_ID, MAX_SLOTS, getLayout, layoutFor, solveTracks */
/* global GENERATED_LAYOUTS */
'use strict';

const ANCHORS = ['tl', 'bl', 'tr', 'br'];

const LAYOUTS = (() => {
  const list = [];

  // ---- 均等 (縦 × 横)
  // 16:9 の画面で映像が画面の半分程度以下になるもの (1×3・1×4・2×1・3×1・4×1・2×4・4×2) は使わないので入れない。
  // 1×2 (約 52%) は 2 本を並べるのに必要なので残す
  for (const [r, c] of [[1, 1], [1, 2], [2, 2], [2, 3], [3, 2], [3, 3], [3, 4], [4, 3], [4, 4]]) {
    const slots = [];
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) slots.push([x, y, 1, 1]);
    list.push({ id: `u${r}x${c}`, key: `u${r}x${c}`, group: 'uniform', kind: 'uniform', name: `${r}×${c}`, cols: c, rows: r, mains: 0, slots });
  }

  // ---- 左上を基準にした形 (メイン + サブ と PinP)。これを反転して 4 つの基準位置を作る
  const base = GENERATED_LAYOUTS.map((g) => ({ ...g, group: 'main', name: `${g.mains}+${g.subs}` }));
  // PinP: 5 × 5 マスのメイン 1 枠に、1 マス (= メインの 1/5) の小窓を右下の角から上へ重ねる
  for (let n = 1; n <= 3; n++) {
    const slots = [[0, 0, 5, 5]];
    for (let k = 0; k < n; k++) slots.push([4, 4 - k, 1, 1]);
    base.push({ key: `pip${n}`, group: 'pip', kind: 'pip', mains: 1, subs: n, name: `PinP 1+${n}`, cols: 5, rows: 5, slots });
  }

  const flips = { tl: [false, false], bl: [false, true], tr: [true, false], br: [true, true] };
  for (const anchor of ANCHORS) {
    const [fx, fy] = flips[anchor];
    for (const g of base) {
      const slots = g.slots.map(([x, y, w, h]) => [fx ? g.cols - x - w : x, fy ? g.rows - y - h : y, w, h]);
      list.push({
        id: `${anchor}-${g.key}`,
        key: g.key,
        anchor,
        group: g.group,
        kind: g.kind,
        name: g.name,
        cols: g.cols,
        rows: g.rows,
        mains: g.mains,
        overlap: g.group === 'pip', // 枠が重なる (小窓をメインの上に出す)
        slots,
      });
    }
  }
  return list;
})();

const DEFAULT_LAYOUT_ID = 'u2x2';
const MAX_SLOTS = Math.max(...LAYOUTS.map((l) => l.slots.length));

function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID);
}

/** 同じ形 (key) で基準位置 anchor のレイアウト。均等など基準位置の無いものはそのまま */
function layoutFor(key, anchor) {
  return LAYOUTS.find((l) => l.key === key && (!l.anchor || l.anchor === anchor)) || null;
}

/**
 * どの枠もなるべく 16:9 になるような列の幅・行の高さ (相対値) を求める。
 * 枠ごとに「横長すぎなら列を縮めて行を伸ばす」補正を掛け、各列・各行は関係する枠の補正の幾何平均を取る。
 * これを繰り返すと、ここで定義しているレイアウトはどれもちょうど 16:9 に収束する。
 * @returns {{colW: number[], rowH: number[], aspect: number}} aspect = 全体の横/縦
 */
function solveTracks(l) {
  if (l._tracks) return l._tracks;
  const target = 16 / 9;
  let colW = Array(l.cols).fill(16);
  let rowH = Array(l.rows).fill(9);
  for (let iter = 0; iter < 300; iter++) {
    const colLog = Array(l.cols).fill(0), colN = Array(l.cols).fill(0);
    const rowLog = Array(l.rows).fill(0), rowN = Array(l.rows).fill(0);
    let worst = 0;
    for (const [x, y, w, h] of l.slots) {
      let sw = 0, sh = 0;
      for (let i = x; i < x + w; i++) sw += colW[i];
      for (let j = y; j < y + h; j++) sh += rowH[j];
      const err = Math.log(sw / sh / target);
      worst = Math.max(worst, Math.abs(err));
      for (let i = x; i < x + w; i++) { colLog[i] -= err / 2; colN[i]++; }
      for (let j = y; j < y + h; j++) { rowLog[j] += err / 2; rowN[j]++; }
    }
    if (worst < 1e-4) break;
    colW = colW.map((v, i) => v * Math.exp(colLog[i] / colN[i]));
    rowH = rowH.map((v, j) => v * Math.exp(rowLog[j] / rowN[j]));
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  l._tracks = { colW, rowH, aspect: sum(colW) / sum(rowH) };
  return l._tracks;
}
