// チャンネルパック (extension/packs.js) の読み書き
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const ch = (n) => 'UC' + String(n).padStart(22, '0'); // 正しい形のチャンネル ID
const pack = (over = {}) => JSON.stringify({ app: 'hakomado', type: 'channels', name: 'テスト', channels: [{ channelId: ch(1), name: 'A' }], ...over });

function setup(globals) {
  const env = load(['packs.js'], { globals });
  return env.get('ChannelPack');
}

test('正しいパックを読む', () => {
  const P = setup();
  const r = plain(
    P.parse(
      pack({
        author: '作者',
        updated: '2026-11-21',
        channels: [
          { channelId: ch(1), name: 'A', handle: '@a', group: 'G', icon: 'https://yt3.ggpht.com/x' },
          { channelId: ch(2), name: 'B' },
        ],
      }),
    ),
  );
  assert.deepEqual(r, {
    name: 'テスト',
    author: '作者',
    updated: '2026-11-21',
    channels: [
      { channelId: ch(1), name: 'A', group: 'G', handle: '@a', icon: 'https://yt3.ggpht.com/x' },
      // group が無ければパックの名前
      { channelId: ch(2), name: 'B', group: 'テスト' },
    ],
  });
});

test('おかしなチャンネルは飛ばし、同じチャンネルは 1 回だけ', () => {
  const P = setup();
  const r = P.parse(
    pack({
      channels: [
        null,
        'UCxxx',
        { channelId: 'UCshort' },
        { channelId: ch(1), name: 'A' },
        { channelId: ch(1), name: 'A2' },
        { channelId: ch(2) },
      ],
    }),
  );
  assert.deepEqual(plain(r.channels.map((c) => [c.channelId, c.name])), [
    [ch(1), 'A'],
    [ch(2), ch(2)], // 名前が無ければチャンネル ID
  ]);
});

test('アイコンは YouTube の画像の置き場所だけ・ハンドルは正しい形だけ', () => {
  const P = setup();
  const r = P.parse(
    pack({
      channels: [
        { channelId: ch(1), icon: 'https://evil.example/x.png', handle: 'no-at' },
        { channelId: ch(2), icon: 'javascript:alert(1)', handle: '@has space' },
        { channelId: ch(3), icon: 'https://i.ytimg.com/vi/x/default.jpg', handle: '@ok' },
      ],
    }),
  );
  const [a, b, c] = plain(r.channels);
  assert.equal(a.icon, undefined);
  assert.equal(a.handle, undefined);
  assert.equal(b.icon, undefined);
  assert.equal(b.handle, undefined);
  assert.equal(c.icon, 'https://i.ytimg.com/vi/x/default.jpg');
  assert.equal(c.handle, '@ok');
});

test('制御文字は空白にし、長すぎる文字は切る', () => {
  const P = setup();
  const r = P.parse(pack({ name: 'a\u0000b\nc' + 'x'.repeat(100), channels: [{ channelId: ch(1), name: 'n'.repeat(500) }] }));
  assert.equal(r.name.length, 50);
  assert.ok(r.name.startsWith('a b c'));
  assert.equal(r.channels[0].name.length, 100);
});

test('名前の無いパックは既定の名前', () => {
  const P = setup();
  assert.equal(P.parse(pack({ name: '' })).name, 'Channel pack');
  assert.equal(P.parse(pack({ name: 123 })).name, 'Channel pack');
});

test('チャンネルは 1000 件まで', () => {
  const P = setup();
  const channels = Array.from({ length: 1200 }, (_, i) => ({ channelId: ch(i) }));
  assert.equal(P.parse(pack({ channels })).channels.length, 1000);
});

test('壊れた入力は理由付きで断る', () => {
  const P = setup();
  const cases = [
    ['{not json', 'notPack'],
    ['null', 'notPack'],
    ['[]', 'notPack'],
    ['"str"', 'notPack'],
    [pack({ app: 'other' }), 'notPack'],
    [pack({ type: 'backup' }), 'notPack'],
    [pack({ channels: {} }), 'notPack'],
    [pack({ channels: [] }), 'emptyPack'],
    [pack({ channels: [{ channelId: 'bad' }] }), 'emptyPack'],
    [' '.repeat(2 * 1024 * 1024 + 1), 'tooLarge'],
    [undefined, 'tooLarge'],
    [{}, 'tooLarge'],
  ];
  for (const [input, message] of cases) {
    assert.throws(() => P.parse(input), { message }, `入力: ${String(input).slice(0, 40)}`);
  }
});

test('書き出したパックをそのまま読める', () => {
  const P = setup();
  const built = P.build('自分の一覧', [
    { channelId: ch(1), nameJa: 'あ', name: 'A', handle: '@a', group: 'G', icon: 'https://yt3.googleusercontent.com/y' },
    { channelId: ch(2), name: 'B', icon: 'https://evil.example/z' },
  ]);
  assert.equal(built.app, 'hakomado');
  assert.equal(built.type, 'channels');
  assert.match(built.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(built.channels[1].icon, undefined, '許していないアイコンは書き出さない');
  const r = plain(P.parse(JSON.stringify(built)));
  assert.equal(r.name, '自分の一覧');
  assert.deepEqual(r.channels, [
    { channelId: ch(1), name: 'あ', group: 'G', handle: '@a', icon: 'https://yt3.googleusercontent.com/y' },
    { channelId: ch(2), name: 'B', group: '自分の一覧' },
  ]);
});

test('URL からの取得は https だけ・Cookie を送らない', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => pack() };
  };
  const P = setup({ fetch });
  await assert.rejects(P.fetchText('http://example.com/p.json'), { message: 'badUrl' });
  await assert.rejects(P.fetchText('not a url'), { message: 'badUrl' });
  await assert.rejects(P.fetchText('file:///etc/passwd'), { message: 'badUrl' });
  assert.equal(calls.length, 0);
  const text = await P.fetchText('  https://example.com/p.json ');
  assert.equal(text, pack());
  assert.equal(calls[0].url, 'https://example.com/p.json');
  assert.equal(calls[0].init.credentials, 'omit');
});

test('URL からの取得: 失敗した応答・大きすぎる中身', async () => {
  let res;
  const P = setup({ fetch: async () => res });
  res = { ok: false, status: 404, text: async () => '' };
  await assert.rejects(P.fetchText('https://example.com/p.json'), { message: 'HTTP 404' });
  res = { ok: true, status: 200, text: async () => 'x'.repeat(2 * 1024 * 1024 + 1) };
  await assert.rejects(P.fetchText('https://example.com/p.json'), { message: 'tooLarge' });
});
