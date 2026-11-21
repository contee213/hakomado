// hakomado: アーカイブの同期再生の、動画ごとのずれ (秒、+ = 先へ進める)。すべてのタブで共通 (保存先は chrome.storage.local)。
// 「その動画の 0 秒が、実際の時刻のいつに当たるか」の補正なので、組み合わせる相手や、入れる枠が変わっても同じ値が使える
// (冒頭が切られたアーカイブ・同時視聴の配信の遅れなど)。一度合わせた動画は、どの枠に入れても・次に開いても・
// 視聴セットのコードで人に渡しても、最初からずれの無い状態で同期できる
/* exported SyncOffsets */
'use strict';

const SyncOffsets = (() => {
  const KEY = 'syncOffsets';
  const MAX = 1000; // 覚えておく動画の数 (古く調整したものから忘れる)
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  let cache = {}; // videoId -> {o: 秒, at: 調整した時刻}
  const listeners = new Set();

  const clean = (v) => Math.round(Math.max(-86400, Math.min(86400, Number(v) || 0)) * 100) / 100; // 0.01 秒単位

  function adopt(raw) {
    const next = {};
    if (raw && typeof raw === 'object') {
      for (const [id, e] of Object.entries(raw)) {
        if (ID_RE.test(id) && e && Number.isFinite(e.o) && e.o !== 0) next[id] = { o: clean(e.o), at: Number(e.at) || 0 };
      }
    }
    return next;
  }

  async function load() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    cache = adopt(raw);
  }

  /** その動画のずれ (記録が無ければ 0) */
  const get = (id) => (id && cache[id] ? cache[id].o : 0);

  /** その動画のずれを記録する (0 なら記録を消す)。書き込みはタブ間でロックを取って、読んでから書く */
  function set(id, v) {
    if (!id || !ID_RE.test(id)) return Promise.resolve();
    const o = clean(v);
    if (o) cache[id] = { o, at: Date.now() };
    else delete cache[id];
    return navigator.locks
      .request('hakomado-sync-offsets', async () => {
        const { [KEY]: raw } = await chrome.storage.local.get(KEY);
        const all = adopt(raw);
        if (o) all[id] = { o, at: Date.now() };
        else delete all[id];
        const kept = Object.entries(all)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, MAX);
        await chrome.storage.local.set({ [KEY]: Object.fromEntries(kept) });
      })
      .catch((e) => console.warn('hakomado: ずれの書き込みに失敗', e));
  }

  /** ほかのタブで変わったとき (変わった動画 ID の一覧を渡す) */
  function onChange(fn) {
    listeners.add(fn);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const next = adopt(changes[KEY].newValue);
    const ids = [...new Set([...Object.keys(cache), ...Object.keys(next)])].filter((id) => get(id) !== (next[id]?.o || 0));
    cache = next;
    if (ids.length) for (const fn of listeners) fn(ids);
  });

  return { KEY, load, get, set, onChange };
})();
