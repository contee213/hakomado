// 取り直せて増えていくもの (キャッシュ・記録) の置き場所。IndexedDB の DB `hakomado-cache` (HAKO-30)。
// 作ったもの (チャンネル・あとで見る・再生リストなど) は chrome.storage.local のまま。ここに置くのは、消えても取り直せる・困らないものだけ
// (decisions.md 2026-11-27。Confluence「拡張機能のデータ保存領域 (調査と方針)」3.1)。
// - kv: 最近の動画 (RSS の結果 `feed:*`) と Twitch のページ (`twpage:*`)。キーと値の形は前の版の chrome.storage.local と同じ。
//   前の版で chrome.storage.local に置いた分は、画面を開いたときに移して消す (途中で閉じても、次に開いたときに続きから移す)
// - streams: 配信ごとの実際の開始・終了 {start, end, at}。配信状況の確認で読んだ動画のページから取る (新しい問い合わせはしない)
// - collab: ライブラリの 🤝 の判定の記録 (2 本の組ごと)。CollabStats が実際の時刻で答え合わせする
// - wave: 動画ごとの全編の音の大きさの波形 {vals: Uint8Array (0.1 秒ごと。0 = まだ無い), at}。同期の調整の波形の帯 (waves.js。HAKO-39)
// - IndexedDB には storage.onChanged が無い。ほかのタブの書き込みは、読むたびに DB から読み直すので知らせは要らない
// - IndexedDB が使えないとき (単体テストの node など) は、kv だけ chrome.storage.local を使い、streams・collab・wave は覚えない
/* exported IdbCache */
'use strict';

