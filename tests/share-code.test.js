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
  assert.deepEqual(r, { ids: [A, B], layoutId: 'u2x2', offsets: null, ref: 0, name: '', movie: null });
});

test('コードに名前を入れて読み戻せる (「"」と改行は除き、40 文字まで)', () => {
  const get = setup();
  const fmt = get('formatShareCode');
  const parse = get('parseShareCode');
  assert.equal(fmt('u2x2', [A, B], [0, 1.5], 0, '夜の 歌枠'), `#Hakomado u2x2.${A}${B}~0,1.5 "夜の 歌枠"`);
  assert.equal(fmt('u2x2', [A], [], 0, '  '), `#Hakomado u2x2.${A}`);
  const odd = fmt('u2x2', [A], [], 0, 'a"b\nc');
  assert.equal(odd, `#Hakomado u2x2.${A} "a b c"`);
  const long = 'あ'.repeat(50);
  const r = plain(parse(`見てね ${fmt('u2x2', [A, B], [0, 2], 1, long)} #tag`));
  assert.equal(r.name, 'あ'.repeat(40));
  assert.deepEqual(r.ids, [A, B]);
  assert.equal(r.ref, 1);
});

test('名前入りのコードも、以前の版の読み方 (名前の前で止まる) で動画とずれが読める', () => {
  const fmt = setup()('formatShareCode');
  const OLD = /#?Hakomado\s+([a-z0-9-]{1,24})\.((?:[A-Za-z0-9_-]{11}){1,16})(?:~([-+*\d.,]{1,240}))?(?![A-Za-z0-9_-])/i;
  const m = fmt('u2x2', [A, B], [0, 1.5], 1, 'コラボ').match(OLD);
  assert.equal(m[1], 'u2x2');
  assert.equal(m[2], A + B);
  assert.equal(m[3], '0,*1.5');
});

test('🎬 本編モード: 本編の位置 (決めていない動画は空) と基準をコードに入れて読み戻せる', () => {
  const get = setup();
  const code = get('formatShareCode')('u2x2', [A, B, C], [9, 9, 9], 1, 'コマンドー', [754.234, null, -3]);
  assert.equal(code, `#Hakomado u2x2.${A}${B}${C} "コマンドー" ~!754.23,*,-3`, 'ずれ (~…) は入れず、名前の後ろに ~!… (0.01 秒単位)');
  assert.deepEqual(plain(get('parseShareCode')(code)), { ids: [A, B, C], layoutId: 'u2x2', offsets: null, ref: 1, name: 'コマンドー', movie: [754.23, null, -3], main: null });
  const noName = get('formatShareCode')('u2x2', [A, B], [], 0, '', [0, 12.5]);
  assert.equal(noName, `#Hakomado u2x2.${A}${B} ~!0,12.5`);
  assert.deepEqual(plain(get('parseShareCode')(noName)).movie, [0, 12.5]);
  assert.equal(get('formatShareCode')('u2x2', [A, B], [], 0, '', [null, null]), `#Hakomado u2x2.${A}${B}`, '1 つも決めていなければ付けない');
});

test('🎬 本編モードのコードも、以前の版の読み方で並び・レイアウト・名前が読める (本編の位置は無視)', () => {
  const OLD = /#?Hakomado\s+([a-z0-9-]{1,24})\.((?:[A-Za-z0-9_-]{11}){1,16})(?:~([-+*\d.,]{1,240}))?(?![A-Za-z0-9_-])(?: "([^"\r\n]{1,40})")?/i;
  const m = setup()('formatShareCode')('u2x2', [A, B], [], 1, 'コマンドー', [754.2, 3]).match(OLD);
  assert.deepEqual([m[1], m[2], m[3], m[4]], ['u2x2', A + B, undefined, 'コマンドー']);
});

