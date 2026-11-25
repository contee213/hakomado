// Twitch のチャンネル (extension/favorites.js の「Twitch のチャンネル」の節): 登録・配信状況・最近の VOD
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const LIVE_AT = '2026-11-24T16:53:49Z';

const ICON = 'https://static-cdn.jtvnw.net/jtv_user_pictures/x-profile_image-300x300.png';

/** Twitch のチャンネルのページ (先頭の作りだけ本物に合わせる。後ろは大きな詰め物) */
function page({ name = 'LofiGirl', live = false, vods = [] } = {}) {
  const graph = [
    { '@type': 'ProfilePage', name: `${name} - Twitch`, mainEntity: { '@type': 'Person', name, alternateName: name.toLowerCase(), image: ICON } },
    { '@type': 'BreadcrumbList', itemListElement: [] },
    { '@type': 'ItemList', itemListElement: vods },
  ];
  if (live) {
    graph.push({
      '@type': 'VideoObject',
      name: `${name} - Twitch`,
      description: 'lofi hip hop radio <3',
      thumbnailUrl: ['https://static-cdn.jtvnw.net/previews-ttv/live_user_lofigirl-320x180.jpg'],
      publication: { '@type': 'BroadcastEvent', startDate: LIVE_AT, isLiveBroadcast: true },
    });
  }
  // 配信中のページは og:type が無く、og:title の後ろは表示言語で変わり、og:image は配信の画像
  const head =
    '<!doctype html><html><head>' +
    (live
      ? `<meta property="og:title" content="${name} - Twitchでライブ配信中"/>` +
        '<meta property="og:image" content="https://static-cdn.jtvnw.net/previews-ttv/live_user_x-640x360.jpg"/>'
      : `<meta property="og:title" content="${name} - Twitch"/><meta property="og:type" content="profile"/><meta property="og:image" content="${ICON}"/>`) +
    // JSON の中の < は \u003c で書かれる (</script> で切れないように)
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'http://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
  return { head, tail: '<script>' + 'x'.repeat(200000) + '</script></head><body></body></html>' };
}

/** チャンネルの情報が入っていない共通のページ (無いチャンネルのときと、あるのにときどき返る) */
const GENERIC = { head: "<!doctype html><html><head><title>Twitch</title><meta property='og:title' content='Twitch'>", tail: '</head><body></body></html>' };

const vod = (id, uploadDate, views = 10) => ({
  '@type': 'VideoObject',
  name: `VOD ${id}`,
  url: `https://www.twitch.tv/videos/${id}`,
  thumbnailUrl: [
    `https://static-cdn.jtvnw.net/cf_vods/x/${id}/thumb/thumb0-80x45.jpg`,
    `https://static-cdn.jtvnw.net/cf_vods/x/${id}/thumb/thumb0-320x180.jpg`,
  ],
  uploadDate,
  interactionStatistic: { '@type': 'InteractionCounter', userInteractionCount: views },
});

/** 本文を 2 つに分けて流す応答。どこまで読まれたか・打ち切られたかを覚える */
function streamed({ head, tail }, log) {
  const enc = new TextEncoder();
  const chunks = [head, tail];
  let n = 0;
  const body = new ReadableStream({
    pull(c) {
      if (n < chunks.length) c.enqueue(enc.encode(chunks[n++]));
      else c.close();
      log.pulled = n;
    },
    cancel() {
      log.canceled = true;
    },
  }, { highWaterMark: 0 }); // 読まれた分だけ流す (先読みしない)
  return new Response(body, { status: 200 });
}

/**
 * pages = {名前: page() か、取るたびに呼ぶ関数} (無ければ 404)、previews = 配信中の名前の一覧 (許可が無いときのサムネイル画像)
 */
function setup({ allowed = true, pages = {}, previews = [], gql = () => ({ data: { user: null } }) } = {}) {
  const calls = [];
  const log = {};
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    if (u.hostname === 'www.twitch.tv') {
      // 関数なら取るたびに呼ぶ (返すページを変える)
      const p = pages[decodeURIComponent(u.pathname.slice(1))];
      const v = typeof p === 'function' ? p() : p;
      return v ? streamed(v, log) : new Response('', { status: 404 });
    }
    if (u.hostname === 'gql.twitch.tv') {
      const r = gql(JSON.parse(init.body));
      return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200 });
    }
    if (u.hostname === 'static-cdn.jtvnw.net') {
      const login = u.pathname.match(/live_user_(\w+)-/)?.[1];
      const live = previews.includes(login);
      return { ok: true, status: 200, url: live ? String(url) : 'https://static-cdn.jtvnw.net/ttv-static/404_preview-80x45.jpg', body: null };
    }
    throw new Error('想定していない取得: ' + url);
  };
  const env = load(['i18n.js', 'presets.js', 'addons.js', 'favorites.js', 'share-code.js'], {
    globals: { fetch, ReadableStream, Response, ErrLog: { warnFetch() {} }, DOMParser: class {} },
  });
  env.chrome.permissions = { contains: async () => allowed };
  return { F: env.get('Favorites'), calls, log, env };
}

