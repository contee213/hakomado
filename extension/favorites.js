// チャンネル一覧 (ピックアップの印を含む): 保存と、チャンネル情報 / 配信状況の取得
// - 既定でホロライブ所属チャンネル (presets.js) を登録しておく
// - 配信状況は、どのチャンネルも同じ仕組みで調べる (「配信の予定と状況」の節):
//   チャンネルの「ライブ配信」の再生リストの RSS で配信予定・新しい配信を知り、動画ごとの状態を覚えておいて、
//   開始予定の時刻のころだけ、その動画のページを確かめる
// - ホロライブのチャンネルは、ホロジュール (schedule.hololive.tv) を補助に使う (全員分の予定が 1 回で分かるので、
//   RSS を見に行く間隔を長くできる。ホロジュールが取れなくても RSS だけで動く)
/* exported Favorites */
/* global PRESET_VERSION, PRESET_FAVORITES, LANG, tr */
'use strict';

const Favorites = (() => {
  const YT = 'https://www.youtube.com';
  const SCHEDULE_URL = 'https://schedule.hololive.tv/lives';
  const STATUS_TTL_MS = 60 * 1000;
  const statusCache = new Map(); // channelId -> {at, status}

  // ------------------------------------------------------------ 取得の負荷を抑える
  // - 取得結果はタブ間で共有する (chrome.storage.session。ブラウザを閉じると消える)。
  //   他のタブが少し前に取ったものはそのまま使い、タブがいくつあっても取得は 1 つ分で済むようにする
  // - YouTube へのページ取得はタブ間で 1 件ずつ、間を空けて行う (一度にまとめて取らない)
  // - YouTube に制限 (429) をかけられたら、しばらく取りに行かない (5 分 → 10 分 → … 最大 60 分)
  const shared = chrome.storage.session;
  const SHARED_KEY = 'statusShared'; // {sched: {at, byHandle}, yt: {channelId: {at, status}}, backoff: {until, step}, lastYtFetch}
  const FEED_AUTO_MS = 3 * 60 * 1000; // チャンネルの RSS を見に行く間隔 (ふつう)
  const FEED_HOLO_MS = 15 * 60 * 1000; // ホロジュールで予定が分かるチャンネル
  const FEED_MANUAL_MS = 30 * 1000; // 「⟳ 更新」
  const FEED_GAP_MS = 200; // RSS (軽い) を取る間隔
  const SCHED_AUTO_MS = 55 * 1000; // ホロジュールは 1 分ごと
  const SCHED_MANUAL_MS = 5 * 1000;
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

  /**
   * YouTube のページを取る順番が来たら fn(fetchText) を呼ぶ (タブ間で 1 件ずつ)。
   * 制限中は取りに行かずに RateLimitedError を投げる (呼び出し側では「取得失敗」扱い)
   */
  function ytTurn(fn, { lock = 'hakomado-yt-fetch', gap = YT_GAP_MS, lastKey = 'lastYtFetch' } = {}) {
    return withLock(lock, async () => {
      const st = await readShared();
      if ((st.backoff?.until || 0) > Date.now()) throw new RateLimitedError(tr('rateLimited'));
      const fetchText = async (url, opts = {}) => {
        const wait = (st[lastKey] || 0) + gap - Date.now();
        if (wait > 0) await sleep(wait);
        let res;
        try {
          res = await fetch(url, withTimeout(opts));
        } finally {
          await updateShared((v) => (v[lastKey] = Date.now()));
        }
        // 制限 (429、または「ロボットではありません」の確認ページに飛ばされた)
        if (res.status === 429 || /\/sorry\//.test(res.url)) {
          await updateShared((v) => {
            const step = Math.min((v.backoff?.step || 0) + 1, 10);
            v.backoff = { step, until: Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (step - 1), BACKOFF_MAX_MS) };
          });
          throw new RateLimitedError(tr('rateLimited'));
        }
        if (res.status === 404 && opts.allow404) return null;
        if (!res.ok) throw new Error(tr('fetchFail', res.status));
        const text = await res.text();
        if (st.backoff) await updateShared((v) => delete v.backoff);
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
  const feedKey = (channelId) => FEED_PREFIX + channelId;
  const readFeed = async (channelId) => (await shared.get(feedKey(channelId)))[feedKey(channelId)];
  const ARCHIVE_TTL_MS = 30 * 60 * 1000;
  const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;

  /** そのチャンネルの再生リストの中身 (maxAge より新しい結果があればそれを使う)。配信をしたことがないチャンネルは [] */
  async function fetchFeed(channelId, { maxAge }) {
    if (!CHANNEL_ID_RE.test(channelId)) return [];
    const fresh = (c) => c && Date.now() - c.at < maxAge && Array.isArray(c.items);
    const hit = await readFeed(channelId);
    if (fresh(hit)) return hit.items;
    return ytTurn(
      async (fetchText) => {
        // 順番を待つ間に他のタブが取っていれば、それを使う
        const again = await readFeed(channelId);
        if (fresh(again)) return again.items;
        const xml = await fetchText(`${YT}/feeds/videos.xml?playlist_id=UULV${channelId.slice(2)}`, { credentials: 'omit', allow404: true });
        const items = xml == null ? [] : parseFeed(xml);
        await shared.set({ [feedKey(channelId)]: { at: Date.now(), items } });
        return items;
      },
      { lock: 'hakomado-feed-fetch', gap: FEED_GAP_MS, lastKey: 'lastFeedFetch' },
    );
  }

  /** そのチャンネルの最近の配信アーカイブ (新しい順)。force = 覚えている結果を使わずに取り直す */
  async function fetchArchives(channelId, { force = false } = {}) {
    const items = await fetchFeed(channelId, { maxAge: force ? 0 : ARCHIVE_TTL_MS });
    // 配信予定 (再生数 0) は除く
    return items.filter((v) => v.views > 0).map(({ views, ...v }) => v);
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
    const info = await fetchChannel(input); // 取得は順番待ちの外で
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
    const targets = (await list()).filter((f) => !f.icon && !f.preset && !iconTried.has(f.channelId)).slice(0, limit);
    if (!targets.length) return 0;
    const found = new Map();
    for (const f of targets) {
      iconTried.add(f.channelId);
      try {
        const html = await ytTurn((fetchText) => fetchText(`${YT}/channel/${f.channelId}`, { credentials: 'omit' }));
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

  function remove(channelId) {
    return withListLock(() => removeLocked(channelId));
  }

  async function removeLocked(channelId) {
    const favs = await list();
    const target = favs.find((f) => f.channelId === channelId);
    await saveList(favs.filter((f) => f.channelId !== channelId));
    statusCache.delete(channelId);
    if (target?.preset) {
      const { removedPresets = [] } = await chrome.storage.local.get('removedPresets');
      if (!removedPresets.includes(channelId)) {
        await chrome.storage.local.set({ removedPresets: [...removedPresets, channelId] });
      }
    }
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
  //  - 初めて見た動画 (RSS の配信予定と、24 時間以内に増えたもの): 1 度確かめる。ホロジュールに載っていれば、
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
    const html = await ytTurn((fetchText) => fetchText(`${YT}/watch?v=${videoId}`, { credentials: 'include' }));
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
    if (/"isLive":true/.test(details)) return { state: 'live', title, startAt: started ? Date.parse(started) : undefined, ...extra };
    if (/"isUpcoming":true/.test(details)) {
      const t = html.match(/"scheduledStartTime":"(\d+)"/)?.[1];
      return { state: 'upcoming', title, startAt: t ? Number(t) * 1000 : undefined, ...extra };
    }
    if (/"isLiveContent":true/.test(details)) return { state: 'ended', title, ...extra };
    return { state: 'none', title, ...extra };
  }

  // ------------------------------------------------------------ 再生リストの動画の状態
  // 再生リストの編集画面で、配信中・配信予定・見られない動画に印を付けるために使う。
  // 調べた結果は配信状況と同じところ (videoStates) に入れて、タブ間・配信状況の確認と共有する

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
    const now = Date.now();
    const known = await readStates();
    // 見られるかどうか (avail) をまだ調べていないものも調べる (配信状況の確認で入ったものなど)
    const due = ids.filter((id) => VIDEO_RE.test(id) && (needsCheck(known[id], now) || !known[id].avail)).slice(0, max);
    for (const vid of due) {
      if (shouldStop?.()) break;
      try {
        const r = await checkVideo(vid);
        const st = { ...r, title: r.title || known[vid]?.title, at: Date.now() };
        await saveStates({ [vid]: st });
        onEach?.(vid, st);
      } catch (e) {
        if (e instanceof RateLimitedError) break;
        console.warn('hakomado: 動画の状態の確認に失敗', vid, e);
      }
    }
  }

  /**
   * チャンネルの今の配信状況。
   * @param {{maxFeedAge: number, budget: {watch: number}|null, holo: Array|null}} o
   *   holo = ホロジュールに載っているこのチャンネルの枠 [{videoId, live, startAt}] (ホロジュールを使わないチャンネルは null)
   */
  async function channelStatus(fav, { maxFeedAge, budget, holo }) {
    let items = [];
    try {
      items = await fetchFeed(fav.channelId, { maxAge: maxFeedAge });
    } catch (e) {
      // RSS が取れなくても、ホロジュールで分かる分は使う
      if (!holo || e instanceof RateLimitedError) throw e;
    }
    const now = Date.now();
    const known = await readStates();
    const updates = {};
    const state = (vid) => updates[vid] || known[vid];
    // 調べる動画: 配信予定 (再生数 0)・24 時間以内に増えたもの・配信予定 / 配信中と分かっているもの・ホロジュールの枠
    const cands = new Map();
    for (const it of items) {
      const s = known[it.videoId];
      if (it.views === 0 || now - it.at < RECENT_MS || s?.state === 'upcoming' || s?.state === 'live') cands.set(it.videoId, it);
    }
    for (const h of holo || []) {
      if (!cands.has(h.videoId)) cands.set(h.videoId, { videoId: h.videoId, title: '', at: 0 });
      const s = known[h.videoId];
      // ホロジュールの開始予定時刻・配信中の印を使う (確かめる前に分かる分)。終わったと分かっているものは戻さない
      if (h.live && (!s || s.state === 'upcoming')) updates[h.videoId] = { ...s, state: 'live', startAt: h.startAt, at: now };
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
        console.warn('hakomado: 動画の状態の確認に失敗', vid, e);
      }
    }
    if (Object.keys(updates).length) await saveStates(updates);

    // 配信中があればそれ (新しく始まったもの)、無ければ一番近い配信予定
    const list = [...cands.keys()].map((vid) => ({ vid, s: state(vid), title: cands.get(vid).title }));
    const live = list.filter((x) => x.s?.state === 'live').sort((a, b) => (b.s.startAt || 0) - (a.s.startAt || 0))[0];
    if (live) return { state: 'live', videoId: live.vid, title: live.s.title || live.title, startAt: live.s.startAt };
    const soon = list
      .filter((x) => x.s?.state === 'upcoming' && (!x.s.startAt || x.s.startAt > now - 6 * 60 * MIN))
      .sort((a, b) => (a.s.startAt || Infinity) - (b.s.startAt || Infinity))[0];
    if (soon) return { state: 'upcoming', videoId: soon.vid, title: soon.s.title || soon.title, startAt: soon.s.startAt };
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

  // ------------------------------------------------------------ ホロジュール
  // 1 ページに前日〜翌日の配信予定が載っている。配信中の枠には赤い枠線 (border: 3px red) が付く。
  // 時刻は日本時間。各枠の配信者は動画の oEmbed で調べ、チャンネルのハンドルで突き合わせる。
  let scheduleCache = null; // {at, promise}

  function parseSchedule(html) {
    // ホロジュールの各枠には onclick="gtag(...)" が付いている。DOMParser は読み込むだけでも
    // インラインのイベントハンドラーを拡張機能の CSP 違反として記録するので、先に取り除く (スクリプトも不要)
    const cleaned = html
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const doc = new DOMParser().parseFromString(cleaned, 'text/html');
    const nowJst = new Date(Date.now() + 9 * 3600e3);
    const entries = [];
    let month = null;
    let day = null;
    for (const el of doc.querySelectorAll('.holodule.navbar-text, a.thumbnail[href*="youtube.com/watch"]')) {
      if (el.tagName !== 'A') {
        const m = el.textContent.match(/(\d{1,2})\/(\d{1,2})/);
        if (m) [month, day] = [Number(m[1]), Number(m[2])];
        continue;
      }
      const videoId = el.getAttribute('href').match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
      const hm = el.querySelector('.datetime')?.textContent.match(/(\d{1,2}):(\d{2})/);
      if (!videoId || !hm || month == null) continue;
      // 年をまたぐとき (12 月に 1 月の予定など) の補正
      let year = nowJst.getUTCFullYear();
      const curMonth = nowJst.getUTCMonth() + 1;
      if (month - curMonth > 6) year--;
      else if (curMonth - month > 6) year++;
      entries.push({
        videoId,
        startAt: Date.UTC(year, month - 1, day, Number(hm[1]) - 9, Number(hm[2])),
        live: /border:\s*3px\s+red/.test(el.getAttribute('style') || ''),
        name: el.querySelector('.name')?.textContent.trim() || '',
        // 配信者のアイコン (コラボは複数並ぶが、先頭が配信者)
        icon: iconKey(el.querySelector('img[src*="yt3."]')?.getAttribute('src')),
      });
    }
    return entries;
  }

  /** アイコン画像の URL から、画像ごとの部分 (サイズ指定の前まで) を取り出す。配信元のドメインが違っても同じになる */
  function iconKey(url) {
    return (url || '').split('?')[0].split('/').pop().split('=')[0];
  }

  // ホロジュールの枠 → 既定のチャンネル (ホロライブ所属) のハンドル。
  // 配信予定の動画は oEmbed が投稿者を返さないので、ホロジュールに載っているアイコンと名前で突き合わせる
  // (アイコンは差し替わることがあり、英語の名前は短い呼び名 (Calli など) なので、両方を使う)
  let presetIndex = null;
  function presetHandleFor(e) {
    if (!presetIndex) {
      presetIndex = new Map();
      for (const p of PRESET_FAVORITES) {
        if (!p.handle) continue;
        for (const k of [iconKey(p.icon), p.name, p.nameEn]) if (k) presetIndex.set(k.toLowerCase(), p.handle);
      }
    }
    return presetIndex.get(e.icon.toLowerCase()) || presetIndex.get(e.name.toLowerCase()) || '';
  }

  /** ホロジュールから、ハンドル (小文字) → そのチャンネルの枠 [{videoId, live, startAt}] の対応表を作る */
  function fetchSchedule({ force = false, auto = false } = {}) {
    // force (「⟳ 更新」) でも、直前 (5 秒以内) に取ったものは使い回す (チャンネルの件数分取りに行かないように)
    const maxAge = auto ? SCHED_AUTO_MS : force ? SCHED_MANUAL_MS : STATUS_TTL_MS;
    const age = scheduleCache ? Date.now() - scheduleCache.at : Infinity;
    if (age < maxAge) return scheduleCache.promise;
    // 他のタブが少し前に取った結果があれば、それを使う (取りに行くのはタブ間で 1 つずつ)
    const promise = withLock('hakomado-schedule', async () => {
      const sh = (await readShared()).sched2;
      if (sh && Date.now() - sh.at < maxAge && sh.byHandle) return new Map(Object.entries(sh.byHandle));
      const byHandle = await buildSchedule();
      await updateShared((v) => (v.sched2 = { at: Date.now(), byHandle: Object.fromEntries(byHandle) }));
      return byHandle;
    });
    scheduleCache = { at: Date.now(), promise };
    promise.catch(() => {
      if (scheduleCache?.promise === promise) scheduleCache = null;
    });
    return promise;
  }

  /** ホロジュールを取って、ハンドル (小文字) → そのチャンネルの枠 [{videoId, live, startAt}] の対応表を作る */
  async function buildSchedule() {
    const entries = parseSchedule(await getHtml(SCHEDULE_URL));
    const now = Date.now();
    // 配信中と、これから始まる枠 (少し遅れて始まる待機中の枠も含む) だけ使う
    const relevant = entries.filter((e) => e.live || (e.startAt >= now - 30 * 60e3 && e.startAt <= now + 48 * 3600e3));
    const byHandle = new Map();
    let i = 0;
    const worker = async () => {
      while (i < relevant.length) {
        const e = relevant[i++];
        // まずホロジュールのアイコン・名前で既定のチャンネルを探す (YouTube に取りに行かずに済む)。
        // 見つからないときだけ oEmbed で投稿者を調べる (配信予定の動画は oEmbed が投稿者を返さないので、配信中のものだけ当たる)
        let handle = presetHandleFor(e);
        if (!handle) handle = (await oembed(`${YT}/watch?v=${e.videoId}`))?.authorUrl.match(/youtube\.com\/(@[^/?]+)/)?.[1] || '';
        if (!handle) continue;
        const key = decodeURIComponent(handle).toLowerCase();
        if (!byHandle.has(key)) byHandle.set(key, []);
        byHandle.get(key).push({ videoId: e.videoId, live: e.live, startAt: e.startAt });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return byHandle;
  }

  /**
   * 今の配信状況
   * @param {{channelId: string, handle?: string, preset?: boolean}} fav
   * @param {{force?: boolean, auto?: boolean, budget?: {watch: number}|null}} [o] budget = この回に動画のページを確かめてよい件数
   * @returns {Promise<{state: 'live'|'upcoming'|'offline', videoId?: string, title?: string, startAt?: number}>}
   */
  async function fetchStatus(fav, { force = false, auto = false, budget = null } = {}) {
    const cached = statusCache.get(fav.channelId);
    if (!force && !auto && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;

    // ホロジュールに載るチャンネル (既定のホロライブのチャンネル・載っている自分で追加したチャンネル) は、その枠も使う。
    // 既定のチャンネルは、載っていなければ「予定なし」が分かるので、RSS を見に行く間隔を長くする
    const key = (fav.handle || '').toLowerCase();
    let holo = null;
    if (key) {
      const schedule = await fetchSchedule({ force, auto }).catch(() => null);
      const mine = schedule?.get(key);
      if (mine || (schedule && fav.preset)) holo = mine || [];
    }
    const maxFeedAge = force && !auto ? FEED_MANUAL_MS : holo && fav.preset ? FEED_HOLO_MS : FEED_AUTO_MS;
    const status = await channelStatus(fav, { maxFeedAge, budget, holo });
    statusCache.set(fav.channelId, { at: Date.now(), status });
    return status;
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
    const c = accessCache.get(videoId);
    if (c && (c.result === 'ok' || Date.now() - c.at < ACCESS_NG_TTL_MS)) return c.result;
    let result = 'unknown';
    try {
      const html = await ytTurn((fetchText) =>
        fetchText(`${YT}/watch?v=${encodeURIComponent(videoId)}`, { credentials: 'include' }),
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
      console.warn('hakomado: 視聴できるかの確認に失敗', videoId, e);
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
    list, add, remove, setStar, seedPresets, restorePresets, removeAllPresets, presetCount, removedPresetCount, fetchStatus, fetchArchives,
    previewPack, importPack, packs, removePack, fillIcons,
    checkAccess, rememberMembersOnly, isMembersBlock,
    videoStates, inspectVideos,
  };
})();
