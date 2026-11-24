// hakomado: Twitch でフォローしているチャンネルを読む (⚙ チャンネルの管理の「Twitch のフォローから選ぶ」)。
// - Twitch の公式の API (Helix) を使う。フォロー一覧は公開ページに無く、使う人のログインが要る (scope: user:read:follows)
// - ログインは Twitch の認可の画面を chrome.identity.launchWebAuthFlow で開く (implicit grant。アプリの秘密の鍵は使わない)。
//   もらったアクセストークンは、読み終えたらすぐ無効にする (保存しない・ほかに送らない)
// - 読んだ一覧は画面に出すだけで、選んだものだけをチャンネル一覧に足す (YouTube の登録チャンネルと同じ)
//
// 使うには、作者が Twitch の開発者コンソール (https://dev.twitch.tv/console/apps) でアプリを登録し、下の CLIENT_ID に入れる。
// 登録するリダイレクト URL は、拡張機能の ID ごとの https://<拡張機能の ID>.chromiumapp.org/ (ストア版と ZIP 版の両方。
// chrome.identity.getRedirectURL() の値)。CLIENT_ID が空の間は、この機能を画面に出さない (available() が false)
/* exported TwitchFollows */
'use strict';

const TwitchFollows = (() => {
  const CLIENT_ID = ''; // Twitch のアプリの Client ID (秘密ではない。拡張機能に入れてよい値)
  const AUTH = 'https://id.twitch.tv/oauth2';
  const API = 'https://api.twitch.tv/helix';
  const ORIGINS = ['https://*.twitch.tv/*'];
  const MAX_PAGES = 20; // 100 件ずつ。2000 件まで
  const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
  const ICON_RE = /^https:\/\/static-cdn\.jtvnw\.net\//;

  const available = () => !!CLIENT_ID;

  /**
   * ログインの窓を開く権限 (identity) と twitch.tv の許可を求める。押した操作の中で、await より前に呼ぶ
   * @returns {Promise<boolean>}
   */
  function requestPermissions() {
    return chrome.permissions.request({ permissions: ['identity'], origins: ORIGINS }).catch(() => false);
  }

  /** Twitch の認可の画面でログインして、アクセストークンをもらう */
  async function authorize() {
    const state = crypto.randomUUID();
    const q = new URLSearchParams({
      response_type: 'token',
      client_id: CLIENT_ID,
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: 'user:read:follows',
      state,
    });
    let back;
    try {
      back = await chrome.identity.launchWebAuthFlow({ url: `${AUTH}/authorize?${q}`, interactive: true });
    } catch {
      throw new Error('canceled'); // 窓を閉じた・ログインしなかった
    }
    const url = new URL(back);
    const p = new URLSearchParams(url.hash.slice(1));
    if (url.searchParams.get('error') || p.get('state') !== state || !p.get('access_token')) throw new Error('denied');
    return p.get('access_token');
  }

  /** アクセストークンを無効にする (読み終えたら。失敗しても止めない) */
  function revoke(token) {
    return fetch(`${AUTH}/revoke`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, token }),
    }).catch(() => {});
  }

  /**
   * フォローしているチャンネル (フォローした新しい順)。
   * @returns {Promise<{channels: Array<{channelId: string, name: string, icon?: string}>, more: boolean}>}
   *   more = 多すぎて全部は読めなかった (MAX_PAGES まで)
   * @throws {Error} message = 'notAvailable' | 'notAllowed' (許可されなかった) | 'canceled' | 'denied' | 取得の失敗
   */
  async function fetchFollows({ allowed }) {
    if (!available()) throw new Error('notAvailable');
    if (!(await allowed)) throw new Error('notAllowed');
    const token = await authorize();
    try {
      const get = async (path) => {
        const res = await fetch(`${API}${path}`, {
          credentials: 'omit',
          headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      const me = (await get('/users')).data?.[0]?.id;
      if (!/^\d+$/.test(me || '')) throw new Error('readFail');
      const follows = [];
      let cursor = '';
      let more = false;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) {
          more = true;
          break;
        }
        const r = await get(`/channels/followed?${new URLSearchParams({ user_id: me, first: '100', ...(cursor ? { after: cursor } : {}) })}`);
        for (const f of Array.isArray(r.data) ? r.data : []) {
          const login = String(f.broadcaster_login || '').toLowerCase();
          if (LOGIN_RE.test(login) && !follows.some((x) => x.login === login)) {
            follows.push({ login, id: String(f.broadcaster_id || ''), name: String(f.broadcaster_name || login).slice(0, 100) });
          }
        }
        cursor = r.pagination?.cursor || '';
        if (!cursor) break;
      }
      // アイコン (100 件ずつ)。読めなくても一覧は出す
      const icons = new Map();
      for (let k = 0; k < follows.length; k += 100) {
        const ids = follows.slice(k, k + 100).filter((f) => /^\d+$/.test(f.id));
        if (!ids.length) continue;
        try {
          const r = await get(`/users?${new URLSearchParams(ids.map((f) => ['id', f.id]))}`);
          for (const u of Array.isArray(r.data) ? r.data : []) {
            if (ICON_RE.test(u.profile_image_url || '')) icons.set(String(u.login).toLowerCase(), u.profile_image_url.slice(0, 1000));
          }
        } catch {
          /* アイコン無しで出す */
        }
      }
      const channels = follows.map((f) => ({ channelId: `tw:${f.login}`, name: f.name, ...(icons.has(f.login) ? { icon: icons.get(f.login) } : {}) }));
      return { channels, more };
    } finally {
      await revoke(token);
    }
  }

  return { available, requestPermissions, fetchFollows };
})();
