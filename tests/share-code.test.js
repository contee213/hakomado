// 視聴セットのコード・取り込み用リンク・1 行 1 本のテキスト (extension/share-code.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// 正しい形の動画 ID (11 文字)
const A = 'AAAAAAAAAAA';
const B = 'BBBBBBBBBBB';
const C = 'CCCCCCCCC-_';

/** resolveVideoId の代わり: 11 文字の ID と watch?v= だけ読める。ほかは失敗 */
async function resolveVideoId(raw) {
  const s = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  throw new Error('bad');
}

function setup(globals = {}) {
  const env = load(['share-code.js'], { globals: { resolveVideoId, Favorites: {}, ...globals } });
  return (name) => env.get(name);
}

test('コードを作る: ずれが無く基準が先頭なら「~」を付けない', () => {
  const fmt = setup()('formatShareCode');
  assert.equal(fmt('u2x2', [A, B]), `#Hakomado u2x2.${A}${B}`);
  assert.equal(fmt('u2x2', [A, B], [0, 0], 0), `#Hakomado u2x2.${A}${B}`);
});

test('コードを作る: ずれと基準', () => {
  const fmt = setup()('formatShareCode');
  assert.equal(fmt('tl-m1s3', [A, B, C], [0, 1.5, -2]), `#Hakomado tl-m1s3.${A}${B}${C}~0,1.5,-2`);
  assert.equal(fmt('u2x2', [A, B], [0, 0], 1), `#Hakomado u2x2.${A}${B}~0,*0`);
});

test('作ったコードを読み戻せる', () => {
  const get = setup();
  const fmt = get('formatShareCode');
  const parse = get('parseShareCode');
  for (const [layout, ids, offs, ref] of [
    ['u1x1', [A], [], 0],
    ['u2x2', [A, B, C], [0, 2.25, -1], 0],
    ['br-pip2', [A, B, C], [3, 0, 0], 2],
  ]) {
    const r = plain(parse(fmt(layout, ids, offs, ref)));
    assert.equal(r.layoutId, layout);
    assert.deepEqual(r.ids, ids);
    assert.equal(r.ref, ref);
    if (offs.some(Boolean) || ref > 0) assert.deepEqual(r.offsets, ids.map((_, k) => offs[k] || 0));
    else assert.equal(r.offsets, null);
  }
});

test('投稿の本文の中からコードだけを拾う', () => {
  const parse = setup()('parseShareCode');
  const r = plain(parse(`今日のコラボ!\nhakomado u2x2.${A}${B} ← これを貼ってね #Vtuber`));
  assert.deepEqual(r, { ids: [A, B], layoutId: 'u2x2', offsets: null, ref: 0 });
});

test('同じ動画が 2 回あれば 1 回目だけ (ずれも 1 回目のもの)', () => {
  const parse = setup()('parseShareCode');
  const r = plain(parse(`#Hakomado u2x2.${A}${B}${A}~1,2,3`));
  assert.deepEqual(r.ids, [A, B]);
  assert.deepEqual(r.offsets, [1, 2]);
});

test('コードではないもの・壊れたコードは null', () => {
  const parse = setup()('parseShareCode');
  for (const text of [
    '',
    'こんにちは',
    `#Hakomado .${A}`, // レイアウトが無い
    `#Hakomado u2x2.${A.slice(0, 10)}`, // 動画 ID が 11 文字に足りない
    `#Hakomado u2x2.${A}X`, // 11 文字の区切りに合わない
    `#Hakomado u2x2.${A.repeat(17)}`, // 17 本は多すぎる
  ]) {
    assert.equal(parse(text), null, text);
  }
});

test('ずれの数字が壊れていれば 0 として読む', () => {
  const parse = setup()('parseShareCode');
  const r = plain(parse(`#Hakomado u2x2.${A}${B}~1.2.3,--`));
  assert.deepEqual(r.offsets, [0, 0]);
});

test('取り込み用リンクを読む', () => {
  const link = setup()('parseWatchVideosLink');
  const r = plain(link(`https://www.youtube.com/watch_videos?video_ids=${A},${B},bad,${A}&hakomado=%E3%82%B3%E3%83%A9%E3%83%9C`));
  assert.deepEqual(r, { ids: [A, B], name: 'コラボ' });
  assert.deepEqual(plain(link(`https://m.youtube.com/watch_videos?video_ids=${C}`)), { ids: [C], name: '' });
  assert.deepEqual(plain(link('https://youtube.com/watch_videos')), { ids: [], name: '' });
});

test('取り込み用リンクではないものは null', () => {
  const link = setup()('parseWatchVideosLink');
  for (const raw of [
    'not a url',
    `https://www.youtube.com/watch?v=${A}`,
    `https://evil.example/watch_videos?video_ids=${A}`,
    `https://www.youtube.com.evil.example/watch_videos?video_ids=${A}`,
    `https://music.youtube.com/watch_videos?video_ids=${A}`,
  ]) {
    assert.equal(link(raw), null, raw);
  }
});

