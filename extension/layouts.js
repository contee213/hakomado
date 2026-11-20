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
    list.push({ id: `u${r}x${c}`, group: 'uniform', name: `${r}×${c}`, cols: c, rows: r, mains: 0, slots });
  }

  // ---- メイン + サブ (大きいメイン枠と小さいサブ枠)
  // 名前は「メイン数+サブ数」。同じ組み合わせは 1 種類だけなので、位置 (右・下など) は書かない。
  const add = (id, cols, rows, mains, subs) => {
    list.push({ id, group: 'main', name: `${mains.length}+${subs.length}`, cols, rows, mains: mains.length, slots: [...mains, ...subs] });
  };

  /** x0..x1, y0..y1 の範囲を 1 マスずつのサブ枠で埋める */
  const cells = (x0, y0, w, h) => {
    const out = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y, 1, 1]);
    return out;
  };
  /** メイン枠を cols 列 × rows 段に並べる (1 枠 = size × size マス) */
  const mainGrid = (cols, rows, size) => {
    const out = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) out.push([x * size, y * size, size, size]);
    return out;
  };

  // メイン 1
  add('m1s2', 3, 2, [[0, 0, 2, 2]], cells(2, 0, 1, 2)); // サブが右
  add('m1s3r', 4, 3, [[0, 0, 3, 3]], cells(3, 0, 1, 3)); // サブが右
  add('m1s4b', 4, 4, [[0, 0, 4, 3]], cells(0, 3, 4, 1)); // サブが下
  add('m1s5', 3, 3, [[0, 0, 2, 2]], [...cells(2, 0, 1, 2), ...cells(0, 2, 3, 1)]); // L 字 (右と下)
  add('m1s7', 4, 4, [[0, 0, 3, 3]], [...cells(3, 0, 1, 3), ...cells(0, 3, 4, 1)]); // L 字
  add('m1s8', 6, 4, [[0, 0, 4, 4]], cells(4, 0, 2, 4)); // サブが右に 2 列
  add('m1s9', 5, 5, [[0, 0, 4, 4]], [...cells(4, 0, 1, 4), ...cells(0, 4, 5, 1)]); // L 字
  add('m1s12', 4, 4, [[1, 1, 2, 2]], [ // メインが中央
    ...cells(0, 0, 4, 1),
    [0, 1, 1, 1], [3, 1, 1, 1],
    [0, 2, 1, 1], [3, 2, 1, 1],
    ...cells(0, 3, 4, 1),
  ]);

  // メイン 2 (横に並べ、サブは下)
  add('m2s3', 6, 3, [[0, 0, 3, 2], [3, 0, 3, 2]], [[0, 2, 2, 1], [2, 2, 2, 1], [4, 2, 2, 1]]);
  add('m2s4', 4, 3, mainGrid(2, 1, 2), cells(0, 2, 4, 1));
  add('m2s8', 4, 4, mainGrid(2, 1, 2), cells(0, 2, 4, 2));
  add('m2s12', 6, 5, mainGrid(2, 1, 3), cells(0, 3, 6, 2));

  // メイン 4 (2 × 2)
  add('m4s4', 5, 4, mainGrid(2, 2, 2), cells(4, 0, 1, 4)); // サブが右
  add('m4s6', 6, 7, mainGrid(2, 2, 3), cells(0, 6, 6, 1)); // サブが下
  add('m4s9', 5, 5, mainGrid(2, 2, 2), [...cells(4, 0, 1, 4), ...cells(0, 4, 5, 1)]); // L 字

  // メイン 6 (3 × 2) とメイン 8 (3 × 3 の 1 マスを 4 分割)
  add('m6s6', 6, 5, mainGrid(3, 2, 2), cells(0, 4, 6, 1));
  add('m6s9', 9, 7, mainGrid(3, 2, 3), cells(0, 6, 9, 1));
  add('m8s4', 6, 6, mainGrid(3, 3, 2).slice(0, 8), cells(4, 4, 2, 2));

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
