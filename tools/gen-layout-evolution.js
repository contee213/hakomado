#!/usr/bin/env node
// hakomado: レイアウトの進化図 (上部バーの「＋」「−」で、どのレイアウトからどこへ移るか) を docs/layout-evolution.html に書き出す。
// 行き先は extension/layouts.js の resizeLayoutFor をそのまま動かして求める (grid.js の addTileSlot・shrinkTarget と同じく、
// その枠数のレイアウトが無ければ次の枠数を見る)。レイアウトや選び方を変えたら `node tools/gen-layout-evolution.js` で作り直す
// (tests/layout-evolution.test.js が、作り直し忘れを見つける)。
// 見た目は tools/layout-evolution.template.html。前提: 基準位置は左上、クルーズ中ではない、空き枠は十分にある、画面は 1920×1000
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'layout-evolution.html');
const TEMPLATE = path.join(__dirname, 'layout-evolution.template.html');

/** 進化図の中身 (HTML の文字列) を作る */
function build() {
  const ctx = {};
  vm.createContext(ctx);
  const src = ['layouts-generated.js', 'layouts.js'].map((f) => fs.readFileSync(path.join(ROOT, 'extension', f), 'utf8')).join('\n');
  vm.runInContext(`${src}\n;this.L = { LAYOUTS, solveTracks, resizeLayoutFor };`, ctx);
  const { LAYOUTS, solveTracks, resizeLayoutFor } = ctx.L;

  // grid.js の filledArea と同じ (画面は 1920×1000、枠の間は 4px)
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const area = (l, n) => {
    const { colW, rowH } = solveTracks(l);
    const W = 1920 - 4 * (l.cols + 1);
    const H = 1000 - 4 * (l.rows + 1);
    const scale = Math.min(W / sum(colW), H / sum(rowH));
    let a = 0;
    for (const [x, y, w, h] of l.slots.slice(0, n)) a += sum(colW.slice(x, x + w)) * scale * sum(rowH.slice(y, y + h)) * scale;
    return a / (W * H);
  };
  // grid.js の addTileSlot (dir = 1) / shrinkTarget (dir = -1): その枠数が無ければ次の枠数
  const step = (base, dir) => {
    for (let n = base.slots.length + dir; n >= 1 && n <= 16; n += dir) {
      const l = resizeLayoutFor(n, base, { area: (x) => area(x, n) });
      if (l) return l.id;
    }
    return null;
  };
  const withAnchor = (l) => ({ ...l, anchor: l.anchor || 'tl' });
  // 1×1・1×2 の均等で読み込んだ枠が全部ショートなら、縦長の段にいるものとして扱う (grid.js の layoutForCount)
  const asVertical = (l) => ({ ...withAnchor(l), group: 'vertical', kind: 'vertical' });

  const shown = LAYOUTS.filter((l) => !l.anchor || l.anchor === 'tl');
  const data = shown.map((l) => {
    const { colW, rowH } = solveTracks(l);
    return {
      id: l.id,
      name: l.name,
      group: l.group,
      mains: l.mains,
      n: l.slots.length,
      slots: l.slots,
      rec: !!l.recommended,
      tr: { c: colW.map((v) => +v.toFixed(3)), r: rowH.map((v) => +v.toFixed(3)) },
      add: step(withAnchor(l), 1),
      rem: step(withAnchor(l), -1),
    };
  });
  const byId = Object.fromEntries(LAYOUTS.map((l) => [l.id, l]));
  // 段: 1×1 から ＋ をたどったもの (横長 / 全部ショート)
  const ladder = (vertical) => {
    const out = [];
    for (let l = byId.u1x1; l; ) {
      out.push(l.id);
      const base = vertical && l.group === 'uniform' ? asVertical(l) : withAnchor(l);
      const next = step(base, 1);
      l = next && byId[next];
    }
    return out;
  };
  const payload = { layouts: data, ladder: ladder(false), vladder: ladder(true) };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return fs.readFileSync(TEMPLATE, 'utf8').replace('/*DATA*/', json);
}

if (require.main === module) {
  fs.writeFileSync(OUT, build());
  console.log(`${path.relative(ROOT, OUT)} を書き出した`);
}

module.exports = { build, OUT };
