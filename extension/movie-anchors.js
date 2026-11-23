// hakomado: アーカイブの同期再生の「🎬 同時視聴」で使う、動画ごとの本編の位置 (秒)。すべてのタブで共通 (保存先は chrome.storage.local)。
// 「その動画の、本編 (同時視聴している映画など) の 0:00 に当たる再生位置」。ライブ配信は配信開始からの経過で表すので、
// アーカイブになっても同じ値が使える。相手や組み合わせによらない値なので、一度決めた動画は、どの枠に入れても・
// 次に開いても・視聴セットのコードで人に渡しても使える。sync-offsets.js と同じ作り
// (違い: 0 も意味のある値 (配信の始まりと同時に本編が始まった) なので、決めていない動画は null。消すときは remove)
// 動画ごとに、ほかに 2 つの印を持つ:
// - guess: 配信の時刻などから見当を付けた値 (使う人が決めた値ではない)。同じ時間に配信していた枠の本編の位置が決まったら、
//   そこから付け直してよい
// - main: 使う人が「この動画を本編にする」と決めた (プレミア公開でなくても本編の枠として扱う)
/* exported MovieAnchors */
'use strict';

const MovieAnchors = (() => {
  const KEY = 'movieAnchors';
  const MAX = 1000; // 覚えておく動画の数 (古く決めたものから忘れる)
  const LIMIT = 7 * 86400; // 1 週間分まで (長い配信でも入るように)
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  let cache = {}; // videoId -> {s?: 秒, at: 決めた時刻, g?: 1 (見当), m?: 1 (本編にした)}
  const listeners = new Set();

  const clean = (v) => Math.round(Math.max(-LIMIT, Math.min(LIMIT, Number(v))) * 100) / 100; // 0.01 秒単位 (✨ 自動補正・± 0.01 で合わせられるように)

  /** 1 件を正しい形に (本編の位置も「本編にした」の印も無ければ null) */
  function entry(e) {
    if (!e || typeof e !== 'object') return null;
    const out = { at: Number(e.at) || 0 };
    if (Number.isFinite(e.s)) {
      out.s = clean(e.s);
      if (e.g) out.g = 1;
    }
    if (e.m) out.m = 1;
    return 's' in out || out.m ? out : null;
  }

  function adopt(raw) {
    const next = {};
    if (raw && typeof raw === 'object') {
      for (const [id, e] of Object.entries(raw)) {
        const v = ID_RE.test(id) ? entry(e) : null;
        if (v) next[id] = v;
      }
    }
    return next;
  }

  async function load() {
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    cache = adopt(raw);
  }

  /** その動画の本編の位置 (決めていなければ null) */
  const get = (id) => (id && cache[id] && 's' in cache[id] ? cache[id].s : null);
  /** 本編の位置が見当 (配信の時刻などから付けた値) か */
  const isGuess = (id) => !!(id && cache[id]?.g && 's' in cache[id]);
  /** 使う人が「本編にする」と決めた動画か */
  const isMain = (id) => !!(id && cache[id]?.m);

  /** 書き込み (fn で 1 件を書き換える)。タブ間でロックを取って、読んでから書く */
  function write(id, fn) {
    if (!id || !ID_RE.test(id)) return Promise.resolve();
    const apply = (all) => {
      const v = entry(fn({ ...(all[id] || {}) }));
      if (v) all[id] = { ...v, at: Date.now() };
      else delete all[id];
    };
    apply(cache);
    return navigator.locks
      .request('hakomado-movie-anchors', async () => {
        const { [KEY]: raw } = await chrome.storage.local.get(KEY);
        const all = adopt(raw);
        apply(all);
        const kept = Object.entries(all)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, MAX);
        await chrome.storage.local.set({ [KEY]: Object.fromEntries(kept) });
      })
      .catch((e) => console.warn('hakomado: 本編の位置の書き込みに失敗', e));
  }
  /** 本編の位置を記録する (v = null なら消す)。guess = 見当として記録する */
  const set = (id, v, { guess = false } = {}) =>
    write(id, (e) => {
      const ok = v != null && Number.isFinite(Number(v));
      const { s, g, ...rest } = e;
      return ok ? { ...rest, s: Number(v), ...(guess ? { g: 1 } : {}) } : rest;
    });
  const remove = (id) => set(id, null);
  /** 「この動画を本編にする」の印を付ける / 外す */
  const setMain = (id, on) =>
    write(id, (e) => {
      const { m, ...rest } = e;
      return on ? { ...rest, m: 1 } : rest;
    });

  /** ほかのタブで変わったとき (変わった動画 ID の一覧を渡す) */
  function onChange(fn) {
    listeners.add(fn);
  }
  const sig = (e) => (e ? [e.s, e.g, e.m].join() : '');
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const next = adopt(changes[KEY].newValue);
    const ids = [...new Set([...Object.keys(cache), ...Object.keys(next)])].filter((id) => sig(cache[id]) !== sig(next[id]));
    cache = next;
    if (ids.length) for (const fn of listeners) fn(ids);
  });

  return { KEY, load, get, isGuess, isMain, set, remove, setMain, onChange };
})();