test('YouTube の再生リストの URL', () => {
  const pl = setup()('youtubePlaylistId');
  assert.equal(pl('https://www.youtube.com/playlist?list=PLabcdefghij'), 'PLabcdefghij');
  assert.equal(pl('https://music.youtube.com/playlist?list=PLabcdefghij'), 'PLabcdefghij');
  assert.equal(pl('https://www.youtube.com/playlist?list=short'), null);
  assert.equal(pl('https://www.youtube.com/playlist?list=PL<script>xx'), null);
  assert.equal(pl(`https://www.youtube.com/watch?v=${A}&list=PLabcdefghij`), null);
  assert.equal(pl('https://evil.example/playlist?list=PLabcdefghij'), null);
  assert.equal(pl('nope'), null);
});

test('1 行 1 本のテキスト: 説明行・名前・ずれ・基準', async () => {
  const lines = setup()('parseVideoLines');
  const text = [
    '# playlist=夜の部',
    '# sync=on',
    '# layout = u2x2',
    '# ただの説明',
    '',
    `https://www.youtube.com/watch?v=${A}  ~1.5  #  配信者  A  `,
    `${B} ~*-2`,
    `${C} # 名前だけ`,
    `${A} # 2 回目は飛ばす`,
    'これは読めない',
  ].join('\r\n');
  const r = plain(await lines(text, 16));
  assert.deepEqual(r.meta, { playlist: '夜の部', sync: 'on', layout: 'u2x2' });
  assert.deepEqual(r.items, [
    { videoId: A, label: '配信者 A', offset: 1.5 },
    { videoId: B, offset: -2 },
    { videoId: C, label: '名前だけ' },
  ]);
  assert.equal(r.ref, B);
  assert.equal(r.hasOffsets, true);
  assert.equal(r.bad, 1);
  assert.equal(r.tooMany, false);
});

test('1 行 1 本のテキスト: 本数の上限', async () => {
  const lines = setup()('parseVideoLines');
  const progress = [];
  const r = plain(await lines([A, B, C].join('\n'), 2, (k, n) => progress.push([k, n])));
  assert.deepEqual(r.items.map((h) => h.videoId), [A, B]);
  assert.equal(r.tooMany, true);
  assert.equal(r.hasOffsets, false);
  assert.deepEqual(progress, [[1, 3], [2, 3]]);
});

test('1 行 1 本のテキスト: 取り込み用リンクと YouTube の再生リストを展開する', async () => {
  const fetched = [];
  const Favorites = {
    async fetchYouTubePlaylist(id) {
      fetched.push(id);
      if (id === 'PLemptyemptyempty') return { ids: [], name: '' };
      if (id === 'PLbrokenbrokenbro') throw new Error('network');
      return { ids: [C], name: 'YT の再生リスト' };
    },
  };
  const lines = setup({ Favorites })('parseVideoLines');
  const text = [
    `https://www.youtube.com/watch_videos?video_ids=${A},${B}&hakomado=リンクの名前`,
    'https://www.youtube.com/playlist?list=PLgoodgoodgoodgo',
    'https://www.youtube.com/playlist?list=PLemptyemptyempty',
    'https://www.youtube.com/playlist?list=PLbrokenbrokenbro',
  ].join('\n');
  const r = plain(await lines(text, 16));
  assert.deepEqual(r.items.map((h) => h.videoId), [A, B, C]);
  assert.equal(r.meta.playlist, 'リンクの名前', '先に書いた名前が優先');
  assert.equal(r.bad, 2, '空の再生リスト・取れなかった再生リストは読めなかった行として数える');
  assert.deepEqual(fetched, ['PLgoodgoodgoodgo', 'PLemptyemptyempty', 'PLbrokenbrokenbro']);
});

test('「# sync=…」の ON / OFF', () => {
  const on = setup()('metaOn');
  for (const v of ['on', 'ON', ' 1 ', 'true', 'yes']) assert.equal(on(v), true, v);
  for (const v of ['off', '0', 'no', '', undefined, null]) assert.equal(on(v), false, String(v));
});

test('URL から動画 ID を取り出す (右クリックのメニュー)', () => {
  const id = setup()('videoIdFromUrl');
  for (const [url, want] of [
    [`https://www.youtube.com/watch?v=${A}&t=30s`, A],
    [`https://m.youtube.com/watch?app=desktop&v=${B}`, B],
    [`https://music.youtube.com/watch?v=${A}`, A],
    [`https://youtube.com/watch?v=${A}`, A],
    [`https://www.youtube.com/live/${C}?si=x`, C],
    [`https://www.youtube.com/shorts/${A}`, A],
    [`https://www.youtube.com/embed/${A}`, A],
    [`https://youtu.be/${B}?t=10`, B],
    [`https://www.youtube.com/watch?v=${A}x`, null],
    ['https://www.youtube.com/watch', null],
    ['https://www.youtube.com/@channel/live', null],
    [`https://www.youtube.com/live/${A}/extra`, null],
    [`https://youtu.be/${A}/x`, null],
    [`https://evil.example/watch?v=${A}`, null],
    [`https://youtube.com.evil.example/watch?v=${A}`, null],
    [`javascript://www.youtube.com/watch?v=${A}`, null],
    ['not a url', null],
  ]) {
    assert.equal(id(url), want, url);
  }
});
