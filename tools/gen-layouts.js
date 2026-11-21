#!/usr/bin/env node
// hakomado: 「メイン + サブ」レイアウト (左上セット) を計算して extension/layouts-generated.js に書き出す。
// ルールを変えたら `node tools/gen-layouts.js` で作り直す。左下・右上・右下セットは layouts.js で反転して作る。
//
// ルール (2026-11 に利用者と決めたもの):
//  - メイン枠は 1・2・3・4・6・8。サブ枠は 1・2・3・4・6・8・9・10・12 (メイン 1 だけ 5 も)。合計は 16 まで
//  - メイン同士・サブ同士はそれぞれ同じ大きさで、どれも 16:9。サブはメインより小さく、メインの 1/6 以上
//  - 全体は凹みのない長方形 (隙間なし)。メインは左上にまとめ、サブは右と下 (L 字も可) に置く
//  - 1 列 (縦) のサブは 5 個まで、1 段 (横) のサブは 6 個まで
//  - 画面 (16:9) を 70% 以上使うものだけ。無ければ一番広く使うもの 1 つ
//  - 1 つの組み合わせに、サブが一番小さい形 (メイン重視) と一番大きい形 (バランス) を、横長・縦長それぞれ
//  - 同じメイン数で、サブの多い組み合わせにメインもサブも負ける形は使わない
'use strict';

const fs = require('fs');
const path = require('path');

const MAINS = [1, 2, 3, 4, 6, 8];
const subsFor = (m) => (m === 1 ? [1, 2, 3, 4, 5, 6, 8, 9, 10, 12] : [1, 2, 3, 4, 6, 8, 9, 10, 12]);
const MAX_TOTAL = 16;
const SUB_MIN = 6; // サブはメインの 1/6 以上
const COL_MAX = 5; // 1 列のサブ
const ROW_MAX = 6; // 1 段のサブ
const USE_MIN = 0.7; // 画面使用の下限
const GW = 1920;
const GH = 1030; // 比べるときの画面 (上部バーを除いた 1920×1080)

const gcd = (x, y) => (y ? gcd(y, x % y) : x);

function mainShapes(m) {
  const out = [];
  for (let r = 1; r <= m; r++) if (m % r === 0) out.push([r, m / r]);
  return out;
}

/**
 * 単位: 16:9 の小さなマス。サブ = a×a マス、メイン = b×b マス (b > a)。
 * メイン r 段 × c 列を左上に置き、右の帯と下の帯をサブで埋める。
 * o = 1: 右の帯はメインの高さ・下の帯は全幅 / o = 2: 右の帯は全高・下の帯はメインの幅
 */
function slotsOf(x) {
  const mains = [];
  const subs = [];
  for (let i = 0; i < x.r; i++) for (let j = 0; j < x.c; j++) mains.push([j * x.b, i * x.b, x.b, x.b]);
  const mw = x.c * x.b;
  const mh = x.r * x.b;
  if (x.rw) for (let y = 0; y < x.rH; y += x.a) for (let X = mw; X < x.W; X += x.a) subs.push([X, y, x.a, x.a]);
  if (x.bh) for (let y = mh; y < x.H; y += x.a) for (let X = 0; X < x.bW; X += x.a) subs.push([X, y, x.a, x.a]);
  return { mains, subs };
}

