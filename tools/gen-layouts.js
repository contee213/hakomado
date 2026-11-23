#!/usr/bin/env node
// hakomado: 「メイン + サブ」レイアウト (左上セット) とおすすめを extension/layouts-generated.js に書き出す。
// 形の一覧は tools/layout-picks.json (利用者が選んだもの)。一覧を変えたら `node tools/gen-layouts.js` で作り直す。
// 左下・右上・右下セットは layouts.js で反転して作る。
//
// 一覧の決め方 (2026-11-23 に利用者と決めたもの):
//  - 候補: 均等の格子 (6×6 まで) の左上から k×k のマスをまとめた形 (1 つ・長方形に並べる・階段状に並べる) と、
//    それまでの「メイン + サブ」(メインとサブの大きさの比が整数倍でないものを含む)・PinP。枠は 16 まで
//  - 採用: 画面 (16:9) を 50% 以上使うもの。ただし同じ枠数で、メインの数も同じで大きい枠も小さい枠も上回る形があるもの、
//    または一番小さい枠でもこちらの一番大きい枠より大きい形があるものは外す (例外は利用者が選んで残したもの)
//  - おすすめ: 枠数 × メインの数 (均等は別) ごとに 1 つ。本数が決まったときに自動で選ぶ
//  - タブ: レイアウト画面の「おすすめ」タブに出すもの。枠数ごとに 1 つ以上 (おすすめの中から利用者が選んだもの)
//
// layout-picks.json の形: { layouts: [{key, mains, subs, kind, cols, rows, slots}], recommended: [key], tab: [key] }
//  - slots は [列, 行, 横幅, 縦幅] (格子のマス単位、0 始まり)。メイン枠が先、続いてサブ枠
//  - key は共有コードに入るので、一度出したものは変えない。新しい形は「m<メイン>s<サブ>-g<段>x<列>」(階段状は末尾に l + 段ごとのブロック数)
//  - recommended・tab には均等 (u<段>x<列>) と PinP (pip<n>) の key も入る
'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'layout-picks.json');
const { layouts, recommended, tab } = JSON.parse(fs.readFileSync(src, 'utf8'));

const keys = new Set();
for (const l of layouts) {
  if (keys.has(l.key)) throw new Error(`key が重なる: ${l.key}`);
  keys.add(l.key);
  if (l.slots.length !== l.mains + l.subs) throw new Error(`${l.key}: 枠の数が合わない`);
  if (!/^[a-z0-9-]{1,21}$/.test(l.key)) throw new Error(`${l.key}: 共有コードに入らない key`);
}

const sorted = [...layouts].sort((a, b) => a.mains + a.subs - (b.mains + b.subs) || a.mains - b.mains || a.key.localeCompare(b.key));
const file = path.join(__dirname, '..', 'extension', 'layouts-generated.js');
const body = sorted.map((l) => '  ' + JSON.stringify({ key: l.key, mains: l.mains, subs: l.subs, kind: l.kind, cols: l.cols, rows: l.rows, slots: l.slots })).join(',\n');
fs.writeFileSync(
  file,
  `// このファイルは tools/gen-layouts.js が tools/layout-picks.json から作る。手で書き換えない
// 「メイン + サブ」レイアウトの左上セット。左下・右上・右下セットは layouts.js で反転して作る。
// slots は [列, 行, 横幅, 縦幅] (格子のマス単位、0 始まり)。メイン枠が先、続いてサブ枠
// RECOMMENDED_LAYOUT_KEYS = 枠数 × メインの数ごとのおすすめ (本数が決まったときに自動で選ぶ)
// TAB_LAYOUT_KEYS = レイアウト画面の「おすすめ」タブに出すもの
/* exported GENERATED_LAYOUTS, RECOMMENDED_LAYOUT_KEYS, TAB_LAYOUT_KEYS */
'use strict';

const GENERATED_LAYOUTS = [
${body},
];

const RECOMMENDED_LAYOUT_KEYS = ${JSON.stringify(recommended)};

const TAB_LAYOUT_KEYS = ${JSON.stringify(tab)};
`,
);
console.log(`${sorted.length} layouts, ${recommended.length} recommended, ${tab.length} in the tab -> ${path.relative(process.cwd(), file)}`);
