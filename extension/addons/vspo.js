// アドオン: ぶいすぽっ!の配信スケジュール (www.vspo-schedule.com。有志による非公式のサイト)
// ページ (Next.js) に埋め込まれた枠のデータ (self.__next_f.push([1,"…"]) の文字列) を読む。ログインは要らない。
// - /schedule/live … 配信中の枠、/schedule/upcoming … これからの枠 (翌日以降も)。/schedule/all は今日の分だけなので使わない
// - 枠: {"id":"<動画 ID>","type":…,"platform":"youtube"|"twitch"|…,"channelId":"UC…","channelTitle":…,
//   "channelThumbnailUrl":…,"status":"live"|"upcoming"|"ended","scheduledStartTime":"…Z",…}。YouTube のチャンネル ID が入っている
// - ぶいすぽっ!・VSPO! EN のメンバーの枠が載る (Twitch などの枠もあるが、YouTube の枠だけ使う)
// - 公開の API ではない (サイトの作りが変わると読めなくなる)。読めないときは、各チャンネルの RSS だけで調べる
/* global Addons */
'use strict';

(() => {
  const SITE = 'https://www.vspo-schedule.com';
  const PAGES = ['/schedule/live', '/schedule/upcoming'];
  const ICON_RE = /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//;
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
  const CHANNEL_RE = /^UC[\w-]{22}$/;
  const MAX_OBJECT = 50000; // 1 枠のデータの長さの上限 (説明文が埋め込まれていても足りる長さ)

  /** ページの埋め込みデータ (self.__next_f.push([1,"…"]) の文字列) をつなげる */
  function flightText(html) {
    const parts = [];
    for (const m of String(html).matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\[\s\S])*")\]\)/g)) {
      try {
        parts.push(JSON.parse(m[1]));
      } catch {
        // 読めない断片は飛ばす
      }
    }
    return parts.join('');
  }

  /** text の start から始まる JSON のオブジェクト ({…}) を切り出して読む (読めなければ null) */
  function readObject(text, start) {
    let depth = 0;
    let inStr = false;
    const end = Math.min(text.length, start + MAX_OBJECT);
    for (let i = start; i < end; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /** スケジュールのページ (HTML) から枠の一覧を読む [{videoId, startAt, live, channelId, name, icon}] (YouTube の配信中・予定の枠だけ) */
  function parse(html) {
    const text = flightText(html);
    if (!text) throw new Error('hakomado: ぶいすぽっ!のスケジュールのデータが見つからない');
    const entries = [];
    const seen = new Set();
    for (const m of text.matchAll(/\{"id":"([A-Za-z0-9_-]{11})","type":/g)) {
      const s = readObject(text, m.index);
      if (!s || s.platform !== 'youtube' || !VIDEO_RE.test(s.id) || seen.has(s.id)) continue;
      if (s.status !== 'live' && s.status !== 'upcoming') continue;
      const startAt = Date.parse(s.scheduledStartTime);
      if (!Number.isFinite(startAt)) continue;
      seen.add(s.id);
      const icon = String(s.channelThumbnailUrl || '');
      const e = {
        videoId: s.id,
        startAt,
        live: s.status === 'live',
        name: typeof s.channelTitle === 'string' ? s.channelTitle.trim().slice(0, 200) : '',
        icon: ICON_RE.test(icon) ? icon : '',
      };
      if (CHANNEL_RE.test(s.channelId || '')) e.channelId = s.channelId;
      entries.push(e);
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
  // スケジュールのサイトにはメンバーの一覧が無いので、公式サイトのメンバー紹介 (vspo.jp/member/) を読む
  // (pack.origins。拡張機能はここへは通信しないので、manifest.json の権限には入れない)。
  // 1 ページに全員が載る。各メンバーの <li class="… member__single__item --<id> --japanese|--english" data-name="…"> の中の
  // YouTube へのリンク (/channel/UC… か /@ハンドル) を読む
  const MEMBERS = 'https://vspo.jp/member/';
  // メンバー紹介に載らない公式のチャンネル (スケジュールのサイトに枠が載る)
  const OFFICIAL = [['UCuI5XaO-6VkOEhHao6ij7JA', 'ぶいすぽっ!【公式】']];
  const decodeText =(s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

  /** メンバー紹介のページから [{channelId か handle, name, group}] */
  function parseMembers(html) {
    const out = [];
    for (const part of String(html).split(/<li\s+class="[^"]*\bmember__single__item\b/).slice(1)) {
      const cls = part.match(/^([^"]*)"/)?.[1] || '';
      const rawName = part.match(/\bdata-name="([^"]*)"/)?.[1];
      const yt = part.match(/href="https:\/\/(?:www\.)?youtube\.com\/(channel\/(UC[\w-]{22})|@([^"?/\s]+))/);
      if (!rawName || !yt) continue;
      // 公式サイトは「花芽 すみれ」のように姓と名の間に空白を入れる。チャンネル名・パックでは詰める
      const name = decodeText(rawName).replace(/ /g, '');
      const c = { name, group: /--english\b/.test(cls) ? 'VSPO! EN' : 'ぶいすぽっ!' };
      if (yt[2]) c.channelId = yt[2];
      else c.handle = `@${decodeURIComponent(yt[3])}`;
      out.push(c);
    }
    return out;
  }

  async function listChannels({ fetchText }) {
    const out = parseMembers(await fetchText(MEMBERS));
    if (!out.length) throw new Error('hakomado: ぶいすぽっ!のメンバーの一覧が読めない');
    for (const [channelId, name] of OFFICIAL) out.push({ channelId, name, group: '公式' });
    return out;
  }

  Addons.register({
    id: 'vspo',
    type: 'schedule',
    name: ['ぶいすぽっ!', 'VSPO!'],
    note: [
      'ぶいすぽっ!の配信スケジュール (有志の非公式サイト vspo-schedule.com) を読み込み、ぶいすぽっ!のパックのチャンネルの配信状況の確認を軽くします',
      'Loads the VSPO! stream schedule (vspo-schedule.com, an unofficial fan site) so checking stream status for VSPO! pack channels is lighter',
    ],
    origins: ['https://www.vspo-schedule.com/*'],
    defaultOn: false,
    // ぶいすぽっ!のチャンネルパック (名前に「ぶいすぽ」/「VSPO」が入るもの) から足したチャンネル
    covers: (fav) => /ぶいすぽ|vspo/i.test(fav.pack || ''),
    // 両方取れなければ失敗にする (一部だけだと、載っていない = 予定なしと見なしてしまうため。そのときは RSS だけで調べる)
    fetchEntries: async ({ fetchText }) => merge(await Promise.all(PAGES.map((p) => fetchText(`${SITE}${p}`).then(parse)))),
    parse,
    listChannels,
    parseMembers,
    // listChannels から作るチャンネルパック (tools/make-pack.js)。name は covers の条件 (「ぶいすぽ」が入る) に合わせる
    pack: {
      file: 'vspo.json',
      origins: ['https://vspo.jp/*'],
      name: 'ぶいすぽっ!',
      nameEn: 'VSPO!',
      description: 'ぶいすぽっ!・VSPO! EN のメンバーのチャンネル (公式サイトのメンバー紹介から作成)。アドオン「ぶいすぽっ!」と組み合わせると配信状況の確認が軽くなります',
      descriptionEn: 'Channels of VSPO! and VSPO! EN members (made from the member list on the official website). Pairs with the VSPO! add-on to make stream checks lighter',
    },
  });
})();
