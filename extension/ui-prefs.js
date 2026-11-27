// hakomado: 画面の小さな覚え (絞り込み・最後に開いた再生リスト・共有画像の作者名・同期の調整の帯の高さなど)。すべてのタブで共通 (保存先は chrome.storage.local)。
// 画面を開いたときに load() でまとめて読んでおき、あとは get() で同期して読む。ほかのタブで変わったら storage.onChanged で覚え直す。
// 以前の版は localStorage の 'hakomado.<名前>' に置いていた。load() で引き継いで localStorage から消す
// (表示言語 'hakomado.lang' だけは、画面を描く前に同期して読みたいので、i18n.js が localStorage に置いたまま)
/* exported UiPrefs */
'use strict';

const UiPrefs = (() => {
  const PREFIX = 'ui:'; // chrome.storage.local のキーは 'ui:<名前>'
  const LEGACY_PREFIX = 'hakomado.'; // 以前の版の localStorage のキー
  // 名前 → 以前の版の localStorage の文字列を、今の値に直す
  const NAMES = {
    libScope: String, // チャンネル一覧の すべて / ピックアップ
    libKinds: (s) => JSON.parse(s), // 種類の絞り込み (配列)
    libPlaylist: String, // 最後に開いていた再生リストの id
    shareImgLabels: (s) => s === '1', // 共有画像に枠の名前を入れるか
    shareAuthor: String, // 共有画像に描く作者名
    waveH: Number, // 〰 波形の帯の高さ (ドット。HAKO-39。以前の版には無い)
    waveRuler: String, // 〰 波形の帯の目盛り 'elapsed' (経過時間) / 'clock' (時刻) (HAKO-39。以前の版には無い)
  };
  // 以前の版で localStorage に覚えていた、最後に開いたタブの位置。今は grid.js の TabMemory (sessionStorage) に置くので、引き継がずに消す
  // 同期の調整パネルの置き方 (syncDock) も、パネルを無くした (HAKO-48) ので消す
  const DROPPED = ['settingsTab', 'libTab', 'shareTab', 'syncDock'];
  // 使わなくなった chrome.storage の覚え ('ui:<名前>')。読んだときに消す (取り戻す必要は無い)
  const GONE = ['syncDock'];
  const known = (name) => Object.hasOwn(NAMES, name);
  let cache = {};

  /** 覚えをまとめて読む (画面を開いたときに 1 回)。以前の版で localStorage に覚えていたものは引き継ぐ */
  async function load() {
    const keys = Object.keys(NAMES).map((n) => PREFIX + n);
    let got = {};
    try {
      got = await chrome.storage.local.get(keys);
    } catch (e) {
      console.warn('hakomado: 画面の覚えを読めない', e);
    }
    cache = {};
    for (const n of Object.keys(NAMES)) if (got[PREFIX + n] !== undefined) cache[n] = got[PREFIX + n];
    chrome.storage.local.remove(GONE.map((n) => PREFIX + n)).catch(() => {}); // 消せなくても、使わないだけ

    const moved = {};
    const legacy = [];
    try {
      for (const n of DROPPED) if (localStorage.getItem(LEGACY_PREFIX + n) != null) legacy.push(LEGACY_PREFIX + n);
      for (const [n, decode] of Object.entries(NAMES)) {
        const s = localStorage.getItem(LEGACY_PREFIX + n);
        if (s == null) continue;
        legacy.push(LEGACY_PREFIX + n);
        if (n in cache) continue; // chrome.storage にあるほうが新しい
        try {
          cache[n] = moved[PREFIX + n] = decode(s);
        } catch {
          /* 読めない値は引き継がない */
        }
      }
    } catch {
      return; // localStorage が使えなければ、引き継ぐものも無い
    }
    if (!legacy.length) return;
    try {
      if (Object.keys(moved).length) await chrome.storage.local.set(moved);
      for (const k of legacy) localStorage.removeItem(k); // 書けてから消す
    } catch (e) {
      console.warn('hakomado: 画面の覚えを引き継げない', e);
    }
  }

  /** 覚えている値 (無ければ undefined) */
  const get = (name) => (known(name) ? cache[name] : undefined);

  /** 覚える (書き込みは待たない。書けなくても画面は動く) */
  function set(name, value) {
    if (!known(name)) return;
    cache[name] = value;
    chrome.storage.local.set({ [PREFIX + name]: value }).catch((e) => console.warn('hakomado: 画面の覚えを書けない', e));
  }

  // ほかのタブで変わったら覚え直す (次にその画面を開いたときに使う。localStorage のときと同じ)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const n of Object.keys(NAMES)) {
      const c = changes[PREFIX + n];
      if (!c) continue;
      if (c.newValue === undefined) delete cache[n];
      else cache[n] = c.newValue;
    }
  });

  return { PREFIX, load, get, set };
})();
