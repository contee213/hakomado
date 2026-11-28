// バックアップの読み込み時の検証 (extension/backup.js)・再生リスト 1 件の検証 (extension/playlists.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const ch = (n) => 'UC' + String(n).padStart(22, '0');
const vid = (n) => 'v' + String(n).padStart(10, '0');
const DEFAULTS = { duration: 5, opacity: 0.9, areaPos: 'top', danmaku: true };

function setup() {
  const env = load(['i18n.js', 'history.js', 'playlists.js', 'backup.js']);
  return { Backup: env.get('Backup'), Playlists: env.get('Playlists'), env };
}
const file = (data, over = {}) => JSON.stringify({ app: 'hakomado', format: 1, data, ...over });

test('ほかのファイル・壊れたファイルは notBackup', () => {
  const { Backup } = setup();
  for (const text of ['', '{', 'null', '[]', '"x"', JSON.stringify({ app: 'other', format: 1, data: {} }), JSON.stringify({ app: 'hakomado', format: 1 }), JSON.stringify({ app: 'hakomado', format: 1, data: 'x' })]) {
    assert.throws(() => Backup.parse(text, DEFAULTS), { message: 'notBackup' }, text);
  }
});

test('知らない新しい形・形の番号が無いものは tooNew', () => {
  const { Backup } = setup();
  assert.throws(() => Backup.parse(file({}, { format: 2 }), DEFAULTS), { message: 'tooNew' });
  assert.throws(() => Backup.parse(file({}, { format: undefined }), DEFAULTS), { message: 'tooNew' });
  assert.throws(() => Backup.parse(file({}, { format: '1' }), DEFAULTS), { message: 'tooNew' });
});

test('空のデータは初期の形になる', () => {
  const { Backup } = setup();
  const r = plain(Backup.parse(file({}), DEFAULTS));
  assert.deepEqual(r, {
    data: { settings: {}, favorites: [], presetVersion: 0, removedPresets: [], presetsDeclined: false, history: [], saved: [], playlists: [] },
    lang: null,
    counts: { channels: 0, stars: 0, history: 0, saved: 0, playlists: 0 },
  });
});

test('共通設定: 初期値にある項目で、同じ型の値だけ', () => {
  const { Backup } = setup();
  const r = Backup.parse(file({ settings: { duration: 8, opacity: '1', areaPos: 'bottom', danmaku: 1, unknown: 'x' } }), DEFAULTS);
  assert.deepEqual(plain(r.data.settings), { duration: 8, areaPos: 'bottom' });
  // 手で書いた "__proto__" から初期値以外の値を持ち込まない
  const proto = Backup.parse('{"app":"hakomado","format":1,"data":{"settings":{"__proto__":{"duration":9}}}}', DEFAULTS);
  assert.deepEqual(plain(proto.data.settings), {});
  assert.deepEqual(plain(Backup.parse(file({ settings: [1, 2] }), DEFAULTS).data.settings), {});
});

test('チャンネル: 正しい ID だけ・同じものは 1 回・https のアイコンだけ', () => {
  const { Backup } = setup();
  const favorites = [
    { channelId: ch(1), name: 'A', star: true, preset: true, icon: 'https://yt3.ggpht.com/a', extra: 'x' },
    { channelId: ch(1), name: 'A の 2 回目' },
    { channelId: 'bad' },
    null,
    { channelId: ch(2), handle: '@b', icon: 'javascript:alert(1)', star: 'yes' },
    { channelId: ch(3) },
  ];
  const r = plain(Backup.parse(file({ favorites }), DEFAULTS));
  assert.deepEqual(r.data.favorites, [
    { channelId: ch(1), name: 'A', icon: 'https://yt3.ggpht.com/a', preset: true, star: true },
    { channelId: ch(2), handle: '@b', name: '@b' },
    { channelId: ch(3), name: ch(3) },
  ]);
  assert.equal(r.counts.channels, 3);
  assert.equal(r.counts.stars, 1);
});

test('履歴・あとで見る: 正しい動画 ID だけ・理由は知っているものだけ・100 件まで', () => {
  const { Backup } = setup();
  const history = [
    { videoId: vid(1), title: 'T', at: 10, reason: 'ended', junk: 1 },
    { videoId: vid(1), title: '2 回目' },
    { videoId: 'short' },
    { videoId: vid(2), reason: 'hacked', at: 'yesterday' },
    ...Array.from({ length: 150 }, (_, i) => ({ videoId: vid(100 + i) })),
  ];
  const r = plain(Backup.parse(file({ history, saved: [{ videoId: vid(3), channel: 'C' }, 'x'] }), DEFAULTS));
  assert.deepEqual(r.data.history.slice(0, 2), [
    { videoId: vid(1), title: 'T', at: 10, reason: 'ended' },
    { videoId: vid(2) },
  ]);
  assert.equal(r.data.history.length, 100);
  assert.deepEqual(r.data.saved, [{ videoId: vid(3), channel: 'C' }]);
});

test('その他の項目・表示言語', () => {
  const { Backup } = setup();
  const r = plain(
    Backup.parse(
      file({ presetVersion: 3, removedPresets: [ch(1), ch(1), 'bad'], presetsDeclined: true }, { lang: 'en' }),
      DEFAULTS,
    ),
  );
  assert.equal(r.data.presetVersion, 3);
  assert.deepEqual(r.data.removedPresets, [ch(1)]);
  assert.equal(r.data.presetsDeclined, true);
  assert.equal(r.lang, 'en');
  const bad = plain(Backup.parse(file({ presetVersion: -1, presetsDeclined: 'true' }, { lang: 'fr' }), DEFAULTS));
  assert.equal(bad.data.presetVersion, 0);
  assert.equal(bad.data.presetsDeclined, false);
  assert.equal(bad.lang, null);
});

