// ファイルの枠 (パソコンの動画ファイルを枠にドロップして再生する) で使う、ファイルの見分けと場所の保存。
// - 場所は、ドロップで Chrome が渡すファイルの持ち手 (FileSystemFileHandle) を IndexedDB に入れて覚える
//   (chrome.storage には入らない。中身ではなく持ち手だけなので、ファイルを動かす・消すと読めなくなる)
// - 開き直したときに読めるかは Chrome の許可次第 (queryPermission)。聞き直しが要るときは、枠の中の「許可して再生」で聞く
/* exported LocalFiles */
'use strict';

const LocalFiles = (() => {
  const DB = 'hakomado-files';
  const STORE = 'handles';
  // Chrome で再生できることが多い形式。type が空のこともあるので拡張子でも見る
  const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|ogg|mkv)$/i;

  /** 動画ファイルらしいか (名前と MIME タイプから) */
  const isVideo = (name, type) => /^video\//i.test(String(type || '')) || VIDEO_EXT.test(String(name || ''));

  /** 新しい ID (枠の状態に保存する。持ち手そのものは IndexedDB に置く) */
  const newId = () => 'f' + crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 16);

  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbp.catch(() => (dbp = null));
    }
    return dbp;
  }

  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(Array.isArray(req) ? req.map((r) => r.result) : req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // 持ち手と、覚えた時刻 (片付けで、ほかのタブが覚えたばかりのものを消さないように)
  const put = (id, handle) => run('readwrite', (s) => s.put({ handle, at: Date.now() }, id));
  const get = async (id) => (await run('readonly', (s) => s.get(id)))?.handle || null;
  const remove = (id) => run('readwrite', (s) => s.delete(id));
  const KEEP_NEW_MS = 10 * 60 * 1000;

  /** 使われていない持ち手を消す (keep = まだどこかの視聴セッションが使っている ID。覚えてから 10 分以内のものは残す) */
  async function prune(keep, now = Date.now()) {
    const [ids, rows] = await run('readonly', (s) => [s.getAllKeys(), s.getAll()]); // 同じトランザクションで読む (組がずれないように)
    for (let k = 0; k < ids.length; k++) {
      if (!keep.has(ids[k]) && !(now - (rows[k]?.at || 0) < KEEP_NEW_MS)) await remove(ids[k]);
    }
  }

  return { isVideo, newId, put, get, remove, prune };
})();
