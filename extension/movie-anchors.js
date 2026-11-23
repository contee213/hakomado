// hakomado: アーカイブの同期再生の「🎬 本編」モードで使う、動画ごとの本編の位置 (秒)。すべてのタブで共通 (保存先は chrome.storage.local)。
// 「その動画の、本編 (同時視聴している映画など) の 0:00 に当たる再生位置」。ライブ配信は配信開始からの経過で表すので、
// アーカイブになっても同じ値が使える。相手や組み合わせによらない値なので、一度決めた動画は、どの枠に入れても・
// 次に開いても・視聴セットのコードで人に渡しても使える。sync-offsets.js と同じ作り
// (違い: 0 も意味のある値 (配信の始まりと同時に本編が始まった) なので、決めていない動画は null。消すときは remove)
/* exported MovieAnchors */
'use strict';

const MovieAnchors = (() => {
  const KEY = 'movieAnchors';
  const MAX = 1000; // 覚えておく動画の数 (古く決めたものから忘れる)
  const LIMIT = 7 * 86400; // 1 週間分まで (長い配信でも入るように)
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  let cache = {}; // videoId -> {s: 秒, at: 決めた時刻}
  const listeners = new Set();

  const clean = (v) => Math.round(Math.max(-LIMIT, Math.min(LIMIT, Number(v))) * 100) / 100; // 0.01 秒単位 (✨ 自動補正・± 0.01 で合わせられるように)

  function adopt(raw) {
    const next = {};
    if (raw && typeof raw === 'object') {
      for (const [id, e] of Object.entries(raw)) {
        if (ID_RE.test(id) && e && Number.isFinite(e.s)) next[id] = { s: clean(e.s), at: Number(e.at) || 0 };
      }
    }
    return next;
  }

  async function load() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    cache = adopt(raw);
  }

  /** その動画の本編の位置 (決めていなければ null) */
  const get = (id) => (id && cache[id] ? cache[id].s : null);

  /** 書き込み (v = null なら消す)。タブ間でロックを取って、読んでから書く */
  function write(id, v) {
    if (!id || !ID_RE.test(id)) return Promise.resolve();
    const s = v == null || !Number.isFinite(Number(v)) ? null : clean(v);
    if (s == null) delete cache[id];
    else cache[id] = { s, at: Date.now() };
    return navigator.locks
      .request('hakomado-movie-anchors', async () => {
        const { [KEY]: raw } = await chrome.storage.local.get(KEY);
        const all = adopt(raw);
        if (s == null) delete all[id];
        else all[id] = { s, at: Date.now() };
        const kept = Object.entries(all)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, MAX);
        await chrome.storage.local.set({ [KEY]: Object.fromEntries(kept) });
      })
      .catch((e) => console.warn('hakomado: 本編の位置の書き込みに失敗', e));
  }
  const set = (id, v) => write(id, v);
  const remove = (id) => write(id, null);

  /** ほかのタブで変わったとき (変わった動画 ID の一覧を渡す) */
  function onChange(fn) {
    listeners.add(fn);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const next = adopt(changes[KEY].newValue);
    const ids = [...new Set([...Object.keys(cache), ...Object.keys(next)])].filter((id) => get(id) !== (next[id]?.s ?? null));
    cache = next;
    if (ids.length) for (const fn of listeners) fn(ids);
  });

  return { KEY, load, get, set, remove, onChange };
})();