const IdbCache = (() => {
  const DB = 'hakomado-cache';
  const STORES = ['kv', 'streams', 'collab', 'wave'];
  const MOVE_PREFIXES = ['feed:', 'twpage:']; // 前の版で chrome.storage.local に置いていた分
  const has = typeof indexedDB !== 'undefined';
  const local = () => chrome.storage.local;

  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 2); // 2: wave を足した (HAKO-39)
        req.onupgradeneeded = () => {
          for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
        };
        req.onsuccess = () => {
          // ほかのページが新しい版で開こうとしたら、この接続を閉じて止めないようにする (次に使うときに開き直す)
          req.result.onversionchange = () => {
            req.result.close();
            dbp = null;
          };
          resolve(req.result);
        };
        req.onerror = () => reject(req.error);
      });
      dbp.catch(() => (dbp = null));
    }
    return dbp;
  }

  /** 1 つの store で fn(store) を動かし、終わったら fn が返したリクエストの結果を返す。接続が閉じられていたら、一度だけ開き直す */
  async function run(store, mode, fn) {
    try {
      return await run1(store, mode, fn);
    } catch (e) {
      if (e?.name !== 'InvalidStateError') throw e;
      dbp = null; // ほかのページが新しい版で開いて、この接続が閉じられた
      return run1(store, mode, fn);
    }
  }
  async function run1(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** store の全部 (キー → 値) */
  async function all(store) {
    const [keys, vals] = await Promise.all([run(store, 'readonly', (s) => s.getAllKeys()), run(store, 'readonly', (s) => s.getAll())]);
    return new Map(keys.map((k, i) => [k, vals[i]]));
  }

  // ---- 前の版の chrome.storage.local の分を移す (画面を開いて最初に使うときに 1 回。ほかのタブと同時にしない)
  let moving = null;
  function moveOld() {
    if (!moving) {
      moving = (async () => {
        const run1 = async () => {
          const keys = local().getKeys ? await local().getKeys() : Object.keys(await local().get(null));
          const old = keys.filter((k) => MOVE_PREFIXES.some((p) => k.startsWith(p)));
          if (!old.length) return;
          const got = await local().get(old);
          // 先に書いてから消す (途中で閉じても、残った分は次に開いたときに移す)。もう新しい結果があれば、そちらを残す
          const cur = await getKv(old);
          const put = Object.fromEntries(Object.entries(got).filter(([k, v]) => v && !((cur[k]?.at || 0) >= (v.at || 0))));
          if (Object.keys(put).length) await setKv(put);
          await local().remove(old);
        };
        try {
          if (navigator.locks) await navigator.locks.request('hakomado-cache-move', run1);
          else await run1();
        } catch (e) {
          console.warn('hakomado: 前の版の取得結果を移せませんでした', e);
        }
      })();
    }
    return moving;
  }

  async function getKv(keys) {
    const list = keys == null ? null : Array.isArray(keys) ? keys : [keys];
    if (list == null) return Object.fromEntries(await all('kv'));
    const vals = await Promise.all(list.map((k) => run('kv', 'readonly', (s) => s.get(k))));
    return Object.fromEntries(list.map((k, i) => [k, vals[i]]).filter(([, v]) => v !== undefined));
  }
  const setKv = (items) =>
    run('kv', 'readwrite', (s) => {
      for (const [k, v] of Object.entries(items)) s.put(v, k);
    });

  /**
   * chrome.storage.local と同じ形で使える置き場所 (get / set / remove / getKeys)。最近の動画・Twitch のページ用。
   * IndexedDB が使えなければ chrome.storage.local そのもの
   */
  const kv = has
    ? {
        async get(keys) {
          await moveOld();
          return getKv(keys);
        },
        async set(items) {
          await moveOld();
          await setKv(items);
        },
        async remove(keys) {
          await moveOld();
          const list = Array.isArray(keys) ? keys : [keys];
          await run('kv', 'readwrite', (s) => {
            for (const k of list) s.delete(k);
          });
        },
        async getKeys() {
          await moveOld();
          return run('kv', 'readonly', (s) => s.getAllKeys());
        },
      }
    : {
        get: (keys) => local().get(keys),
        set: (items) => local().set(items),
        remove: (keys) => local().remove(keys),
        getKeys: async () => (local().getKeys ? local().getKeys() : Object.keys(await local().get(null))),
      };

  // ---- 配信の実際の時刻 (videoId → {start, end?, at})
  /** 実際の開始 (と、終わっていれば終了) を覚える。分からないものは覚えない */
  async function putStream(videoId, { start, end }) {
    if (!has || !Number.isFinite(start)) return;
    const prev = await run('streams', 'readonly', (s) => s.get(videoId));
    const next = { start, ...(Number.isFinite(end) ? { end } : prev?.end ? { end: prev.end } : {}), at: Date.now() };
    if (prev && prev.start === next.start && prev.end === next.end) return;
    await run('streams', 'readwrite', (s) => s.put(next, videoId));
  }
  const streams = () => (has ? all('streams') : Promise.resolve(new Map()));

  // ---- 🤝 の判定の記録 (`id\nid` → {a, b, judged, rule, gap, at})
  const putCollab = (rows) =>
    has && rows.length
      ? run('collab', 'readwrite', (s) => {
          for (const r of rows) s.put(r, `${r.a}\n${r.b}`);
        })
      : Promise.resolve();
  const collab = () => (has ? all('collab') : Promise.resolve(new Map()));

  /** streams・collab の古いもの (keepMs より前に覚えたもの) を消し、波形を WAVE_MAX 本までにする。画面を開いたときに呼ぶ */
  async function prune(keepMs = 8 * 24 * 3600e3, now = Date.now()) {
    if (!has) return;
    await pruneWaves().catch((e) => console.warn('hakomado: 波形の片付けに失敗しました', e));
    for (const store of ['streams', 'collab']) {
      const rows = await all(store);
      const drop = [...rows].filter(([, v]) => !(now - (v?.at || 0) < keepMs)).map(([k]) => k);
      if (drop.length)
        await run(store, 'readwrite', (s) => {
          for (const k of drop) s.delete(k);
        });
    }
  }

  // ---- 全編の音の波形 (videoId → {vals: Uint8Array, at})。WAVE_MAX 本まで、使っていないものから消す
  const WAVE_MAX = 100;
  const getWave = async (videoId) => (has ? (await run('wave', 'readonly', (s) => s.get(videoId))) || null : null);
  async function putWave(videoId, vals) {
    if (!has) return;
    await run('wave', 'readwrite', (s) => s.put({ vals, at: Date.now() }, videoId));
  }
  /** 波形を WAVE_MAX 本までにする (古く書いたものから消す)。画面を開いたときに呼ぶ */
  async function pruneWaves(max = WAVE_MAX) {
    if (!has) return;
    const keys = await run('wave', 'readonly', (s) => s.getAllKeys());
    if (keys.length <= max) return;
    const rows = await all('wave');
    const drop = [...rows]
      .sort((a, b) => (a[1]?.at || 0) - (b[1]?.at || 0))
      .slice(0, rows.size - max)
      .map(([k]) => k);
    await run('wave', 'readwrite', (s) => {
      for (const k of drop) s.delete(k);
    });
  }

  return { kv, putStream, streams, putCollab, collab, prune, getWave, putWave, pruneWaves, available: has };
})();
