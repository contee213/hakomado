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

/** vspo-schedule.com のページの形 (埋め込みデータを self.__next_f.push([1,"…"]) の文字列で、途中で 2 つに分けて入れる) */
function vspoPage(streams) {
  const text = `1c:T95d,説明文 {"id":"notanobject"\n5:["$","div",null,{"streams":${JSON.stringify(streams)}}]\n`;
  const half = Math.floor(text.length / 2);
  return [text.slice(0, half), text.slice(half)].map((t) => `<script>self.__next_f.push([1,${JSON.stringify(t)}])</script>`).join('');
}

test('ぶいすぽっ!: ページの埋め込みデータから YouTube の配信中・予定の枠を読む (Twitch・終わった枠・形の違うものは捨てる)', () => {
  const A = env().get('Addons');
  const v = A.list().find((a) => a.id === 'vspo');
  assert.equal(v.defaultOn, false, '初期値は OFF');
  const s = (id, status, extra = {}) => ({
    id, type: 'livestream', title: 'タイトル {"id":"AAAAAAAAAAA","type":"x"}', description: '$1e', platform: 'youtube',
    channelId: 'UCIcAj6WkJ8vZ7DeJVgmeqKw', channelTitle: ' 胡桃のあ ', channelThumbnailUrl: 'https://yt3.ggpht.com/abc=s800',
    tags: [''], status, scheduledStartTime: '2026-11-24T06:40:56Z', ...extra,
  });
  const html = vspoPage([
    s('b2IOS8weqtM', 'live'),
    s('rABZaVS2fOI', 'upcoming', { channelId: 'bad', channelThumbnailUrl: 'https://evil.example/a.png', scheduledStartTime: '2026-11-25T10:50:00Z' }),
    s('Q5PpnS5Hgq4', 'ended'),
    s('2938393174', 'live', { platform: 'twitch' }),
    s('xGX2_FepG_o', 'upcoming', { scheduledStartTime: 'soon' }),
    s('b2IOS8weqtM', 'live'),
  ]);
  assert.deepEqual(plain(v.parse(html)), [
    { videoId: 'b2IOS8weqtM', startAt: Date.UTC(2026, 10, 24, 6, 40, 56), live: true, name: '胡桃のあ', icon: 'https://yt3.ggpht.com/abc=s800', channelId: 'UCIcAj6WkJ8vZ7DeJVgmeqKw' },
    { videoId: 'rABZaVS2fOI', startAt: Date.UTC(2026, 10, 25, 10, 50), live: false, name: '胡桃のあ', icon: '' },
  ]);
  assert.throws(() => v.parse('<html></html>'));
  assert.deepEqual(plain(v.parse(vspoPage([]))), []);
  assert.equal(v.covers({ pack: 'ぶいすぽっ!' }), true);
  assert.equal(v.covers({ pack: 'VSPO! EN' }), true);
  assert.equal(v.covers({ pack: 'にじさんじ' }), false);
  assert.equal(v.covers({ preset: true }), false);
  assert.equal(A.allowed(v, 'https://www.vspo-schedule.com/schedule/live'), true);
  assert.equal(A.allowed(v, 'https://vspo.jp/member/'), false, 'メンバー紹介はパック作り専用 (拡張機能は取りに行かない)');
});

test('ぶいすぽっ!: 配信中・これからの 2 ページを取ってまとめる。1 つでも取れなければ失敗', async () => {
  const v = env().get('Addons').list().find((a) => a.id === 'vspo');
  const s = (id, status) => ({ id, type: 'livestream', platform: 'youtube', status, scheduledStartTime: '2026-11-24T11:00:00Z' });
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    return vspoPage(url.endsWith('/live') ? [s('AAAAAAAAAAA', 'live')] : [s('AAAAAAAAAAA', 'upcoming'), s('BBBBBBBBBBB', 'upcoming')]);
  };
  const got = plain(await v.fetchEntries({ fetchText }));
  assert.deepEqual(urls.sort(), ['https://www.vspo-schedule.com/schedule/live', 'https://www.vspo-schedule.com/schedule/upcoming']);
  assert.deepEqual(got.map((e) => [e.videoId, e.live]).sort(), [['AAAAAAAAAAA', true], ['BBBBBBBBBBB', false]]);
  await assert.rejects(v.fetchEntries({ fetchText: async (url) => (url.endsWith('/upcoming') ? Promise.reject(new Error('502')) : vspoPage([])) }));
});

