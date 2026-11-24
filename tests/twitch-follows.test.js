// Twitch のフォローの取り込み (extension/twitch-follows.js)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { load, plain, EXT } = require('./helpers/load');
const path = require('node:path');

/** CLIENT_ID を入れた写しを読み込む (本物のファイルは空のまま) */
function setup({ clientId = 'testclient', authBack, pages = [], users = [], fail = null } = {}) {
  const src = fs.readFileSync(path.join(EXT, 'twitch-follows.js'), 'utf8').replace("const CLIENT_ID = '';", `const CLIENT_ID = '${clientId}';`);
  // 書き換えた写しは OS の一時フォルダに置く (extension/ には書かない)
  const tmp = path.join(os.tmpdir(), `hakomado-twitch-follows-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(tmp, src);
  const calls = [];
  let authUrl = '';
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    const json = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (u.pathname === '/oauth2/revoke') return new Response('', { status: 200 });
    if (fail && u.pathname === fail) return new Response('', { status: 500 });
    if (u.pathname === '/helix/users' && !u.searchParams.has('id')) return json({ data: [{ id: '42' }] });
    if (u.pathname === '/helix/channels/followed') {
      const after = u.searchParams.get('after');
      const k = after ? Number(after) : 0;
      return json({ data: pages[k] || [], pagination: k + 1 < pages.length ? { cursor: String(k + 1) } : {} });
    }
    if (u.pathname === '/helix/users') return json({ data: users.filter((x) => u.searchParams.getAll('id').includes(x.id)) });
    throw new Error('想定していない取得: ' + url);
  };
  try {
    const env = load([path.relative(EXT, tmp)], { globals: { fetch, Response, crypto: { randomUUID: () => 'st8' } } });
    env.chrome.identity = {
      getRedirectURL: () => 'https://abc.chromiumapp.org/',
      launchWebAuthFlow: async ({ url }) => {
        authUrl = url;
        if (authBack instanceof Error) throw authBack;
        return authBack ?? 'https://abc.chromiumapp.org/#access_token=tok123&scope=user%3Aread%3Afollows&state=st8&token_type=bearer';
      },
    };
    return { T: env.get('TwitchFollows'), calls, authUrl: () => authUrl };
  } finally {
    fs.unlinkSync(tmp);
  }
}

const f = (login, id, name = login) => ({ broadcaster_login: login, broadcaster_id: id, broadcaster_name: name });

test('Client ID が空の間は使えない (画面に出さない)', async () => {
  const { T } = setup({ clientId: '' });
  assert.equal(T.available(), false);
  await assert.rejects(T.fetchFollows({ allowed: true }), /notAvailable/);
});

test('ログインしてフォローを全部のページ読み、アイコンを付ける。読み終えたらトークンを無効にする', async () => {
  const { T, calls, authUrl } = setup({
    pages: [[f('LofiGirl', '1', 'LofiGirl'), f('shroud', '2')], [f('xqc', '3', 'xQc'), f('shroud', '2')]],
    users: [
      { id: '1', login: 'lofigirl', profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/a.png' },
      { id: '3', login: 'xqc', profile_image_url: 'https://evil.example/x.png' },
    ],
  });
  assert.equal(T.available(), true);
  const r = plain(await T.fetchFollows({ allowed: Promise.resolve(true) }));
  assert.deepEqual(r, {
    channels: [
      { channelId: 'tw:lofigirl', name: 'LofiGirl', icon: 'https://static-cdn.jtvnw.net/jtv_user_pictures/a.png' },
      { channelId: 'tw:shroud', name: 'shroud' },
      { channelId: 'tw:xqc', name: 'xQc' }, // Twitch の画像の置き場所でないアイコンは使わない
    ],
    more: false,
  });
  const q = new URL(authUrl()).searchParams;
  assert.equal(q.get('response_type'), 'token');
  assert.equal(q.get('scope'), 'user:read:follows');
  assert.equal(q.get('redirect_uri'), 'https://abc.chromiumapp.org/');
  const api = calls.filter((c) => c.url.startsWith('https://api.twitch.tv/'));
  assert.ok(api.every((c) => c.init.headers.Authorization === 'Bearer tok123' && c.init.headers['Client-Id'] === 'testclient' && c.init.credentials === 'omit'));
  const last = calls[calls.length - 1];
  assert.equal(last.url, 'https://id.twitch.tv/oauth2/revoke');
  assert.equal(String(last.init.body), 'client_id=testclient&token=tok123');
});

test('許可されない・ログインをやめた・state が違う・認可されない は理由ごとのエラー。読めなかったときもトークンは無効にする', async () => {
  await assert.rejects(setup().T.fetchFollows({ allowed: false }), /notAllowed/);
  await assert.rejects(setup({ authBack: new Error('closed') }).T.fetchFollows({ allowed: true }), /canceled/);
  await assert.rejects(setup({ authBack: 'https://abc.chromiumapp.org/#access_token=t&state=other' }).T.fetchFollows({ allowed: true }), /denied/);
  await assert.rejects(setup({ authBack: 'https://abc.chromiumapp.org/?error=access_denied&state=st8' }).T.fetchFollows({ allowed: true }), /denied/);
  const failed = setup({ fail: '/helix/channels/followed' });
  await assert.rejects(failed.T.fetchFollows({ allowed: true }), /HTTP 500/);
  assert.equal(failed.calls[failed.calls.length - 1].url, 'https://id.twitch.tv/oauth2/revoke');
});
