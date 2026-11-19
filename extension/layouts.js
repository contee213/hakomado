// おすすめレイアウトの定義
// cols × rows の格子の上に、枠 (slot) を [列, 行, 横幅, 縦幅] で置く (0 始まり、単位は格子のマス)。
// slots の並び順 = 枠の番号。メイン枠を先に並べるので、1 番から順にメイン → サブになる。
/* exported LAYOUTS, DEFAULT_LAYOUT_ID, MAX_SLOTS, getLayout, solveTracks */
'use strict';

const LAYOUTS = (() => {
  const list = [];

  // ---- 均等 (縦 × 横)
  // 16:9 の画面で映像が画面の半分程度以下になるもの (1×3・1×4・2×1・3×1・4×1・2×4・4×2) は使わないので入れない。
  // 1×2 (約 52%) は 2 本を並べるのに必要なので残す
  for (const [r, c] of [[1, 1], [1, 2], [2, 2], [2, 3], [3, 2], [3, 3], [3, 4], [4, 3], [4, 4]]) {
    const slots = [];
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) slots.push([x, y, 1, 1]);
    list.push({ id: `u${r}x${c}`, group: '均等', name: `${r}×${c}`, cols: c, rows: r, mains: 0, slots });
  }

  // ---- メイン + サブ (メイン 1〜4 枠と小さいサブ枠)
  const add = (id, name, cols, rows, mains, subs) =>
    list.push({ id, group: 'メイン + サブ', name, cols, rows, mains: mains.length, slots: [...mains, ...subs] });

  /** x0..x1, y0..y1 の範囲を 1 マスずつのサブ枠で埋める */
  const cells = (x0, y0, w, h) => {
    const out = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y, 1, 1]);
    return out;
  };

  add('m1s2', '1 + 2', 3, 2, [[0, 0, 2, 2]], cells(2, 0, 1, 2));
  add('m1s3r', '1 + 3 (右)', 4, 3, [[0, 0, 3, 3]], cells(3, 0, 1, 3));
  add('m1s4b', '1 + 4 (下)', 4, 4, [[0, 0, 4, 3]], cells(0, 3, 4, 1));
  add('m1s5', '1 + 5', 3, 3, [[0, 0, 2, 2]], [...cells(2, 0, 1, 2), ...cells(0, 2, 3, 1)]);
  add('m1s7', '1 + 7', 4, 4, [[0, 0, 3, 3]], [...cells(3, 0, 1, 3), ...cells(0, 3, 4, 1)]);
  add('m1s12', '1 + 12 (中央)', 4, 4, [[1, 1, 2, 2]], [
    ...cells(0, 0, 4, 1),
    [0, 1, 1, 1], [3, 1, 1, 1],
    [0, 2, 1, 1], [3, 2, 1, 1],
    ...cells(0, 3, 4, 1),
  ]);

  add('m2s3', '2 + 3 (下)', 6, 3, [[0, 0, 3, 2], [3, 0, 3, 2]], [[0, 2, 2, 1], [2, 2, 2, 1], [4, 2, 2, 1]]);
  add('m2s4', '2 + 4 (下)', 4, 3, [[0, 0, 2, 2], [2, 0, 2, 2]], cells(0, 2, 4, 1));
  add('m2s8', '2 + 8 (下)', 4, 4, [[0, 0, 2, 2], [2, 0, 2, 2]], cells(0, 2, 4, 2));

  add('m3s4', '3 + 4', 4, 4, [[0, 0, 2, 2], [2, 0, 2, 2], [0, 2, 2, 2]], cells(2, 2, 2, 2));
  add('m3s9', '3 + 9', 6, 6, [[0, 0, 3, 3], [3, 0, 3, 3], [0, 3, 3, 3]], cells(3, 3, 3, 3));

  add('m4s4', '4 + 4 (右)', 5, 4, [[0, 0, 2, 2], [2, 0, 2, 2], [0, 2, 2, 2], [2, 2, 2, 2]], cells(4, 0, 1, 4));

  return list;
})();

const DEFAULT_LAYOUT_ID = 'u2x2';
const MAX_SLOTS = Math.max(...LAYOUTS.map((l) => l.slots.length));

function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID);
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
