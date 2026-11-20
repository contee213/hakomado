// チャンネル一覧 (ピックアップの印を含む): 保存と、チャンネル情報 / 配信状況の取得
// - 既定でホロライブ所属チャンネル (presets.js) を登録しておく
// - ホロライブのチャンネルの配信状況は、ホロジュール (schedule.hololive.tv) を 1 回取得してまとめて判定する
//   (YouTube のチャンネルページは 1 件 1MB 以上あり、数十件を毎回取りに行くと重いため)
// - それ以外のチャンネルは YouTube の /live ページを個別に見る
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
  const YT_AUTO_MS = 3 * 60 * 1000; // 自動再生・一覧を開いたとき: ホロライブ以外のチャンネルは 3 分に 1 回まで
  const YT_MANUAL_MS = 30 * 1000; // 「⟳ 更新」や自動再生を ON にしたとき
  const SCHED_AUTO_MS = 55 * 1000; // ホロジュールは 1 分ごと
  const SCHED_MANUAL_MS = 5 * 1000;
  const YT_GAP_MS = 1000; // YouTube へのページ取得の間隔
  const YT_STALE_MS = 10 * 60 * 1000; // 取りに行けなかったときに使ってよい、前の結果の古さ
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
    return withLock('hukumado-status-store', async () => {
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
  function ytTurn(fn) {
    return withLock('hukumado-yt-fetch', async () => {
      const st = await readShared();
      if ((st.backoff?.until || 0) > Date.now()) throw new RateLimitedError(tr('rateLimited'));
      const fetchText = async (url, opts) => {
        const wait = (st.lastYtFetch || 0) + YT_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        let res;
        try {
          res = await fetch(url, withTimeout(opts));
        } finally {
          await updateShared((v) => (v.lastYtFetch = Date.now()));
        }
        // 制限 (429、または「ロボットではありません」の確認ページに飛ばされた)
        if (res.status === 429 || /\/sorry\//.test(res.url)) {
          await updateShared((v) => {
            const step = Math.min((v.backoff?.step || 0) + 1, 10);
            v.backoff = { step, until: Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (step - 1), BACKOFF_MAX_MS) };
          });
          throw new RateLimitedError(tr('rateLimited'));
        }
        if (!res.ok) throw new Error(tr('fetchFail', res.status));
        const text = await res.text();
        if (st.backoff) await updateShared((v) => delete v.backoff);
        return text;
      };
      return fn(fetchText);
    });
  }

  // ------------------------------------------------------------ 配信のアーカイブ (YouTube のフィード)
  // チャンネルの「ライブ配信」の再生リスト (UULV + チャンネル ID の 3 文字目以降) のフィードから、新しい順 15 件を取る。
  // ログイン不要の軽い XML。取った結果は 30 分覚えておく (タブ間で共有。何度開いても取りに行かない)
  // 配信予定 (待機所) もこの再生リストに入るが、再生数が 0 なので除く。日時は「枠を作った日時」なので、日時では区別できない
  const ARCHIVE_KEY = 'archiveCache2'; // {channelId: {at, items: [{videoId, title, at}]}} (2 = 配信予定を除くようにした版)
  const ARCHIVE_TTL_MS = 30 * 60 * 1000;
  const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;

  /** そのチャンネルの最近の配信アーカイブ (新しい順)。force = 覚えている結果を使わずに取り直す */
  async function fetchArchives(channelId, { force = false } = {}) {
    if (!CHANNEL_ID_RE.test(channelId)) return [];
    const { [ARCHIVE_KEY]: cache = {} } = await shared.get(ARCHIVE_KEY);
    const hit = cache[channelId];
    if (!force && hit && Date.now() - hit.at < ARCHIVE_TTL_MS && Array.isArray(hit.items)) return hit.items;
    const res = await fetch(`${YT}/feeds/videos.xml?playlist_id=UULV${channelId.slice(2)}`, withTimeout({ credentials: 'omit' }));
    // 配信をしたことがないチャンネルは、再生リストが無いので 404
    let items = [];
    if (res.ok) items = parseFeed(await res.text());
    else if (res.status !== 404) throw new Error(tr('fetchFail', res.status));
    await withLock('hukumado-archive-store', async () => {
      const { [ARCHIVE_KEY]: c = {} } = await shared.get(ARCHIVE_KEY);
      // 古いものは捨てる (セッションの間にたまり続けないように)
      for (const [k, v] of Object.entries(c)) if (Date.now() - (v?.at || 0) > ARCHIVE_TTL_MS * 4) delete c[k];
      c[channelId] = { at: Date.now(), items };
      await shared.set({ [ARCHIVE_KEY]: c });
    });
    return items;
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
      .filter((v) => VIDEO_RE.test(v.videoId) && v.views > 0)
      .map(({ views, ...v }) => v);
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
  const withListLock = (fn) => navigator.locks.request('hukumado-favorites', fn);

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

  /**
   * YouTube の /live ページを見た配信状況 (ホロジュールに載らないチャンネル用)。
   * maxAge より新しい結果 (他のタブが取ったものも含む) があればそれを使う。
   * budget.yt (この回に取りに行ってよい件数) を使い切っていて、古くても結果があればそれを使う
   */
  async function youtubeStatus(channelId, { maxAge, budget }) {
    const fresh = (c) => c && Date.now() - c.at < maxAge;
    const cached = (await readShared()).yt?.[channelId];
    if (fresh(cached)) return cached.status;
    // (10 分より古い結果は使わない。制限中などで取れなければ「取得失敗」扱いにして、古い状態で枠を足し引きしない)
    if (cached && budget && budget.yt <= 0 && Date.now() - cached.at < YT_STALE_MS) return cached.status;
    if (budget) budget.yt--;
    return ytTurn(async (fetchText) => {
      // 順番を待つ間に他のタブが取っていれば、それを使う
      const again = (await readShared()).yt?.[channelId];
      if (fresh(again)) return again.status;
      const status = parseLivePage(await fetchText(`${YT}/channel/${channelId}/live`, { credentials: 'include' }));
      await updateShared((v) => {
        v.yt = v.yt || {};
        v.yt[channelId] = { at: Date.now(), status };
      });
      return status;
    });
  }

  function parseLivePage(html) {
    const vid = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/)?.[1];
    if (!vid) return { state: 'offline' };
    // ytInitialPlayerResponse.videoDetails の中の isLive / isUpcoming を見る
    const at = html.indexOf('"videoDetails":{"videoId":"' + vid + '"');
    const details = at >= 0 ? html.slice(at, at + 3000) : '';
    const title = meta(html, 'title') || meta(html, 'og:title');
    if (/"isLive":true/.test(details)) return { state: 'live', videoId: vid, title };
    if (/"isUpcoming":true/.test(details)) {
      const t = html.match(/"scheduledStartTime":"(\d+)"/)?.[1] || html.match(/"startTime":"(\d+)"/)?.[1];
      return { state: 'upcoming', videoId: vid, title, startAt: t ? Number(t) * 1000 : undefined };
    }
    return { state: 'offline' };
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

  /** ホロジュールから、ハンドル (小文字) → 配信状況 の対応表を作る */
  function fetchSchedule({ force = false, auto = false } = {}) {
    // force (「⟳ 更新」) でも、直前 (5 秒以内) に取ったものは使い回す (チャンネルの件数分取りに行かないように)
    const maxAge = auto ? SCHED_AUTO_MS : force ? SCHED_MANUAL_MS : STATUS_TTL_MS;
    const age = scheduleCache ? Date.now() - scheduleCache.at : Infinity;
    if (age < maxAge) return scheduleCache.promise;
    // 他のタブが少し前に取った結果があれば、それを使う (取りに行くのはタブ間で 1 つずつ)
    const promise = withLock('hukumado-schedule', async () => {
      const sh = (await readShared()).sched;
      if (sh && Date.now() - sh.at < maxAge && sh.byHandle) return new Map(Object.entries(sh.byHandle));
      const byHandle = await buildSchedule();
      await updateShared((v) => (v.sched = { at: Date.now(), byHandle: Object.fromEntries(byHandle) }));
      return byHandle;
    });
    scheduleCache = { at: Date.now(), promise };
    promise.catch(() => {
      if (scheduleCache?.promise === promise) scheduleCache = null;
    });
    return promise;
  }

  /** ホロジュールを取って、ハンドル (小文字) → 配信状況 の対応表を作る */
  async function buildSchedule() {
    const entries = parseSchedule(await getHtml(SCHEDULE_URL));
    const now = Date.now();
    // 配信中と、これから始まる枠 (少し遅れて始まる待機中の枠も含む) だけ調べる
    const relevant = entries.filter((e) => e.live || (e.startAt >= now - 30 * 60e3 && e.startAt <= now + 48 * 3600e3));
    const byHandle = new Map();
    let i = 0;
    const worker = async () => {
      while (i < relevant.length) {
        const e = relevant[i++];
        const o = await oembed(`${YT}/watch?v=${e.videoId}`);
        // 配信予定の動画は oEmbed が投稿者もタイトルも返さない → ホロジュールのアイコン・名前で既定のチャンネルを探す
        const handle = o?.authorUrl.match(/youtube\.com\/(@[^/?]+)/)?.[1] || presetHandleFor(e);
        if (!handle) continue;
        const key = decodeURIComponent(handle).toLowerCase();
        const title = o?.title || '';
        const status = e.live
          ? { state: 'live', videoId: e.videoId, title, startAt: e.startAt }
          : { state: 'upcoming', videoId: e.videoId, title, startAt: e.startAt };
        const prev = byHandle.get(key);
        // 配信中を優先。予定どうしなら早い方
        if (
          !prev ||
          (status.state === 'live' && prev.state !== 'live') ||
          (status.state === prev.state && status.startAt < prev.startAt)
        ) {
          byHandle.set(key, status);
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return byHandle;
  }

  /**
   * 今の配信状況
   * @param {{channelId: string, handle?: string, preset?: boolean}} fav
   * @returns {Promise<{state: 'live'|'upcoming'|'offline', videoId?: string, title?: string, startAt?: number}>}
   */
  async function fetchStatus(fav, { force = false, auto = false, budget = null } = {}) {
    const cached = statusCache.get(fav.channelId);
    if (!force && !auto && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;

    let status;
    const key = (fav.handle || '').toLowerCase();
    if (fav.preset && key) {
      // ホロライブ所属: ホロジュールに載っていなければ配信なし
      const schedule = await fetchSchedule({ force, auto });
      status = schedule.get(key) || { state: 'offline' };
    } else {
      // ホロジュールに載っていればそれを使い、無ければ YouTube を個別に見る
      // (配信の終了は枠のプレイヤーが知らせてくるので、ここは新しく始まった配信を見つけるためだけ。3 分に 1 回まで)
      const schedule = key ? await fetchSchedule({ force, auto }).catch(() => null) : null;
      status =
        schedule?.get(key) ||
        (await youtubeStatus(fav.channelId, { maxAge: force && !auto ? YT_MANUAL_MS : YT_AUTO_MS, budget }));
    }
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
      console.warn('hukumado: 視聴できるかの確認に失敗', videoId, e);
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
    checkAccess, rememberMembersOnly, isMembersBlock,
  };
})();
