// hakomado: 新しいバージョンが出ていないかを確かめる (GitHub のリリースと比べる)
// - 開発者モードで読み込んだ拡張機能は自動では更新されないので、新しい版が出たら画面で知らせる
// - ストアから入れた版 (manifest に update_url がある) はブラウザが更新するので、確かめない
// - 確かめるのは 1 日 1 回まで (結果は chrome.storage.local に残し、全タブで共有する)。
//   GitHub の API は CORS で誰からでも読めるので、host_permissions は要らない
/* exported UpdateCheck */
'use strict';

const UpdateCheck = (() => {
  const REPO = 'contee213/hakomado';
  const API = `https://api.github.com/repos/${REPO}/releases/latest`;
  const RELEASES = `https://github.com/${REPO}/releases/latest`;
  const KEY = 'updateCheck'; // {at, latest, url}
  const NOTIFIED_KEY = 'updateNotified'; // お知らせを出した版 (同じ版では 1 度だけ)
  const INTERVAL_MS = 24 * 60 * 60 * 1000;
  const RETRY_MS = 60 * 60 * 1000; // 取得に失敗したときは 1 時間後まで取りに行かない

  /** "0.10.2" と "0.9.0" を数字として比べる (a が新しければ正) */
  function compare(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  async function fetchLatest() {
    const res = await fetch(API, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const latest = String(json?.tag_name || '').match(/^v?(\d+(?:\.\d+){0,3})$/)?.[1];
    if (!latest) throw new Error('no version');
    // リリースのページ以外には飛ばさない
    const url = typeof json.html_url === 'string' && json.html_url.startsWith(`https://github.com/${REPO}/releases/`) ? json.html_url : RELEASES;
    return { latest, url };
  }

  /**
   * 新しい版があれば {latest, url, notify} を返す (無い / 分からないときは null)。
   * notify = まだお知らせを出していない版 (出したら markNotified を呼ぶ)
   */
  async function check() {
    const m = chrome.runtime.getManifest();
    if (m.update_url) return null;
    const { [KEY]: cached, [NOTIFIED_KEY]: notified } = await chrome.storage.local.get([KEY, NOTIFIED_KEY]);
    let info = cached && typeof cached === 'object' ? cached : null;
    const age = Date.now() - (info?.at || 0);
    if (!info || age > (info.latest ? INTERVAL_MS : RETRY_MS) || age < 0) {
      try {
        info = { at: Date.now(), ...(await fetchLatest()) };
      } catch (e) {
        console.warn('hakomado: 新しいバージョンの確認に失敗', e);
        info = { at: Date.now(), latest: info?.latest || '', url: info?.url || '' };
      }
      await chrome.storage.local.set({ [KEY]: info });
    }
    if (!info.latest || compare(info.latest, m.version) <= 0) return null;
    return { latest: info.latest, url: info.url || RELEASES, notify: notified !== info.latest };
  }

  function markNotified(version) {
    return chrome.storage.local.set({ [NOTIFIED_KEY]: version });
  }

  return { check, markNotified, compare };
})();