test('🎬 本編モードのリンク: hkm= に入れて読み戻せる。以前の版は hkm= を知らないので無視する', () => {
  const get = setup();
  const link = get('formatShareLink')('u2x2', [A, B], [], 1, '名前', '', false, [754.2, null]);
  assert.match(link, /&hkm=754\.2,\*&/);
  assert.doesNotMatch(link, /hks=/);
  assert.deepEqual(plain(get('parseShareLink')(link)), { ids: [A, B], layoutId: 'u2x2', offsets: null, ref: 1, name: '名前', movie: [754.2, null], main: null });
  assert.equal(get('parseShareLink')(link.replace('hkm=754.2', 'hkm=x')), null, '壊れた hkm= は読まない');
});

test('🎬 「本編にした」動画: 最後に「,*番号」を足して読み戻せる (基準とは別)', () => {
  const get = setup();
  const code = get('formatShareCode')('u2x2', [A, B, C], [], 1, 'コマンドー', [0, null, -3], 0);
  assert.equal(code, `#Hakomado u2x2.${A}${B}${C} "コマンドー" ~!0,*,-3,*0`);
  assert.deepEqual(plain(get('parseShareCode')(code)), { ids: [A, B, C], layoutId: 'u2x2', offsets: null, ref: 1, name: 'コマンドー', movie: [0, null, -3], main: 0 });
  // 基準と同じ動画を本編にしても読める
  const same = get('formatShareCode')('u2x2', [A, B], [], 1, '', [3, 0], 1);
  assert.equal(same, `#Hakomado u2x2.${A}${B} ~!3,*0,*1`);
  assert.deepEqual([plain(get('parseShareCode')(same)).ref, plain(get('parseShareCode')(same)).main], [1, 1]);
  // 本編の位置が 1 つも無くても、本編にした動画があればコードにする
  assert.equal(get('formatShareCode')('u2x2', [A, B], [], 0, '', [null, null], 1), `#Hakomado u2x2.${A}${B} ~!,,*1`);
  // 範囲外の番号は入れない
  assert.equal(get('formatShareCode')('u2x2', [A, B], [], 0, '', [1, 2], 5), `#Hakomado u2x2.${A}${B} ~!1,2`);
});

