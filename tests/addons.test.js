// アドオン (extension/addons.js と addons/ のファイル)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, plain, readExt, EXT } = require('./helpers/load');

const ADDON_FILES = fs.readdirSync(path.join(EXT, 'addons')).filter((f) => f.endsWith('.js')).map((f) => `addons/${f}`);
const env = () => load(['i18n.js', 'addons.js', ...ADDON_FILES]);

test('addons/ のファイルは全部 grid.html で addons.js の後・favorites.js の前に読み込む', () => {
  const scripts = [...readExt('grid.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const f of ADDON_FILES) {
    assert.ok(scripts.includes(f), `${f} を読み込んでいない`);
    assert.ok(scripts.indexOf('addons.js') < scripts.indexOf(f) && scripts.indexOf(f) < scripts.indexOf('favorites.js'), f);
  }
});

test('アドオンのアクセス先は manifest.json の権限に書いてある', () => {
  const manifest = JSON.parse(readExt('manifest.json'));
  const declared = new Set([...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])]);
  const addons = env().get('Addons.list()');
  assert.ok(addons.length >= 1);
  for (const a of addons) {
    for (const o of a.origins) assert.ok(declared.has(o), `${a.id} の ${o} が manifest.json に無い`);
    assert.ok(Array.isArray(a.name) && a.name.length === 2 && Array.isArray(a.note) && a.note.length === 2, `${a.id} の名前・説明が [ja, en] の組ではない`);
    if (a.type === 'schedule') assert.equal(typeof a.fetchEntries, 'function', a.id);
  }
});

test('ON / OFF: 書いていなければ初期値。初期値と同じにしたら設定から消す。知らない形は捨てる', () => {
  const e = env();
  const A = e.get('Addons');
  A.setStates('');
  assert.equal(A.isOn('holodule'), true, 'ホロジュールは初期値で ON');
  const off = A.withState('', 'holodule', false);
  assert.equal(off, 'holodule:off');
  A.setStates(off);
  assert.equal(A.isOn('holodule'), false);
  assert.deepEqual(plain(A.enabled('schedule').map((a) => a.id)), []);
  assert.equal(A.withState(off, 'holodule', true), '', '初期値に戻したら書かない');
  A.setStates('holodule:maybe,<bad>:on,,nosuch:on');
  assert.equal(A.isOn('holodule'), true);
  assert.equal(A.isOn('nosuch'), false, '登録されていないものは ON にならない');
});

test('アドオンが取りに行けるのは origins の中だけ', () => {
  const A = env().get('Addons');
  const h = A.list().find((a) => a.id === 'holodule');
  assert.equal(A.allowed(h, 'https://schedule.hololive.tv/lives'), true);
  assert.equal(A.allowed(h, 'https://schedule.hololive.tv.example.com/'), false);
  assert.equal(A.allowed(h, 'https://www.youtube.com/'), false);
});

test('登録の誤り (id の重複・origins の形) は止める', () => {
  const A = env().get('Addons');
  assert.throws(() => A.register({ id: 'holodule', origins: [] }));
  assert.throws(() => A.register({ id: 'x', origins: ['https://example.com/'] }));
  assert.throws(() => A.register({ id: 'Bad id', origins: [] }));
});