test('Twitch のチャンネルの URL で登録できる (名前・アイコンはページから。ログイン名は小文字の ID に)', async () => {
  const { F, calls, log } = setup({ pages: { lofigirl: page() } });
  const { info, added } = await F.add('https://www.twitch.tv/LofiGirl');
  assert.equal(added, true);
  assert.deepEqual(plain(info), {
    channelId: 'tw:lofigirl',
    handle: '',
    name: 'LofiGirl',
    icon: ICON,
  });
  assert.equal(calls[0].init.credentials, 'omit', 'Cookie は送らない');
  // 構造化データまで読んだら、後ろ (大きな詰め物) は読まずに打ち切る
  assert.equal(log.pulled, 1);
  assert.equal(log.canceled, true);
  assert.equal(plain(await F.list()).length, 1);
});

test('twitch.tv/名前・tw:名前 でも登録できる。VOD の URL や無いチャンネルは断る', async () => {
  const { F, calls } = setup({ pages: { abc_1: page({ name: 'Abc' }), nope: GENERIC } });
  assert.equal((await F.add('twitch.tv/abc_1')).info.channelId, 'tw:abc_1');
  assert.equal((await F.add('tw:abc_1')).added, false, '登録済み');
  await assert.rejects(F.add('https://www.twitch.tv/videos/123'), /VOD からはチャンネルを登録できません/);
  await assert.rejects(F.add('tw:v:123'), /VOD からはチャンネルを登録できません/);
  const before = calls.length;
  await assert.rejects(F.add('https://www.twitch.tv/nope'), /Twitch のチャンネルが見つかりませんでした/);
  assert.equal(calls.length - before, 2, 'チャンネルの情報が無いページなら 1 回だけ取り直す');
});

test('配信中のページでも、名前とアイコンはチャンネルの情報から取る (題名の後ろの言葉・配信の画像を使わない)', async () => {
  const { F } = setup({ pages: { lofigirl: page({ live: true }) } });
  const { info } = await F.add('https://www.twitch.tv/lofigirl');
  assert.equal(info.name, 'LofiGirl');
  assert.equal(info.icon, ICON);
});

test('チャンネルの情報が無いページがたまに返っても、取り直して読む。続けて返ったら覚えずに取得失敗にする', async () => {
  let n = 0;
  const { F, calls } = setup({
    pages: {
      flaky: () => (n++ % 2 === 0 ? GENERIC : page({ name: 'Flaky', live: true })),
      gone: GENERIC,
    },
  });
  assert.equal((await F.add('twitch.tv/flaky')).info.name, 'Flaky');
  await assert.rejects(F.fetchStatus({ channelId: 'tw:gone' }), /Twitch のページを読み取れませんでした/);
  const before = calls.length;
  await assert.rejects(F.fetchStatus({ channelId: 'tw:gone' }, { force: true }), /読み取れません/);
  assert.equal(calls.length - before, 2, '読めなかった結果は覚えていない');
});

test('twitch.tv の許可が無いと登録できない', async () => {
  const { F, calls } = setup({ allowed: false, pages: { lofigirl: page() } });
  await assert.rejects(F.add('https://www.twitch.tv/lofigirl'), /twitch\.tv へのアクセスの許可/);
  assert.equal(calls.length, 0);
});

test('配信状況: 配信中ならチャンネルの枠の ID・題名・始まった時刻。配信していなければ offline', async () => {
  const { F } = setup({ pages: { lofigirl: page({ live: true }), quiet: page({ name: 'Quiet' }) } });
  assert.deepEqual(plain(await F.fetchStatus({ channelId: 'tw:lofigirl' })), {
    state: 'live',
    kind: 'live',
    videoId: 'tw:lofigirl',
    title: 'lofi hip hop radio <3',
    startAt: Date.parse(LIVE_AT),
  });
  assert.deepEqual(plain(await F.fetchStatus({ channelId: 'tw:quiet' })), { state: 'offline' });
});

test('配信状況: 少し前に取ったページはタブ間で使い回す (⟳ 更新でも 30 秒以内なら取りに行かない)', async () => {
  const { F, calls } = setup({ pages: { lofigirl: page({ live: true }) } });
  await F.fetchStatus({ channelId: 'tw:lofigirl' }, { force: true, auto: true });
  await F.fetchStatus({ channelId: 'tw:lofigirl' }, { force: true, auto: true });
  await F.fetchStatus({ channelId: 'tw:lofigirl' }, { force: true });
  assert.equal(calls.length, 1);
});

