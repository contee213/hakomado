// 枠の並び順の計算 (extension/tile-slots.js)。
// 配信・URL の枠・空き枠を混ぜたランダムな状態をたくさん作り、どんな状態でも次のこと (不変条件) が守られるかを確かめる:
//  - order は 0〜15 の並べ替えのまま (抜けたり重なったりしない)
//  - 減らしても増やしても、見えている中身のある枠は 1 つも見えなくならない (枠の種類が増えても、ここで気づけるように)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const MAX = 16;
const TileSlots = load(['tile-slots.js']).get('TileSlots');

/** 再現できる乱数 (mulberry32) */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = [
  () => ({ videoId: null, web: '' }), // 空き枠
  (k) => ({ videoId: `vid${String(k).padStart(8, '0')}`, web: '' }), // YouTube
  (k) => ({ videoId: null, web: `https://example.com/${k}` }), // URL の枠
];

function randomState(rand) {
  const tiles = Array.from({ length: MAX }, (_, k) => KINDS[Math.floor(rand() * KINDS.length)](k));
  const order = Array.from({ length: MAX }, (_, i) => i);
  for (let i = MAX - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const count = 1 + Math.floor(rand() * MAX);
  return { tiles, order, count };
}

const isPermutation = (o) => o.length === MAX && new Set(o).size === MAX && o.every((i) => Number.isInteger(i) && i >= 0 && i < MAX);
const filledShown = (s) => s.order.slice(0, s.count).filter((j) => TileSlots.filled(s.tiles[j]));

test('filled: 配信・URL の枠は中身あり、空き枠・欠けた値は中身なし', () => {
  assert.equal(TileSlots.filled({ videoId: 'abcdefghijk', web: '' }), true);
  assert.equal(TileSlots.filled({ videoId: null, web: 'https://example.com/' }), true);
  assert.equal(TileSlots.filled({ videoId: null, web: '' }), false);
  assert.equal(TileSlots.filled(null), false);
  assert.equal(TileSlots.filled(undefined), false);
});

test('keepNumbersOrder: 不変条件 (ランダムな 3000 通り)', () => {
  const rand = rng(1);
  for (let run = 0; run < 3000; run++) {
    const s = randomState(rand);
    const shown = s.order.slice(0, s.count);
    const keep = filledShown(s);
    const empties = shown.filter((j) => !TileSlots.filled(s.tiles[j]));
    // ✕ を押した空き枠 (無いときは null)
    const prefer = empties.length && rand() < 0.5 ? empties[Math.floor(rand() * empties.length)] : null;
    for (let n = Math.max(1, keep.length); n <= MAX; n++) {
      const out = plain(TileSlots.keepNumbersOrder(s, n, prefer));
      const label = `run ${run} n=${n} ${JSON.stringify({ order: s.order, count: s.count, prefer })}`;
      assert.ok(isPermutation(out), `並べ替えのまま: ${label}`);
      const visible = out.slice(0, n);
      // 見えていた中身のある枠は、全部見えたまま
      for (const j of keep) assert.ok(visible.includes(j), `枠 ${j} が見えなくなった: ${label}`);
      // 新しいレイアウトにもある位置の中身のある枠は、位置 (番号) が変わらない
      shown.slice(0, n).forEach((j, k) => {
        if (TileSlots.filled(s.tiles[j])) assert.equal(out[k], j, `枠 ${j} の位置が変わった: ${label}`);
      });
      // 隠れていた中身のある枠は、見せる前に空にする (勝手に再生し始めない)。
      // 今より増やすのに隠れている空き枠が足りないときだけ出てくるので、revealedFilled がそれをちょうど挙げるかを見る
      const hiddenEmpty = s.order.slice(s.count).filter((j) => !TileSlots.filled(s.tiles[j])).length;
      const revealed = plain(TileSlots.revealedFilled(s, out, n));
      const tiles = s.tiles.map((t, j) => (revealed.includes(j) ? {} : t)); // grid.js と同じく空にした後
      for (const j of visible) assert.ok(shown.includes(j) || !TileSlots.filled(tiles[j]), `隠れていた枠 ${j} が出てきた: ${label}`);
      if (n <= s.count + hiddenEmpty) assert.deepEqual(revealed, [], `空き枠が足りているのに空にする枠がある: ${label}`);
      // 空にするのは、隠れていて中身のある枠だけ (見えている枠は空にしない)
      for (const j of revealed) assert.ok(!shown.includes(j), `見えている枠 ${j} を空にしようとした: ${label}`);
      // はみ出す中身があれば、✕ を押した空き枠に先に入る
      const overflow = shown.slice(n).filter((j) => TileSlots.filled(s.tiles[j]));
      const at = shown.indexOf(prefer);
      if (overflow.length && at >= 0 && at < n) assert.equal(out[at], overflow[0], `✕ を押した枠に入らない: ${label}`);
    }
  }
});

test('growOrder: 不変条件 (ランダムな 3000 通り)', () => {
  const rand = rng(2);
  for (let run = 0; run < 3000; run++) {
    const s = randomState(rand);
    const out = plain(TileSlots.growOrder(s));
    const label = `run ${run} ${JSON.stringify({ order: s.order, count: s.count })}`;
    assert.ok(isPermutation(out), `並べ替えのまま: ${label}`);
    assert.deepEqual(out.slice(0, s.count), s.order.slice(0, s.count), `見えている枠が動いた: ${label}`);
    // 見えている枠のすぐ後ろには、隠れている空き枠が先に来る (足した位置に中身の残った枠が出てこない)
    const rest = out.slice(s.count);
    const firstFilled = rest.findIndex((j) => TileSlots.filled(s.tiles[j]));
    if (firstFilled >= 0) assert.ok(rest.slice(firstFilled).every((j) => TileSlots.filled(s.tiles[j])), `空き枠が後ろに残った: ${label}`);
  }
});

test('freeTiles: used を除いた全部の枠を、空き枠 → 中身のある枠の順に返す', () => {
  const rand = rng(3);
  for (let run = 0; run < 1000; run++) {
    const { tiles } = randomState(rand);
    const used = Array.from({ length: MAX }, (_, j) => j).filter(() => rand() < 0.3);
    const out = plain(TileSlots.freeTiles(tiles, used));
    assert.deepEqual([...out].sort((a, b) => a - b), Array.from({ length: MAX }, (_, j) => j).filter((j) => !used.includes(j)));
    const firstFilled = out.findIndex((j) => TileSlots.filled(tiles[j]));
    if (firstFilled >= 0) assert.ok(out.slice(firstFilled).every((j) => TileSlots.filled(tiles[j])));
  }
});

test('不具合の再現: [動画, 空き, URL, 動画] を 3 枠にしても URL の枠は消えない', () => {
  const tiles = [{ videoId: 'aaaaaaaaaaa' }, {}, { web: 'https://example.com/' }, { videoId: 'bbbbbbbbbbb' }, ...Array.from({ length: 12 }, () => ({}))];
  const s = { tiles, order: Array.from({ length: MAX }, (_, i) => i), count: 4 };
  assert.deepEqual(plain(TileSlots.keepNumbersOrder(s, 3)).slice(0, 3), [0, 3, 2]);
});

test('境目: 隠れている空き枠が足りないまま増やすと、出てくる隠れ枠を revealedFilled が挙げる', () => {
  // 見えている 2 枠 (どちらも配信) + 隠れている 14 枠 (どれも前の中身が残っている) を 4 枠にする
  const tiles = Array.from({ length: MAX }, (_, k) => ({ videoId: `vid${String(k).padStart(8, '0')}` }));
  const s = { tiles, order: Array.from({ length: MAX }, (_, i) => i), count: 2 };
  const out = plain(TileSlots.keepNumbersOrder(s, 4));
  assert.deepEqual(out.slice(0, 4), [0, 1, 2, 3]);
  assert.deepEqual(plain(TileSlots.revealedFilled(s, out, 4)), [2, 3]);
});

test('不具合の再現: 隠れている URL の枠があっても、枠を足したあとの order は並べ替えのまま', () => {
  const tiles = Array.from({ length: MAX }, () => ({}));
  tiles[5] = { web: 'https://example.com/' };
  const s = { tiles, order: Array.from({ length: MAX }, (_, i) => i), count: 4 };
  assert.ok(isPermutation(plain(TileSlots.growOrder(s))));
});