test('にじさんじ: /api/streams の JSON から YouTube の枠を読む (Twitch・形の違うものは捨てる)', () => {
  const A = env().get('Addons');
  const n = A.list().find((a) => a.id === 'nijisanji');
  assert.equal(n.defaultOn, false, '初期値は OFF');
  const ch = { name: '九里詠太 / Kuri Eita【にじさんじ】', 'thumbnail-url': 'https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj' };
  const json = JSON.stringify([
    { url: 'https://www.youtube.com/watch?v=5U_QG9D43xo', 'start-at': '2026-11-24T09:00:00.000+09:00', status: 'on_air', platform: 'youtube', channel: ch },
    { url: 'https://www.youtube.com/watch?v=cTZef0lFlxo', 'start-at': '2026-11-25T00:00:00.000+09:00', status: 'not_on_air', platform: 'youtube', channel: { name: 'x', 'thumbnail-url': 'https://evil.example/a.png' } },
    { url: 'https://www.twitch.tv/someone', 'start-at': '2026-11-24T11:53:09.000+09:00', status: 'on_air', platform: 'twitch', channel: ch },
    { url: 'https://www.youtube.com/watch?v=bad', 'start-at': '2026-11-24T09:00:00.000+09:00', platform: 'youtube' },
    null,
  ]);
  assert.deepEqual(plain(n.parse(json)), [
    { videoId: '5U_QG9D43xo', startAt: Date.UTC(2026, 10, 24, 0, 0), live: true, name: ch.name, icon: ch['thumbnail-url'] },
    { videoId: 'cTZef0lFlxo', startAt: Date.UTC(2026, 10, 24, 15, 0), live: false, name: 'x', icon: '' },
  ]);
  assert.throws(() => n.parse('<html>'));
  assert.throws(() => n.parse('{"error":1}'));
  assert.equal(n.covers({ pack: 'にじさんじ' }), true);
  assert.equal(n.covers({ pack: 'NIJISANJI EN' }), true);
  assert.equal(n.covers({ pack: 'ホロライブ' }), false);
  assert.equal(n.covers({ preset: true }), false);
  assert.equal(A.allowed(n, 'https://www.nijisanji.jp/api/streams?day_offset=0'), true);
  assert.equal(A.allowed(n, 'https://nijisanji.jp/api/streams'), false);
});

test('にじさんじ: 配信中・今日・明日を取ってまとめる。1 つでも取れなければ失敗', async () => {
  const n = env().get('Addons').list().find((a) => a.id === 'nijisanji');
  const item = (v, status) => ({ url: `https://www.youtube.com/watch?v=${v}`, 'start-at': '2026-11-24T09:00:00+09:00', status, platform: 'youtube', channel: {} });
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    return JSON.stringify(url.includes('now_on_air') ? [item('AAAAAAAAAAA', 'on_air')] : [item('AAAAAAAAAAA', 'not_on_air'), item('BBBBBBBBBBB', 'not_on_air')]);
  };
  const got = plain(await n.fetchEntries({ fetchText }));
  assert.deepEqual(urls.sort(), [
    'https://www.nijisanji.jp/api/streams?day_offset=0',
    'https://www.nijisanji.jp/api/streams?day_offset=1',
    'https://www.nijisanji.jp/api/streams?now_on_air=true',
  ]);
  assert.deepEqual(got.map((e) => [e.videoId, e.live]).sort(), [['AAAAAAAAAAA', true], ['BBBBBBBBBBB', false]]);
  await assert.rejects(n.fetchEntries({ fetchText: async (url) => (url.includes('day_offset=1') ? Promise.reject(new Error('502')) : '[]') }));
});

test('にじさんじ: ライバーの一覧からパック用のチャンネルを読む (ユニット・卒業・形の違うものは除く)', async () => {
  const n = env().get('Addons').list().find((a) => a.id === 'nijisanji');
  const details = {
    kuzuha: { name: '葛葉', enName: 'Kuzuha', unit: false, channelId: 'UCSFCh5NL4qXrAy9u-u2lX3g' },
    'nijisanji-en': { name: 'NIJISANJI EN', unit: true, channelId: 'UC-JSeFfovhNsEhftt1WHMvg' },
    'vox-akuma': { name: 'ヴォックス・アクマ', enName: 'Vox Akuma', unit: false, channelId: 'UCckdfYDGrjojJM28n5SHYrA' },
    broken: { name: 'x', unit: false, channelId: 'bad' },
  };
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    assert.ok(url.startsWith('https://www.nijisanji.jp/'), url);
    if (url.endsWith('/streams')) return '<script>{"buildId":"B1d-x"}</script>';
    if (url.includes('/api/livers')) {
      return JSON.stringify(
        url.includes('affiliation=nijisanjien')
          ? [{ slug: 'nijisanji-en' }, { slug: 'vox-akuma' }]
          : [{ slug: 'kuzuha' }, { slug: 'gone', hidden: true }, { slug: 'broken' }, { slug: '../x' }],
      );
    }
    const slug = url.match(/\/talents\/l\/([^/]+)\.json$/)[1];
    assert.ok(url.includes('/_next/data/B1d-x/ja/'), url);
    return JSON.stringify({ pageProps: { liverDetail: details[slug] } });
  };
  assert.deepEqual(plain(await n.listChannels({ fetchText })), [
    { channelId: 'UCSFCh5NL4qXrAy9u-u2lX3g', name: '葛葉', group: 'にじさんじ' },
    { channelId: 'UCckdfYDGrjojJM28n5SHYrA', name: 'Vox Akuma', group: 'NIJISANJI EN' },
  ]);
  assert.ok(!urls.some((u) => u.includes('/gone.') || u.includes('../')), '卒業・おかしな slug は取りに行かない');
  assert.equal(n.covers({ pack: n.pack.name }), true, 'パックの名前は covers の条件に合う');
});

