// レイアウトの定義
// cols × rows の格子の上に、枠 (slot) を [列, 行, 横幅, 縦幅] で置く (0 始まり、単位は格子のマス)。
// slots の並び順 = 枠の番号。メイン枠を先に並べるので、1 番から順にメイン → サブになる。
// 種類 (group):
//  - uniform: 均等 (全部同じ大きさ)
//  - main: メイン + サブ。tools/layout-picks.json の形 (tools/gen-layouts.js が layouts-generated.js に書き出す)
//  - pip: PinP。メイン 1 枠の中に小窓 (メインの 1/5) を 1〜3 個重ねる
//  - vertical: 縦長の均等。どの枠も 9:16 (ショート・縦型の配信向け)。aspects = 枠ごとの目標の横/縦
// main と pip は、基準位置 (anchor: tl / bl / tr / br = メインを置く角) ごとにある。
// 計算した形は左上 (tl) が基準で、他は反転して作る。サブ・小窓はメインと反対側に来る
// (PinP は基準が左上なら小窓が右下)
// kind: uniform = 均等 / pip = PinP / vertical = 縦長 / main は focus = メイン重視 (サブが小さい)・balance = バランス (サブが大きい)・single = それ以外
// recommended = 枠数 × メインの数ごとのおすすめ (本数が決まったときに自動で選ぶ。RECOMMENDED_LAYOUT_KEYS)
// tab = レイアウト画面の「おすすめ」タブに出す (TAB_LAYOUT_KEYS)
/* exported LAYOUTS, ANCHORS, DEFAULT_LAYOUT_ID, MAX_SLOTS, getLayout, layoutFor, layoutIdOf, solveTracks, mainCountOf, resizeLayoutFor */
/* global GENERATED_LAYOUTS, RECOMMENDED_LAYOUT_KEYS, TAB_LAYOUT_KEYS */
'use strict';

const ANCHORS = ['tl', 'bl', 'tr', 'br'];

const LAYOUTS = (() => {
  const list = [];

  const rec = new Set(RECOMMENDED_LAYOUT_KEYS);
  const tab = new Set(TAB_LAYOUT_KEYS);

  // ---- 均等 (縦 × 横)
  // 16:9 の画面を 50% 以上使うもの (1×3・2×4 などの細長いものは入れない)。
  // 2×4・4×2 は 2+6 にどの枠も負けるので入れない
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 2], [3, 3], [3, 4], [4, 3], [3, 5], [5, 3], [4, 4]]) {
    const slots = [];
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) slots.push([x, y, 1, 1]);
    const key = `u${r}x${c}`;
    list.push({ id: key, key, group: 'uniform', kind: 'uniform', name: `${r}×${c}`, cols: c, rows: r, mains: 0, recommended: rec.has(key), tab: tab.has(key), slots });
  }

  // ---- 縦長 (縦 × 横)。どの枠も 9:16。3 枚を横に並べると 27:16 で、16:9 の画面をほぼ埋める (6×2 の 12 枚も同じ)
  // 16:9 の画面を 50% 以上使うもの。1×1・1×2 は均等の枠でも縦長に寄せれば同じ広さになるので入れない
  for (const [r, c] of [[1, 3], [1, 4], [1, 5], [1, 6], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8]]) {
    const slots = [];
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) slots.push([x, y, 1, 1]);
    const key = `v${r}x${c}`;
    list.push({ id: key, key, group: 'vertical', kind: 'vertical', name: `▯${r}×${c}`, cols: c, rows: r, mains: 0, recommended: false, tab: false, aspects: slots.map(() => 9 / 16), slots });
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
        recommended: rec.has(g.key),
        tab: tab.has(g.key),
        slots,
      });
    }
  }
  return list;
})();

const DEFAULT_LAYOUT_ID = 'u2x2';
const MAX_SLOTS = Math.max(...LAYOUTS.map((l) => l.slots.length));

// 今は無いレイアウトの置き換え先 (形の key → 置き換え先の id)。共有コード・保存したセッションに残っている id を読むため
// m8s8-sw (2026-11 に外した 8+8): どの枠も 4×4 の均等より小さい
const RETIRED_LAYOUTS = { 'm8s8-sw': 'u4x4' };

/** 今使える id (今は無いものは置き換え先)。分からなければ null */
function layoutIdOf(id) {
  if (typeof id !== 'string') return null;
  if (LAYOUTS.some((l) => l.id === id)) return id;
  const key = id.replace(/^(tl|bl|tr|br)-/, '');
  return Object.hasOwn(RETIRED_LAYOUTS, key) ? RETIRED_LAYOUTS[key] : null;
}

function getLayout(id) {
  const found = layoutIdOf(id);
  return LAYOUTS.find((l) => l.id === found) || LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID);
}

/** 同じ形 (key) で基準位置 anchor のレイアウト。均等など基準位置の無いものはそのまま */
function layoutFor(key, anchor) {
  return LAYOUTS.find((l) => l.key === key && (!l.anchor || l.anchor === anchor)) || null;
}

