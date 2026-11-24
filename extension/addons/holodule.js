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
  });
})();
