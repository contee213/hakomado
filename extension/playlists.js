// hakomado: 再生リスト (ライブラリの「📃 再生リスト」タブ)。名前を付けた配信・動画の並び。
// AI チャットなどで作ったテキストや、取り込み用リンク (watch_videos?video_ids=…&hakomado=名前) から作る。
// あとで見ると違って、再生しても中身は減らない。同じ名前で保存すると中身を置き換える (AI に作り直してもらったとき用)。
// 保存先は chrome.storage.local (すべてのタブで共通)。
/* exported Playlists */
const Playlists = (() => {
  'use strict';
  const { valid, pick } = VideoEntry;

  const KEY = 'playlists';
  const MAX_LISTS = 50;
  const MAX_ITEMS = 200;
  const NAME_MAX = 80;

  // 読み書きの順番待ち (あとで見ると同じく、このタブの中は promise の列、タブ間はロック)
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
      .then(() => navigator.locks.request('hakomado-playlists', run))
      .catch((e) => console.warn('hakomado: 再生リストの書き込みに失敗', e));
    return chain.then(() => result);
  }

  const cleanName = (s) => String(s ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, NAME_MAX);

  /** 1 件分の中身を確かめる (バックアップの読み込みでも使う)。おかしなものは null */
  function clean(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || !Array.isArray(p.items)) return null;
    const seen = new Set();
    const items = p.items
      .filter((h) => valid(h) && !seen.has(h.videoId) && seen.add(h.videoId))
      .slice(0, MAX_ITEMS)
      .map((h) => ({ videoId: h.videoId, ...pick(h) }));
    return {
      id: p.id.slice(0, 64),
      name: cleanName(p.name) || '?',
      items,
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : 0,
      updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : 0,
    };
  }

  /** 新しく保存・更新した順の一覧 */
  async function list() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    return Array.isArray(raw) ? raw.map(clean).filter(Boolean).slice(0, MAX_LISTS) : [];
  }

  async function get(id) {
    return (await list()).find((p) => p.id === id) || null;
  }

  /**
   * 保存する。同じ名前の再生リストがあれば中身を置き換える。
   * @param {string} name
   * @param {{videoId: string, label?: string, title?: string}[]} items
   * @returns {Promise<{playlist?: object, replaced?: boolean, full?: boolean}>} full = 再生リストの数がいっぱい
   */
  function save(name, items) {
    const n = cleanName(name);
    return mutate((all) => {
      const now = Date.now();
      const old = all.find((p) => p.name === n);
      if (!old && all.length >= MAX_LISTS) return { result: { full: true } };
      const playlist = clean({ id: old?.id || crypto.randomUUID(), name: n, items, createdAt: old?.createdAt || now, updatedAt: now });
      return { next: [playlist, ...all.filter((p) => p !== old)], result: { playlist, replaced: !!old } };
    });
  }

  function remove(id) {
    return mutate((all) => ({ next: all.filter((p) => p.id !== id) }));
  }

  /** 再生リストから 1 件外す */
  function removeItem(id, videoId) {
    return mutate((all) => {
      const p = all.find((x) => x.id === id);
      if (!p) return null;
      p.items = p.items.filter((h) => h.videoId !== videoId);
      return { next: all };
    });
  }

  /** タイトルやチャンネル名が分かった (その動画を含む再生リストだけ。まだ無い項目だけ足す。並び順は変えない) */
  function update(videoId, info) {
    const add = pick(info);
    if (!videoId || !Object.keys(add).length) return chain;
    return mutate((all) => {
      let changed = false;
      for (const p of all) {
        const h = p.items.find((x) => x.videoId === videoId);
        if (!h) continue;
        for (const [k, v] of Object.entries(add)) {
          if (!h[k]) {
            h[k] = v;
            changed = true;
          }
        }
      }
      return changed ? { next: all } : null;
    });
  }

  return { KEY, MAX_LISTS, MAX_ITEMS, NAME_MAX, clean, list, get, save, remove, removeItem, update };
})();
