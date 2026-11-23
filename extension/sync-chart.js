// hakomado: 同期の調整パネルの図の目盛り (各枠の開始のあたりを並べる)。画面には触らない計算だけ
// - 開始どうしが近いところ (まとまり) は、同じ縮尺で拡大して見せる (数秒の補正も見えるように)
// - まとまりとまとまりの間が GAP_MS より空いていれば、間を詰めて一定の幅の切れ目 (≈) にする
//   (1 分・10 分・30 分の差が混ざっても、どの枠の開始も見分けられるように。正確な差は図の横の文字で出す)
// 位置は 0〜100 (%)。左に少し余白、右は棒が続く余白を残す
/* exported SyncChart */
'use strict';

const SyncChart = (() => {
  const GAP_MS = 60000; // これより空いた間は切れ目にする
  const MIN_VIEW_MS = 6000; // まとまりが狭くても、拡大しすぎない (少なくともこの幅を見せる)
  const LEAD = 8; // 左の余白 (%)
  const TAIL = 22; // 右の余白 (%。棒が右へ続いて見えるように)
  const BREAK = 10; // 切れ目の幅 (%)

  /**
   * @param {number[]} points 開始の時刻 (ミリ秒。補正を入れたものと入れないもの)
   * @returns {{pos: (t: number) => number, breaks: number[], first: number, last: number}|null}
   *   pos = 時刻 → 位置 (%、0〜100 に収める)、breaks = 切れ目の真ん中の位置 (%)
   */
  function scale(points) {
    const xs = [...new Set(points.filter(Number.isFinite))].sort((a, b) => a - b);
    if (!xs.length) return null;
    const groups = [];
    for (const x of xs) {
      const g = groups[groups.length - 1];
      if (g && x - g.hi <= GAP_MS) g.hi = x;
      else groups.push({ lo: x, hi: x });
    }
    const span = groups.reduce((s, g) => s + (g.hi - g.lo), 0);
    const room = 100 - LEAD - TAIL - BREAK * (groups.length - 1);
    const k = room / Math.max(span, MIN_VIEW_MS); // % / ミリ秒 (まとまりの中は、どこも同じ縮尺)
    let x = LEAD;
    for (const g of groups) {
      g.x0 = x;
      g.x1 = x + (g.hi - g.lo) * k;
      x = g.x1 + BREAK;
    }
    const clamp = (v) => Math.max(0, Math.min(100, v));
    function pos(t) {
      const first = groups[0];
      if (t <= first.lo) return clamp(first.x0 - (first.lo - t) * k);
      for (let n = 0; n < groups.length; n++) {
        const g = groups[n];
        if (t <= g.hi) return clamp(g.x0 + (t - g.lo) * k);
        const next = groups[n + 1];
        if (next && t < next.lo) return clamp(g.x1 + (BREAK * (t - g.hi)) / (next.lo - g.hi)); // 切れ目の中は詰めて
      }
      const last = groups[groups.length - 1];
      return clamp(last.x1 + (t - last.hi) * k);
    }
    const breaks = groups.slice(0, -1).map((g) => g.x1 + BREAK / 2);
    return { pos, breaks, first: xs[0], last: xs[xs.length - 1] };
  }

  return { scale, GAP_MS };
})();