test('再生リスト: 1 件ずつ確かめ、同じ id は 1 回・30 個まで', () => {
  const { Backup } = setup();
  const playlists = [
    { id: 'p1', name: 'A', items: [{ videoId: vid(1) }] },
    { id: 'p1', name: 'A の 2 回目', items: [] },
    { id: '', items: [] },
    { id: 'p2', name: 'B' }, // items が無い
    ...Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, items: [] })),
  ];
  const r = plain(Backup.parse(file({ playlists }), DEFAULTS));
  assert.equal(r.data.playlists[0].name, 'A');
  assert.equal(r.data.playlists.length, 30);
  assert.equal(r.counts.playlists, 30);
});

test('Playlists.clean: 中身の検証', () => {
  const { Playlists } = setup();
  const p = plain(
    Playlists.clean({
      id: 'x'.repeat(100),
      name: ' 名前\n2 行目 ',
      items: [
        { videoId: vid(1), label: 'L\tabel', offset: 99999999, watched: true },
        { videoId: vid(1) },
        { videoId: 'bad' },
        { videoId: vid(2), offset: 'x', watched: 'yes' },
      ],
      sync: 'true',
      layoutId: '<script>',
      ref: vid(9), // 中に無い動画
      resume: { at: -1 },
      createdAt: 5,
    }),
  );
  assert.equal(p.id.length, 64);
  assert.equal(p.name, '名前 2 行目');
  assert.deepEqual(p.items, [{ videoId: vid(1), label: 'L abel', offset: 86400, watched: true }, { videoId: vid(2) }]);
  assert.equal(p.sync, false);
  assert.equal(p.layoutId, null);
  assert.equal(p.ref, null);
  assert.equal(p.resume, null);
  assert.equal(p.createdAt, 5);
  assert.equal(p.updatedAt, 0);
  for (const bad of [null, 'x', { id: 1, items: [] }, { id: 'a' }, { id: 'a', items: {} }]) assert.equal(Playlists.clean(bad), null);
});

test('Playlists.clean: 同期再生は 16 本・順に再生は 200 本まで', () => {
  const { Playlists } = setup();
  const items = Array.from({ length: 250 }, (_, i) => ({ videoId: vid(i) }));
  assert.equal(Playlists.clean({ id: 'a', items, sync: true }).items.length, 16);
  assert.equal(Playlists.clean({ id: 'a', items }).items.length, 200);
  const ok = plain(Playlists.clean({ id: 'a', items: items.slice(0, 2), sync: true, layoutId: 'tl-m1s3', ref: vid(1), resume: { at: 1000, pos: 12.7 } }));
  assert.equal(ok.layoutId, 'tl-m1s3');
  assert.equal(ok.ref, vid(1));
  assert.deepEqual(ok.resume, { at: 1000, pos: 13, savedAt: 0 });
});

test('読み込んだ内容で置き換える (apply)', async () => {
  const { Backup, Playlists, env } = setup();
  env.chrome.storage.local._seed({ favorites: [{ channelId: ch(9), name: '前の' }], playlistIndex: ['old'], 'playlist:old': { id: 'old', name: '前', items: [] } });
  const parsed = Backup.parse(
    file({ favorites: [{ channelId: ch(1), name: 'A' }], history: [{ videoId: vid(1) }], playlists: [{ id: 'p1', name: 'P', items: [{ videoId: vid(2) }] }] }, { lang: 'en' }),
    DEFAULTS,
  );
  await Backup.apply(parsed);
  const d = env.chrome.storage.local._dump();
  assert.deepEqual(d.favorites, [{ channelId: ch(1), name: 'A' }]);
  assert.deepEqual(d.history, [{ videoId: vid(1) }]);
  assert.deepEqual(d.playlistIndex, ['p1']);
  assert.equal(d['playlist:old'], undefined, '前の再生リストは消える');
  assert.deepEqual(plain((await Playlists.list()).map((p) => p.name)), ['P']);
  assert.equal(env.get('localStorage').getItem('hakomado.lang'), 'en');
});

test('再生リストだけ書けなかったら、ほかは置き換えたまま playlistsError を返す (再生リストの onError は呼ばない。HAKO-58)', async () => {
  const { Backup, Playlists, env } = setup();
  const local = env.chrome.storage.local;
  const set = local.set.bind(local);
  local.set = async (items) => {
    if (Object.keys(items).some((k) => k.startsWith('playlist'))) throw new Error('QUOTA_BYTES quota exceeded');
    return set(items);
  };
  const notified = [];
  Playlists.onError((e) => notified.push(e));
  const parsed = Backup.parse(file({ favorites: [{ channelId: ch(1), name: 'A' }], playlists: [{ id: 'p1', name: 'P', items: [{ videoId: vid(2) }] }] }), DEFAULTS);
  const r = await Backup.apply(parsed);
  assert.match(String(r.playlistsError?.message), /quota/);
  assert.deepEqual(local._dump().favorites, [{ channelId: ch(1), name: 'A' }], 'ほかは置き換わっている');
  assert.equal(notified.length, 0, '知らせるのは画面 (バックアップの読み込み) の側');
  // 書けたときは playlistsError が無い
  local.set = set;
  assert.equal((await Backup.apply(parsed)).playlistsError, null);
});
