// hakomado: アーカイブの同期再生の「🎬 同時視聴」で使う、動画ごとの本編の位置 (秒)。すべてのタブで共通 (保存先は chrome.storage.local)。
// 「その動画の、本編 (同時視聴している映画など) の 0:00 に当たる再生位置」。ライブ配信は配信開始からの経過で表すので、
// アーカイブになっても同じ値が使える。相手や組み合わせによらない値なので、一度決めた動画は、どの枠に入れても・
// 次に開いても・視聴セットのコードで人に渡しても使える。sync-offsets.js と同じ作り
// (違い: 0 も意味のある値 (配信の始まりと同時に本編が始まった) なので、決めていない動画は null。消すときは remove)
// 動画ごとに、ほかに 2 つの印を持つ:
// - guess: 配信の時刻などから見当を付けた値 (使う人が決めた値ではない)。同じ時間に配信していた枠の本編の位置が決まったら、
//   そこから付け直してよい
// - main: 使う人が「この動画を本編にする」と決めた (プレミア公開でなくても本編の枠として扱う)
// 画面のタイマーから見つけた区間 (HAKO-49) も持つ:
// - w: 配信の画面のタイマーが動き出した所の並び [[動き出した再生位置 (秒), そのときのタイマーの値 (秒)], ...] (再生位置の順)。
//   値が 0 (か最初の 1 つ) なら新しい作品の始まり、それ以外は同じ作品の続き。作品 n の 0:00 = 動き出した位置 − 値
// - k: 今選んでいる作品 (1 から)。選んだ作品の 0:00 を s にも入れる (s だけ読む同期・共有コード・前の版はそのまま使える)
/* exported MovieAnchors */
'use strict';

const MovieAnchors = (() => {
  const KEY = 'movieAnchors';
  const MAX = 1000; // 覚えておく動画の数 (古く決めたものから忘れる)
  const LIMIT = 7 * 86400; // 1 週間分まで (長い配信でも入るように)
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const MAX_W = 200; // 1 本の動画で覚える区間の数
  let cache = {}; // videoId -> {s?: 秒, at: 決めた時刻, g?: 1 (見当), m?: 1 (本編にした), w?: [[秒, 秒], ...], k?: 作品の番号}
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
    const w = cleanW(e.w);
    if (w.length) {
      out.w = w;
      const n = startsOf(w).length;
      if (Number.isInteger(e.k) && e.k >= 1 && e.k <= n) out.k = e.k;
    }
    return 's' in out || out.m || out.w ? out : null;
  }
  /** 区間の並びを正しい形に (数の組だけ・再生位置は 0 以上・値は 0 以上・再生位置の順・同じ位置は 1 つ) */
  function cleanW(w) {
    if (!Array.isArray(w)) return [];
    const out = [];
    for (const p of w) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const a = Number(p[0]), v = Number(p[1]);
      if (!Number.isFinite(a) || !Number.isFinite(v) || a < 0 || v < 0 || a > LIMIT || v > LIMIT) continue;
      out.push([clean(a), clean(v)]);
    }
    out.sort((x, y) => x[0] - y[0]);
    return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0]).slice(0, MAX_W);
  }
  /** 作品の始まりの区間 (最初の区間と、値が 0 の区間) */
  const startsOf = (w) => w.filter((p, i) => i === 0 || p[1] === 0);

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
  /** 画面のタイマーから見つけた作品の一覧 [{n: 何本目 (1 から), at: 動き出した再生位置, zero: その作品の 0:00 の再生位置}] */
  const works = (id) => (id && cache[id]?.w ? startsOf(cache[id].w).map((p, j) => ({ n: j + 1, at: p[0], zero: clean(p[0] - p[1]) })) : []);
  /** 今選んでいる作品の番号 (無ければ null) */
  const selected = (id) => (id && cache[id]?.k) || null;

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
      // 手で決め直したら、選んでいた作品の印は外す (見つけた区間 w は残す)
      const { s, g, k, ...rest } = e;
      return ok ? { ...rest, s: Number(v), ...(guess ? { g: 1 } : {}) } : rest;
    });
  const remove = (id) => set(id, null);
  /** 「この動画を本編にする」の印を付ける / 外す */
  const setMain = (id, on) =>
    write(id, (e) => {
      const { m, ...rest } = e;
      return on ? { ...rest, m: 1 } : rest;
    });

  /** 画面のタイマーから見つけた区間の並びを記録する (今までの分に足す)。本編の位置が未定なら 1 本目の 0:00 を入れて選ぶ */
  const addSections = (id, list) =>
    write(id, (e) => {
      const w = cleanW([...(e.w || []), ...list]);
      if (!w.length) return e;
      const out = { ...e, w };
      if (!Number.isFinite(e.s) || e.g) {
        const first = w[0];
        const { g, ...rest } = out;
        return { ...rest, s: clean(first[0] - first[1]), k: 1 };
      }
      return out;
    });
  /** 作品 n を選ぶ (その作品の 0:00 を本編の位置にする)。選べたら 0:00 の位置を返す */
  function select(id, n) {
    const wk = works(id).find((x) => x.n === n);
    if (!wk) return null;
    write(id, (e) => {
      const { g, ...rest } = e;
      return { ...rest, s: wk.zero, k: n };
    });
    return wk.zero;
  }

  /** ほかのタブで変わったとき (変わった動画 ID の一覧を渡す) */
  function onChange(fn) {
    listeners.add(fn);
  }
  const sig = (e) => (e ? [e.s, e.g, e.m, e.k, JSON.stringify(e.w || '')].join() : '');
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const next = adopt(changes[KEY].newValue);
    const ids = [...new Set([...Object.keys(cache), ...Object.keys(next)])].filter((id) => sig(cache[id]) !== sig(next[id]));
    cache = next;
    if (ids.length) for (const fn of listeners) fn(ids);
  });

  return { KEY, load, get, isGuess, isMain, set, remove, setMain, works, selected, addSections, select, onChange };
})();
