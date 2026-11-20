// お気に入りチャンネル: 保存と、チャンネル情報 / 配信状況の取得
// - 既定でホロライブ所属チャンネル (presets.js) を登録しておく
// - ホロライブのチャンネルの配信状況は、ホロジュール (schedule.hololive.tv) を 1 回取得してまとめて判定する
//   (YouTube のチャンネルページは 1 件 1MB 以上あり、数十件を毎回取りに行くと重いため)
// - それ以外のチャンネルは YouTube の /live ページを個別に見る
/* exported Favorites */
/* global PRESET_VERSION, PRESET_FAVORITES */
'use strict';

const Favorites = (() => {
  const YT = 'https://www.youtube.com';
  const SCHEDULE_URL = 'https://schedule.hololive.tv/lives';
  const STATUS_TTL_MS = 60 * 1000;
  const statusCache = new Map(); // channelId -> {at, status}

  // ------------------------------------------------------------ storage
  async function list() {
    const { favorites = [] } = await chrome.storage.local.get('favorites');
    return favorites;
  }

  async function saveList(favs) {
    await chrome.storage.local.set({ favorites: favs });
  }

  /** 既定のお気に入り (ホロライブ) を、まだ入れていなければ追加する。外したものは戻さない */
  async function seedPresets() {
    const { favorites = [], presetVersion = 0, removedPresets = [] } = await chrome.storage.local.get([
      'favorites',
      'presetVersion',
      'removedPresets',
    ]);
    if (presetVersion >= PRESET_VERSION) return;
    const byId = new Map(favorites.map((f) => [f.channelId, f]));
    for (const p of PRESET_FAVORITES) {
      const existing = byId.get(p.channelId);
      if (existing) {
        // 自分で登録済みのチャンネルにもグループ等を付けておく
        Object.assign(existing, { group: p.group, preset: true, handle: existing.handle || p.handle });
      } else if (!removedPresets.includes(p.channelId)) {
        favorites.push({ ...p, preset: true });
      }
    }
    await chrome.storage.local.set({ favorites, presetVersion: PRESET_VERSION });
  }

  /** 外した既定のお気に入りを戻す */
  async function restorePresets() {
    await chrome.storage.local.set({ removedPresets: [], presetVersion: 0 });
    await seedPresets();
  }

  async function removedPresetCount() {
    const { removedPresets = [] } = await chrome.storage.local.get('removedPresets');
    return removedPresets.length;
  }

  async function add(input) {
    const info = await fetchChannel(input);
    const favs = await list();
    const preset = PRESET_FAVORITES.find((p) => p.channelId === info.channelId);
    const existing = favs.findIndex((f) => f.channelId === info.channelId);
    if (existing >= 0) {
      favs[existing] = { ...favs[existing], ...info, name: favs[existing].name };
    } else {
      favs.push(preset ? { ...preset, preset: true } : info);
    }
    await saveList(favs);
    if (preset) {
      const { removedPresets = [] } = await chrome.storage.local.get('removedPresets');
      await chrome.storage.local.set({ removedPresets: removedPresets.filter((id) => id !== info.channelId) });
    }
    return { info: favs.find((f) => f.channelId === info.channelId), added: existing < 0 };
  }

  async function remove(channelId) {
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
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`取得できませんでした (${res.status})`);
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
    if (!s) throw new Error('@チャンネル名 か URL を入力してください');
    if (/^@[\w.\-]+$/.test(s)) return `${YT}/${s}`;
    if (/^UC[\w-]{22}$/.test(s)) return `${YT}/channel/${s}`;

    let url;
    try {
      url = new URL(/^https?:\/\//.test(s) ? s : 'https://' + s);
    } catch {
      throw new Error('URL として読み取れませんでした');
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
    throw new Error('YouTube のチャンネルが見つかりませんでした');
  }

  /** チャンネル名・アイコン・ID を取得 */
  async function fetchChannel(input) {
    const url = await channelUrlFrom(input);
    const html = await getHtml(url, { credentials: 'include' });
    const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
    const channelId = canon?.[1] || html.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
    if (!channelId) throw new Error('チャンネルの情報を読み取れませんでした');
    const handle = html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/)?.[1] || '';
    return {
      channelId,
      handle: handle ? decodeURIComponent(handle) : '',
      name: meta(html, 'og:title') || handle || channelId,
      icon: meta(html, 'og:image'),
    };
  }

  // 動画 → 投稿チャンネル (oEmbed。1 件 1KB 程度と軽い)。動画の投稿者は変わらないので覚えておく
  const oembedCache = new Map();
  function oembed(videoUrl) {
    if (!oembedCache.has(videoUrl)) {
      oembedCache.set(
        videoUrl,
        fetch(`${YT}/oembed?format=json&url=${encodeURIComponent(videoUrl)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j ? { authorUrl: String(j.author_url || '').replace(/^http:/, 'https:'), title: j.title || '' } : null))
          .catch(() => null),
      );
    }
    return oembedCache.get(videoUrl);
  }

  /** YouTube の /live ページを見て配信状況を判定 (ホロジュールに載らないチャンネル用) */
  async function fetchStatusFromYouTube(channelId) {
    const html = await getHtml(`${YT}/channel/${channelId}/live`, { credentials: 'include' });
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
      });
    }
    return entries;
  }

  /** ホロジュールから、ハンドル (小文字) → 配信状況 の対応表を作る */
  function fetchSchedule({ force = false } = {}) {
    // force (「⟳ 更新」) でも、直前 (5 秒以内) に取ったものは使い回す (お気に入りの件数分取りに行かないように)
    const age = scheduleCache ? Date.now() - scheduleCache.at : Infinity;
    if (age < (force ? 5000 : STATUS_TTL_MS)) return scheduleCache.promise;
    const promise = (async () => {
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
          const handle = o?.authorUrl.match(/youtube\.com\/(@[^/?]+)/)?.[1];
          if (!handle) continue;
          const key = decodeURIComponent(handle).toLowerCase();
          const status = e.live
            ? { state: 'live', videoId: e.videoId, title: o.title, startAt: e.startAt }
            : { state: 'upcoming', videoId: e.videoId, title: o.title, startAt: e.startAt };
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
    })();
    scheduleCache = { at: Date.now(), promise };
    promise.catch(() => {
      if (scheduleCache?.promise === promise) scheduleCache = null;
    });
    return promise;
  }

  /**
   * 今の配信状況
   * @param {{channelId: string, handle?: string, preset?: boolean}} fav
   * @returns {Promise<{state: 'live'|'upcoming'|'offline', videoId?: string, title?: string, startAt?: number}>}
   */
  async function fetchStatus(fav, { force = false } = {}) {
    const cached = statusCache.get(fav.channelId);
    if (!force && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;

    let status;
    const key = (fav.handle || '').toLowerCase();
    if (fav.preset && key) {
      // ホロライブ所属: ホロジュールに載っていなければ配信なし
      const schedule = await fetchSchedule({ force });
      status = schedule.get(key) || { state: 'offline' };
    } else {
      // ホロジュールに載っていればそれを使い、無ければ YouTube を個別に見る
      const schedule = key ? await fetchSchedule({ force }).catch(() => null) : null;
      status = schedule?.get(key) || (await fetchStatusFromYouTube(fav.channelId));
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
      const html = await getHtml(`${YT}/watch?v=${encodeURIComponent(videoId)}`, { credentials: 'include' });
      const at = html.indexOf('"playabilityStatus":{');
      const ps = at >= 0 ? html.slice(at, at + 6000) : '';
      const status = ps.match(/"status":"(\w+)"/)?.[1];
      if (status === 'OK') result = 'ok';
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
    list, add, remove, seedPresets, restorePresets, removedPresetCount, fetchChannel, fetchStatus,
    checkAccess, rememberMembersOnly, isMembersBlock,
  };
})();
