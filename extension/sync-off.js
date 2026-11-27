// hakomado: アーカイブ同期の入っていないリリース版 (Chrome ウェブストア・GitHub のリリースの ZIP) で、sync.js の代わりに読み込む (HAKO-51)。
// grid.js が使う Sync・AudioSync の窓口を、「同期していない」と答えるだけの形で持つ。同期の入口 (上部バーの ⏱・☰、
// 設定の「実験的な機能」、ヘルプの「アーカイブの同期再生」、枠の情報の「アーカイブ同期」の列) は出さない。
// 保存の値 expSync が true でも、動かすコードが無いので何も起きない。
// ふだんの開発 (extension/ をそのまま読み込む) では読み込まない。tools/build.js が grid.html の sync.js をこれに差し替える。
// grid.js が sync.js の窓口を新しく使ったら、ここにも足す (tests/sync-off.test.js が確かめる)
/* exported Sync, AudioSync */
'use strict';

const Sync = (() => {
  const hideEntries = () => {
    document.body.classList.add('sync-off');
    for (const id of ['syncToggle', 'syncBar', 'favSelSync']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    for (const b of document.querySelectorAll('[data-help="sync"]')) b.hidden = true;
    const exp = document.getElementById('expSync')?.closest('.settings-col');
    if (exp) exp.hidden = true;
  };
  return {
    setup: hideEntries,
    refresh: hideEntries,
    enabled: () => false,
    built: false, // 同期のコードが入っていない (再生リストの同期・ツアーの案内も出さない)
    startWhenReady: () => {},
    isOn: () => false,
    isMovie: () => false,
    refIfOn: () => null,
    isWaiting: () => false,
    speedGroupOf: () => null,
    setGroupSpeed: () => {},
    groupInfo: () => null,
    seekToAllStarted: () => false,
    showDock: () => {},
    resumePoint: () => null,
    tileStatus: () => ({ ok: false, text: '' }),
  };
})();

const AudioSync = {
  toggle: () => {},
  chunk: () => {},
  blocked: () => {},
  runCount: () => 0,
  hasOutput: () => false,
};