test('🎬 「本編にした」印の入ったコードも、以前の版の本編の位置の読み方で読める (印は無視)', () => {
  // 以前の版の movieIds (動画の数までしか読まない)
  const oldMovieIds = (list, text) => {
    const tail = text.split(',');
    const anchors = [];
    let ref = 0;
    list.forEach((id, k) => {
      const t = tail[k] ?? '';
      if (t.startsWith('*')) ref = k;
      const v = t.replace('*', '');
      anchors.push(v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    });
    return { anchors, ref };
  };
  const OLD = /#?Hakomado\s+([a-z0-9-]{1,24})\.((?:[A-Za-z0-9_-]{11}){1,16})(?:~([-+*\d.,]{1,240}))?(?![A-Za-z0-9_-])(?: "([^"\r\n]{1,40})")?(?: ~!([-*\d.,]{1,240}))?/i;
  const get = setup();
  const m = get('formatShareCode')('u2x2', [A, B, C], [], 1, 'コマンドー', [754.2, null, -3], 2).match(OLD);
  assert.deepEqual([m[1], m[2], m[4]], ['u2x2', A + B + C, 'コマンドー']);
  assert.deepEqual(oldMovieIds([A, B, C], m[5]), { anchors: [754.2, null, -3], ref: 1 });
  // リンクの hkm= も、以前の版の確かめ方 (使える文字) に合う
  const link = get('formatShareLink')('u2x2', [A, B], [], 0, '', '', false, [1, 2], 0);
  const hkm = new URL(link).searchParams.get('hkm');
  assert.equal(hkm, '1,2,*0');
  assert.match(hkm, /^[-*\d.,]{1,240}$/);
  assert.deepEqual(plain(get('parseShareLink')(link)).main, 0);
});

test('🎬 以前の版で作った本編モードのコードは「本編にした」印なし (main = null)。壊れた印も無視', () => {
  const parse = setup()('parseShareCode');
  assert.equal(parse(`#Hakomado u2x2.${A}${B} ~!754.2,*`).main, null);
  assert.equal(parse(`#Hakomado u2x2.${A}${B} ~!754.2,*,*7`).main, null, '範囲外');
  assert.equal(parse(`#Hakomado u2x2.${A}${B} ~!754.2,*,5`).main, null, '「*」が無い');
  assert.equal(parse(`#Hakomado u2x2.${A}${B} ~!754.2,*,*0,*1`).main, null, '項目が多すぎる');
  // 同じ動画が 2 回ある並びでは、同じ動画を除いた番号にする
  assert.equal(parse(`#Hakomado u2x2.${A}${A}${B} ~!1,1,2,*2`).main, 1);
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

test('取り込み用リンクの名前: hakomado= が無ければ title= (YouTube のリストの名前)', () => {
  const link = setup()('parseWatchVideosLink');
  assert.deepEqual(plain(link(`https://www.youtube.com/watch_videos?video_ids=${A}&title=%E3%82%B3%E3%83%A9%E3%83%9C&hakomado=`)), { ids: [A], name: 'コラボ' });
  assert.deepEqual(plain(link(`https://www.youtube.com/watch_videos?video_ids=${A}&title=x&hakomado=y`)), { ids: [A], name: 'y' });
});

test('QR 用のリンク: コードと同じ中身を読み戻せる (名前は title=。hakomado= は名前があれば 1、無ければ 0)', () => {
  const get = setup();
  const fmt = get('formatShareLink');
  const parse = get('parseShareLink');
  for (const [layout, ids, offs, ref] of [
    ['u1x1', [A], [], 0],
    ['u2x2', [A, B, C], [0, 2.25, -1], 0],
    ['br-pip2', [A, B, C], [3, 0, 0], 2],
  ]) {
    const url = fmt(layout, ids, offs, ref, 'コラボ "A"');
    assert.match(url, /^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=[^&]+&hkl=.*&title=[^&]+&hakomado=1$/);
    const r = plain(parse(`見てね ${url} #Hakomado`));
    assert.equal(r.layoutId, layout);
    assert.deepEqual(r.ids, ids);
    assert.equal(r.ref, ref);
    assert.equal(r.name, 'コラボ A');
    if (offs.some(Boolean) || ref > 0) assert.deepEqual(r.offsets, ids.map((_, k) => offs[k] || 0));
    else assert.equal(r.offsets, null);
  }
  // 名前が無ければ title は代わりの名前 (無ければ付けない)。hakomado=0 なので、読み戻しても名前にはならない
  const unnamed = fmt('u1x1', [A], [], 0, '', 'Hakomado 視聴セット');
  assert.match(unnamed, /&title=Hakomado%20視聴セット&hakomado=0$/);
  assert.equal(parse(unnamed).name, '');
  assert.equal(parse(fmt('u1x1', [A], [], 0, '', 'Hakomado 視聴セット', true)).name, '');
  assert.match(fmt('u1x1', [A], [], 0, ''), /&hkl=u1x1&hakomado=0$/);
  // リンクのすぐ後ろに文字が続いても (hakomado= の値にくっつく)、名前は変わらない
  assert.equal(parse(`${fmt('u1x1', [A], [], 0, '名前')}）見てね`).name, '名前');
  assert.equal(parse(`${unnamed}）見てね`).name, '');
  // 日本語はそのまま、区切りになる文字だけ % にする (読み戻すと元の名前)
  const url = fmt('u1x1', [A], [], 0, "A&B #1 100% <x>+y'");
  assert.match(url, /&title=A%26B%20%231%20100%25%20%3Cx%3E%2By%27&hakomado=1$/);
  assert.equal(parse(`${url} の続き`).name, "A&B #1 100% <x>+y'");
  // ascii = true (X の本文用) なら名前を全部 % にし、URL は ASCII だけ (読み戻すと同じ名前)
  const ascii = fmt('u1x1', [A], [], 0, "テスト (A&B) 100%'", '', true);
  assert.match(ascii, /^[!-~]+$/);
  assert.doesNotMatch(ascii, /[()'!*]/);
  assert.equal(parse(ascii).name, "テスト (A&B) 100%'");
  assert.doesNotMatch(fmt('u1x1', [A], [], 0, ''), /title=/);
});

test('QR 用のリンクではないもの (hkl= が無い・壊れている・17 本以上) は null', () => {
  const parse = setup()('parseShareLink');
  const ids17 = Array.from({ length: 17 }, (_, k) => `AAAAAAAAA${String(k).padStart(2, '0')}`).join(',');
  for (const raw of [
    `https://www.youtube.com/watch_videos?video_ids=${A}&hakomado=x`,
    `https://www.youtube.com/watch_videos?video_ids=${A}&hkl=u1x1!`,
    `https://www.youtube.com/watch_videos?video_ids=${A}&hkl=u1x1&hks=1;2`,
    `https://www.youtube.com/watch_videos?video_ids=${A},bad&hkl=u1x1`,
    `https://www.youtube.com/watch_videos?video_ids=${ids17}&hkl=u4x4`,
    `https://evil.example/watch_videos?video_ids=${A}&hkl=u1x1`,
  ]) {
    assert.equal(parse(raw), null, raw);
  }
});

test('X の投稿画面の URL: 文章と URL を入れる', () => {
  const fmt = setup()('formatXPostUrl');
  const url = new URL(fmt('11/21 話題の配信 #Hakomado', 'https://www.youtube.com/watch_videos?video_ids=A&hkl=u1x1&hakomado='));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), '11/21 話題の配信 #Hakomado');
  assert.equal(url.searchParams.get('url'), 'https://www.youtube.com/watch_videos?video_ids=A&hkl=u1x1&hakomado=');
  assert.equal(new URL(fmt('x')).searchParams.has('url'), false);
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

test('名前の 40 文字目が絵文字でも割れない (半端な 1 文字は落とし、リンク・コードに入れられる)', () => {
  const get = setup();
  const name = `${'あ'.repeat(39)}😀`; // 41 単位 (😀 は 2 単位)
  const n = get('shareName')(name);
  assert.equal(n, 'あ'.repeat(39));
  assert.doesNotThrow(() => get('formatShareLink')('u1x1', [A], [], 0, name, '', true));
  const ok = `${'あ'.repeat(38)}😀`; // ちょうど 40 単位なら絵文字ごと残る
  assert.equal(get('shareName')(ok), ok);
  assert.equal(get('parseShareCode')(get('formatShareCode')('u1x1', [A], [], 0, ok)).name, ok);
  assert.equal(get('parseShareLink')(get('formatShareLink')('u1x1', [A], [], 0, ok, '', true)).name, ok);
});

test('Twitch: チャンネル・VOD の URL から枠の ID (tw:…) を読む。YouTube やサイトのページは null', () => {
  const get = setup();
  const tw = get('twitchIdFromUrl');
  assert.equal(tw('https://www.twitch.tv/SomeOne'), 'tw:someone');
  assert.equal(tw('twitch.tv/some_one/'), 'tw:some_one');
  assert.equal(tw('https://m.twitch.tv/someone?ref=x'), 'tw:someone');
  assert.equal(tw('https://www.twitch.tv/videos/2345678901'), 'tw:v:2345678901');
  assert.equal(tw('https://www.twitch.tv/someone/video/123456'), 'tw:v:123456');
  assert.equal(tw('https://player.twitch.tv/?channel=SomeOne&parent=x'), 'tw:someone');
  assert.equal(tw('https://player.twitch.tv/?video=v123456&parent=x'), 'tw:v:123456');
  // v123 という名前のチャンネルは VOD と取り違えない
  assert.equal(tw('https://www.twitch.tv/v123'), 'tw:v123');
  for (const bad of ['https://www.twitch.tv/directory', 'https://www.twitch.tv/someone/clips', 'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'AAAAAAAAAAA', 'javascript:alert(1)', 'https://evil.example/twitch.tv/x', 'https://twitch.tv.evil.example/x']) {
    assert.equal(tw(bad), null, bad);
  }
  assert.equal(get('twitchName')('tw:someone'), 'someone');
  assert.equal(get('twitchName')('tw:v:123'), 'Twitch VOD 123');
  assert.equal(get('twitchName')(A), '');
});

// ---- Twitch の枠 (コードの最後の「 ~t …」・リンクの hkt=)
const TL = 'tw:lofigirl';
const TV = 'tw:v:2938768445';

test('Twitch の枠: コードの最後に「~t 枠の番号=名前」で入れ、全部の並びで読み戻せる', () => {
  const get = setup();
  const code = get('formatShareCode')('u2x2', [A, TL, B, TV], [], 0, '夜の部');
  assert.equal(code, `#Hakomado u2x2.${A}${B} "夜の部" ~t 1=lofigirl,3=v:2938768445`);
  assert.deepEqual(plain(get('parseShareCode')(code)), {
    ids: [A, TL, B, TV],
    offsets: null,
    ref: 0,
    layoutId: 'u2x2',
    name: '夜の部',
    movie: null,
  });
});

test('Twitch の枠: 同期のずれ・基準は YouTube の動画だけで数え、読むと全部の並び (Twitch のずれは 0) に戻る', () => {
  const get = setup();
  // 全部の並び: A, TL, B (基準), ずれ A=5 B=0
  const code = get('formatShareCode')('u3', [A, TL, B], [5, 0, 0], 2);
  assert.equal(code, `#Hakomado u3.${A}${B}~5,*0 ~t 1=lofigirl`);
  const r = plain(get('parseShareCode')(code));
  assert.deepEqual(r.ids, [A, TL, B]);
  assert.deepEqual(r.offsets, [5, 0, 0]);
  assert.equal(r.ref, 2);
});

test('Twitch の枠: 以前の版の読み方 (「~t」を知らない) では、YouTube の動画だけを詰めて読める', () => {
  const OLD =
    /#?Hakomado\s+([a-z0-9-]{1,24})\.((?:[A-Za-z0-9_-]{11}){1,16})(?:~([-+*\d.,]{1,240}))?(?![A-Za-z0-9_-])(?: "([^"\r\n]{1,40})")?(?: ~!([-*\d.,]{1,240}))?/i;
  const code = setup()('formatShareCode')('u2x2', [TL, A, TV, B], [0, 3, 0, 0], 3, '名前');
  const m = code.match(OLD);
  assert.equal(m[2], A + B);
  assert.equal(m[3], '3,*0');
  assert.equal(m[4], '名前');
});

test('Twitch の枠: 🎬 本編モードでも、本編の位置・本編にした動画を全部の並びに戻す', () => {
  const get = setup();
  const code = get('formatShareCode')('u3', [TL, A, B], [], 2, '', [null, 10, 20], 1);
  assert.equal(code, `#Hakomado u3.${A}${B} ~!10,*20,*0 ~t 0=lofigirl`);
  const r = plain(get('parseShareCode')(code));
  assert.deepEqual(r.ids, [TL, A, B]);
  assert.deepEqual(r.movie, [null, 10, 20]);
  assert.equal(r.ref, 2);
  assert.equal(r.main, 1);
});

test('Twitch の枠だけのセットも読み書きできる (YouTube の動画は 0 本)', () => {
  const get = setup();
  const code = get('formatShareCode')('u1x2', [TL, TV]);
  assert.equal(code, '#Hakomado u1x2. ~t 0=lofigirl,1=v:2938768445');
  assert.deepEqual(plain(get('parseShareCode')(code).ids), [TL, TV]);
  // 何も入っていないコードは null
  assert.equal(get('parseShareCode')('#Hakomado u1x2. ほかの文'), null);
});

test('Twitch の枠: 番号が飛んでいても詰める。同じ枠は 1 回だけ。壊れた「~t」は無視して YouTube の分を読む', () => {
  const parse = setup()('parseShareCode');
  assert.deepEqual(plain(parse(`#Hakomado u3.${A} ~t 9=lofigirl,0=abc,5=lofigirl`).ids), ['tw:abc', A, TL]);
  assert.deepEqual(plain(parse(`#Hakomado u3.${A}${B} ~t 1=Bad!Name`).ids), [A, B]);
  assert.deepEqual(plain(parse(`#Hakomado u3.${A}${B} ~t 1=LOFIGIRL`).ids), [A, B], '大文字は Twitch の名前ではない');
});

test('Twitch の枠: QR 用のリンクは hkt= に入れて読み戻せる (hakomado= はいつも最後)', () => {
  const get = setup();
  const link = get('formatShareLink')('u2x2', [A, TL, B], [], 0, '名前');
  assert.match(link, /&hkt=1=lofigirl&title=名前&hakomado=1$/);
  assert.match(link, new RegExp(`video_ids=${A},${B}&`));
  const r = plain(get('parseShareLink')(link));
  assert.deepEqual(r.ids, [A, TL, B]);
  assert.equal(r.name, '名前');
  // Twitch だけ: video_ids は空
  const only = get('formatShareLink')('u1', [TV]);
  assert.deepEqual(plain(get('parseShareLink')(only).ids), [TV]);
  // 壊れた hkt= のリンクは読まない
  assert.equal(get('parseShareLink')(`https://www.youtube.com/watch_videos?video_ids=${A}&hkl=u1&hkt=x&hakomado=0`), null);
});

test('🎬 見つけた区間 (~w・hkw=) を入れて読める。区間の無い動画は書かない (HAKO-49)', () => {
  const get = setup();
  const plans = [{ w: [[608.54, 0], [640, 20], [2096.651, 0]], k: 2 }, null];
  const code = get('formatShareCode')('u2x2', [A, B], [], 0, '無職転生', [2096.65, 12], -1, plans);
  assert.equal(code, `#Hakomado u2x2.${A}${B} "無職転生" ~!2096.65,12 ~w 0=2:608.54_0:640_20:2096.65_0`);
  const r = plain(get('parseShareCode')(code));
  assert.deepEqual(r.movie, [2096.65, 12]);
  assert.deepEqual(r.plans, [{ w: [[608.54, 0], [640, 20], [2096.65, 0]], k: 2 }, null]);
  // リンクでも同じ
  const link = get('formatShareLink')('u2x2', [A, B], [], 0, '', '', false, [2096.65, 12], -1, plans);
  assert.match(link, /&hkw=0=2:608\.54_0:640_20:2096\.65_0&/);
  assert.deepEqual(plain(get('parseShareLink')(link)).plans, r.plans);
  // 作品を選んでいなければ 0、区間の無いセットは「~w」を付けない
  assert.match(get('formatShareCode')('u2x2', [A], [], 0, '', [5], -1, [{ w: [[5, 0]], k: null }]), / ~w 0=0:5_0$/);
  assert.equal(get('formatShareCode')('u2x2', [A], [], 0, '', [5], -1, [null]), `#Hakomado u2x2.${A} ~!5`);
  assert.equal(plain(get('parseShareCode')(`#Hakomado u2x2.${A} ~!5`)).plans, undefined);
});

test('🎬 見つけた区間: 形の違う「~w」は無視して本編の位置だけで読む。Twitch の枠があっても動画の位置がずれない', () => {
  const get = setup();
  const bad = plain(get('parseShareCode')(`#Hakomado u2x2.${A} ~!5 ~w 0=1:abc`));
  assert.deepEqual(bad.movie, [5]);
  assert.equal(bad.plans, undefined);
  const ids = ['tw:somebody', A, B];
  const code = get('formatShareCode')('u2x2', ids, [], 1, '', [null, 5, 7], -1, [null, null, { w: [[7, 0]], k: 1 }]);
  assert.match(code, / ~t 0=somebody ~w 1=1:7_0$/, 'YouTube の動画だけの並びでの番号');
  const r = plain(get('parseShareCode')(code));
  assert.deepEqual(r.ids, ids);
  assert.deepEqual(r.plans, [null, null, { w: [[7, 0]], k: 1 }]);
});
