// hakomado: 再生リスト (ライブラリの「📃 再生リスト」タブ)。名前を付けた配信・動画の並び。
// 主にライブラリの画面で作って編集する (新規・今の枠から作る・URL の追加・枠や一覧の 📃)。
// AI チャットなどで作ったテキストや、取り込み用リンク (watch_videos?video_ids=…&hakomado=名前) からも作れる。
// あとで見ると違って、再生しても中身は減らない。保存先は chrome.storage.local (すべてのタブで共通)。
//
// 1 件の形:
//   { id, name, items: [{videoId, label?, title?, channel?, handle?, channelId?, input?, offset?}],
//     sync, layoutId, ref, createdAt, updatedAt }
//   sync     = 同期再生する (全部を一度に並べ、アーカイブを同じ瞬間にそろえる。枠の数と同じ 16 本まで)。false なら今の枠で順に再生 (200 本まで)
//   layoutId = 同期再生のときのレイアウト (null = 本数に合わせて選ぶ)
//   ref      = 同期の基準にする動画 (null = 先頭)
//   offset   = その動画の同期のずれ (秒。0 は持たない)。SyncOffsets と同じ意味で、同期再生を始めるときに SyncOffsets へ入れる
//   label    = 枠に出す名前 (チャンネル一覧での名前、または自分で付けた名前)
//   watched  = 「▶ 順に再生」で最後まで見た (次に再生するときは飛ばす。続きから再生)
//   resume   = 同期再生をどこまで見たか ({at: 同期の時計 (実際の時刻のミリ秒), pos: 基準の動画の再生位置 (秒), savedAt})
/* exported Playlists */
const Playlists = (() => {
  'use strict';
  const { valid, pick } = VideoEntry;

  const KEY = 'playlists';
  const MAX_LISTS = 50;
  const MAX_ITEMS = 200;
  const SYNC_MAX = 16; // 同期再生の再生リストは、一度に並べられる枠の数まで
  const NAME_MAX = 80;
  const LABEL_MAX = 80;
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

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

  /**
   * 1 件の再生リストを書き換える (無ければ何もせず undefined)。
   * fn は「書き込むか」の真偽値か、{write, result} を返す (result が呼び出し元への戻り値)
   */
  function edit(id, fn) {
    return mutate((all) => {
      const p = all.find((x) => x.id === id);
      if (!p) return null;
      const r = fn(p, all);
      const { write, result } = r && typeof r === 'object' ? r : { write: !!r, result: undefined };
      if (!write) return { result };
      p.updatedAt = Date.now();
      return { next: all.map(clean), result };
    });
  }

  /** その再生リストに入れられる本数 (同期再生なら 16、順に再生なら 200) */
  const limitOf = (p) => (p?.sync ? SYNC_MAX : MAX_ITEMS);

  const cleanName = (s) => String(s ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, NAME_MAX);
  const cleanLabel = (s) => String(s ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, LABEL_MAX);
  /** ずれの秒 (0.01 秒単位。SyncOffsets と同じ範囲) */
  const cleanOffset = (v) => Math.round(Math.max(-86400, Math.min(86400, Number(v) || 0)) * 100) / 100;

  /** 1 本分 (おかしなものは null) */
  function cleanItem(h) {
    if (!valid(h)) return null;
    const out = { videoId: h.videoId, ...pick(h) };
    if (out.label) out.label = cleanLabel(out.label);
    if (!out.label) delete out.label;
    const o = cleanOffset(h.offset);
    if (o) out.offset = o;
    if (h.watched === true) out.watched = true;
    return out;
  }

  /** 同期再生の続きの位置 (おかしなものは null) */
  function cleanResume(r) {
    if (!r || typeof r !== 'object' || !Number.isFinite(r.at) || r.at <= 0) return null;
    return { at: r.at, pos: Number.isFinite(r.pos) && r.pos >= 0 ? Math.round(r.pos) : 0, savedAt: Number.isFinite(r.savedAt) ? r.savedAt : 0 };
  }

  /** 1 件分の中身を確かめる (バックアップの読み込みでも使う)。おかしなものは null */
  function clean(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || !Array.isArray(p.items)) return null;
    const seen = new Set();
    const items = p.items
      .map(cleanItem)
      .filter((h) => h && !seen.has(h.videoId) && seen.add(h.videoId))
      .slice(0, limitOf(p));
    const layoutId = typeof p.layoutId === 'string' && /^[a-z0-9-]{1,24}$/i.test(p.layoutId) ? p.layoutId : null;
    const ref = typeof p.ref === 'string' && VIDEO_ID_RE.test(p.ref) && items.some((h) => h.videoId === p.ref) ? p.ref : null;
    return {
      id: p.id.slice(0, 64),
      name: cleanName(p.name) || '?',
      items,
      sync: p.sync === true,
      layoutId,
      ref,
      resume: cleanResume(p.resume),
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : 0,
      updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : 0,
    };
  }

  /** 一覧 (新しく作った・同じ名前で保存し直したものが先頭。中身の編集では並びを変えない) */
  async function list() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    return Array.isArray(raw) ? raw.map(clean).filter(Boolean).slice(0, MAX_LISTS) : [];
  }

  async function get(id) {
    return (await list()).find((p) => p.id === id) || null;
  }

  /** 同期再生の設定 ({sync, layoutId, ref}) のうち、渡されたものだけ */
  function pickOptions(opts = {}) {
    const out = {};
    if ('sync' in opts) out.sync = !!opts.sync;
    if ('layoutId' in opts) out.layoutId = opts.layoutId || null;
    if ('ref' in opts) out.ref = opts.ref || null;
    return out;
  }

  /**
   * 保存する。同じ名前の再生リストがあれば中身 (と同期再生の設定) を置き換える。
   * 同期再生なら 16 本、順に再生なら 200 本を超えた分は入れない (呼び出し元で limitOf を見て知らせる)
   * @param {string} name
   * @param {{videoId: string, label?: string, offset?: number}[]} items
   * @param {{sync?: boolean, layoutId?: string|null, ref?: string|null}} [opts]
   * @returns {Promise<{playlist?: object, replaced?: boolean, full?: boolean}>} full = 再生リストの数がいっぱい
   */
  function save(name, items, opts = {}) {
    const n = cleanName(name);
    return mutate((all) => {
      const now = Date.now();
      const old = all.find((p) => p.name === n);
      if (!old && all.length >= MAX_LISTS) return { result: { full: true } };
      const playlist = clean({
        id: old?.id || crypto.randomUUID(),
        name: n,
        items,
        sync: false,
        ...pickOptions(opts),
        createdAt: old?.createdAt || now,
        updatedAt: now,
      });
      return { next: [playlist, ...all.filter((p) => p !== old)], result: { playlist, replaced: !!old } };
    });
  }

  /**
   * 新しい再生リストを作る (同じ名前があれば作らずにそれを返す)。
   * @returns {Promise<{playlist?: object, exists?: object, full?: boolean, empty?: boolean}>}
   */
  function create(name, items = [], opts = {}) {
    const n = cleanName(name);
    if (!n) return Promise.resolve({ empty: true });
    return mutate((all) => {
      const old = all.find((p) => p.name === n);
      if (old) return { result: { exists: old } };
      if (all.length >= MAX_LISTS) return { result: { full: true } };
      const now = Date.now();
      const playlist = clean({ id: crypto.randomUUID(), name: n, items, sync: false, ...pickOptions(opts), createdAt: now, updatedAt: now });
      return { next: [playlist, ...all], result: { playlist } };
    });
  }

  /** 使われていない名前 (「名前」「名前 (2)」…) */
  async function freeName(name) {
    const base = cleanName(name);
    const names = new Set((await list()).map((p) => p.name));
    if (!names.has(base)) return base;
    for (let k = 2; ; k++) {
      const n = cleanName(`${base.slice(0, NAME_MAX - 6)} (${k})`);
      if (!names.has(n)) return n;
    }
  }

  /**
   * 何本かを最後に足す (もう入っているものは飛ばす)。
   * @returns {Promise<{added: number, exists: number, full: boolean}|undefined>} undefined = 再生リストが無い
   */
  function addItems(id, infos) {
    const add = infos.map(cleanItem).filter(Boolean);
    return edit(id, (p) => {
      const r = { added: 0, exists: 0, full: false };
      for (const h of add) {
        if (p.items.some((x) => x.videoId === h.videoId)) r.exists++;
        else if (p.items.length >= limitOf(p)) r.full = true;
        else {
          p.items.push(h);
          r.added++;
        }
      }
      return { result: r, write: r.added > 0 };
    });
  }

  /**
   * 1 件を最後に足す。
   * @returns {Promise<'added'|'exists'|'full'|undefined>} undefined = 再生リストが無い
   */
  async function addItem(id, info) {
    if (!valid(info)) return undefined;
    const r = await addItems(id, [info]);
    if (!r) return undefined;
    return r.added ? 'added' : r.full ? 'full' : 'exists';
  }

  /** 1 本の名前・ずれを変える (patch に入っているものだけ。label が空なら名前を消す) */
  function updateItem(id, videoId, patch) {
    return edit(id, (p) => {
      const h = p.items.find((x) => x.videoId === videoId);
      if (!h) return false;
      if ('label' in patch) {
        const l = cleanLabel(patch.label);
        if (l) h.label = l;
        else delete h.label;
      }
      if ('watched' in patch) {
        if (patch.watched) h.watched = true;
        else delete h.watched;
      }
      if ('offset' in patch) {
        const o = cleanOffset(patch.offset);
        if (o) h.offset = o;
        else delete h.offset;
      }
      return true;
    });
  }

  /** 見た印をまとめて付ける / 外す (videoIds を省くと全部) */
  function setWatched(id, videoIds, on) {
    return edit(id, (p) => {
      let changed = false;
      for (const h of p.items) {
        if (videoIds && !videoIds.includes(h.videoId)) continue;
        if (!!h.watched === !!on) continue;
        if (on) h.watched = true;
        else delete h.watched;
        changed = true;
      }
      return changed;
    });
  }

  /** 同期再生の続きの位置を書く (null で消す)。中身の並びは変えないので、更新日時も変えない */
  function setResume(id, resume) {
    const r = cleanResume(resume);
    return mutate((all) => {
      const p = all.find((x) => x.id === id);
      if (!p || JSON.stringify(p.resume) === JSON.stringify(r)) return null;
      p.resume = r;
      return { next: all };
    });
  }

  /** 1 本を index の位置に入れ直す (外したものを元に戻す)。もう入っていれば何もしない */
  function insertItem(id, item, index) {
    const h = cleanItem(item);
    if (!h) return Promise.resolve();
    return edit(id, (p) => {
      if (p.items.some((x) => x.videoId === h.videoId)) return { result: 'exists', write: false };
      if (p.items.length >= limitOf(p)) return { result: 'full', write: false };
      p.items.splice(Math.max(0, Math.min(p.items.length, index)), 0, h);
      return { result: 'added', write: true };
    });
  }

  /**
   * 複製する (名前は「名前 のコピー」。中身・同期再生の設定・ずれはそのまま、見た印と続きの位置は持たない)
   * @returns {Promise<{playlist?: object, full?: boolean}>}
   */
  async function duplicate(id, copyName) {
    const p = await get(id);
    if (!p) return {};
    const name = await freeName(copyName(p.name));
    return mutate((all) => {
      if (all.length >= MAX_LISTS) return { result: { full: true } };
      const now = Date.now();
      const playlist = clean({
        ...p,
        id: crypto.randomUUID(),
        name,
        items: p.items.map(({ watched, ...h }) => h),
        resume: null,
        createdAt: now,
        updatedAt: now,
      });
      // 元の再生リストのすぐ後ろに置く
      const at = all.findIndex((x) => x.id === id) + 1;
      const next = [...all];
      next.splice(at, 0, playlist);
      return { next, result: { playlist } };
    });
  }

  /** ずれをまとめて書く ({videoId: 秒})。入っていない動画は無視。変わらなければ書き込まない */
  function setOffsets(id, map) {
    return edit(id, (p) => {
      let changed = false;
      for (const h of p.items) {
        if (!(h.videoId in map)) continue;
        const o = cleanOffset(map[h.videoId]);
        if ((h.offset || 0) === o) continue;
        if (o) h.offset = o;
        else delete h.offset;
        changed = true;
      }
      return changed;
    });
  }

  /**
   * 同期再生の設定を変える ({sync, layoutId, ref} のうち渡したものだけ)。
   * 16 本を超える再生リストを同期再生にするときは、cut が無ければ変えずに 'tooMany'、cut なら 17 本目以降を外す
   * @returns {Promise<'ok'|'tooMany'|undefined>}
   */
  function setOptions(id, opts, { cut = false } = {}) {
    const o = pickOptions(opts);
    return edit(id, (p) => {
      if (Object.entries(o).every(([k, v]) => p[k] === v)) return { result: 'ok', write: false };
      if (o.sync && !p.sync && p.items.length > SYNC_MAX) {
        if (!cut) return { result: 'tooMany', write: false };
        p.items = p.items.slice(0, SYNC_MAX);
      }
      Object.assign(p, o);
      return { result: 'ok', write: true };
    });
  }

  /**
   * 名前を変える。
   * @returns {Promise<'ok'|'exists'|'empty'|undefined>} exists = 同じ名前の再生リストがほかにある
   */
  function rename(id, name) {
    const n = cleanName(name);
    if (!n) return Promise.resolve('empty');
    return edit(id, (p, all) => {
      if (p.name === n) return { result: 'ok', write: false };
      if (all.some((x) => x !== p && x.name === n)) return { result: 'exists', write: false };
      p.name = n;
      return { result: 'ok', write: true };
    });
  }

  /** 1 件を index の位置へ動かす (並べ替え) */
  function move(id, videoId, index) {
    return edit(id, (p) => {
      const from = p.items.findIndex((h) => h.videoId === videoId);
      if (from < 0) return false;
      const to = Math.max(0, Math.min(p.items.length - 1, index));
      if (to === from) return false;
      const [h] = p.items.splice(from, 1);
      p.items.splice(to, 0, h);
      return true;
    });
  }

  function remove(id) {
    return mutate((all) => ({ next: all.filter((p) => p.id !== id) }));
  }

  /** 再生リストから 1 件外す */
  function removeItem(id, videoId) {
    return edit(id, (p) => {
      const n = p.items.length;
      p.items = p.items.filter((h) => h.videoId !== videoId);
      return p.items.length !== n;
    });
  }

  /** タイトルやチャンネル名が分かった (その動画を含む再生リストだけ。まだ無い項目だけ足す。並び順は変えない) */
  function update(videoId, info) {
    const add = pick(info);
    delete add.label; // 名前は自分で付けたものを上書きしない
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

  return {
    KEY,
    MAX_LISTS,
    MAX_ITEMS,
    SYNC_MAX,
    NAME_MAX,
    LABEL_MAX,
    clean,
    limitOf,
    list,
    get,
    save,
    create,
    freeName,
    addItems,
    addItem,
    updateItem,
    setWatched,
    setResume,
    insertItem,
    duplicate,
    setOffsets,
    setOptions,
    rename,
    move,
    remove,
    removeItem,
    update,
  };
})();