test('配信状況: 許可が無いときは、配信のサムネイル画像が 404 の画像に転送されるかで見る', async () => {
  const { F, calls } = setup({ allowed: false, previews: ['onair'] });
  assert.equal(plain(await F.fetchStatus({ channelId: 'tw:onair' })).state, 'live');
  assert.equal(plain(await F.fetchStatus({ channelId: 'tw:offair' })).state, 'offline');
  assert.ok(calls.every((c) => new URL(c.url).hostname === 'static-cdn.jtvnw.net'));
  assert.equal(calls[0].init.cache, 'no-store');
});

test('最近の VOD: 新しい順。再生数 0 と、配信中の配信の VOD は除く', async () => {
  const vods = [
    vod('100', '2026-11-20T10:00:00Z'),
    vod('300', '2026-11-24T16:54:00Z'), // 今の配信 (始まってから作られた)
    vod('200', '2026-11-22T10:00:00Z'),
    vod('150', '2026-11-21T10:00:00Z', 0),
  ];
  const { F } = setup({ pages: { lofigirl: page({ live: true, vods }) } });
  const list = plain(await F.fetchArchives('tw:lofigirl'));
  assert.deepEqual(
    list.map((v) => v.videoId),
    ['tw:v:200', 'tw:v:100'],
  );
  assert.deepEqual(list[0], {
    videoId: 'tw:v:200',
    title: 'VOD 200',
    at: Date.parse('2026-11-22T10:00:00Z'),
    thumb: 'https://static-cdn.jtvnw.net/cf_vods/x/200/thumb/thumb0-320x180.jpg',
    list: 'TW',
    kind: 'live',
  });
});

test('Twitch の配信は、メンバー限定の確認 (YouTube の動画のページ) をしない', async () => {
  const { F, calls } = setup();
  assert.equal(await F.checkAccess('tw:lofigirl'), 'ok');
  assert.equal(calls.length, 0);
});

test('バックアップとチャンネルパックは Twitch のチャンネルを残す', () => {
  const env = load(['packs.js']);
  const P = env.get('ChannelPack');
  const r = plain(
    P.parse(
      JSON.stringify({
        app: 'hakomado',
        type: 'channels',
        name: 'T',
        channels: [{ channelId: 'tw:lofigirl', name: 'LofiGirl', icon: 'https://static-cdn.jtvnw.net/jtv_user_pictures/x.png' }],
      }),
    ),
  );
  assert.deepEqual(r.channels, [{ channelId: 'tw:lofigirl', name: 'LofiGirl', group: 'T', icon: 'https://static-cdn.jtvnw.net/jtv_user_pictures/x.png' }]);
  assert.throws(() => P.parse(JSON.stringify({ app: 'hakomado', type: 'channels', name: 'T', channels: [{ channelId: 'tw:Bad!', name: 'x' }] })));
});

test('配信中の VOD: 内部の窓口 (GQL) で聞き、2 分は覚えておく。Cookie は付けない', async () => {
  const asked = [];
  const { F, calls } = setup({
    gql: (b) => {
      asked.push(b.variables.l);
      return { data: { user: { stream: b.variables.l === 'onair' ? { archiveVideo: { id: '2940156931' } } : null } } };
    },
  });
  assert.equal(await F.twitchCurrentVod('tw:onair'), 'tw:v:2940156931');
  assert.equal(await F.twitchCurrentVod('tw:onair'), 'tw:v:2940156931');
  assert.equal(await F.twitchCurrentVod('tw:offair'), null);
  assert.deepEqual(asked, ['onair', 'offair']);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.method, 'POST');
});

test('配信中の VOD: VOD を残さない・答えがおかしい・聞けない・許可が無いときは null', async () => {
  const answers = {
    novod: { data: { user: { stream: { archiveVideo: null } } } },
    weird: { data: { user: { stream: { archiveVideo: { id: '../x' } } } } },
    gone: new Response('', { status: 500 }),
  };
  const { F } = setup({ gql: (b) => answers[b.variables.l] });
  for (const login of Object.keys(answers)) assert.equal(await F.twitchCurrentVod('tw:' + login), null, login);
  assert.equal(await F.twitchCurrentVod('tw:v:123'), null);
  const denied = setup({ allowed: false, gql: () => assert.fail('許可が無いのに聞いた') });
  assert.equal(await denied.F.twitchCurrentVod('tw:onair'), null);
});
