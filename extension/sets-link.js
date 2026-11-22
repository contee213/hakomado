// Hakomado セット集 (web/) の短縮リンク。機能フラグ ENABLED でオンオフする (オフなら画面にも出さず、通信もしない)。
// - 作る: 共有画面で「短縮リンクを作る」「QR を短縮リンクにする」を押したときだけ、そのセットのコード
//   (動画 ID・レイアウト・同期のずれ・名前) をセット集に送る。セット集では限定公開 (リンクを知っている人だけ。一覧に載らない) になる
// - 読む: 読み込む画面に短縮リンク (<ORIGIN>/s/xxxxxxxx) が貼られたら、セット集からコードを取ってきて読む
// 送るのは https://<ORIGIN> だけ。Cookie は送らない。セット集は拡張機能のページからの呼び出しを CORS で許すので、host 権限は使わない
/* exported SetsLink */
'use strict';

const SetsLink = (() => {
  const ENABLED = false; // 機能フラグ。オンにするときは CHROMEWEBSTORE.md の「短縮リンク」の節の手順も
  const ORIGIN = 'https://hakomado-sets.example.workers.dev'; // セット集のデプロイ先 (オンにするときに置き換える)
  const TIMEOUT = 15000;

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const LINK_RE = new RegExp(`${esc(ORIGIN)}/s/([A-Za-z0-9]{8})(?![A-Za-z0-9])`);
  const made = new Map(); // コード → 短縮リンク (この画面を開いている間だけ覚える。同じものを何度も送らない)

  const call = async (path, init = {}) => {
    let res;
    try {
      res = await fetch(`${ORIGIN}${path}`, { ...init, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) });
    } catch {
      throw new Error('network');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data.error || res.status));
    return data;
  };

  /** コードを送って短縮リンクを作る (返すのは <ORIGIN>/s/xxxxxxxx) */
  async function create(code) {
    if (!ENABLED) throw new Error('disabled');
    if (made.has(code)) return made.get(code);
    const data = await call('/api/sets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: code }) });
    if (typeof data.id !== 'string' || !/^[A-Za-z0-9]{8}$/.test(data.id)) throw new Error('server');
    const url = `${ORIGIN}/s/${data.id}`;
    made.set(code, url);
    return url;
  }

  /** テキストの中の短縮リンクのセットの ID (無ければ null) */
  const idIn = (text) => (ENABLED ? String(text || '').match(LINK_RE)?.[1] || null : null);

  /** 短縮リンクの指すセットのコード (#Hakomado …) を取ってくる。短縮リンクが無ければ null */
  async function resolve(text) {
    const id = idIn(text);
    if (!id) return null;
    const data = await call(`/api/sets/${id}`);
    if (typeof data.code !== 'string') throw new Error('server');
    return data.code;
  }

  return { enabled: ENABLED, origin: ORIGIN, create, resolve, isLink: (text) => !!idIn(text) };
})();
