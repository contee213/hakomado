// アドオン: にじさんじのライブスケジュール (www.nijisanji.jp/streams)
// 公式サイトのスケジュールのページが裏で使っている JSON (/api/streams) を読む。ログインは要らない。
// - ?day_offset=N … 日本時間で今日から N 日後の枠 (0 = 今日)。?now_on_air=true … 今配信中の枠 (前日に始まったものも)
// - 枠: url (YouTube の動画か Twitch)・start-at (ISO 8601、+09:00 付き)・status ('on_air' / 'not_on_air')・
//   channel.name (YouTube のチャンネル名)・channel.thumbnail-url (YouTube のアイコン)。YouTube のチャンネル ID・ハンドルは無いので、
//   表示名・アイコンで本体がチャンネル一覧と突き合わせる
// - にじさんじ・NIJISANJI EN のライバーのメインチャンネルの枠が載る (サブチャンネルは載らないことがある)
// - 公開の API ではない (サイトの作りが変わると読めなくなる)。読めないときは、各チャンネルの RSS だけで調べる
/* global Addons */
'use strict';

(() => {
  const API = 'https://www.nijisanji.jp/api/streams';
  // 配信中 + 今日 + 明日 (本体が使うのは 48 時間先まで。明後日以降はほとんど載らない)
  const QUERIES = ['now_on_air=true', 'day_offset=0', 'day_offset=1'];
  const ICON_RE = /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//;

  /** /api/streams の JSON (文字列) から枠の一覧を読む [{videoId, startAt, live, name, icon}] (YouTube の枠だけ) */
  function parse(text) {
    let list;
    try {
      list = JSON.parse(text);
    } catch {
      throw new Error('hakomado: にじさんじのスケジュールが JSON ではない');
    }
    if (!Array.isArray(list)) throw new Error('hakomado: にじさんじのスケジュールの形が違う');
    const entries = [];
    for (const s of list) {
      if (!s || typeof s !== 'object' || s.platform !== 'youtube') continue;
      const videoId = String(s.url || '').match(/^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/)?.[1];
      const startAt = Date.parse(s['start-at']);
      if (!videoId || !Number.isFinite(startAt)) continue;
      const icon = String(s.channel?.['thumbnail-url'] || '');
      entries.push({
        videoId,
        startAt,
        live: s.status === 'on_air',
        name: typeof s.channel?.name === 'string' ? s.channel.name.trim().slice(0, 200) : '',
        icon: ICON_RE.test(icon) ? icon : '',
      });
    }
    return entries;
  }

  /** 何回かに分けて取ったものを 1 つに (同じ動画は配信中の印があるほうを残す) */
  function merge(lists) {
    const byId = new Map();
    for (const e of lists.flat()) {
      const had = byId.get(e.videoId);
      if (!had || (e.live && !had.live)) byId.set(e.videoId, e);
    }
    return [...byId.values()];
  }

  // ---- 配信者の一覧 (チャンネルパックを作るとき用。tools/make-pack.js が呼ぶ。拡張機能の画面からは呼ばない)
  // /api/livers で今のライバー (卒業した人は除く) の slug を取り、各ライバーのページのデータ
  // (/_next/data/<ビルド ID>/ja/talents/l/<slug>.json) から YouTube のチャンネル ID を読む
  const SITE = 'https://www.nijisanji.jp';
  const GROUPS = [
    { affiliation: 'nijisanji', group: 'にじさんじ', en: false },
    { affiliation: 'nijisanjien', group: 'NIJISANJI EN', en: true },
  ];
  const CHANNEL_RE = /^UC[\w-]{22}$/;
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

  async function listChannels({ fetchText, wait = () => Promise.resolve() }) {
    // ページのデータの置き場所はサイトのビルドごとに変わるので、今のビルド ID をページから読む
    const buildId = (await fetchText(`${SITE}/streams`)).match(/"buildId":"([\w-]+)"/)?.[1];
    if (!buildId) throw new Error('hakomado: にじさんじのサイトのビルド ID が分からない');
    const out = [];
    for (const g of GROUPS) {
      const livers = JSON.parse(
        await fetchText(`${SITE}/api/livers?limit=300&orderKey=subscriber_count&order=desc&affiliation=${g.affiliation}&locale=ja&includeAll=false`),
      );
      if (!Array.isArray(livers)) throw new Error('hakomado: にじさんじのライバーの一覧の形が違う');
      for (const l of livers) {
        if (!l || l.hidden || !SLUG_RE.test(l.slug || '')) continue;
        await wait();
        const d = JSON.parse(await fetchText(`${SITE}/_next/data/${buildId}/ja/talents/l/${l.slug}.json`))?.pageProps?.liverDetail;
        // unit = ユニット・公式のチャンネル (配信者ひとりのチャンネルではない) は入れない
        if (!d || d.unit || !CHANNEL_RE.test(d.channelId || '')) continue;
        out.push({ channelId: d.channelId, name: (g.en ? d.enName || d.name : d.name || d.enName || '').trim(), group: g.group });
      }
    }
    return out;
  }

  Addons.register({
    id: 'nijisanji',
    type: 'schedule',
    name: ['にじさんじ', 'NIJISANJI'],
    note: [
      'にじさんじ公式サイトのライブスケジュールを読み込み、にじさんじのパックのチャンネルの配信状況の確認を軽くします',
      'Loads the live schedule from the NIJISANJI website so checking stream status for NIJISANJI pack channels is lighter',
    ],
    origins: ['https://www.nijisanji.jp/*'],
    defaultOn: false,
    // にじさんじのチャンネルパック (名前に「にじさんじ」/「NIJISANJI」が入るもの) から足したチャンネル
    covers: (fav) => /にじさんじ|nijisanji/i.test(fav.pack || ''),
    // 1 つでも取れなければ失敗にする (一部だけだと、載っていない = 予定なしと見なしてしまうため。そのときは RSS だけで調べる)
    fetchEntries: async ({ fetchText }) => merge(await Promise.all(QUERIES.map((q) => fetchText(`${API}?${q}`).then(parse)))),
    parse,
    listChannels,
    // listChannels から作るチャンネルパック (tools/make-pack.js)。name は covers の条件 (「にじさんじ」が入る) に合わせる
    pack: {
      file: 'nijisanji.json',
      name: 'にじさんじ',
      nameEn: 'NIJISANJI',
      description: 'にじさんじ・NIJISANJI EN のライバーのメインチャンネル (公式サイトのライバー一覧から作成。卒業した方は含みません)。アドオン「にじさんじ」と組み合わせると配信状況の確認が軽くなります',
      descriptionEn: 'Main channels of NIJISANJI and NIJISANJI EN livers (made from the talent list on the official website; graduated livers not included). Pairs with the NIJISANJI add-on to make stream checks lighter',
    },
  });
})();
