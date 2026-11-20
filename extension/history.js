// hukumado: 視聴履歴。この拡張機能の枠で読み込んだ配信・動画を新しい順に 100 件まで残す。
// 保存先は chrome.storage.local なので、どのタブで見たものも同じ履歴に入る (このパソコンの中だけ)。
// 枠から外れたときは理由 (配信終了 / ✕ で閉じた / メンバー限定 / 入れ替え) も書き足し、
// 勝手に消えた・間違えて閉じた配信を履歴から戻せるようにする。
const WatchHistory = (() => {
  'use strict';

  const KEY = 'history';
  const MAX = 100;
  // 外れた理由
  //   ended    = 配信が終わった / 最後まで再生した
  //   closed   = 枠の ✕ で閉じた
  //   members  = メンバー限定で見られなかった
  //   replaced = 自動再生の入れ替えや、同じ枠に別の配信を読み込んだ
  const REASONS = ['ended', 'closed', 'members', 'replaced'];

  // 読み書きを 1 本の列に並べる (このタブ内で、読んでから書くまでの間に別の書き込みが割り込まないように)
  let chain = Promise.resolve();
  function mutate(fn) {
    chain = chain
      .then(async () => {
        const { [KEY]: raw } = await chrome.storage.local.get(KEY);
        const list = Array.isArray(raw) ? raw.filter((h) => h && typeof h.videoId === 'string') : [];
        const next = fn(list);
        if (next) await chrome.storage.local.set({ [KEY]: next.slice(0, MAX) });
      })
      .catch((e) => console.warn('hukumado: 履歴の保存に失敗', e));
    return chain;
  }

  const pick = (info) => {
    const out = {};
    for (const k of ['title', 'channel', 'handle', 'label', 'input']) {
      if (typeof info?.[k] === 'string' && info[k]) out[k] = info[k].slice(0, 300);
    }
    return out;
  };

  /** 新しい順の一覧 */
  async function list() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    return Array.isArray(raw) ? raw.filter((h) => h && typeof h.videoId === 'string') : [];
  }

  /** 枠に読み込んだ: 先頭に移して日時を更新 (前に外れた理由は消す) */
  function opened(videoId, info) {
    if (!videoId) return chain;
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
