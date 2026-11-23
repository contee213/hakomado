// hakomado: アーカイブの同期再生の「✨ 自動補正」(音で合わせる) の計算部分 (画面に触らない)。
// grid.html では audio-align-worker.js (Worker) の中で動かす (何秒もかかることがあり、その間に画面と同期が止まらないように)。
// コラボの各視点には通話の声が共通して入っているので、各枠の音の大きさ (包絡、1 ミリ秒ごと) を実際の時刻の軸に
// 並べて突き合わせ (相互相関)、枠どうしのずれを求める。枠の中での記録は content/watch.js、流れは grid.js の AudioSync。
// - 記録 (track): 枠から届いたものをそのまま貯めたもの
//     { sr, per, bins: number[] (包絡。per サンプルごとの |x| の平均), marks: [[累計サンプル数, 再生位置 (秒), 速度], ...] }
//   marks はバッファごと。累計サンプル数は「再生中で、広告でない」間だけ数える (止まっていた間は記録が飛ぶ)。
//   隠れた枠ではサンプルが抜けることがあるので、ビンの再生位置は marks から求める (前後のバッファの中央値で平らにする)
// - ずれの向きは SyncOffsets と同じ (秒、+ = 先へ進める)。ある枠の補正値に lag/1000 を足すと、その枠が基準にそろう
// - 2 人の配信では、相関のピークが 2 つに分かれる (A の声は A の枠に直接・B の枠に通話経由で入るため。差 = 通話の遅れ ×2)。
//   既定はその中間 (映像がそろう)。3 人以上では、第三者の声のピークがちょうど中間に出るので、それを採る
/* exported AudioAlign */
'use strict';

