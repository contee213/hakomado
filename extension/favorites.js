// チャンネル一覧 (ピックアップの印を含む): 保存と、チャンネル情報 / 配信状況の取得
// - 既定でホロライブ所属チャンネル (presets.js) を登録しておく
// - 配信状況は、どのチャンネルも同じ仕組みで調べる (「配信の予定と状況」の節):
//   チャンネルの「ライブ配信」の再生リストの RSS で配信予定・新しい配信を知り、動画ごとの状態を覚えておいて、
//   開始予定の時刻のころだけ、その動画のページを確かめる
// - 配信予定のアドオン (addons/。ホロジュールなど) が ON なら補助に使う (載っているチャンネルの予定が 1 回で分かるので、
//   RSS を見に行く間隔を長くできる。アドオンが OFF・取れなくても RSS だけで動く)
// - Twitch のチャンネル (channelId = 'tw:<名前>') は、チャンネルの公開ページの先頭で配信中と最近の VOD を調べる
//   (「Twitch のチャンネル」の節)
/* exported Favorites */
/* global PRESET_VERSION, PRESET_FAVORITES, LANG, tr, ErrLog, Addons, twitchIdFromUrl */
'use strict';

const Favorites = (() => {
  const YT = 'https://www.youtube.com';
  const STATUS_TTL_MS = 60 * 1000;
  const statusCache = new Map(); // channelId -> {at, status}

  // ------------------------------------------------------------ 取得の負荷を抑える
  // - 取得結果はタブ間で共有する (chrome.storage.session。ブラウザを閉じると消える)。
  //   他のタブが少し前に取ったものはそのまま使い、タブがいくつあっても取得は 1 つ分で済むようにする
  // - YouTube へのページ取得はタブ間で 1 件ずつ、間を空けて行う (一度にまとめて取らない)
  // - YouTube に制限 (429) をかけられたら、しばらく取りに行かない (5 分 → 10 分 → … 最大 60 分)
  const shared = chrome.storage.session;
  const SHARED_KEY = 'statusShared'; // {sched3: {アドオンの id: {at, byKey}}, yt: {channelId: {at, status}}, backoff: {until, step}, lastYtFetch}
  // チャンネルの RSS を見に行く間隔 (設定。setFeedIntervals)。ピックアップ (📌) は短く、それ以外は長く。
  // 配信予定が見えている配信は、RSS を取り直さなくても覚えている分から開始の前後に動画のページで確かめるので、
  // 長くして遅れるのは、新しく出た配信予定と、予定を出さずに始めた配信 (ゲリラ配信) に気づくまで
  const FEED_PICK_MS_DEFAULT = 3 * 60 * 1000;
  const FEED_OTHER_MS_DEFAULT = 15 * 60 * 1000;
  const feedIntervals = { pick: FEED_PICK_MS_DEFAULT, other: FEED_OTHER_MS_DEFAULT };
  const FEED_SCHED_MS = 15 * 60 * 1000; // 配信予定のアドオンで予定が全部分かるチャンネル
  const FEED_MANUAL_MS = 30 * 1000; // 「⟳ 更新」
  const FEED_GAP_MS = 200; // RSS (軽い) を取る間隔
  // プレミア公開を探す「動画」「ショート」の RSS を見に行く間隔 (公開予定は前もって出るので長めでよい)
  const FEED_PREMIERE_MS = 15 * 60 * 1000;
  const SCHED_AUTO_MS = 55 * 1000; // 配信予定のアドオンは 1 分ごと
  const SCHED_MANUAL_MS = 5 * 1000;
  const SCHED_SKIP_MS = 30 * 1000; // 載るチャンネルが無くて取りに行かなかったアドオンを、次に確かめるまで
  const YT_GAP_MS = 1000; // YouTube へのページ取得の間隔
  // 取得の待ち時間の上限。応答が返ってこないまま順番待ち (ロック) を持ち続けると、全タブの取得が止まるため
  const FETCH_TIMEOUT_MS = 20 * 1000;
  const withTimeout = (opts = {}) => ({ ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const BACKOFF_BASE_MS = 5 * 60 * 1000;
  const BACKOFF_MAX_MS = 60 * 60 * 1000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 同じ名前のロックは、この拡張機能のどのタブとも共有される (順番待ち)
  const withLock = (name, fn) => navigator.locks.request(name, fn);

  async function readShared() {
    const { [SHARED_KEY]: v } = await shared.get(SHARED_KEY);
    return v && typeof v === 'object' ? v : {};
  }
  function updateShared(fn) {
    return withLock('hakomado-status-store', async () => {
      const v = await readShared();
      fn(v);
      await shared.set({ [SHARED_KEY]: v });
    });
  }

  class RateLimitedError extends Error {}

  /** fetchText の opts から、fetch に渡すもの (この中だけで使う項目を除く) */
  const fetchInit = ({ until, allow404, ...init }) => init;

  /**
   * 応答の本文を読む。until (読んだところまでの文字列 → 足りたら true) があれば、そこまで読んだら通信を打ち切る
   * (ページの先頭だけ要るとき。Twitch のチャンネルのページ)。maxChars を超えても打ち切る
   */
  async function readBody(res, { until, maxChars = 256 * 1024 } = {}) {
    if (!until || !res.body) return res.text();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (until(text) || text.length > maxChars) break;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return text;
  }

  /**
   * YouTube のページを取る順番が来たら fn(fetchText) を呼ぶ (タブ間で 1 件ずつ)。
   * 制限中は取りに行かずに RateLimitedError を投げる (呼び出し側では「取得失敗」扱い)。
   * backoffKey = 制限中かを覚えておく項目 (Twitch は YouTube と別にする)
   */
  function ytTurn(fn, { lock = 'hakomado-yt-fetch', gap = YT_GAP_MS, lastKey = 'lastYtFetch', backoffKey = 'backoff' } = {}) {
    return withLock(lock, async () => {
      const st = await readShared();
      if ((st[backoffKey]?.until || 0) > Date.now()) throw new RateLimitedError(tr('rateLimited'));
      const fetchText = async (url, opts = {}) => {
        const wait = (st[lastKey] || 0) + gap - Date.now();
        if (wait > 0) await sleep(wait);
        let res;
        try {
          res = await fetch(url, withTimeout(fetchInit(opts)));
        } finally {
          await updateShared((v) => (v[lastKey] = Date.now()));
        }
        // 制限 (429、または「ロボットではありません」の確認ページに飛ばされた)
        if (res.status === 429 || /\/sorry\//.test(res.url)) {
          await updateShared((v) => {
            const step = Math.min((v[backoffKey]?.step || 0) + 1, 10);
            v[backoffKey] = { step, until: Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (step - 1), BACKOFF_MAX_MS) };
          });
          throw new RateLimitedError(tr('rateLimited'));
        }
        if (res.status === 404 && opts.allow404) return null;
        if (!res.ok) throw new Error(tr('fetchFail', res.status));
        const text = await readBody(res, { until: opts.until });
        if (st[backoffKey]) await updateShared((v) => delete v[backoffKey]);
        return text;
      };
      return fn(fetchText);
    });
  }

  // ------------------------------------------------------------ チャンネルの「ライブ配信」の再生リストの RSS
  // 再生リスト UULV + チャンネル ID の 3 文字目以降。ログイン不要の軽い XML で、新しい順 15 件 (配信予定・配信中・アーカイブ)。
  // 配信予定 (待機所) は再生数が 0。配信中とアーカイブは再生数では見分けられない。日時は「枠を作った日時」
  // 取った結果はタブ間で共有する (配信状況と最近の配信の両方で使う)
  const FEED_PREFIX = 'feed:'; // 'feed:<チャンネル ID>' → {at, items: [{videoId, title, at, views}]} (チャンネルごとに別の項目にして、書き込みを軽く)
  // 「動画」(UULF)・「ショート」(UUSH) の再生リストは 'feed:UULF:<チャンネル ID>' など (最近の動画でだけ使う)
  const feedKey = (channelId, list = 'UULV') => FEED_PREFIX + (list === 'UULV' ? '' : `${list}:`) + channelId;
  const readFeed = async (channelId, list) => (await shared.get(feedKey(channelId, list)))[feedKey(channelId, list)];
  const ARCHIVE_TTL_MS = 30 * 60 * 1000;
  const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
  // YouTube は条件によって (スマホと判断したときなど) ページを m.youtube.com に転送する。そちらは取得の許可が無く
  // (CORS で止まる)、ページの作りも違うので、PC 版のページを指定する
  const desktop = (url) => `${url}${url.includes('?') ? '&' : '?'}app=desktop`;

  /**
   * そのチャンネルの再生リストの中身 (maxAge より新しい結果があればそれを使う)。配信をしたことがないチャンネルは []。
   * cacheOnly = 取りに行かず、覚えている結果を古くても使う (無ければ [])。
   * list = 再生リストの種類 (UULV = ライブ配信 / UULF = 動画 / UUSH = ショート)
   */
  async function fetchFeed(channelId, { maxAge, cacheOnly = false, list = 'UULV' }) {
    if (!CHANNEL_ID_RE.test(channelId)) return [];
    const fresh = (c) => c && Date.now() - c.at < maxAge && Array.isArray(c.items);
    const hit = await readFeed(channelId, list);
    if (fresh(hit)) return hit.items;
    if (cacheOnly) return Array.isArray(hit?.items) ? hit.items : [];
    return ytTurn(
      async (fetchText) => {
        // 順番を待つ間に他のタブが取っていれば、それを使う
        const again = await readFeed(channelId, list);
        if (fresh(again)) return again.items;
        const xml = await fetchText(`${YT}/feeds/videos.xml?playlist_id=${list}${channelId.slice(2)}`, { credentials: 'omit', allow404: true });
        const items = xml == null ? [] : parseFeed(xml);
        await shared.set({ [feedKey(channelId, list)]: { at: Date.now(), items } });
        return items;
      },
      { lock: 'hakomado-feed-fetch', gap: FEED_GAP_MS, lastKey: 'lastFeedFetch' },
    );
  }

  /**
   * そのチャンネルの最近の配信アーカイブと動画 (新しい順)。force = 覚えている結果を使わずに取り直す。
   * 「ライブ配信」の再生リスト (UULV) に加えて「動画」の再生リスト (UULF。プレミア公開・MV など。ショートは入らない) も見る。
   * プレミア公開 (同時視聴の本編になりやすい) は「ライブ配信」の方に入らないため。
   * shorts = 「ショート」の再生リスト (UUSH) も見る (ライブラリの最近の動画と、自動再生でショートも流す設定のとき)。
   * 各項目の kind = live (配信のアーカイブ) / video (動画) / short (ショート)、list = 取った再生リスト。
   * 縦型の配信はショートではなくふつうの配信 (「ライブ配信」の再生リストに入る) なので、live のまま
   */
  async function fetchArchives(channelId, { force = false, shorts = false } = {}) {
    if (isTwitchChannel(channelId)) return twitchArchives(channelId, { force });
    const maxAge = force ? 0 : ARCHIVE_TTL_MS;
    const lives = await fetchFeed(channelId, { maxAge });
    // 動画・ショートの方が取れなくても (制限中も)、配信の分は出す
    const more = async (list) => {
      try {
        return await fetchFeed(channelId, { maxAge, list });
      } catch (e) {
        ErrLog.warnFetch('hakomado: チャンネルの動画の取得に失敗', list, channelId, e);
        return [];
      }
    };
    const tag = (items, list, kind) => items.map((v) => ({ ...v, list, kind }));
    const all = [
      ...tag(lives, 'UULV', 'live'),
      ...tag(await more('UULF'), 'UULF', 'video'),
      ...(shorts ? tag(await more('UUSH'), 'UUSH', 'short') : []),
    ];
    const seen = new Set();
    // 配信予定・公開予定 (再生数 0) は除く
    return all
      .filter((v) => v.views > 0 && !seen.has(v.videoId) && seen.add(v.videoId))
      .sort((a, b) => b.at - a.at)
      .map(({ views, ...v }) => v);
  }

  function parseFeed(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const text = (el, name) => el.getElementsByTagNameNS('*', name)[0]?.textContent?.trim() || '';
    return [...doc.getElementsByTagNameNS('*', 'entry')]
      .map((e) => ({
        videoId: text(e, 'videoId'),
        title: text(e, 'title').slice(0, 300),
        at: Date.parse(text(e, 'published')) || 0,
        views: Number(e.getElementsByTagNameNS('*', 'statistics')[0]?.getAttribute('views') ?? NaN),
      }))
      .filter((v) => VIDEO_RE.test(v.videoId));
  }

  // ------------------------------------------------------------ Twitch のチャンネル (channelId = 'tw:<ログイン名>'。枠の ID と同じ形)
  // チャンネルの公開ページ (www.twitch.tv/<名前>) の先頭の構造化データ (JSON-LD) に、配信中か・始まった時刻・配信の題名と、
  // 最近の VOD 10 件 (題名・日時・再生数・サムネイル) が入っている。ページは 230KB ほどあるが、この部分は先頭の 13KB ほどまで
  // なので、そこまで読んだら通信を打ち切る。Cookie は送らない。取るには twitch.tv の許可 (optional_host_permissions) が要る。
  // 許可が無いとき (外したとき) は、配信のサムネイル画像 (static-cdn.jtvnw.net。誰でも読める) が「404」の画像に転送されるかで
  // 配信中かだけを見る (この画像は配信元で最大 15 分覚えられているので、始まったのに気づくのが遅れる)
  const TW = 'https://www.twitch.tv';
  const TW_ORIGINS = ['https://*.twitch.tv/*'];
  const TW_CHANNEL_RE = /^tw:[a-z0-9_]{1,25}$/;
  const isTwitchChannel = (id) => TW_CHANNEL_RE.test(id || '');
  const TW_PAGE_PREFIX = 'twpage:'; // 'twpage:<名前>' → {at, page} (タブ間で共有)
  const TW_AUTO_MS = 2 * 60 * 1000; // 配信状況を見に行く間隔 (ページの先頭だけなので、YouTube の RSS より短く)
  const TW_GAP_MS = 300;
  const TW_RETRY_MS = 1500; // チャンネルの情報が入っていないページが返ったとき、取り直すまで
  const TW_THUMB_RE = /^https:\/\/static-cdn\.jtvnw\.net\//;
  const LD_OPEN = '<script type="application/ld+json">';
  // Cookie は送らない。ページの言葉は英語にする (表示言語によって題名に「Twitchで配信中の…」などが付き、題名と名前を分けにくくなるため)
  const TW_FETCH = { credentials: 'omit', headers: { 'accept-language': 'en' }, until: (t) => ldRead(t) };
  const hasTwitch = () => chrome.permissions.contains({ origins: TW_ORIGINS }).catch(() => false);
  /** JSON-LD の終わりまで読んだか */
  const ldRead = (text) => {
    const at = text.indexOf(LD_OPEN);
    return at >= 0 && text.indexOf('</script>', at) > 0;
  };

  /**
   * Twitch のチャンネルのページを読む (maxAge より新しい結果があればそれを使う)。
   * Twitch は、チャンネルが無いときも、あるのにときどきも、チャンネルの情報が入っていない共通のページ (題名が「Twitch」だけ) を返す。
   * そのときは 1 回だけ取り直し、それでも同じなら null (覚えない。無いチャンネルか、たまたま取れなかったかは見分けられない)
   * @returns {Promise<{name: string, icon: string, live: {title: string, startAt?: number}|null, vods: Array}|null>}
   */
  async function twitchPage(login, { maxAge }) {
    const key = TW_PAGE_PREFIX + login;
    const read = async () => (await shared.get(key))[key];
    const fresh = (c) => c && Date.now() - c.at < maxAge && c.page;
    const hit = await read();
    if (fresh(hit)) return hit.page;
    return ytTurn(
      async (fetchText) => {
        // 順番を待つ間に他のタブが取っていれば、それを使う
        const again = await read();
        if (fresh(again)) return again.page;
        const get = async () => parseTwitchPage(await fetchText(`${TW}/${encodeURIComponent(login)}`, TW_FETCH));
        const page = (await get()) || (await sleep(TW_RETRY_MS), await get());
        if (page) await shared.set({ [key]: { at: Date.now(), page } });
        return page;
      },
      { lock: 'hakomado-tw-fetch', gap: TW_GAP_MS, lastKey: 'lastTwFetch', backoffKey: 'twBackoff' },
    );
  }

  /** Twitch のチャンネルのページの先頭から、名前・アイコン・配信中か・最近の VOD を読む (無いチャンネルなら null) */
  function parseTwitchPage(html) {
    const at = html.indexOf(LD_OPEN);
    const end = at >= 0 ? html.indexOf('</script>', at) : -1;
    let graph = [];
    if (end > at) {
      try {
        const d = JSON.parse(html.slice(at + LD_OPEN.length, end));
        graph = Array.isArray(d?.['@graph']) ? d['@graph'] : [d];
      } catch {
        graph = [];
      }
    }
    const isType = (x, t) => !!x && typeof x === 'object' && x['@type'] === t;
    // チャンネルのページなら ProfilePage がある (配信中のページには og:type が無い)
    const profile = graph.find((x) => isType(x, 'ProfilePage'));
    if (!profile && meta(html, 'og:type') !== 'profile') return null;
    const text = (v, n) => (typeof v === 'string' ? v : '').trim().slice(0, n);
    // 名前・アイコンはチャンネルの情報 (mainEntity) から。og:title は表示言語で後ろが変わり
    // (「<名前> - Twitchでライブ配信中」など)、og:image は配信中だと配信の画像になることがあるので、無いときだけ使う
    const person = isType(profile?.mainEntity, 'Person') ? profile.mainEntity : null;
    const name = text(person?.name, 100) || meta(html, 'og:title').replace(/ - Twitch.*$/, '').slice(0, 100);
    const icon = [person?.image, meta(html, 'og:image')].find((u) => typeof u === 'string' && TW_THUMB_RE.test(u)) || '';
    const liveObj = graph.find((x) => isType(x, 'VideoObject') && x.publication?.isLiveBroadcast === true);
    const startAt = liveObj ? Date.parse(liveObj.publication.startDate) : NaN;
    // 配信中の VideoObject は、name が「<名前> - Twitch」で、description が配信の題名
    const live = liveObj ? { title: text(liveObj.description, 300), ...(startAt ? { startAt } : {}) } : null;
    const items = graph.find((x) => isType(x, 'ItemList'))?.itemListElement;
    const vods = (Array.isArray(items) ? items : [])
      .filter((v) => isType(v, 'VideoObject'))
      .map((v) => {
        const id = String(v.url || '').match(/^https:\/\/www\.twitch\.tv\/videos\/(\d{1,12})$/)?.[1];
        if (!id) return null;
        const thumbs = (Array.isArray(v.thumbnailUrl) ? v.thumbnailUrl : [v.thumbnailUrl]).filter((u) => typeof u === 'string' && TW_THUMB_RE.test(u));
        const thumb = thumbs.find((u) => u.includes('320x180')) || thumbs[thumbs.length - 1] || '';
        const views = Number(v.interactionStatistic?.userInteractionCount);
        return {
          videoId: `tw:v:${id}`,
          title: text(v.name, 300),
          at: Date.parse(v.uploadDate) || 0,
          views: Number.isFinite(views) ? views : 1,
          ...(thumb ? { thumb: thumb.slice(0, 1000) } : {}),
        };
      })
      .filter(Boolean);
    return { name, icon: icon.slice(0, 1000), live, vods };
  }

  /** 許可が無いとき: 配信のサムネイル画像が「404」の画像に転送されなければ配信中 */
  async function twitchPreviewLive(login) {
    const url = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(login)}-80x45.jpg`;
    const res = await fetch(url, withTimeout({ credentials: 'omit', cache: 'no-store' }));
    res.body?.cancel().catch(() => {});
    if (!res.ok) throw new Error(tr('fetchFail', res.status));
    return !/\/404_preview/.test(res.url);
  }

  /** Twitch のチャンネルの今の配信状況。配信中なら videoId はチャンネルの枠の ID (tw:<名前>) */
  async function twitchStatus(fav, { maxAge }) {
    const login = fav.channelId.slice(3);
    let live = null;
    if (await hasTwitch()) {
      const page = await twitchPage(login, { maxAge });
      if (!page) throw new Error(tr('twitchReadFail'));
      live = page.live;
    } else if (await twitchPreviewLive(login)) {
      live = { title: '' };
    }
    if (!live) return { state: 'offline' };
    return { state: 'live', kind: 'live', videoId: fav.channelId, title: live.title, ...(live.startAt ? { startAt: live.startAt } : {}) };
  }

  /** Twitch のチャンネルの最近の VOD (新しい順。配信中の配信の VOD は除く)。list = 'TW'、kind = 'live' (配信のアーカイブ) */
  async function twitchArchives(channelId, { force }) {
    if (!(await hasTwitch())) throw new Error(tr('twitchNeedAllow'));
    const page = await twitchPage(channelId.slice(3), { maxAge: force ? 0 : ARCHIVE_TTL_MS });
    if (!page) throw new Error(tr('twitchReadFail'));
    // 配信中の配信も VOD として載る (終わるまでは最後まで見られない) ので、始まった時刻より後のものは除く
    const since = page.live ? (page.live.startAt || Date.now()) - 5 * 60e3 : Infinity;
    return page.vods
      .filter((v) => v.views > 0 && v.at < since)
      .sort((a, b) => b.at - a.at)
      .map(({ views, ...v }) => ({ ...v, list: 'TW', kind: 'live' }));
  }

  /**
   * Twitch の VOD について分かること (ℹ 枠の情報・同期再生用): {start: 配信が始まった時刻 (ミリ秒), title, channel (表示名)}。
   * VOD のページの先頭の構造化データ (uploadDate。配信の VOD なら配信の開始) と題名 (「<題名> - <名前> on Twitch」) から読む。
   * 分からなければ null。変わらない値なので、取れたものはタブ間で共有して覚えておく
   */
  async function twitchVodInfo(videoId) {
    const id = String(videoId).match(/^tw:v:(\d{1,12})$/)?.[1];
    if (!id) return null;
    const key = 'twvod:' + id;
    const hit = (await shared.get(key))[key];
    if (hit?.start && 'title' in hit) return hit;
    if (!(await hasTwitch())) return null;
    return ytTurn(
      async (fetchText) => {
        const again = (await shared.get(key))[key];
        if (again?.start && 'title' in again) return again;
        const get = async () => parseVodPage(await fetchText(`${TW}/videos/${id}`, TW_FETCH));
        // チャンネルのページと同じく、中身の無い共通のページが返ることがあるので 1 回だけ取り直す
        const info = (await get()) ?? (await sleep(TW_RETRY_MS), await get());
        if (info) await shared.set({ [key]: { at: Date.now(), ...info } });
        return info;
      },
      { lock: 'hakomado-tw-fetch', gap: TW_GAP_MS, lastKey: 'lastTwFetch', backoffKey: 'twBackoff' },
    );
  }

  /** Twitch の VOD の配信が始まった時刻 (ミリ秒。同期再生用)。分からなければ null */
  const twitchVodStart = async (videoId) => (await twitchVodInfo(videoId))?.start ?? null;

  /** VOD のページの先頭から {start, title, channel} を読む (VideoObject が無ければ null) */
  function parseVodPage(html) {
    const at = html.indexOf(LD_OPEN);
    const end = at >= 0 ? html.indexOf('</script>', at) : -1;
    if (end < 0) return null;
    let vo;
    try {
      const d = JSON.parse(html.slice(at + LD_OPEN.length, end));
      const graph = Array.isArray(d?.['@graph']) ? d['@graph'] : [d];
      vo = graph.find((x) => x?.['@type'] === 'VideoObject');
    } catch {
      return null;
    }
    const start = Date.parse(vo?.uploadDate || '');
    if (!Number.isFinite(start) || start <= 0) return null;
    const m = String(vo.name || '').match(/^(.*) - (.+?) on Twitch$/s);
    return { start, title: (m ? m[1] : '').trim().slice(0, 300), channel: (m ? m[2] : '').trim().slice(0, 100) };
  }

  /**
   * Twitch のチャンネルのライブについて分かること (ℹ 枠の情報用): {title, channel (表示名), start (配信が始まった時刻。配信中だけ)}。
   * 配信状況と同じチャンネルのページを使う (2 分は覚えた結果を使う)。分からなければ null
   */
  async function twitchLiveInfo(channelId) {
    if (!isTwitchChannel(channelId) || !(await hasTwitch())) return null;
    const page = await twitchPage(channelId.slice(3), { maxAge: TW_AUTO_MS });
    if (!page) return null;
    return { title: page.live?.title || '', channel: page.name || '', ...(page.live?.startAt ? { start: page.live.startAt } : {}) };
  }

  /** 入力が Twitch のチャンネル (URL / tw:<名前>) なら tw:<名前>、Twitch の VOD なら 'vod'、Twitch でなければ null */
  function twitchChannelOf(input) {
    const s = String(input || '').trim();
    if (TW_CHANNEL_RE.test(s)) return s;
    if (/^tw:v:\d+$/.test(s)) return 'vod';
    const id = typeof twitchIdFromUrl === 'function' ? twitchIdFromUrl(s) : null;
    if (!id) return null;
    return id.startsWith('tw:v:') ? 'vod' : id;
  }

  /** Twitch のチャンネルの名前・アイコン (登録用) */
  async function fetchTwitchChannel(channelId) {
    if (!(await hasTwitch())) throw new Error(tr('twitchNeedAllow'));
    const page = await twitchPage(channelId.slice(3), { maxAge: 0 });
    if (!page) throw new Error(tr('twitchNotFound'));
    return { channelId, handle: '', name: page.name || channelId.slice(3), icon: page.icon };
  }

  // ------------------------------------------------------------ storage
  // 既定のチャンネル (ホロライブ) は、英語表示のときは英語の名前・グループ名で見せる。
  // 保存するのは日本語のまま (表示言語を切り替えても元に戻せるように)
  const presetById = new Map(PRESET_FAVORITES.map((p) => [p.channelId, p]));

  function localize(f) {
    const p = f.preset && LANG !== 'ja' ? presetById.get(f.channelId) : null;
    if (!p) return f;
    return { ...f, name: p.nameEn || f.name, group: p.groupEn || f.group, nameJa: p.name };
  }

  function delocalize(f) {
    const p = f.preset ? presetById.get(f.channelId) : null;
    if (!p || !('nameJa' in f)) return f;
    const { nameJa, ...rest } = f;
    return { ...rest, name: nameJa, group: p.group };
  }

  async function list() {
    const { favorites = [] } = await chrome.storage.local.get('favorites');
    return favorites.map(localize);
  }

  async function saveList(favs) {
    await chrome.storage.local.set({ favorites: favs.map(delocalize) });
  }

  // チャンネル一覧を読んでから書くまでを、タブ間で 1 つずつにする (2 つのタブでほぼ同時に 📌 を変えたときなど)
  const withListLock = (fn) => navigator.locks.request('hakomado-favorites', fn);

  /** 既定のチャンネル (ホロライブ) を、まだ入れていなければ追加する。外したものは戻さない */
  function seedPresets() {
    return withListLock(seedPresetsLocked);
  }

  async function seedPresetsLocked() {
    const { favorites = [], presetVersion = 0, removedPresets = [], presetsDeclined = false } = await chrome.storage.local.get([
      'favorites',
      'presetVersion',
      'removedPresets',
      'presetsDeclined',
    ]);
    if (presetVersion >= PRESET_VERSION) return;
    const byId = new Map(favorites.map((f) => [f.channelId, f]));
    for (const p of PRESET_FAVORITES) {
      const existing = byId.get(p.channelId);
      if (existing) {
        // 自分で登録済みのチャンネルにもグループ等を付けておく
        Object.assign(existing, { group: p.group, preset: true, handle: existing.handle || p.handle });
      } else if (presetsDeclined) {
        // 初期データを全部外した人には、後の版で増えたチャンネルも入れない (戻すときの数には入れる)
        if (!removedPresets.includes(p.channelId)) removedPresets.push(p.channelId);
      } else if (!removedPresets.includes(p.channelId)) {
        favorites.push({ ...p, preset: true });
      }
    }
    await chrome.storage.local.set({ favorites, removedPresets, presetVersion: PRESET_VERSION });
  }

  /** 外した既定のチャンネルを戻す */
  function restorePresets() {
    return withListLock(async () => {
      await chrome.storage.local.set({ removedPresets: [], presetVersion: 0, presetsDeclined: false });
      await seedPresetsLocked();
    });
  }

  /**
   * 初期データのチャンネルをまとめて外す (自分で追加したもの・ピックアップ (📌) に入れたものは残す)。
   * @returns {Promise<number>} 外した数
   */
  function removeAllPresets() {
    return withListLock(async () => {
      const favs = await list();
      const drop = favs.filter((f) => f.preset && !f.star);
      if (!drop.length) return 0;
      const { removedPresets = [] } = await chrome.storage.local.get('removedPresets');
      const ids = new Set([...removedPresets, ...drop.map((f) => f.channelId)]);
      await saveList(favs.filter((f) => !drop.includes(f)));
      for (const f of drop) statusCache.delete(f.channelId);
      await chrome.storage.local.set({ removedPresets: [...ids], presetsDeclined: true });
      return drop.length;
    });
  }

  /** 一覧に残っている初期データのチャンネルのうち、まとめて外せるもの (ピックアップ以外) の数 */
  async function presetCount() {
    return (await list()).filter((f) => f.preset && !f.star).length;
  }

  async function removedPresetCount() {
    const { removedPresets = [] } = await chrome.storage.local.get('removedPresets');
    return removedPresets.length;
  }

  /**
   * チャンネルを登録する (登録済みなら情報を更新)。star = ピックアップ (📌) にもする
   * 保存先の名前は以前のまま 'favorites' (中身はチャンネル一覧。ピックアップは star: true の印)
   */
  async function add(input, { star = false } = {}) {
    const tw = twitchChannelOf(input);
    if (tw === 'vod') throw new Error(tr('twitchVodChannel'));
    const info = tw ? await fetchTwitchChannel(tw) : await fetchChannel(input); // 取得は順番待ちの外で
    return withListLock(() => addLocked(info, { star }));
  }

  async function addLocked(info, { star }) {
    const favs = await list();
    const preset = PRESET_FAVORITES.find((p) => p.channelId === info.channelId);
    const existing = favs.findIndex((f) => f.channelId === info.channelId);
    if (existing >= 0) {
      favs[existing] = { ...favs[existing], ...info, name: favs[existing].name, ...(star ? { star: true } : {}) };
    } else {
      favs.push({ ...(preset ? { ...preset, preset: true } : info), ...(star ? { star: true } : {}) });
    }
    await saveList(favs);
    if (preset) {
      const { removedPresets = [] } = await chrome.storage.local.get('removedPresets');
      await chrome.storage.local.set({ removedPresets: removedPresets.filter((id) => id !== info.channelId) });
    }
    return { info: localize(favs.find((f) => f.channelId === info.channelId)), added: existing < 0 };
  }

  /** ピックアップ (📌) の印を付ける / 外す */
  function setStar(channelId, on) {
    return withListLock(() => setStarLocked(channelId, on));
  }

  async function setStarLocked(channelId, on) {
    const favs = await list();
    const f = favs.find((x) => x.channelId === channelId);
    if (!f) return;
    if (on) f.star = true;
    else delete f.star;
    await saveList(favs);
  }

  // ---- チャンネルパック (packs.js で確かめた中身を、チャンネル一覧に足す / パックごとに外す)
  /** 読み込む前の確認用: 足されるチャンネルと、登録済みのチャンネルの数 */
  async function previewPack(pack) {
    const have = new Set((await list()).map((f) => f.channelId));
    const existing = pack.channels.filter((c) => have.has(c.channelId)).length;
    return { added: pack.channels.length - existing, existing };
  }

  /** パックのチャンネルを足す (登録済みのチャンネルは、名前もピックアップもそのまま) */
  function importPack(pack) {
    return withListLock(async () => {
      const favs = await list();
      const have = new Set(favs.map((f) => f.channelId));
      let added = 0;
      for (const c of pack.channels) {
        if (have.has(c.channelId)) continue;
        favs.push({ ...c, pack: pack.name });
        added++;
      }
      if (added) await saveList(favs);
      return added;
    });
  }

  /** 読み込んだパック [{name, count}] (パックから足したチャンネルの数) */
  async function packs() {
    const counts = new Map();
    for (const f of await list()) if (f.pack) counts.set(f.pack, (counts.get(f.pack) || 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count }));
  }

  /** パックから足したチャンネルをまとめて外す (ピックアップ (📌) に入れたものは残す)。外した数を返す */
  function removePack(name) {
    return withListLock(async () => {
      const favs = await list();
      const keep = favs.filter((f) => f.pack !== name || f.star);
      for (const f of favs) if (!keep.includes(f)) statusCache.delete(f.channelId);
      if (keep.length !== favs.length) await saveList(keep);
      return favs.length - keep.length;
    });
  }

  // ---- アイコンの無いチャンネル (パックにアイコンが無かったもの) は、一覧を開いたときに少しずつ取りに行く。
  // チャンネルのページは重い (1 件 1MB ほど) ので、1 回に数件だけ、YouTube への取得の順番待ちに並べて取る
  const iconTried = new Set(); // このタブで取りに行ったチャンネル (失敗しても、開き直すまでは取り直さない)
  async function fillIcons({ limit = 4 } = {}) {
    const targets = (await list())
      .filter((f) => !f.icon && !f.preset && CHANNEL_ID_RE.test(f.channelId) && !iconTried.has(f.channelId))
      .slice(0, limit);
    if (!targets.length) return 0;
    const found = new Map();
    for (const f of targets) {
      iconTried.add(f.channelId);
      try {
        const html = await ytTurn((fetchText) => fetchText(desktop(`${YT}/channel/${f.channelId}`), { credentials: 'omit' }));
        const icon = meta(html, 'og:image');
        const handle = html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/)?.[1];
        if (/^https:\/\//.test(icon)) found.set(f.channelId, { icon, handle: handle ? decodeURIComponent(handle) : '' });
      } catch (e) {
        if (e instanceof RateLimitedError) break;
      }
    }
    if (!found.size) return 0;
    await withListLock(async () => {
      const favs = await list();
      for (const f of favs) {
        const hit = found.get(f.channelId);
        if (!hit) continue;
        if (!f.icon) f.icon = hit.icon;
        if (!f.handle && hit.handle) f.handle = hit.handle;
      }
      await saveList(favs);
    });
    return found.size;
  }

  /**
   * チャンネルをまとめて外す (チャンネルの管理の画面)。外した数を返す。
   * 📌 付きを外すかは呼ぶ側で決める (ここでは渡されたものを全部外す)。
   * 同梱のチャンネルは、外したことを覚えておく (設定の更新で入れ直さず、「戻す」で戻せるように)
   */
  function removeMany(channelIds) {
    return withListLock(async () => {
      const ids = new Set(channelIds);
      const favs = await list();
      const drop = favs.filter((f) => ids.has(f.channelId));
      if (!drop.length) return 0;
      await saveList(favs.filter((f) => !ids.has(f.channelId)));
      for (const f of drop) statusCache.delete(f.channelId);
      const presets = drop.filter((f) => f.preset).map((f) => f.channelId);
      if (presets.length) {
        const { removedPresets = [] } = await chrome.storage.local.get('removedPresets');
        await chrome.storage.local.set({ removedPresets: [...new Set([...removedPresets, ...presets])] });
      }
      return drop.length;
    });
  }

  // ------------------------------------------------------------ YouTube
  async function getHtml(url, opts = {}) {
    const res = await fetch(url, withTimeout(opts));
    if (!res.ok) throw new Error(tr('fetchFail', res.status));
    return res.text();
  }

  /** HTML の文字参照 (&amp; &#39; &#x2F; など) を戻す。innerHTML は使わない */
  function decode(s) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref) => {
      if (ref[0] === '#') {
        const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return named[ref.toLowerCase()] ?? m;
    });
  }

  function meta(html, prop) {
    const re = new RegExp(`<meta (?:property|name|itemprop)="${prop}" content="([^"]*)"`);
    const m = html.match(re);
    return m ? decode(m[1]) : '';
  }

  /** 入力 (@handle / チャンネルURL / 動画URL / 動画ID) をチャンネルページの URL に */
  async function channelUrlFrom(input) {
    const s = input.trim();
    if (!s) throw new Error(tr('enterChannel'));
    if (/^@[\w.\-]+$/.test(s)) return `${YT}/${s}`;
    if (/^UC[\w-]{22}$/.test(s)) return `${YT}/channel/${s}`;

    let url;
    try {
      url = new URL(/^https?:\/\//.test(s) ? s : 'https://' + s);
    } catch {
      throw new Error(tr('notUrl'));
    }
    const host = url.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtube.com') {
      const ch = url.pathname.match(/^\/(@[^/]+|channel\/UC[\w-]+|c\/[^/]+|user\/[^/]+)/);
      if (ch) return `${YT}/${ch[1]}`;
    }
    // 動画の URL なら投稿者のチャンネルを調べる
    if (host === 'youtube.com' || host === 'youtu.be' || /^[A-Za-z0-9_-]{11}$/.test(s)) {
      const videoUrl = /^[A-Za-z0-9_-]{11}$/.test(s) ? `${YT}/watch?v=${s}` : url.href;
      const o = await oembed(videoUrl);
      if (o?.authorUrl) return o.authorUrl;
    }
    throw new Error(tr('channelNotFound'));
  }

  /** チャンネル名・アイコン・ID を取得 */
  async function fetchChannel(input) {
    const url = await channelUrlFrom(input);
    const html = await getHtml(url, { credentials: 'include' });
    const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
    const channelId = canon?.[1] || html.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
    if (!channelId) throw new Error(tr('channelReadFail'));
    const handle = html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/)?.[1] || '';
    return {
      channelId,
      handle: handle ? decodeURIComponent(handle) : '',
      name: meta(html, 'og:title') || handle || channelId,
      icon: meta(html, 'og:image'),
    };
  }

  // 動画 → 投稿チャンネル (oEmbed。1 件 1KB 程度と軽い)。動画の投稿者は変わらないので覚えておく。
  // ただし配信予定の動画は投稿者・タイトルが空で返るので、それは覚えない (始まったら取り直す)
  const oembedCache = new Map();
  function oembed(videoUrl) {
    if (!oembedCache.has(videoUrl)) {
      const p = fetch(`${YT}/oembed?format=json&url=${encodeURIComponent(videoUrl)}`, withTimeout())
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j ? { authorUrl: String(j.author_url || '').replace(/^http:/, 'https:'), title: j.title || '' } : null))
        .catch(() => null);
      oembedCache.set(videoUrl, p);
      p.then((o) => {
        if (!o?.authorUrl && oembedCache.get(videoUrl) === p) oembedCache.delete(videoUrl);
      });
    }
    return oembedCache.get(videoUrl);
  }

  // ------------------------------------------------------------ 配信の予定と状況
  // 動画ごとの状態 (配信予定 / 配信中 / 終わった / 配信ではない) を覚えておき (タブ間で共有)、確かめ直すのは必要なときだけ:
  //  - 初めて見た動画 (RSS の配信予定と、24 時間以内に増えたもの): 1 度確かめる。配信予定のアドオンに載っていれば、
  //    そこにある開始予定時刻を使うので確かめない
  //  - 配信予定: 開始予定の 2 分前から 1 時間後までは 40 秒ごと (開始をすぐ見つけるため)。それより後は 5 分ごと
  //    (遅れて始まる枠のため。6 時間まで)。開始まで間があるうちは 30 分〜6 時間ごと (時刻が変わることがあるため)
  //  - 配信中: 5 分ごと (終わったことを知るため。枠のプレイヤーが知らせる方が早い)
  //  - 終わった / 配信ではない: もう確かめない
  // 確かめるのは動画のページ (1 件 1MB 以上。圧縮されて 150KB ほど) なので、1 回あたりの件数を budget.watch で抑える
  const VSTATE_KEY = 'videoStates'; // {videoId: {state, startAt, title, at}} (共有データとは別の項目)
  const readStates = async () => (await shared.get(VSTATE_KEY))[VSTATE_KEY] || {};
  const RECENT_MS = 24 * 3600e3;
  const MIN = 60e3;

  /** 動画の状態を確かめ直すか */
  function needsCheck(s, now) {
    if (!s) return true;
    const age = now - s.at;
    // 種類 (配信・動画・ショート) がまだ分からないもの (前の版で覚えたもの・確かめる前に分かったもの) は確かめる
    if ((s.state === 'live' || s.state === 'upcoming') && !s.kind) return true;
    if (s.state === 'live') return age > 5 * MIN;
    if (s.state !== 'upcoming') return false;
    const d = (s.startAt || now + 60 * MIN) - now; // 開始予定までの時間 (分からなければ 1 時間後とみなす)
    if (d > 24 * 60 * MIN) return age > 6 * 60 * MIN;
    if (d > 2 * MIN) return age > 30 * MIN;
    if (d > -60 * MIN) return age > 40e3;
    if (d > -6 * 60 * MIN) return age > 5 * MIN;
    return age > 60 * MIN;
  }

  /** 動画のページを見て状態を調べる */
  async function checkVideo(videoId) {
    const html = await ytTurn((fetchText) => fetchText(desktop(`${YT}/watch?v=${videoId}`), { credentials: 'include' }));
    return parseWatchPage(html, videoId);
  }

  /** JSON の文字列 (エスケープ付き) を戻す */
  const unjson = (s) => {
    try {
      return JSON.parse(`"${s}"`);
    } catch {
      return s;
    }
  };

  /**
   * 動画のページから状態を読む。
   * state = live / upcoming / ended (配信のアーカイブ) / none (配信ではない・見られない)
   * kind = 配信中・配信予定の種類: live (配信) / video (プレミア公開の動画) / short (プレミア公開のショート)。
   *   プレミア公開は公開中・公開前も isLive / isUpcoming になるが、isLiveContent が false。ショートはページの正規 URL が /shorts/
   * avail = ok / gone (削除・非公開など) / members (メンバー限定でメンバーではない) / blocked (そのほかの理由で見られない)
   * channel / channelId = チャンネル名と ID (分かれば)
   */
  function parseWatchPage(html, vid) {
    const at = html.indexOf('"videoDetails":{"videoId":"' + vid + '"');
    if (at < 0) return { state: 'none', avail: 'gone' }; // 非公開・削除など
    // videoDetails の終わりの近くにある isLiveContent までを見る (概要欄が長いと、その手前の isLive・author が
    // 先頭から数千文字より後ろになる)。見つからなければ先頭 3000 文字
    const endKey = html.indexOf('"isLiveContent"', at);
    const details = html.slice(at, endKey > at && endKey - at < 40000 ? endKey + 30 : at + 3000);
    const pAt = html.indexOf('"playabilityStatus":{');
    const ps = pAt >= 0 ? html.slice(pAt, pAt + 6000) : '';
    const status = ps.match(/"status":"(\w+)"/)?.[1];
    let avail = 'ok';
    if (status && status !== 'OK' && status !== 'LIVE_STREAM_OFFLINE') {
      // ログインしていない状態で取れたページだと、メンバーでも見られない扱いになるので、そのときは判定しない
      if (isMembersBlock(ps) || /BADGE_STYLE_TYPE_MEMBERS_ONLY/.test(html)) avail = /"LOGGED_IN":true/.test(html) ? 'members' : 'ok';
      else avail = 'blocked';
    }
    const channel = details.match(/"author":"((?:[^"\\]|\\.)*)"/)?.[1];
    const channelId = details.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
    const extra = { avail, ...(channel ? { channel: unjson(channel) } : {}), ...(channelId ? { channelId } : {}) };
    const title = meta(html, 'og:title') || meta(html, 'title');
    const started = html.match(/"liveBroadcastDetails":\{[^}]*"startTimestamp":"([^"]+)"/)?.[1];
    const kind = /"isLiveContent":true/.test(details) ? 'live' : /<link rel="canonical" href="[^"]*\/shorts\//.test(html) ? 'short' : 'video';
    if (/"isLive":true/.test(details)) return { state: 'live', kind, title, startAt: started ? Date.parse(started) : undefined, ...extra };
    if (/"isUpcoming":true/.test(details)) {
      const t = html.match(/"scheduledStartTime":"(\d+)"/)?.[1];
      return { state: 'upcoming', kind, title, startAt: t ? Number(t) * 1000 : undefined, ...extra };
    }
    if (/"isLiveContent":true/.test(details)) return { state: 'ended', title, ...extra };
    return { state: 'none', title, ...extra };
  }

  // ------------------------------------------------------------ 再生リストの動画の状態
  // 再生リストの編集画面で、配信中・配信予定・見られない動画に印を付けるために使う。
  // 調べた結果は配信状況と同じところ (videoStates) に入れて、タブ間・配信状況の確認と共有する

  /**
   * YouTube の再生リストのページから、動画の並びと名前を読む (最初に表示される分だけ。ふつう 100 本まで)。
   * ほかの YouTube のページ取得と同じ順番待ち・制限中の判定を通す
   * @returns {Promise<{ids: string[], name: string}>}
   */
  async function fetchYouTubePlaylist(listId) {
    if (!/^[\w-]{10,64}$/.test(listId)) throw new Error('bad list id');
    const html = await ytTurn((fetchText) => fetchText(desktop(`${YT}/playlist?list=${encodeURIComponent(listId)}`), { credentials: 'include' }));
    const ids = [];
    const add = (id) => VIDEO_RE.test(id) && !ids.includes(id) && ids.push(id);
    // 今の作り: 1 本ずつ lockupViewModel (contentId が動画 ID)。以前の作り: playlistVideoRenderer
    for (const m of html.matchAll(/"contentId":"([\w-]{11})","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"/g)) add(m[1]);
    if (!ids.length) for (const m of html.matchAll(/"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g)) add(m[1]);
    // さらに作りが変わったとき用: この再生リストの中での順番が付いた再生のリンク
    if (!ids.length) {
      const re = new RegExp(`"watchEndpoint":\\{"videoId":"([\\w-]{11})","playlistId":"${listId}","index":\\d+`, 'g');
      for (const m of html.matchAll(re)) add(m[1]);
    }
    return { ids, name: meta(html, 'og:title') };
  }

  // ---- YouTube の登録チャンネル (ログイン中のアカウント)
  // 登録チャンネルの管理ページ (/feed/channels) を、ブラウザのログイン状態 (Cookie) のまま読む。
  // 2026-11 の時点では、続きの読み込み無しで全件 (500 件超でも) が 1 ページに入っている。ページは大きい (数 MB) ので、
  // 利用者が押したときだけ取る。読んだ一覧は画面に出すだけで、選んだものだけをチャンネル一覧に足す (どこにも送らない)
  const SUB_ICON_RE = /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//;

  /**
   * ログイン中のアカウントの登録チャンネルを読む。
   * @returns {Promise<{channels: Array<{channelId, name, handle?, icon?}>, more: boolean}>}
   *   more = 続きがありそう (ページに入っていない分がある)
   * @throws {Error} message = 'notLoggedIn' (YouTube にログインしていない) | 'readFail' (ページの作りが読めない) | 取得の失敗
   */
  async function fetchSubscriptions() {
    const html = await ytTurn((fetchText) => fetchText(desktop(`${YT}/feed/channels`), { credentials: 'include' }));
    if (!/"LOGGED_IN":true/.test(html)) throw new Error('notLoggedIn');
    const json = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('readFail');
    }
    const seen = new Set();
    const channels = [];
    let more = false;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        for (const v of o) walk(v);
        return;
      }
      for (const [k, v] of Object.entries(o)) {
        if (k === 'continuationItemRenderer') more = true;
        else if (k === 'channelRenderer') addSub(v);
        else walk(v);
      }
    };
    const addSub = (c) => {
      const channelId = c?.channelId;
      if (!CHANNEL_ID_RE.test(channelId || '') || seen.has(channelId)) return;
      seen.add(channelId);
      const name = String(c.title?.simpleText || c.title?.runs?.map((r) => r.text).join('') || '').trim().slice(0, 100);
      const out = { channelId, name: name || channelId };
      const path = c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
      if (/^\/@[^\s/?#]{1,100}$/.test(path)) {
        try {
          out.handle = decodeURIComponent(path.slice(1));
        } catch {
          out.handle = path.slice(1);
        }
      }
      const thumbs = c.thumbnail?.thumbnails || [];
      const icon = String(thumbs[thumbs.length - 1]?.url || '').replace(/^\/\//, 'https://');
      if (SUB_ICON_RE.test(icon)) out.icon = icon.slice(0, 1000);
      channels.push(out);
    };
    walk(data);
    if (!channels.length && !/"channelRenderer"/.test(html) && !/"shelfRenderer"/.test(html)) throw new Error('readFail');
    return { channels, more };
  }

  /** 覚えている動画の状態 ({videoId: {state, startAt, title, channel, avail, at}}) */
  async function videoStates(ids) {
    const all = await readStates();
    return Object.fromEntries(ids.filter((id) => all[id]).map((id) => [id, all[id]]));
  }

  /**
   * 動画の状態を確かめる (確かめ直しが要るものだけ、max 件まで。1 件分かるごとに onEach(videoId, state))。
   * 動画のページは重いので、YouTube への取得の順番待ち (ytTurn) に並ぶ。制限中はやめる
   */
  async function inspectVideos(ids, { max = 20, onEach, shouldStop } = {}) {
    const known = await readStates();
    // 見られるかどうか (avail) をまだ調べていないものも調べる (配信状況の確認で入ったものなど)
    const stale = (st) => needsCheck(st, Date.now()) || !st.avail;
    const due = ids.filter((id) => VIDEO_RE.test(id) && stale(known[id] || null)).slice(0, max);
    for (const vid of due) {
      if (shouldStop?.()) break;
      try {
        // ほかのタブが同じ再生リストを開いていて、先に調べ終わっていれば取りに行かない
        const cur = (await readStates())[vid];
        if (cur && !stale(cur)) {
          onEach?.(vid, cur);
          continue;
        }
        const r = await checkVideo(vid);
        const st = { ...r, title: r.title || known[vid]?.title, at: Date.now() };
        await saveStates({ [vid]: st });
        onEach?.(vid, st);
      } catch (e) {
        if (e instanceof RateLimitedError) break;
        ErrLog.warnFetch('hakomado: 動画の状態の確認に失敗', vid, e);
      }
    }
  }

  /**
   * チャンネルの今の配信状況。
   * @param {{maxFeedAge: number, budget: {watch: number}|null, sched: Array|null, kinds: {video: boolean, short: boolean}}} o
   *   sched = 配信予定のアドオンに載っているこのチャンネルの枠 [{videoId, live, startAt}] (アドオンで分からないチャンネルは null)。
   *   kinds = プレミア公開の動画・ショートも配信と同じに扱うか (設定の「自動再生のコンテンツ」)
   */
  async function channelStatus(fav, { maxFeedAge, budget, sched, kinds, feedCacheOnly = false }) {
    let items = [];
    try {
      items = await fetchFeed(fav.channelId, { maxAge: maxFeedAge, cacheOnly: feedCacheOnly });
    } catch (e) {
      // RSS が取れなくても、配信予定のアドオンで分かる分は使う
      if (!sched || e instanceof RateLimitedError) throw e;
    }
    // プレミア公開は「ライブ配信」の再生リストに入らないので、動画・ショートを対象にしているときは「動画」「ショート」の
    // 再生リストも見る (公開前 = 再生数 0 のものだけ確かめる)。配信予定のアドオンで予定が分かるチャンネルは見ない (載っている)
    const premieres = [];
    if (!sched) {
      for (const [on, list] of [[kinds.video, 'UULF'], [kinds.short, 'UUSH']]) {
        if (!on) continue;
        try {
          premieres.push(...(await fetchFeed(fav.channelId, { maxAge: Math.max(maxFeedAge, FEED_PREMIERE_MS), list })));
        } catch (e) {
          if (e instanceof RateLimitedError) throw e;
          console.warn('hakomado: プレミア公開の確認に失敗', list, fav.channelId, e);
        }
      }
    }
    const now = Date.now();
    const known = await readStates();
    const updates = {};
    const state = (vid) => updates[vid] || known[vid];
    // 調べる動画: 配信予定 (再生数 0)・24 時間以内に増えたもの・配信予定 / 配信中と分かっているもの・配信予定のアドオンの枠・
    // 公開前のプレミア公開
    const cands = new Map();
    for (const it of items) {
      const s = known[it.videoId];
      if (it.views === 0 || now - it.at < RECENT_MS || s?.state === 'upcoming' || s?.state === 'live') cands.set(it.videoId, it);
    }
    for (const it of premieres) {
      const s = known[it.videoId];
      if (!cands.has(it.videoId) && (it.views === 0 || s?.state === 'upcoming' || s?.state === 'live')) cands.set(it.videoId, it);
    }
    for (const h of sched || []) {
      if (!cands.has(h.videoId)) cands.set(h.videoId, { videoId: h.videoId, title: '', at: 0 });
      const s = known[h.videoId];
      // 配信予定のアドオンの開始予定時刻・配信中の印を使う (確かめる前に分かる分)。終わったと分かっているものは戻さない
      if (h.live && (!s || s.state === 'upcoming')) updates[h.videoId] = { ...s, state: 'live', startAt: h.startAt ?? s?.startAt, at: now };
      else if (!s && !h.live) updates[h.videoId] = { state: 'upcoming', startAt: h.startAt, at: now };
    }
    // 確かめる順: 開始予定が近いもの → 初めて見たもの (新しい順)
    const due = [...cands.keys()]
      .filter((vid) => needsCheck(state(vid), now))
      .sort((a, b) => {
        const k = (vid) => (state(vid)?.startAt ? Math.abs(state(vid).startAt - now) : 1e13 - (cands.get(vid).at || 0));
        return k(a) - k(b);
      });
    for (const vid of due) {
      if (budget && budget.watch <= 0) break;
      if (budget) budget.watch--;
      try {
        const r = await checkVideo(vid);
        updates[vid] = { ...r, title: r.title || cands.get(vid).title, at: Date.now() };
      } catch (e) {
        if (e instanceof RateLimitedError) throw e;
        ErrLog.warnFetch('hakomado: 動画の状態の確認に失敗', vid, e);
      }
    }
    if (Object.keys(updates).length) await saveStates(updates);

    // 配信中があればそれ (新しく始まったもの)、無ければ一番近い配信予定。
    // 対象にしていない種類 (プレミア公開の動画・ショート) は除く (種類がまだ分からないものは除かない)
    const allowed = (s) => !s?.kind || s.kind === 'live' || kinds[s.kind] !== false;
    const list = [...cands.keys()].map((vid) => ({ vid, s: state(vid), title: cands.get(vid).title })).filter((x) => allowed(x.s));
    const live = list.filter((x) => x.s?.state === 'live').sort((a, b) => (b.s.startAt || 0) - (a.s.startAt || 0))[0];
    if (live) return { state: 'live', kind: live.s.kind, videoId: live.vid, title: live.s.title || live.title, startAt: live.s.startAt };
    const soon = list
      .filter((x) => x.s?.state === 'upcoming' && (!x.s.startAt || x.s.startAt > now - 6 * 60 * MIN))
      .sort((a, b) => (a.s.startAt || Infinity) - (b.s.startAt || Infinity))[0];
    if (soon) return { state: 'upcoming', kind: soon.s.kind, videoId: soon.vid, title: soon.s.title || soon.title, startAt: soon.s.startAt };
    return { state: 'offline' };
  }

  /** 動画の状態を書き足す (古くなったものは片付ける) */
  function saveStates(updates) {
    return withLock('hakomado-video-states', async () => {
      const all = { ...(await readStates()), ...updates };
      const now = Date.now();
      for (const [vid, s] of Object.entries(all)) {
        const old = now - (s.at || 0);
        if ((s.state === 'ended' || s.state === 'none') && old > 3 * 24 * 3600e3) delete all[vid];
        else if (s.state === 'upcoming' && s.startAt && s.startAt < now - 24 * 3600e3) delete all[vid];
      }
      await shared.set({ [VSTATE_KEY]: all });
    });
  }

  // ------------------------------------------------------------ 配信予定のアドオン
  // 配信予定サイト (ホロジュールなど。addons/ のファイル) から、まとめて分かる配信予定を読む。
  // 各枠の配信者はアドオンが channelId / handle で示すか、表示名・アイコンでチャンネル一覧・既定のチャンネルと突き合わせ、
  // それでも分からなければ動画の oEmbed で調べる。結果はアドオンごとに、チャンネル ID / ハンドル (小文字) → 枠の一覧
  const scheduleCache = new Map(); // アドオンの id -> {at, promise}

  /** アイコン画像の URL から、画像ごとの部分 (サイズ指定の前まで) を取り出す。配信元のドメインが違っても同じになる */
  function iconKey(url) {
    return (url || '').split('?')[0].split('/').pop().split('=')[0];
  }

  // 枠の表示名・アイコン → チャンネルのハンドル。配信予定の動画は oEmbed が投稿者を返さないので、これで突き合わせる
  // (アイコンは差し替わることがあり、英語の名前は短い呼び名 (Calli など) なので、両方を使う)。
  // 既定のチャンネルは毎回同じなので覚えておき、チャンネル一覧 (パックで足したものなど) は取るたびに足す
  let presetIndex = null;
  async function handleIndex() {
    if (!presetIndex) {
      presetIndex = new Map();
      for (const p of PRESET_FAVORITES) {
        if (!p.handle) continue;
        for (const k of [iconKey(p.icon), p.name, p.nameEn]) if (k) presetIndex.set(k.toLowerCase(), p.handle);
      }
    }
    const index = new Map(presetIndex);
    for (const f of await list()) {
      if (!f.handle) continue;
      for (const k of [iconKey(f.icon), f.name]) if (k && !index.has(k.toLowerCase())) index.set(k.toLowerCase(), f.handle);
    }
    return index;
  }

  /**
   * アドオンが取りに行くとき使う取得 (アドオンの origins の中だけ)。Cookie は送らない。
   * signedIn のアドオン (YouTube の登録チャンネル) だけは、ログイン中のアカウントのページなので Cookie 付きで、
   * ほかの YouTube のページ取得と同じ順番待ち・制限中の判定を通す
   */
  const fetchTextFor = (addon) => (url) => {
    if (!Addons.allowed(addon, url)) return Promise.reject(new Error(`hakomado: アドオン ${addon.id} の対象外の URL`));
    if (addon.signedIn) return ytTurn((fetchText) => fetchText(url, { credentials: 'include' }));
    return getHtml(url, { credentials: 'omit' });
  };

  /** そのアドオンの配信予定 (チャンネル ID / ハンドル (小文字) → 枠 [{videoId, live, startAt}]) */
  function fetchSchedule(addon, { force = false, auto = false } = {}) {
    // force (「⟳ 更新」) でも、直前 (5 秒以内) に取ったものは使い回す (チャンネルの件数分取りに行かないように)
    // minAgeMs = アドオンが決めた、取りに行く間隔の下限 (ページが大きいものなど)
    const maxAge = Math.max(auto ? SCHED_AUTO_MS : force ? SCHED_MANUAL_MS : STATUS_TTL_MS, addon.minAgeMs || 0);
    const cached = scheduleCache.get(addon.id);
    if (cached && Date.now() - cached.at < Math.min(maxAge, cached.ttl ?? Infinity)) return cached.promise;
    // 覚えておく時刻は「取った時刻」にそろえる (他のタブが取った結果を使うときは、その時刻)
    const remember = (at, ttl) => {
      const ent = scheduleCache.get(addon.id);
      if (ent?.promise === promise) Object.assign(ent, { at, ttl });
    };
    // 他のタブが少し前に取った結果があれば、それを使う (取りに行くのはタブ間で 1 つずつ)
    const promise = withLock(`hakomado-schedule:${addon.id}`, async () => {
      const sh = (await readShared()).sched3?.[addon.id];
      if (sh && Date.now() - sh.at < maxAge && sh.byKey) {
        remember(sh.at);
        return new Map(Object.entries(sh.byKey));
      }
      // onlyIfCovers のアドオンは、載るチャンネルが一覧に 1 つも無ければ取りに行かない。
      // チャンネルを足したらすぐ使えるように、この結果はこのタブで少しの間だけ覚える (他のタブとは共有しない)
      if (addon.onlyIfCovers && !(await list()).some((f) => addon.covers?.(f))) {
        remember(Date.now(), SCHED_SKIP_MS);
        return new Map();
      }
      const byKey = await buildSchedule(addon);
      const at = Date.now();
      await updateShared((v) => {
        delete v.sched2; // 前の版 (ホロジュールだけだったころ) の項目
        v.sched3 = { ...v.sched3, [addon.id]: { at, byKey: Object.fromEntries(byKey) } };
      });
      remember(at);
      return byKey;
    });
    scheduleCache.set(addon.id, { at: Date.now(), promise });
    // 取れなかったときも少しの間は覚えておく (すぐ忘れると、チャンネルの件数分取りに行ってしまう。
    // YouTube の登録チャンネルなら、ログインしていない間に大きなページを何度も取らないように)
    promise.catch(() => remember(Date.now(), SCHED_AUTO_MS));
    return promise;
  }

  /** アドオンから枠を取って、チャンネル ID / ハンドル (小文字) → そのチャンネルの枠 [{videoId, live, startAt}] の対応表を作る */
  async function buildSchedule(addon) {
    const entries = await addon.fetchEntries({ fetchText: fetchTextFor(addon) });
    const now = Date.now();
    // 配信中と、これから始まる枠 (少し遅れて始まる待機中の枠も含む) だけ使う。
    // 配信中の枠は、始まった時刻が分からなくてもよい (YouTube の登録チャンネルのフィードには載らない)
    const relevant = (Array.isArray(entries) ? entries : []).filter(
      (e) =>
        e &&
        VIDEO_RE.test(e.videoId) &&
        ((e.live && (e.startAt === undefined || Number.isFinite(e.startAt))) ||
          (Number.isFinite(e.startAt) && e.startAt >= now - 30 * 60e3 && e.startAt <= now + 48 * 3600e3)),
    );
    const index = await handleIndex();
    const byKey = new Map();
    let i = 0;
    const worker = async () => {
      while (i < relevant.length) {
        const e = relevant[i++];
        let key = CHANNEL_ID_RE.test(e.channelId || '') ? e.channelId : '';
        if (!key) {
          // まず表示名・アイコンでチャンネルを探す (YouTube に取りに行かずに済む)。
          // 見つからないときだけ oEmbed で投稿者を調べる (配信予定の動画は oEmbed が投稿者を返さないので、配信中のものだけ当たる)
          let handle = /^@[^/?\s]+$/.test(e.handle || '') ? e.handle : '';
          if (!handle) handle = index.get(iconKey(e.icon).toLowerCase()) || index.get(String(e.name || '').toLowerCase()) || '';
          if (!handle) handle = (await oembed(`${YT}/watch?v=${e.videoId}`))?.authorUrl.match(/youtube\.com\/(@[^/?]+)/)?.[1] || '';
          if (handle) key = decodeURIComponent(handle).toLowerCase();
        }
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ videoId: e.videoId, live: !!e.live, startAt: e.startAt });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return byKey;
  }

  /**
   * ON になっている配信予定のアドオンを全部読む。取れたものだけ [{addon, byKey}]
   * (権限が無いもの・取れなかったものは除く。そのチャンネルは RSS だけで調べる)
   */
  async function fetchSchedules(opts) {
    const results = await Promise.all(
      Addons.enabled('schedule').map(async (addon) => {
        if (!(await Addons.granted(addon))) return null;
        try {
          return { addon, byKey: await fetchSchedule(addon, opts) };
        } catch (e) {
          ErrLog.warnFetch('hakomado: 配信予定の取得に失敗', addon.id, e);
          return null;
        }
      }),
    );
    return results.filter(Boolean);
  }

  /**
   * 今の配信状況
   * @param {{channelId: string, handle?: string, preset?: boolean}} fav
   * @param {{force?: boolean, auto?: boolean, budget?: {watch: number}|null, quick?: boolean, kinds?: {video: boolean, short: boolean}}} [o]
   *   kinds = プレミア公開の動画・ショートも配信と同じに扱うか (設定の「自動再生のコンテンツ」。省くと両方)。
   *   budget = この回に動画のページを確かめてよい件数。
   *   quick = 自動再生を ON にした最初の 1 回など、すぐ結果がほしいとき。配信予定のアドオンで分かるチャンネルは RSS を取り直さず、
   *   アドオンの予定と覚えている RSS で決める (RSS は 1 チャンネル 1 秒ほどかかり、全部取り直すと数十秒待たせるため。
   *   取り直しはその後の自動再生の確認に任せる)
   * @returns {Promise<{state: 'live'|'upcoming'|'offline', videoId?: string, title?: string, startAt?: number}>}
   */
  async function fetchStatus(fav, { force = false, auto = false, budget = null, quick = false, kinds = { video: true, short: true } } = {}) {
    const kk = `${!!kinds.video}${!!kinds.short}`;
    const cached = statusCache.get(fav.channelId);
    if (!force && !auto && cached && cached.kk === kk && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;
    // 「⟳ 更新」(force) だけ取り直す。すぐ結果がほしいとき (quick) は、いつもの間隔で覚えている分を使う
    const manual = force && !auto && !quick;
    const interval = fav.star ? feedIntervals.pick : feedIntervals.other;
    if (isTwitchChannel(fav.channelId)) {
      const status = await twitchStatus(fav, { maxAge: manual ? FEED_MANUAL_MS : Math.max(TW_AUTO_MS, interval) });
      statusCache.set(fav.channelId, { at: Date.now(), status, kk });
      return status;
    }

    // 配信予定のアドオンに載るチャンネルは、その枠も使う。アドオンが「全部載る」とするチャンネル (ホロジュールなら
    // 既定のホロライブのチャンネル) は、載っていなければ「予定なし」が分かるので、RSS を見に行く間隔を長くする
    const key = (fav.handle || '').toLowerCase();
    let sched = null;
    let covered = false;
    for (const { addon, byKey } of await fetchSchedules({ force, auto })) {
      const mine = byKey.get(fav.channelId) || (key && byKey.get(key));
      const all = !!addon.covers?.(fav);
      if (mine || all) sched = [...(sched || []), ...(mine || [])];
      covered ||= all;
    }
    const maxFeedAge = manual ? FEED_MANUAL_MS : covered ? Math.max(FEED_SCHED_MS, interval) : interval;
    const status = await channelStatus(fav, { maxFeedAge, budget, sched, kinds, feedCacheOnly: quick && !!sched });
    statusCache.set(fav.channelId, { at: Date.now(), status, kk });
    return status;
  }

  /** RSS を見に行く間隔 (分) を設定から決める (ピックアップ / それ以外)。おかしな値は既定に戻す */
  function setFeedIntervals({ pickMin, otherMin }) {
    const ms = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) * 60 * 1000 : def);
    feedIntervals.pick = ms(pickMin, FEED_PICK_MS_DEFAULT);
    feedIntervals.other = ms(otherMin, FEED_OTHER_MS_DEFAULT);
  }

  // ------------------------------------------------------------ メンバー限定
  // 動画ページの playabilityStatus を見て、今のログイン状態で見られるかを調べる。
  // 見られる結果は変わらないので覚えておく。それ以外 (メンバーに入ることもある) は 10 分だけ
  const accessCache = new Map(); // videoId -> {at, result}
  const ACCESS_NG_TTL_MS = 10 * 60 * 1000;

  /** playabilityStatus (JSON の一部) がメンバー限定で見られないことを表しているか */
  function isMembersBlock(text) {
    return /sponsors?_only|members?_?only|ypcoffer|メンバー限定|メンバーシップ|membership/i.test(text);
  }

  /**
   * その配信を今のアカウントで見られるか
   * @returns {Promise<'ok'|'members'|'unknown'>} members = メンバー限定でメンバーではない。
   *   unknown = 判定できない (ログイン状態が分からない / 取得失敗など)。unknown では除外しない
   */
  async function checkAccess(videoId) {
    if (!VIDEO_RE.test(videoId || '')) return 'ok'; // Twitch の配信 (tw:…) は確かめない
    const c = accessCache.get(videoId);
    if (c && (c.result === 'ok' || Date.now() - c.at < ACCESS_NG_TTL_MS)) return c.result;
    let result = 'unknown';
    try {
      const html = await ytTurn((fetchText) =>
        fetchText(desktop(`${YT}/watch?v=${encodeURIComponent(videoId)}`), { credentials: 'include' }),
      );
      const at = html.indexOf('"playabilityStatus":{');
      const ps = at >= 0 ? html.slice(at, at + 6000) : '';
      const status = ps.match(/"status":"(\w+)"/)?.[1];
      if (status === 'OK') result = 'ok';
      // 開始前 (待機画面) はメンバーでも OK にならないので判定しない (始まってから枠のプレイヤーで判定)
      else if (status === 'LIVE_STREAM_OFFLINE') result = 'unknown';
      // ログインしていない状態で取れたページだと、メンバーでも見られない扱いになるので判定しない
      else if (status && /"LOGGED_IN":true/.test(html) && (isMembersBlock(ps) || /BADGE_STYLE_TYPE_MEMBERS_ONLY/.test(html))) {
        result = 'members';
      }
    } catch (e) {
      ErrLog.warnFetch('hakomado: 視聴できるかの確認に失敗', videoId, e);
    }
    // 判定できなかったときも 10 分は同じ結果を使う (1 分ごとの確認で毎回ページを取りに行かない)
    accessCache.set(videoId, { at: Date.now(), result });
    return result;
  }

  /** 枠の中のプレイヤーが「メンバー限定で見られない」と知らせてきたとき、結果を覚えておく */
  function rememberMembersOnly(videoId) {
    accessCache.set(videoId, { at: Date.now(), result: 'members' });
  }

  return {
    list, add, removeMany, isTwitchChannel, twitchVodStart, twitchVodInfo, twitchLiveInfo, setStar, seedPresets, restorePresets, removeAllPresets, presetCount, removedPresetCount, fetchStatus, fetchArchives,
    previewPack, importPack, packs, removePack, fillIcons,
    checkAccess, rememberMembersOnly, isMembersBlock, setFeedIntervals,
    videoStates, inspectVideos, fetchYouTubePlaylist, fetchSubscriptions,
  };
})();