function search(m, s) {
  const res = [];
  const seen = new Set();
  for (let a = 1; a <= 4; a++) {
    for (let b = a + 1; b <= SUB_MIN * a; b++) {
      for (const [r, c] of mainShapes(m)) {
        const mw = c * b;
        const mh = r * b;
        for (let W = mw; W <= mw + 16 * a; W++) {
          for (let H = mh; H <= mh + 16 * a; H++) {
            const rw = W - mw;
            const bh = H - mh;
            if (rw % a || bh % a) continue;
            for (const o of [1, 2]) {
              if (o === 2 && !(rw && bh)) continue;
              const rH = o === 1 ? mh : H;
              const bW = o === 1 ? W : mw;
              if (rw > 0 && rH % a) continue;
              if (bh > 0 && bW % a) continue;
              if ((rw / a) * (rH / a) + (bh / a) * (bW / a) !== s) continue;
              const g = gcd(a, gcd(b, gcd(W, H)));
              const key = [a / g, b / g, r, c, W / g, H / g, o].join();
              if (seen.has(key)) continue;
              seen.add(key);
              const x = { a: a / g, b: b / g, r, c, W: W / g, H: H / g, o, rw: rw / g, bh: bh / g, rH: rH / g, bW: bW / g };
              const { subs } = slotsOf(x);
              const colN = new Map();
              const rowN = new Map();
              for (const [sx, sy] of subs) {
                colN.set(sx, (colN.get(sx) || 0) + 1);
                rowN.set(sy, (rowN.get(sy) || 0) + 1);
              }
              if (Math.max(0, ...colN.values()) > COL_MAX || Math.max(0, ...rowN.values()) > ROW_MAX) continue;
              const unit = Math.min(GW / (x.W * 16), GH / (x.H * 9));
              res.push({
                ...x,
                use: Math.min(x.W / x.H, x.H / x.W),
                ratio: x.b / x.a,
                wide: x.W >= x.H,
                mainW: x.b * 16 * unit,
                subW: x.a * 16 * unit,
              });
            }
          }
        }
      }
    }
  }
  return res;
}

function pick(m, s) {
  const all = search(m, s);
  if (!all.length) return [];
  const ok = all.filter((x) => x.use >= USE_MIN - 1e-9);
  if (!ok.length) {
    const best = all.sort((p, q) => q.use - p.use || q.W / q.H - p.W / p.H)[0];
    return [{ ...best, kind: 'single' }];
  }
  const ratios = [...new Set(ok.map((x) => +x.ratio.toFixed(3)))].sort((p, q) => q - p);
  const want = ratios.length > 1 ? [ratios[0], ratios[ratios.length - 1]] : [ratios[0]];
  const out = [];
  want.forEach((rt, i) => {
    const group = ok.filter((x) => Math.abs(x.ratio - rt) < 1e-3);
    for (const wide of [true, false]) {
      const g = group.filter((x) => x.wide === wide).sort((p, q) => q.use - p.use)[0];
      if (g) out.push({ ...g, kind: want.length > 1 ? (i === 0 ? 'focus' : 'balance') : 'single' });
    }
  });
  return out;
}

const data = {};
for (const m of MAINS) {
  data[m] = {};
  for (const s of subsFor(m)) if (m + s <= MAX_TOTAL) data[m][s] = pick(m, s);
}
// サブの多い組み合わせにメインもサブも負ける形は使わない
for (const m of MAINS) {
  for (const s of Object.keys(data[m]).map(Number)) {
    for (const v of data[m][s]) {
      v.beaten = Object.keys(data[m])
        .map(Number)
        .filter((s2) => s2 > s)
        .some((s2) => data[m][s2].some((u) => u.mainW > v.mainW + 0.5 && u.subW > v.subW + 0.5));
    }
  }
}

const out = [];
for (const m of MAINS) {
  for (const s of Object.keys(data[m]).map(Number)) {
    for (const v of data[m][s]) {
      if (v.beaten) continue;
      const { mains, subs } = slotsOf(v);
      out.push({
        key: `m${m}s${s}-${v.kind[0]}${v.wide ? 'w' : 't'}`,
        mains: m,
        subs: s,
        kind: v.kind,
        cols: v.W,
        rows: v.H,
        slots: [...mains, ...subs],
      });
    }
  }
}

const file = path.join(__dirname, '..', 'extension', 'layouts-generated.js');
const body = out.map((l) => '  ' + JSON.stringify(l)).join(',\n');
fs.writeFileSync(
  file,
  `// このファイルは tools/gen-layouts.js が作る。手で書き換えない (ルールを変えたらスクリプトを実行し直す)
// 「メイン + サブ」レイアウトの左上セット。左下・右上・右下セットは layouts.js で反転して作る。
// slots は [列, 行, 横幅, 縦幅] (格子のマス単位、0 始まり)。メイン枠が先、続いてサブ枠
/* exported GENERATED_LAYOUTS */
'use strict';

const GENERATED_LAYOUTS = [
${body},
];
`,
);
console.log(`${out.length} layouts -> ${path.relative(process.cwd(), file)}`);
