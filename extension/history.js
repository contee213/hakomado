// hakomado: 視聴履歴。この拡張機能の枠で読み込んだ配信・動画を新しい順に 100 件まで残す。
// 保存先は chrome.storage.local なので、どのタブで見たものも同じ履歴に入る (このパソコンの中だけ)。
// 枠から外れたときは理由 (配信終了 / ✕ で閉じた / メンバー限定 / 入れ替え) も書き足し、
// 勝手に消えた・間違えて閉じた配信を履歴から戻せるようにする。
// 視聴履歴・あとで見るで共通: 保存されている 1 件が正しい形か (壊れたデータや古い版のデータで一覧が止まらないように) と、
// 残す項目だけを取り出す (長すぎる文字は切る)
const VideoEntry = (() => {
  'use strict';
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const KINDS = ['live', 'video', 'short'];
  const valid = (h) => h && typeof h === 'object' && typeof h.videoId === 'string' && VIDEO_ID_RE.test(h.videoId);
  const pick = (info) => {
    const out = {};
    for (const k of ['title', 'channel', 'handle', 'channelId', 'label', 'input']) {
      if (typeof info?.[k] === 'string' && info[k]) out[k] = info[k].slice(0, 300);
    }
    // 種類 (ライブラリの種類の絞り込み用): live = 配信 (アーカイブ・配信中・配信予定) / video = 動画 / short = ショート
    if (KINDS.includes(info?.kind)) out.kind = info.kind;
    return out;
  };
  return { valid, pick };
})();

const WatchHistory = (() => {
  'use strict';
  const { valid, pick } = VideoEntry;

  const KEY = 'history';
  const MAX = 100;
  // 外れた理由
  //   ended    = 配信が終わった / 最後まで再生した
  //   closed   = 枠の ✕ で閉じた
  //   members  = メンバー限定で見られなかった
  //   replaced = 自動再生の入れ替えや、同じ枠に別の配信を読み込んだ
  const REASONS = ['ended', 'closed', 'members', 'replaced'];

  // 読み書きを 1 本の列に並べる (読んでから書くまでの間に別の書き込みが割り込まないように)。
  // このタブの中は promise の列、タブ間はロックで順番待ちにする (複数のタブを同時に開き直したときなど)
  let chain = Promise.resolve();
  function mutate(fn) {
    const run = async () => {
      const next = fn(await list());
      if (next) await chrome.storage.local.set({ [KEY]: next.slice(0, MAX) });
    };
    chain = chain
      .then(() => navigator.locks.request('hakomado-history', run))
      .catch((e) => console.warn('hakomado: 履歴の保存に失敗', e));
    return chain;
  }



  /** 新しい順の一覧 */
  async function list() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    return Array.isArray(raw) ? raw.filter(valid) : [];
  }

  /** 枠に読み込んだ: 先頭に移して日時を更新 (前に外れた理由は消す) */
  function opened(videoId, info) {
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return chain; // YouTube の動画だけ残す (Twitch の枠 tw:… は残さない)
    return mutate((list) => {
      const prev = list.find((h) => h.videoId === videoId);
      const { reason, removedAt, ...keep } = prev || {};
      const entry = { ...keep, ...pick(info), videoId, at: Date.now() };
      return [entry, ...list.filter((h) => h.videoId !== videoId)];
    });
  }

  /** タイトルやチャンネル名が分かった (並び順は変えない) */
  function update(videoId, info) {
    if (!videoId) return chain;
    const add = pick(info);
    if (!Object.keys(add).length) return chain;
    return mutate((list) => {
      const h = list.find((x) => x.videoId === videoId);
      if (!h || Object.entries(add).every(([k, v]) => h[k] === v)) return null;
      Object.assign(h, add);
      return list;
    });
  }

  /** 枠から外れた理由を書き足す */
  function removed(videoId, reason) {
    if (!videoId || !REASONS.includes(reason)) return chain;
    return mutate((list) => {
      const h = list.find((x) => x.videoId === videoId);
      if (!h) return null;
      Object.assign(h, { reason, removedAt: Date.now() });
      return list;
    });
  }

  /** 1 件消す */
  function remove(videoId) {
    return mutate((list) => list.filter((h) => h.videoId !== videoId));
  }

  /** 全部消す */
  function clear() {
    return mutate(() => []);
  }

  return { KEY, list, opened, update, removed, remove, clear };
})();

// hakomado: あとで見る (ライブラリの「🔖 あとで見る」タブ)。枠のバーの 🔖 や視聴履歴から、自分で選んだものを入れる。
// 最後まで再生するか 🔖 を外すと消える。履歴と違って古いものから勝手には消えず、100 件でいっぱいになったら外すまで増やせない。
// 保存先は chrome.storage.local (すべてのタブで共通)。
const SavedVideos = (() => {
  'use strict';
  const { valid, pick } = VideoEntry;

  const KEY = 'saved';
  const MAX = 100;

  // 読み書きの順番待ち (履歴と同じく、このタブの中は promise の列、タブ間はロック)
  let chain = Promise.resolve();
  function mutate(fn) {
    let result;
    const run = async () => {
      const r = fn(await list());
      if (!r) return;
      result = r.result;
      if (r.next) await chrome.storage.local.set({ [KEY]: r.next });
    };
    chain = chain
      .then(() => navigator.locks.request('hakomado-saved', run))
      .catch((e) => console.warn('hakomado: 保存の書き込みに失敗', e));
    return chain.then(() => result);
  }

  /** 保存した新しい順の一覧 */
  async function list() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    return Array.isArray(raw) ? raw.filter(valid).slice(0, MAX) : [];
  }

  /**
   * 保存する / 外す (入っていれば外す)。
   * @returns {Promise<'saved'|'removed'|'full'|undefined>} full = いっぱいで保存できなかった
   */
  function toggle(videoId, info) {
    if (!videoId) return Promise.resolve();
    return mutate((list) => {
      if (list.some((h) => h.videoId === videoId)) {
        return { next: list.filter((h) => h.videoId !== videoId), result: 'removed' };
      }
      if (list.length >= MAX) return { result: 'full' };
      return { next: [{ ...pick(info), videoId, at: Date.now() }, ...list], result: 'saved' };
    });
  }

  /** タイトルやチャンネル名が分かった (保存しているものだけ。並び順は変えない) */
  function update(videoId, info) {
    const add = pick(info);
    if (!videoId || !Object.keys(add).length) return chain;
    return mutate((list) => {
      const h = list.find((x) => x.videoId === videoId);
      // 自分で付けた名前 (label) などは上書きせず、まだ無いものだけ足す
      const missing = Object.entries(add).filter(([k]) => !h?.[k]);
      if (!h || !missing.length) return null;
      Object.assign(h, Object.fromEntries(missing));
      return { next: list };
    });
  }

  /** 1 件外す */
  function remove(videoId) {
    return mutate((list) => ({ next: list.filter((h) => h.videoId !== videoId) }));
  }

  return { KEY, MAX, list, toggle, update, remove };
})();