test('ホロジュール: 公式サイトのタレントのページから、チャンネル (ID かハンドル)・名前・グループを読む', () => {
  const h = env().get('Addons').list().find((a) => a.id === 'holodule');
  const page = (h1, gp, gpName, sns) =>
    `<div class="breadcrumb"><a href="https://hololive.hololivepro.com/talents" class="taxonomy">TALENT</a>` +
    `<a property="item" href="https://hololive.hololivepro.com/talents?gp=${gp}" class="taxonomy gp" ><span property="name">${gpName}</span></a></div>` +
    `<h1>\n${h1}<span>Roman</span> </h1><ul class="t_sns clearfix">${sns}</ul><a href="https://www.youtube.com/channel/UCJFZiqLMntJufDCHc6bQixg">公式</a>`;
  assert.deepEqual(
    plain(h.parseTalent(page('赤井はあと', '1stgen', '1期生', '<li><a href="https://www.youtube.com/channel/UC1CfXB_kRs3C-zaeTG3oGyg?sub_confirmation=1">YouTube</a></li>'))),
    { name: '赤井はあと', group: '1期生', channelId: 'UC1CfXB_kRs3C-zaeTG3oGyg' },
  );
  assert.deepEqual(
    plain(h.parseTalent(page('音乃瀬奏', 'regloss', 'ReGLOSS', '<li><a href="https://youtube.com/@OtonoseKanade?sub_confirmation=1">YouTube</a></li>'))),
    { name: '音乃瀬奏', group: 'ReGLOSS', handle: '@OtonoseKanade' },
    'リンクがハンドルのときはハンドル',
  );
  assert.equal(h.parseTalent(page('Someone', 'myth', 'Myth', '<li>x</li>')), null, 'YouTube のリンクが無ければ読まない');
  assert.equal(h.parseTalent(page('【配信活動終了】 誰か', 'holox', '秘密結社holoX', '<li><a href="https://www.youtube.com/channel/UCIBY1ollUsauvVi4hW4cumw">YouTube</a></li>')), null);
  assert.equal(h.parseTalent(page('新人', 'new-unit', '新ユニット', '<li><a href="https://www.youtube.com/@New">YouTube</a></li>')).group, '新ユニット', '知らない gp はサイトの表記');
  assert.equal(h.covers({ pack: 'ホロライブ' }), true, 'ホロライブのパックから足したチャンネルも載る');
  assert.equal(h.covers({ pack: 'にじさんじ' }), false);
  assert.deepEqual(plain(h.pack.origins), ['https://hololive.hololivepro.com/*']);
});

test('パックを作るアドオン: pack の名前は covers の条件に合い、pack.origins は manifest.json に入れない (拡張機能は通信しない)', () => {
  const manifest = JSON.parse(readExt('manifest.json'));
  const declared = new Set([...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])]);
  for (const a of env().get('Addons').list().filter((x) => x.pack)) {
    assert.equal(typeof a.listChannels, 'function', a.id);
    assert.equal(a.covers({ pack: a.pack.name }), true, `${a.id}: パックの名前が covers に合わない`);
    assert.ok(fs.existsSync(path.join(EXT, '..', 'packs', a.pack.file)), `${a.id}: packs/${a.pack.file} が無い`);
    for (const o of a.pack.origins || []) {
      assert.match(o, /^https:\/\/[a-z0-9.-]+\/\*$/);
      assert.ok(!declared.has(o) || a.origins.includes(o), `${a.id}: ${o} はパック作り専用なので権限に入れない`);
    }
  }
});
