// アドオン: STPR (すとぷり・騎士X・AMPTAKxCOLORS・めておら・すにすて・とぅるりぷ など) の配信予定 (schedule.stpr.com)
// 公式の配信予定のページが読んでいる JSON (S3 の schedule_v2.json) を読む。ログインは要らない。1 回で全員分が取れる
// - {last_updated, items: [{date: 'アーカイブ' | 'YYYY-MM-DD', items: [枠…]}]}。今日から 1 週間ほど先までの枠が日付ごとに入る
// - 枠: serviceKind ('youtube' / 'twitcasting' / 'twitch')・channelId (YouTube のチャンネル ID)・channelTitle・videoId・
//   scheduledStartTime (ISO 8601、+09:00 付き)・status ('live' / 'upcoming' / 'completed')・channelThumbnails.url
// - 公開の API ではない (サイトの作りが変わると読めなくなる)。読めないときは、各チャンネルの RSS だけで調べる
// - S3 の CORS は schedule.stpr.com だけに開いているので、拡張機能からはホストの権限で読む
/* global Addons */
'use strict';

(() => {
  const SCHEDULE_URL = 'https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/schedule/schedule_v2.json';
  const ICON_RE = /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//;
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
  const CHANNEL_RE = /^UC[\w-]{22}$/;

  /** schedule_v2.json (文字列) から枠の一覧を読む [{videoId, startAt, live, channelId?, name, icon}] (YouTube の配信中・予定の枠だけ) */
  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('hakomado: STPR の配信予定が JSON ではない');
    }
    if (!Array.isArray(data?.items)) throw new Error('hakomado: STPR の配信予定の形が違う');
    const entries = [];
    const seen = new Set();
    for (const day of data.items) {
      for (const s of Array.isArray(day?.items) ? day.items : []) {
        if (!s || typeof s !== 'object' || s.serviceKind !== 'youtube') continue;
        if (s.status !== 'live' && s.status !== 'upcoming') continue;
        const videoId = String(s.videoId || '');
        const startAt = Date.parse(s.scheduledStartTime);
        if (!VIDEO_RE.test(videoId) || !Number.isFinite(startAt) || seen.has(videoId)) continue;
        seen.add(videoId);
        const icon = String(s.channelThumbnails?.url || '');
        const e = {
          videoId,
          startAt,
          live: s.status === 'live',
          name: typeof s.channelTitle === 'string' ? s.channelTitle.trim().slice(0, 200) : '',
          icon: ICON_RE.test(icon) ? icon : '',
        };
        if (CHANNEL_RE.test(s.channelId || '')) e.channelId = s.channelId;
        entries.push(e);
      }
    }
    return entries;
  }

  // ---- 配信者の一覧 (チャンネルパックを作るとき用。tools/make-pack.js が呼ぶ。拡張機能の画面からは呼ばない)
  // 配信予定のサイトには所属の一覧が無いので、公式サイト (www.stpr.com) を読む (pack.origins。拡張機能はここへは通信しないので、
  // manifest.json の権限には入れない)。どのページにもあるメニュー (<div class="creator-grid">) にグループとメンバーが並ぶ。
  // 各メンバー・グループのページ (/artist/detail/<番号>) の <ul class="list--sns"> の YouTube へのリンクからチャンネルを読む
  const SITE = 'https://www.stpr.com';
  // メンバー・グループのページに YouTube へのリンクが無い公式のチャンネル
  const OFFICIAL = [['UCdB5vhQORw9HeiF82IYLnjw', 'すとぷりちゃんねる', 'すとぷり']];
  const decodeText = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  // 「騎士X - Knight X -」「とぅるりぷ -True&Lip」→ 騎士X・とぅるりぷ。グループに入っていない人は「STPR」
  const groupName = (s, notGroup) => (notGroup ? 'STPR' : decodeText(s).split(/\s+-/)[0].trim() || decodeText(s));

  /** メニューからグループ [{group, id (グループのページ。無ければ null), members: [{id, name}]}] */
  function parseMenu(html) {
    const out = [];
    for (const part of String(html).split(/<div class="creator-grid">/).slice(1)) {
      const g = part.match(/<a href="([^"]*)" class="name-group( not-group)?">([^<]*)<\/a>/);
      if (!g) continue;
      const list = part.match(/<ul class="list--menu__creator">([\s\S]*?)<\/ul>/)?.[1] || '';
      const members = [...list.matchAll(/href="https:\/\/www\.stpr\.com\/artist\/detail\/(\d{1,6})">([^<]*)</g)].map((m) => ({ id: m[1], name: decodeText(m[2]) }));
      out.push({ group: groupName(g[3], !!g[2]), id: g[1].match(/\/artist\/detail\/(\d{1,6})$/)?.[1] || null, members });
    }
    return out;
  }

  /** メンバー・グループのページの YouTube へのリンク → {channelId} か {handle} (無ければ null) */
  function parseArtist(html) {
    const sns = String(html).match(/<ul class="list--sns">([\s\S]*?)<\/ul>/)?.[1] || '';
    const yt = sns.match(/href="https:\/\/(?:www\.)?youtube\.com\/(channel\/(UC[\w-]{22})|@([^"?/\s]+))/);
    if (!yt) return null;
    return yt[2] ? { channelId: yt[2] } : { handle: `@${decodeURIComponent(yt[3])}` };
  }

  async function listChannels({ fetchText, wait = () => Promise.resolve() }) {
    const groups = parseMenu(await fetchText(`${SITE}/`));
    if (!groups.some((g) => g.members.length)) throw new Error('hakomado: STPR の所属の一覧が読めない');
    const out = [];
    for (const g of groups) {
      // グループのチャンネル (あれば) を先に、続けてメンバー
      for (const a of [...(g.id ? [{ id: g.id, name: g.group }] : []), ...g.members]) {
        await wait();
        const yt = parseArtist(await fetchText(`${SITE}/artist/detail/${a.id}`));
        if (yt) out.push({ ...yt, name: a.name, group: g.group });
      }
    }
    for (const [channelId, name, group] of OFFICIAL) out.push({ channelId, name, group });
    return out;
  }

  Addons.register({
    id: 'stpr',
    type: 'schedule',
    name: ['STPR (すとぷり)', 'STPR'],
    note: [
      'STPR (すとぷり・騎士X・AMPTAKxCOLORS・めておら・すにすて・とぅるりぷ など) の公式の配信予定を読み込み、STPR のパックのチャンネルの配信状況の確認を軽くします',
      'Loads the official STPR stream schedule (Strawberry Prince, Knight X, AMPTAKxCOLORS, Meteorites and more) so checking stream status for STPR pack channels is lighter',
    ],
    origins: ['https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/*'],
    defaultOn: false,
    // STPR のチャンネルパック (名前に「STPR」/「すとぷり」が入るもの) から足したチャンネル
    covers: (fav) => /stpr|すとぷり/i.test(fav.pack || ''),
    fetchEntries: async ({ fetchText }) => parse(await fetchText(SCHEDULE_URL)),
    parse,
    listChannels,
    parseMenu,
    parseArtist,
    // listChannels から作るチャンネルパック (tools/make-pack.js)。name は covers の条件 (「STPR」が入る) に合わせる
    pack: {
      file: 'stpr.json',
      origins: ['https://www.stpr.com/*'],
      name: 'STPR (すとぷり)',
      nameEn: 'STPR',
      description: 'STPR 所属のクリエイターとグループのチャンネル (すとぷり・騎士X・AMPTAKxCOLORS・めておら・すにすて・とぅるりぷ など。公式サイトから作成)。アドオン「STPR (すとぷり)」と組み合わせると配信状況の確認が軽くなります',
      descriptionEn: 'Channels of STPR creators and groups (Strawberry Prince, Knight X, AMPTAKxCOLORS, Meteorites, SneakerStep, True&Lip and more; made from the official website). Pairs with the STPR add-on to make stream checks lighter',
    },
  });
})();