test('ぶいすぽっ!: 公式サイトのメンバー紹介からパック用のチャンネルを読む', async () => {
  const v = env().get('Addons').list().find((a) => a.id === 'vspo');
  const li = (cls, name, href) =>
    `<li\n class="swiper-slide member__single__item ${cls}"\n data-id="x"\n data-name="${name}">\n<ul class="member__sns"><li><a href="https://twitter.com/x"></a></li>${href ? `<li><a href="${href}" target="_blank"></a></li>` : ''}</ul></li>`;
  const html = [
    li('--noah --japanese', '胡桃 のあ', 'https://www.youtube.com/channel/UCIcAj6WkJ8vZ7DeJVgmeqKw'),
    li('--met --japanese', '小森 めと', 'https://www.youtube.com/@Met_Komori'),
    li('--remia --english', '青月レミア', 'https://www.youtube.com/@RemiaAotsuki'),
    li('--nolink --japanese', 'リンクなし', ''),
  ].join('\n');
  const urls = [];
  const got = plain(await v.listChannels({ fetchText: async (url) => (urls.push(url), html) }));
  assert.deepEqual(urls, ['https://vspo.jp/member/']);
  assert.deepEqual(got.slice(0, 3), [
    { name: '胡桃のあ', group: 'ぶいすぽっ!', channelId: 'UCIcAj6WkJ8vZ7DeJVgmeqKw' },
    { name: '小森めと', group: 'ぶいすぽっ!', handle: '@Met_Komori' },
    { name: '青月レミア', group: 'VSPO! EN', handle: '@RemiaAotsuki' },
  ]);
  assert.ok(got.slice(3).every((c) => c.group === '公式' && /^UC[\w-]{22}$/.test(c.channelId)), '残りは公式のチャンネル');
  await assert.rejects(v.listChannels({ fetchText: async () => '<html></html>' }));
  assert.equal(v.covers({ pack: v.pack.name }), true, 'パックの名前は covers の条件に合う');
  assert.ok(v.pack.origins.every((o) => !v.origins.includes(o)));
});

test('STPR: schedule_v2.json から YouTube の配信中・予定の枠を読む (ツイキャス・終わった枠・形の違うものは捨てる)', async () => {
  const A = env().get('Addons');
  const st = A.list().find((a) => a.id === 'stpr');
  assert.equal(st.defaultOn, false, '初期値は OFF');
  const s = (videoId, status, extra = {}) => ({
    serviceKind: 'youtube', channelId: 'UCz6sI0kRv-nNdf8MzBUDa3g', channelTitle: ' パルオ【とぅるりぷ】 ', videoId,
    scheduledStartTime: '2026-11-24T18:00:00+09:00', status, channelThumbnails: { url: 'https://yt3.ggpht.com/abc=s800' }, ...extra,
  });
  const json = JSON.stringify({
    last_updated: '2026-11-24T18:30:14+09:00',
    items: [
      { date: 'アーカイブ', items: [s('S--9weO2ztY', 'completed')] },
      { date: '2026-11-24', items: [s('5aa7jVsO2Y8', 'live'), s('xxxxxxxxxxx', 'live', { serviceKind: 'twitcasting' }), s('bad', 'upcoming'), null] },
      { date: '2026-11-25', items: [s('r-DiUhGwWbQ', 'upcoming', { channelId: 'x', channelThumbnails: { url: 'https://evil.example/a.png' }, scheduledStartTime: '2026-11-25T20:00:00+09:00' }), s('5aa7jVsO2Y8', 'live')] },
      { date: '2026-11-26', items: null },
    ],
  });
  assert.deepEqual(plain(st.parse(json)), [
    { videoId: '5aa7jVsO2Y8', startAt: Date.UTC(2026, 10, 24, 9, 0), live: true, name: 'パルオ【とぅるりぷ】', icon: 'https://yt3.ggpht.com/abc=s800', channelId: 'UCz6sI0kRv-nNdf8MzBUDa3g' },
    { videoId: 'r-DiUhGwWbQ', startAt: Date.UTC(2026, 10, 25, 11, 0), live: false, name: 'パルオ【とぅるりぷ】', icon: '' },
  ]);
  assert.throws(() => st.parse('<html>'));
  assert.throws(() => st.parse('{"rankings":[]}'));
  const urls = [];
  await st.fetchEntries({ fetchText: async (url) => (urls.push(url), json) });
  assert.deepEqual(urls, ['https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/schedule/schedule_v2.json']);
  assert.equal(A.allowed(st, urls[0]), true);
  assert.equal(A.allowed(st, 'https://www.stpr.com/'), false, '公式サイトはパック作り専用 (拡張機能は取りに行かない)');
  assert.equal(st.covers({ pack: 'STPR (すとぷり)' }), true);
  assert.equal(st.covers({ pack: 'すとぷり' }), true);
  assert.equal(st.covers({ pack: 'ぶいすぽっ!' }), false);
  assert.equal(st.covers({ preset: true }), false);
});

