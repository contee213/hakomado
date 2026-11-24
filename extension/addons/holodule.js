// アドオン: ホロジュール (schedule.hololive.tv)
// ホロライブ所属の全員分の配信予定が 1 ページで分かるので、既定のチャンネル (ホロライブ) は RSS を見に行く間隔を長くできる。
// OFF にしても、どのチャンネルも RSS だけで配信状況を調べる (少し重くなるだけ)
// 1 ページに前日〜翌日の配信予定が載っている。配信中の枠には赤い枠線 (border: 3px red) が付く。時刻は日本時間
/* global Addons */
'use strict';

(() => {
  const SCHEDULE_URL = 'https://schedule.hololive.tv/lives';

  /** ホロジュールのページから枠の一覧を読む [{videoId, startAt, live, name, icon}] */
  function parse(html) {
    // 各枠には onclick="gtag(...)" が付いている。DOMParser は読み込むだけでも
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
        icon: el.querySelector('img[src*="yt3."]')?.getAttribute('src') || '',
      });
    }
    return entries;
  }

  // ---- 配信者の一覧 (チャンネルパックを作るとき用。tools/make-pack.js が呼ぶ。拡張機能の画面からは呼ばない)
  // ホロジュールにはタレントの一覧が無いので、公式サイトのタレント一覧 (hololive.hololivepro.com/talents) を読む
  // (pack.origins。拡張機能はここへは通信しないので、manifest.json の権限には入れない)。
  // 各タレントのページの YouTube へのリンクからチャンネル ID を、パンくずの「gp」(グループ) から group を読む。卒業生 (gp=alum) は除く
  const TALENTS = 'https://hololive.hololivepro.com/talents';
  // 公式サイトのグループ (gp) → パック・初期データ (presets.js) での書き方。知らない gp はサイトの表記のまま
  const GROUP_NAMES = {
    'gen-0': '0期生', '1stgen': '1期生', 'gen-2': '2期生', 'gen-3': '3期生', 'gen-4': '4期生', 'gen-5': '5期生',
    gamers: 'ゲーマーズ', holox: 'holoX', regloss: 'ReGLOSS', 'flow-glow': 'FLOW GLOW', 'asobi-mawari-tai': 'アソビ★まわり隊！',
    holoan: 'holoAN', area15: 'ID 1期生 AREA15', holoro: 'ID 2期生 holoro', holoh3ro: 'ID 3期生 holoh3ro',
    myth: 'EN Myth', 'project-hope': 'EN Project: HOPE', council: 'EN Council / Promise', promise: 'EN Council / Promise',
    advent: 'EN Advent', justice: 'EN Justice',
  };
  // タレント一覧に載らない公式のチャンネル (初期データと同じもの)
  const OFFICIAL = [
    ['UCJFZiqLMntJufDCHc6bQixg', 'ホロライブ公式'],
    ['UCotXwY6s8pWmuWd_snKYjhg', 'hololive English'],
    ['UCfrWoRGlawPQDQxxeIDRP0Q', 'hololive Indonesia'],
    ['UC10wVt6hoQiwySRhz7RdOUA', 'ReGLOSS 公式'],
    ['UCu2n3qHuOuQIygREMnWeQWg', 'FLOW GLOW 公式'],
    ['UCAHwWUotyS3l2qBetFDsjgQ', 'アソビ★まわり隊！ 公式'],
    ['UCmms2EE02mK4zdECwrHBpaA', 'ホロカ公式 (OFFICIAL CARD GAME)'],
    ['UCawGfU44CZxd2ZVf_VGijbA', 'ホロドリ (hololive Dreams)'],
  ];
  const TALENT_LINK_RE = /href="https:\/\/hololive\.hololivepro\.com\/talents\/([a-z0-9-]+)\/"/g;
  const slugsIn = (html) => [...new Set([...html.matchAll(TALENT_LINK_RE)].map((m) => m[1]))];
  const decodeText = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

  /**
   * タレントのページから {channelId か handle, name, group} (読めなければ null。配信活動を終えた人も null)。
   * YouTube へのリンクは /channel/UC… のことも /@ハンドル のこともある (ハンドルだけのときは tools/make-pack.js が ID を調べる)
   */
  function parseTalent(html) {
    const sns = html.match(/<ul class="t_sns[^"]*">([\s\S]*?)<\/ul>/)?.[1] || '';
    const yt = sns.match(/href="https:\/\/(?:www\.)?youtube\.com\/(channel\/(UC[\w-]{22})|@([^"?/\s]+))/);
    // 名前: <h1> 赤井はあと<span>Akai Haato</span> </h1> の前半
    const rawName = html.match(/<h1>\s*([^<]+?)\s*<span>/)?.[1];
    if (!yt || !rawName) return null;
    const name = decodeText(rawName);
    if (/^【/.test(name)) return null; // 【配信活動終了】など
    const gps = [...html.matchAll(/talents\?gp=([a-z0-9-]+)" class="taxonomy gp"\s*><span property="name">([^<]*)</g)];
    const gp = gps.at(-1);
    const out = { name, group: gp ? GROUP_NAMES[gp[1]] || decodeText(gp[2]) : '' };
    if (yt[2]) out.channelId = yt[2];
    else out.handle = `@${decodeURIComponent(yt[3])}`;
    return out;
  }

  async function listChannels({ fetchText, wait = () => Promise.resolve() }) {
    const alum = new Set(slugsIn(await fetchText(`${TALENTS}?gp=alum`)));
    const slugs = slugsIn(await fetchText(TALENTS)).filter((s) => !alum.has(s));
    if (!slugs.length) throw new Error('hakomado: ホロライブのタレント一覧が読めない');
    const out = [];
    for (const slug of slugs) {
      await wait();
      const t = parseTalent(await fetchText(`${TALENTS}/${slug}/`));
      if (t) out.push(t);
    }
    for (const [channelId, name] of OFFICIAL) out.push({ channelId, name, group: '公式' });
    return out;
  }

  Addons.register({
    id: 'holodule',
    type: 'schedule',
    name: ['ホロジュール', 'Holodule'],
    note: [
      'ホロライブの配信予定をまとめて読み込み、配信状況の確認を軽くします',
      'Loads the hololive stream schedule in one go so checking stream status is lighter',
    ],
    origins: ['https://schedule.hololive.tv/*'],
    defaultOn: true,
    // 既定のチャンネル (presets.js。ホロライブ所属) と、ホロライブのチャンネルパックから足したチャンネルは全員ホロジュールに載る
    covers: (fav) => !!fav.preset || /ホロライブ|hololive/i.test(fav.pack || ''),
    fetchEntries: async ({ fetchText }) => parse(await fetchText(SCHEDULE_URL)),
    parse,
    listChannels,
    parseTalent,
    // listChannels から作るチャンネルパック (tools/make-pack.js)。中身は初期データ (presets.js) と同じチャンネルにそろえる
    pack: {
      file: 'hololive.json',
      origins: ['https://hololive.hololivepro.com/*'],
      name: 'ホロライブ',
      nameEn: 'hololive',
      description: '同梱のホロライブ (初期データ) と同じ内容です。同梱版を外したあとに入れ直すときや、パックの見本として',
      descriptionEn: 'The same channels as the bundled hololive data. Use it to add them back after removing the bundled ones, or as a sample pack',
    },
  });
})();
