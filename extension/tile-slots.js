// 枠の並び順 (order) を変える計算 (マルチビュー画面の「＋」「−」・空き枠の ✕・自動再生で詰めるとき)。
// 画面に触らない純粋な関数だけを置く (tests/tile-slots.test.js で、どんな枠の状態でも中身のある枠を消さないことを確かめる)。
// order = 枠の番号 (0〜15) を表示する順に並べたもの。先頭 count 個が見えている枠
/* exported TileSlots */
'use strict';

const TileSlots = (() => {
  /**
   * 何か入っている枠か (YouTube・Twitch の動画か、URL の枠・ファイルの枠)。
   * 「枠が空いているか」は必ずこれで見る (videoId だけで見ると URL の枠を空き枠と取り違える)
   */
  const filled = (t) => !!t && (!!t.videoId || !!t.web || !!t.file);

  /**
   * 表示する枠を n 個にするときの並び順。新しいレイアウトにもある番号 (n 番まで) の枠は中身をそのまま (番号を変えない)。
   * はみ出す番号 (n 番より後ろ) の中身は空き枠に移す。移す先は prefer を先に、残りは番号の大きい空き枠から
   * (元の番号に近いところ)。今より増やすときは、隠れている空き枠を後ろに足す。
   * 表示している中身のある枠の数が n 以下のときだけ使う (はみ出す中身が必ず空き枠に入るように)
   * @param {{order: number[], count: number, tiles: object[]}} s
   * @param {number} n
   * @param {number|null} [prefer] ✕ を押した空き枠の番号
   * @returns {number[]}
   */
  function keepNumbersOrder({ order, count, tiles }, n, prefer = null) {
    const shown = order.slice(0, count);
    const hiddenEmpty = order.slice(count).filter((j) => !filled(tiles[j]));
    const next = [...shown, ...hiddenEmpty].slice(0, n);
    const holes = next.map((j, k) => k).filter((k) => !filled(tiles[next[k]])).reverse();
    const at = next.indexOf(prefer);
    if (at >= 0 && holes.includes(at)) {
      holes.splice(holes.indexOf(at), 1);
      holes.unshift(at);
    }
    for (const j of shown.slice(n)) {
      if (filled(tiles[j])) next[holes.shift()] = j;
    }
    return [...next, ...order.filter((j) => !next.includes(j))];
  }

  /**
   * 並び順を out に変えて n 個を表示したとき、隠れていたのに見えるようになる中身のある枠。
   * 今より増やすのに隠れている空き枠が足りないと出てくる (keepNumbersOrder)。勝手に再生し始めないよう、呼ぶ側で空にする
   * @param {{order: number[], count: number, tiles: object[]}} s 変える前
   * @param {number[]} out 変えた後の並び順
   * @param {number} n
   * @returns {number[]}
   */
  function revealedFilled({ order, count, tiles }, out, n) {
    const shown = new Set(order.slice(0, count));
    return out.slice(0, n).filter((j) => !shown.has(j) && filled(tiles[j]));
  }

  /**
   * 枠を足すときの並び順。見えている枠は並びも中身もそのまま、その後ろに隠れている空き枠を先に置く
   * (隠れている枠に中身が残っていても、それは出さずに空き枠から使う)
   * @param {{order: number[], count: number, tiles: object[]}} s
   * @returns {number[]}
   */
  function growOrder({ order, count, tiles }) {
    const hidden = order.slice(count);
    return [...order.slice(0, count), ...hidden.filter((j) => !filled(tiles[j])), ...hidden.filter((j) => filled(tiles[j]))];
  }

  /**
   * 新しく中身を入れる先に使える枠 (used に無いもの)。空き枠を先に、番号の小さい順
   * @param {object[]} tiles
   * @param {Iterable<number>} used
   * @returns {number[]}
   */
  function freeTiles(tiles, used) {
    const u = new Set(used);
    const rest = tiles.map((_, j) => j).filter((j) => !u.has(j));
    return [...rest.filter((j) => !filled(tiles[j])), ...rest.filter((j) => filled(tiles[j]))];
  }

  return { filled, keepNumbersOrder, revealedFilled, growOrder, freeTiles };
})();