test('STPR: 公式サイトのメニューと各ページから、パック用のチャンネル・グループを読む', async () => {
  const st = env().get('Addons').list().find((a) => a.id === 'stpr');
  const grid = (href, cls, name, members) =>
    `<div class="creator-grid">\n<a href="${href}" class="name-group${cls}">${name}</a>\n<ul class="list--menu__creator">${members
      .map(([id, n]) => `<li><a href="https://www.stpr.com/artist/detail/${id}">${n}</a></li>`)
      .join('')}</ul>\n</div>`;
  const top = [
    grid('https://www.stpr.com/artist/detail/11', '', '騎士X - Knight X -', [['12', 'しゆん'], ['13', 'タケヤキ翔']]),
    grid('https://www.stpr.com/artist/detail/55', '', 'とぅるりぷ -True&amp;Lip', [['59', 'パルオ']]),
    grid('', ' not-group', 'STPR所属クリエイター', [['41', 'もりうさ'], ['3', 'ななもり。']]),
  ].join('\n');
  const sns = (yt) => `<h2 class="section-tit group-name">x</h2><ul class="list--sns">${yt ? `<li class="youtube"><a href="${yt}" target="_blank"></a></li>` : ''}<li><a href="https://x.com/a"></a></li></ul>`;
  const pages = {
    11: sns('https://www.youtube.com/@Knight_X_info'),
    12: sns('https://www.youtube.com/@shiyun'),
    13: sns('https://www.youtube.com/channel/UCEA8Umn4azMfY2-qic1lCOA'),
    55: sns(''),
    59: sns('https://www.youtube.com/@paruo_urusai'),
    41: sns(''),
    3: sns('https://www.youtube.com/@Nanamori_STPR'),
  };
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    if (url === 'https://www.stpr.com/') return top;
    return pages[url.match(/\/artist\/detail\/(\d+)$/)[1]];
  };
  const got = plain(await st.listChannels({ fetchText }));
  assert.ok(urls.every((u) => u.startsWith('https://www.stpr.com/')), urls.join());
  assert.deepEqual(got.slice(0, -1), [
    { handle: '@Knight_X_info', name: '騎士X', group: '騎士X' },
    { handle: '@shiyun', name: 'しゆん', group: '騎士X' },
    { channelId: 'UCEA8Umn4azMfY2-qic1lCOA', name: 'タケヤキ翔', group: '騎士X' },
    { handle: '@paruo_urusai', name: 'パルオ', group: 'とぅるりぷ' },
    { handle: '@Nanamori_STPR', name: 'ななもり。', group: 'STPR' },
  ]);
  assert.equal(got.at(-1).group, 'すとぷり', '最後は公式のチャンネル (ページにリンクが無いもの)');
  await assert.rejects(st.listChannels({ fetchText: async () => '<html></html>' }));
  assert.equal(st.covers({ pack: st.pack.name }), true, 'パックの名前は covers の条件に合う');
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
