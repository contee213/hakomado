// アドオン: YouTube の登録チャンネル (www.youtube.com/feed/subscriptions)
// ログイン中のアカウントの「登録チャンネル」のフィードを 1 ページ読むと、登録チャンネルの配信中・配信予定がまとめて分かる。
// 設定 → チャンネルの「登録チャンネルから選ぶ」で足したチャンネル (パック「YouTube の登録チャンネル」) は、
// RSS を見に行く間隔を長くできる (数百件あっても、確認が追いつくように)
// - ページは数 MB と大きいので、取りに行くのは 2 分に 1 回まで。パックのチャンネルが無ければ取りに行かない (本体が見る)
// - 2026-11 の時点の作り: 動画は lockupViewModel (contentId = 動画 ID)。配信中は THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE のバッジ、
//   配信予定は「2026/11/24 21:00 に公開予定」のような文字 (時刻の数値は無い)。チャンネルは browseId (UC…)
// - 載るのは新しい順に 100 本ほど。配信中は上の方に載る。前に作られた配信予定は載らないことがあるが、
//   そのチャンネルも RSS を (間隔を長くして) 見ているので、いずれ分かる
// - ログインしていないときは失敗にする (そのときは各チャンネルの RSS だけで調べる)
/* global Addons */
'use strict';

(() => {
  const FEED_URL = 'https://www.youtube.com/feed/subscriptions';
  // 設定 → チャンネルの「登録チャンネルから選ぶ」で足したチャンネルのパックの名前 (足したときの表示言語のもの)
  const PACK_NAMES = ['YouTube の登録チャンネル', 'YouTube subscriptions'];
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;

  /**
   * 「…に公開予定」などの文字から開始予定 (ミリ秒) を読む。時刻は、利用者の環境の時刻 (YouTube がそれに合わせて出す)。
   * 日本語: 2026/11/24 21:00 に公開予定。英語: Scheduled for 11/24/26, 9:00 PM / Premieres 11/24/26, 9:00 PM
   * 読めなければ NaN
   */
  function parseStart(text) {
    const s = String(text || '');
    let m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*に(公開|配信)予定/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    m = s.match(/^(?:Scheduled for|Premieres)\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i);
    if (m) {
      let h = +m[4] % (m[6] ? 12 : 24);
      if (/pm/i.test(m[6] || '')) h += 12;
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return new Date(y, +m[1] - 1, +m[2], h, +m[5]).getTime();
    }
    return NaN;
  }

  /** フィードの動画 1 本 (lockupViewModel) の、メタデータの文字 (チャンネル名・「…人が視聴中」・「…に公開予定」など) */
  function metaTexts(v) {
    const out = [];
    const walk = (o, inParts) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, x] of Object.entries(o)) {
        if (inParts && k === 'content' && typeof x === 'string') out.push(x);
        else walk(x, inParts || k === 'metadataParts');
      }
    };
    walk(v?.metadata, false);
    return out;
  }

  /** 登録チャンネルのフィードの HTML から、配信中・配信予定の枠を読む [{videoId, channelId, live, startAt?}] */
  function parse(html) {
    if (!/"LOGGED_IN":true/.test(html)) throw new Error('hakomado: YouTube にログインしていない');
    const json = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('hakomado: 登録チャンネルのフィードが読めない');
    }
    const entries = [];
    const seen = new Set();
    const add = (v) => {
      const videoId = v.contentId;
      if (!VIDEO_RE.test(videoId || '') || seen.has(videoId)) return;
      const text = JSON.stringify(v);
      const channelId = text.match(/"browseId":"(UC[\w-]{22})"/)?.[1];
      if (!channelId) return;
      if (/"THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"/.test(text)) {
        seen.add(videoId);
        entries.push({ videoId, channelId, live: true }); // 始まった時刻は分からない (本体が動画のページで確かめる)
        return;
      }
      for (const t of metaTexts(v)) {
        const startAt = parseStart(t);
        if (Number.isFinite(startAt)) {
          seen.add(videoId);
          entries.push({ videoId, channelId, live: false, startAt });
          return;
        }
      }
    };
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        for (const x of o) walk(x);
        return;
      }
      for (const [k, x] of Object.entries(o)) {
        if (k === 'lockupViewModel' && x?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') add(x);
        else walk(x);
      }
    };
    walk(data);
    return entries;
  }

  Addons.register({
    id: 'ytsubs',
    type: 'schedule',
    name: ['YouTube の登録チャンネル', 'YouTube subscriptions'],
    note: [
      'ログイン中の YouTube の登録チャンネルのフィードを読み込み、登録チャンネルから足したチャンネルの配信状況の確認を軽くします',
      'Reads the subscriptions feed of your signed-in YouTube account so checking stream status for channels added from your subscriptions is lighter',
    ],
    origins: ['https://www.youtube.com/*'],
    defaultOn: true,
    // ログイン中のアカウントのページなので Cookie 付きで取る (本体の YouTube の取得の順番待ちを通す)
    signedIn: true,
    // ページが大きいので、取りに行くのは 2 分に 1 回まで
    minAgeMs: 2 * 60 * 1000,
    // 載るチャンネルが 1 つも無ければ取りに行かない
    onlyIfCovers: true,
    covers: (fav) => PACK_NAMES.includes(fav.pack || ''),
    fetchEntries: async ({ fetchText }) => parse(await fetchText(FEED_URL)),
    parse,
    parseStart,
    packNames: PACK_NAMES,
  });
})();