/** メイン枠の数 (均等・縦長はどの枠も同じ大きさなので、全部をメイン枠として数える) */
function mainCountOf(l) {
  return l.group === 'uniform' || l.group === 'vertical' ? l.slots.length : l.mains;
}

/**
 * 上部バーの「＋」「−」などで、枠数をちょうど k にするときのレイアウト (合うものが無ければ null)。優先する順に:
 *  1. 縦長を使っているときは縦長、PinP を使っているときは PinP
 *  2. メイン枠の数が今より減らない (均等・縦長は全部メイン枠。減らないものが無ければ、今に一番近いもの)
 *  3. メイン枠の数が一番多い (均等がある枠数なら均等になる)
 *  4. おすすめ
 *  5. 今と同じ基準位置
 *  6. 映像が画面を占める割合が大きい (area)
 *  7. LAYOUTS の並び順
 * 今のレイアウトにほとんど関係なく枠数ごとに形が決まるので、＋ してから − すれば元に戻る。
 * PinP・縦長は、今それを使っているときだけ選ぶ。クルーズ中 (3 枠以上) はメイン枠を回せるようメイン + サブだけ
 * @param {number} k
 * @param {{mains: number, group: string, anchor: string, kind?: string, slots?: any[]}} base 今のレイアウト
 * @param {{cruise?: boolean, area?: (l: object) => number}} [opts] area = 映像が画面を占める割合
 */
function resizeLayoutFor(k, base, { cruise = false, area = () => 0 } = {}) {
  let pool = LAYOUTS.filter((l) => l.slots.length === k && (l.group !== 'pip' || base.group === 'pip') && (l.group !== 'vertical' || base.group === 'vertical'));
  if (cruise && k >= 3) pool = pool.filter((l) => l.mains > 0);
  if (!pool.length) return null;
  const cur = base.slots ? mainCountOf(base) : base.mains;
  const keep = pool.some((l) => mainCountOf(l) >= cur);
  const rank = (l, i) => [
    base.group === 'vertical' && l.group !== 'vertical' ? 1 : 0,
    base.kind === 'pip' && l.kind !== 'pip' ? 1 : 0,
    mainCountOf(l) >= cur ? 0 : 1,
    keep ? 0 : Math.abs(mainCountOf(l) - cur),
    -mainCountOf(l),
    l.recommended ? 0 : 1,
    (l.anchor ?? base.anchor) === base.anchor ? 0 : 1,
    -area(l),
    i,
  ];
  const better = (x, y) => {
    for (let j = 0; j < x.length; j++) if (Math.abs(x[j] - y[j]) > 1e-3) return x[j] < y[j];
    return false;
  };
  let best = null;
  pool.forEach((l, i) => {
    const r = rank(l, i);
    if (!best || better(r, best.r)) best = { l, r };
  });
  return best.l;
}

/**
 * どの枠もなるべく 16:9 になるような列の幅・行の高さ (相対値) を求める。
 * 枠ごとに「横長すぎなら列を縮めて行を伸ばす」補正を掛け、各列・各行は関係する枠の補正の幾何平均を取る。
 * これを繰り返すと、ここで定義しているレイアウトはどれもちょうど 16:9 に収束する。
 * aspects (省略可) = 枠ごとの目標の横/縦 (縦長の映像の枠は 9/16 など)。省略時はレイアウトの aspects (無ければどれも 16:9)。
 * 同じ列・行に違う目標の枠があると、間の比で止まる
 * @param {number[]} [aspects]
 * @returns {{colW: number[], rowH: number[], aspect: number}} aspect = 全体の横/縦
 */
function solveTracks(l, aspects) {
  const key = aspects ? aspects.map((a) => a.toFixed(4)).join(',') : '';
  if (!l._tracks) l._tracks = new Map();
  if (l._tracks.has(key)) return l._tracks.get(key);
  let colW = Array(l.cols).fill(16);
  let rowH = Array(l.rows).fill(9);
  for (let iter = 0; iter < 300; iter++) {
    const colLog = Array(l.cols).fill(0), colN = Array(l.cols).fill(0);
    const rowLog = Array(l.rows).fill(0), rowN = Array(l.rows).fill(0);
    let worst = 0;
    l.slots.forEach(([x, y, w, h], k) => {
      const target = (aspects && aspects[k]) || (l.aspects && l.aspects[k]) || 16 / 9;
      let sw = 0, sh = 0;
      for (let i = x; i < x + w; i++) sw += colW[i];
      for (let j = y; j < y + h; j++) sh += rowH[j];
      const err = Math.log(sw / sh / target);
      worst = Math.max(worst, Math.abs(err));
      for (let i = x; i < x + w; i++) { colLog[i] -= err / 2; colN[i]++; }
      for (let j = y; j < y + h; j++) { rowLog[j] += err / 2; rowN[j]++; }
    });
    if (worst < 1e-4) break;
    colW = colW.map((v, i) => v * Math.exp(colLog[i] / colN[i]));
    rowH = rowH.map((v, j) => v * Math.exp(rowLog[j] / rowN[j]));
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const out = { colW, rowH, aspect: sum(colW) / sum(rowH) };
  if (l._tracks.size > 64) l._tracks.clear();
  l._tracks.set(key, out);
  return out;
}