const AudioAlign = (() => {
  const MAX_LAG_MS = 120000; // 探すずれの範囲 (±)。配信の遅れの差は 1 分を超えることがある (実測: 5 人のコラボで 63 秒。
  // 範囲が狭いと、範囲の中で偶然そっくりな所 (実測: 本当の位置から 30 秒ずれた所) を ◎ で拾ってしまう)
  const SINGLE_WEIGHT = 0.3; // 3 枠以上で「1 人の声だけのピーク」の組の重み (その人の声は通話の遅れぶん片寄るので、3 人目の声・2 人の声の中間を優先する)
  const MIN_OVERLAP_MS = 20000; // 突き合わせに要る重なり
  const MIN_TRACK_MS = 30000; // これより短い記録は使わない
  const Z_OK = 5; // これ以上の z 値を採用する
  const PEAK_SEP_MS = 150; // 別のピークとみなす間隔
  const PAIR_MIN_MS = 150; // 2 人の声のピークの間隔 (= 通話の遅れ ×2) としてありうる範囲
  const PAIR_MAX_MS = 800;
  const OUTLIER_MS = 50; // 全部の組で解いたときに外れ値とみなす残差
  const SECOND_OVER_NOISE = 1.6; // 2 つ目のピークが 3 つ目のこの倍以上なら、雑音ではなく声とみなす
  const MIRROR_MS = 30; // 対称とみなす位置のずれ
  const SPLIT_MS = 80; // 前半・後半の答えが、全体の答えからこれ以上離れていたら食い違い

  // ---------------------------------------------------------------- 実際の時刻の軸へ
  /**
   * 記録を、実際の時刻 (ミリ秒) の 1 ミリ秒刻みの軸に並べ直す。
   * startMs = 配信の開始時刻、off = その動画の今の補正値 (秒)。止まっていた・広告の間など、記録の無い所は mask = 0
   * @returns {{r0: number, x: Float64Array, mask: Uint8Array} | null}
   */
  function toReal(track, startMs, off = 0) {
    const { sr, per, bins, marks } = track || {};
    if (!(sr > 0) || !(per > 0) || !bins?.length || !marks?.length) return null;
    // 速度 (同期が少しのずれを速度で詰める) を考えた「記録の始めからの再生の進み」m。バッファ k の中のサンプル s の再生位置は
    // 基点 + m[k-1] + 速度 × (s − n[k-1]) / sr。基点 (再生位置 − m) を前後 8 バッファの中央値で平らにする
    const m = new Float64Array(marks.length);
    for (let k = 0; k < marks.length; k++) {
      const prevN = k ? marks[k - 1][0] : 0;
      m[k] = (k ? m[k - 1] : 0) + ((marks[k][2] || 1) * (marks[k][0] - prevN)) / sr;
    }
    const base = marks.map(([, t], k) => t - m[k]);
    const W = 8;
    const med = base.map((_, k) => {
      const w = base.slice(Math.max(0, k - W), k + W + 1).sort((a, b) => a - b);
      return w[w.length >> 1];
    });
    // ビンの中央のサンプル → それを含むバッファの基点 → 再生位置 → 実際の時刻
    const real = new Float64Array(bins.length);
    let k = 0;
    for (let j = 0; j < bins.length; j++) {
      const s = (j + 0.5) * per;
      while (k < marks.length - 1 && marks[k][0] < s) k++;
      const prevN = k ? marks[k - 1][0] : 0;
      const pos = med[k] + (k ? m[k - 1] : 0) + ((marks[k][2] || 1) * (s - prevN)) / sr;
      real[j] = startMs + (pos - off) * 1000;
    }
    const r0 = Math.ceil(real[0]);
    const r1 = Math.floor(real[bins.length - 1]);
    if (!(r1 > r0)) return null;
    const len = Math.min(r1 - r0, 24 * 3600 * 1000);
    const x = new Float64Array(len);
    const mask = new Uint8Array(len);
    let j = 0;
    for (let i = 0; i < len; i++) {
      const r = r0 + i;
      while (j < bins.length - 2 && real[j + 1] < r) j++;
      const a = real[j];
      const b = real[j + 1];
      // 隣のビンと 5 ミリ秒以上離れている (記録が飛んだ) 所は使わない
      if (!(b > a) || b - a > 5 || r < a || r > b) continue;
      const f = (r - a) / (b - a);
      x[i] = bins[j] * (1 - f) + bins[j + 1] * f;
      mask[i] = 1;
    }
    return { r0, x, mask };
  }

  /** 包絡を圧縮し (平方根)、±150 ミリ秒の移動平均を引いて (声の立ち上がりだけ残す)、RMS で割る。記録の無い所は 0 */
  function prep(x, mask, w = 150) {
    const n = x.length;
    const cs = new Float64Array(n + 1);
    const cm = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      cs[i + 1] = cs[i] + (mask[i] ? Math.sqrt(x[i]) : 0);
      cm[i + 1] = cm[i] + mask[i];
    }
    const y = new Float64Array(n);
    let ss = 0;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const a = Math.max(0, i - w);
      const b = Math.min(n, i + w + 1);
      y[i] = Math.sqrt(x[i]) - (cs[b] - cs[a]) / (cm[b] - cm[a]);
      ss += y[i] * y[i];
      cnt++;
    }
    const rms = Math.sqrt(ss / Math.max(1, cnt)) || 1;
    for (let i = 0; i < n; i++) y[i] /= rms;
    return y;
  }

  // ---------------------------------------------------------------- 相互相関
  function fft(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((2 * Math.PI) / len) * (inv ? 1 : -1);
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < half; k++) {
          const h = i + k + half;
          const vr = re[h] * cr - im[h] * ci;
          const vi = re[h] * ci + im[h] * cr;
          re[h] = re[i + k] - vr;
          im[h] = im[i + k] - vi;
          re[i + k] += vr;
          im[i + k] += vi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
    if (inv) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  /** FFT の長さ (2 のべき乗) */
  function sizeFor(len) {
    let N = 1;
    while (N < len) N <<= 1;
    return N;
  }
  /** スペクトル (計算は倍精度、持っておくのは単精度: 枠ごとに使い回すので、メモリを半分にする) */
  function spectrumOf(v, N) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re.set(v);
    fft(re, im, false);
    return [Float32Array.from(re), Float32Array.from(im)];
  }
  /** c[s] = Σ_t a[t]·b[t+s] (s は b の添字のずれ。負もある)。FA・FB = a・b のスペクトル。戻り値は s → 値 の関数 */
  function crossCorr(FA, FB) {
    const [ar, ai] = FA;
    const [br, bi] = FB;
    const N = ar.length;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      // conj(A)·B
      re[i] = ar[i] * br[i] + ai[i] * bi[i];
      im[i] = ar[i] * bi[i] - ai[i] * br[i];
    }
    fft(re, im, true);
    return (k) => re[((k % N) + N) % N];
  }
  /** 突き合わせの下ごしらえ (枠ごとに 1 回): 前処理した包絡と、記録のある所の印のスペクトル */
  function spectra(R, N) {
    return { r0: R.r0, y: spectrumOf(prep(R.x, R.mask), N), m: spectrumOf(R.mask, N) };
  }

  /**
   * 2 つの実時刻の軸の記録を突き合わせる。lag (ミリ秒) = b の中の音が、a の中の同じ音より何ミリ秒あとの実時刻にあるか
   * (= b の枠の補正値に lag/1000 を足すと a にそろう)。
   * @returns {{lag: number, z: number}[]} 強い順のピーク (最大 6 つ)。突き合わせられなければ空
   */
  function correlate(A, B, opts) {
    const N = sizeFor(A.x.length + B.x.length);
    return correlateSpectra(spectra(A, N), spectra(B, N), opts);
  }
  /** correlate の続き (スペクトルを作ってあるとき。SA・SB は同じ長さの FFT) */
  function correlateSpectra(SA, SB, { maxLag = MAX_LAG_MS, minOverlap = MIN_OVERLAP_MS } = {}) {
    const c = crossCorr(SA.y, SB.y);
    const ov = crossCorr(SA.m, SB.m);
    const d = SA.r0 - SB.r0; // a[t] と同じ実時刻の b の添字 = t + d
    const lags = [];
    const vals = [];
    for (let L = -maxLag; L <= maxLag; L++) {
      const n = Math.round(ov(d + L));
      if (n < minOverlap) continue;
      lags.push(L);
      // 重なりの長さ n の平方根で割る (相関のばらつきは √n に比例するので、重なりの短いずれで偶然のピークが目立たないように)
      vals.push(c(d + L) / Math.sqrt(n));
    }
    if (vals.length < 3) return [];
    const sorted = [...vals].sort((x, y) => x - y);
    const medv = sorted[sorted.length >> 1];
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - medv) ** 2, 0) / vals.length) || 1;
    const cand = [];
    for (let i = 1; i < vals.length - 1; i++) {
      if (lags[i + 1] - lags[i - 1] !== 2) continue; // 途切れの境目は除く
      if (vals[i] >= vals[i - 1] && vals[i] > vals[i + 1]) cand.push([lags[i], (vals[i] - medv) / sd]);
    }
    cand.sort((p, q) => q[1] - p[1]);
    const out = [];
    for (const [lag, z] of cand) {
      if (out.every((p) => Math.abs(p.lag - lag) >= PEAK_SEP_MS)) out.push({ lag, z: Math.round(z * 10) / 10 });
      if (out.length >= 6) break;
    }
    return out;
  }

  /**
   * ピークから合わせる位置を選ぶ。
   * - (3 人以上のとき) 強い 3 つが 1 秒以内に並び、真ん中が中ほどにある → 真ん中 (第三者の声。どの枠にも通話経由で入るので、
   *   配信システムの遅れの差そのもの)。通話の遅れは人ごとに少し違うので、等間隔はおおよそでよい (実測: 207 / 484 / 841)
   * - 強い 2 つが 0.15〜0.8 秒離れている → 中間 (2 人の声。lo = 相手 (b) の声、hi = 基準 (a) の声に合わせる位置)。
   *   片方の人がよく話していると、もう一人の声のピークは 1 つ目の半分より弱くなる (実測: 15.8 と 6.8)。
   *   そのときも、2 つ目が 1 つ目の 0.35 倍以上で、ほかのピーク (雑音) よりはっきり強ければ、2 人の声とみなす。
   *   ただし 1 つ目の左右に対称に出るピークは、声の音節の周期でできる偽のピークなので、声にも雑音にも数えない
   * - どちらでもない → 一番強いピーク
   * 2 人のときに 3 つ目を採らないのは、相関の裾にできる偽のピークを第三者の声と取り違えないため
   * @returns {{lag: number, z: number, kind: 'single'|'pair'|'triple', lo?: number, hi?: number} | null}
   */
  function pick(peaks, allowTriple = true) {
    if (!peaks.length) return null;
    const top = peaks.slice(0, 3);
    if (allowTriple && top.length === 3 && top.every((p) => p.z >= 3)) {
      const s = top.map((p) => p.lag).sort((x, y) => x - y);
      const span = s[2] - s[0];
      const d1 = s[1] - s[0];
      const d2 = s[2] - s[1];
      if (span >= PAIR_MIN_MS && span <= PAIR_MAX_MS * 1.25 && d1 >= span * 0.3 && d2 >= span * 0.3) {
        return { lag: s[1], z: Math.min(...top.map((p) => p.z)), kind: 'triple', lo: s[0], hi: s[2] };
      }
    }
    const p = peaks[0];
    const gapOk = (x) => Math.abs(p.lag - x.lag) >= PAIR_MIN_MS && Math.abs(p.lag - x.lag) <= PAIR_MAX_MS;
    // 1 つ目をはさんで対称の位置にもピークがある (音節の周期の偽のピーク)
    const mirrored = (x) => peaks.some((y) => y !== x && y !== p && Math.abs(y.lag + x.lag - 2 * p.lag) <= MIRROR_MS && y.z >= x.z * 0.6);
    let q = peaks[1];
    if (q && !(q.z >= p.z * 0.5)) {
      // 2 つ目が弱め: 偽のピークでなく、雑音よりはっきり強いものだけを 2 人目の声とみなす
      q = peaks.slice(1).find((x) => gapOk(x) && !mirrored(x));
      const noise = q ? Math.max(0, ...peaks.filter((x) => x !== p && x !== q && !mirrored(x)).map((x) => x.z)) : 0;
      if (q && !(q.z >= p.z * 0.35 && q.z >= noise * SECOND_OVER_NOISE)) q = null;
    }
    if (q && q.z >= Z_OK * 0.8 && gapOk(q)) {
      const lo = Math.min(p.lag, q.lag);
      const hi = Math.max(p.lag, q.lag);
      return { lag: Math.round((lo + hi) / 2), z: Math.min(p.z, q.z), kind: 'pair', lo, hi };
    }
    return { lag: p.lag, z: p.z, kind: 'single' };
  }

  // ---------------------------------------------------------------- 全部の組を解く
  /**
   * 組ごとのずれ (x[j] − x[i] = lag) から、各枠のずれを最小二乗で求める (基準の枠 = 0)。
   * 残差が大きい組は外れ値として除いて解き直す。
   * @param {number} n 枠の数
   * @param {{i: number, j: number, lag: number, w: number}[]} pairs
   * @returns {{x: (number|null)[], used: object[], dropped: object[]}} 基準とつながらない枠は null
   */
  function solve(n, pairs, ref) {
    let used = pairs.filter((p) => p.w > 0);
    const dropped = [];
    for (;;) {
      const x = lsq(n, used, ref);
      let worst = null;
      for (const p of used) {
        if (x[p.i] == null || x[p.j] == null) continue;
        const r = Math.abs(x[p.j] - x[p.i] - p.lag);
        if (r > OUTLIER_MS && (!worst || r > worst.r)) worst = { p, r };
      }
      // 外れ値を除いても、ほかの組で同じ枠どうしがつながっているときだけ除く
      if (worst && used.length > n - 1) {
        const rest = used.filter((p) => p !== worst.p);
        const x2 = lsq(n, rest, ref);
        if (x2.every((v, k) => v != null || x[k] == null)) {
          dropped.push(worst.p);
          used = rest;
          continue;
        }
      }
      return { x, used, dropped };
    }
  }

  function lsq(n, pairs, ref) {
    // 基準とつながっている枠
    const reach = new Set([ref]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const p of pairs) {
        if (reach.has(p.i) !== reach.has(p.j)) {
          reach.add(p.i);
          reach.add(p.j);
          grew = true;
        }
      }
    }
    const idx = [...reach].filter((k) => k !== ref).sort((a, b) => a - b);
    const pos = new Map(idx.map((k, m) => [k, m]));
    const m = idx.length;
    const M = Array.from({ length: m }, () => new Float64Array(m + 1));
    for (const p of pairs) {
      if (!reach.has(p.i) || !reach.has(p.j)) continue;
      // x_j − x_i = lag
      const terms = [];
      if (p.j !== ref) terms.push([pos.get(p.j), 1]);
      if (p.i !== ref) terms.push([pos.get(p.i), -1]);
      for (const [r, cr] of terms) {
        for (const [c, cc] of terms) M[r][c] += p.w * cr * cc;
        M[r][m] += p.w * cr * p.lag;
      }
    }
    // ガウスの消去法
    for (let c = 0; c < m; c++) {
      let piv = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c] || 1e-12;
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const f = M[r][c] / d;
        if (f) for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(null);
    x[ref] = 0;
    for (const k of idx) x[k] = M[pos.get(k)][m] / (M[pos.get(k)][pos.get(k)] || 1e-12);
    return x;
  }

  // ---------------------------------------------------------------- 確かさ
  // 枠ごとの確かさ (3 = ◎ 確か / 2 = ○ たぶん / 1 = △ 怪しい)。
  // - 基準との組のピークの強さ (z)
  // - ほかの組からも同じ答えになるか (3 枠以上: 解いた答えとの差が SUPPORT_MS 以内の組の数)
  const Z_GOOD = 6.5; // ○
  const Z_GREAT = 9; // ◎
  const SUPPORT_MS = 20;
  // - 3 枠以上で、その枠を支える組がどれも「1 人の声だけのピーク」なら ○ まで (その人の声は通話の遅れぶん片寄る。
  //   実測: 最初の 40 秒は基準との組がどれもそうで、全部の枠が 0.11〜0.17 秒ずれた値を ◎ で出していた)
  function grades(n, ref, x, used) {
    return Array.from({ length: n }, (_, k) => {
      if (k === ref || x[k] == null) return null;
      const mine = used.filter((p) => (p.i === k || p.j === k) && x[p.i] != null && x[p.j] != null);
      const agree = mine.filter((p) => Math.abs(x[p.j] - x[p.i] - p.lag) <= SUPPORT_MS);
      const direct = mine.find((p) => p.i === ref || p.j === ref);
      const zd = direct && agree.includes(direct) ? direct.z : 0;
      const zmax = agree.reduce((m, p) => Math.max(m, p.z), 0);
      const onlySingle = n >= 3 && agree.length > 0 && agree.every((p) => p.kind === 'single');
      let g = 1;
      if (zd >= Z_GREAT || (agree.length >= 2 && zmax >= Z_GOOD)) g = 3;
      else if (zd >= Z_GOOD || agree.length >= 2) g = 2;
      return onlySingle ? Math.min(g, 2) : g;
    });
  }

  // ---------------------------------------------------------------- まとめ
  /** 実時刻の軸の記録を、後半・前半に分ける (同じ答えになるか見るため) */
  function half(R, which) {
    const n = R.x.length >> 1;
    return which === 0
      ? { r0: R.r0, x: R.x.subarray(0, n), mask: R.mask.subarray(0, n) }
      : { r0: R.r0 + n, x: R.x.subarray(n), mask: R.mask.subarray(n) };
  }
  const validMs = (R) => R.mask.reduce((s, v) => s + v, 0);
  /** 半分で測った答え (part) が、全体の答え (whole) のどれかの声の位置と合う */
  const agrees = (whole, part) => {
    const at = (x) => [x.lag, x.lo, x.hi].filter((v) => v != null);
    return at(part).some((a) => at(whole).some((b) => Math.abs(a - b) <= SPLIT_MS));
  };
  const PAIRS_ALL_MAX = 6; // これより枠が多いときは、全部の組ではなく、基準との組と隣どうしの組だけ突き合わせる (時間がかかりすぎないように)

  /**
   * 枠の記録から、各枠のずれの直し方を求める。
   * @param {{track: object, startMs: number, off: number}[]} items 枠ごと (順番は呼ぶ側の都合でよい)
   * @param {number} ref 基準の枠 (items の添字)
   * @returns {{
   *   ok: boolean, reason?: 'short'|'weak',
   *   deltas: (number|null)[],   // 秒。補正値に足す (基準は 0。直せない枠は null)
   *   z: (number|null)[],        // 基準との組の信頼度
   *   grade: (1|2|3|null)[],     // 確かさ (3 = ◎ / 2 = ○ / 1 = △)
   *   two: {mid: number, refVoice: number, otherVoice: number} | null, // 2 枠のときの選択肢 (相手の枠に足す秒)
   *   pairs: object[]
   * }}
   */
  async function analyze(items, ref, { yieldFn = () => new Promise((r) => setTimeout(r, 0)) } = {}) {
    const n = items.length;
    const R = items.map((it) => toReal(it.track, it.startMs, it.off));
    const deltas = new Array(n).fill(null);
    const zs = new Array(n).fill(null);
    const none = (reason) => ({ ok: false, reason, deltas, z: zs, grade: new Array(n).fill(null), two: null, pairs: [] });
    const usable = R.map((r) => !!r && validMs(r) >= MIN_TRACK_MS);
    if (!usable[ref]) return none('short');
    // スペクトルは枠ごとに 1 回だけ作って、組ごとに使い回す (全体・前半・後半)
    const maxLen = Math.max(...R.filter(Boolean).map((r) => r.x.length));
    const N = sizeFor(2 * maxLen);
    const Nh = sizeFor(2 * (maxLen - (maxLen >> 1)));
    const S = R.map((r, k) => (usable[k] ? { full: spectra(r, N), h: [spectra(half(r, 0), Nh), spectra(half(r, 1), Nh)] } : null));
    const want = (i, j) => n <= PAIRS_ALL_MAX || i === ref || j === ref || j === i + 1;
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!S[i] || !S[j] || !want(i, j)) continue;
        const pk = pick(correlateSpectra(S[i].full, S[j].full), n >= 3);
        if (!pk) continue;
        // 前半と後半で別々に測って、強いのに全体の答えと食い違うなら採らない (声の少ない区間の偽のピーク)。
        // 前半はおもに A が、後半はおもに B が話していれば、半分ずつではそれぞれの声のピーク (lo / hi) が出るので、それは食い違いとしない
        const h = [0, 1].map((w) => pick(correlateSpectra(S[i].h[w], S[j].h[w], { minOverlap: MIN_OVERLAP_MS / 2 }), n >= 3));
        const split = h.some((x) => x && x.z >= Z_OK * 0.8 && !agrees(pk, x));
        const ok = pk.z >= Z_OK && !split;
        const w = !ok ? 0 : n >= 3 && pk.kind === 'single' ? pk.z * SINGLE_WEIGHT : pk.z;
        pairs.push({ i, j, lag: pk.lag, z: pk.z, kind: pk.kind, lo: pk.lo, hi: pk.hi, ok, w });
        await yieldFn();
      }
    }
    const { x, used } = solve(n, pairs, ref);
    for (let k = 0; k < n; k++) {
      if (x[k] == null) continue;
      deltas[k] = Math.round(x[k]) / 1000;
      const p = pairs.find((q) => (q.i === ref && q.j === k) || (q.j === ref && q.i === k));
      zs[k] = k === ref ? null : p ? p.z : null;
    }
    let two = null;
    if (n === 2) {
      const p = pairs[0];
      if (p?.ok && p.kind === 'pair') {
        // i < j。基準が i なら、j に足す値。基準が j なら符号が逆になり、lo / hi の意味も入れ替わる
        const s = ref === p.i ? 1 : -1;
        const mid = (s * (p.lo + p.hi)) / 2 / 1000;
        // 相手の枠の補正値に hi を足す → 基準の人の声 (基準の枠には直接、相手の枠には通話経由で入る) がそろう
        const refVoice = (ref === p.i ? p.hi : -p.lo) / 1000;
        const otherVoice = (ref === p.i ? p.lo : -p.hi) / 1000;
        two = { mid, refVoice, otherVoice };
      }
    }
    const ok = deltas.some((d, k) => k !== ref && d != null);
    return { ok, reason: ok ? undefined : 'weak', deltas, z: zs, grade: grades(n, ref, x, used), two, pairs };
  }

  return { toReal, prep, correlate, pick, solve, analyze, grades, Z_OK };
})();
