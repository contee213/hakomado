// hakomado: チャンネルパック (ほかの人が作ったチャンネルの一覧を取り込む / 自分の一覧を配る)
// - Hakomado は、ホロライブ以外のグループの初期データを持たない。代わりに、誰でも作って配れる「チャンネルパック」
//   (グループ名付きのチャンネルの一覧の JSON) を読み込めるようにする。形式は README の「チャンネルパック」を参照
// - 読み込むときは中身を確かめ、知っている項目・正しい形の値だけを取り込む (データとして読むだけ。スクリプトなどは動かない)
// - 取り込んだチャンネルには、どのパックから来たか (pack: パックの名前) を付けておき、パックごとにまとめて外せるようにする
// ここは形式の読み書きだけ。チャンネル一覧への足し引きは favorites.js
/* exported ChannelPack */
'use strict';

const ChannelPack = (() => {
  const APP = 'hakomado';
  const TYPE = 'channels';
  const MAX_CHANNELS = 1000;
  const MAX_BYTES = 2 * 1024 * 1024;
  const CHANNEL_RE = /^UC[\w-]{22}$/;
  const HANDLE_RE = /^@[^\s/?#]{1,100}$/;
  // アイコンは YouTube の画像の置き場所のものだけ (ほかの URL は読み込ませない)
  const ICON_RE = /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com|i\.ytimg\.com)\//;

  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

  /**
   * パックの中身 (JSON の文字列) を確かめて、取り込める形にする。
   * @returns {{name: string, author: string, updated: string, channels: Array<{channelId, name, handle?, group, icon?}>}}
   * @throws {Error} message = 'notPack' (パックではない) | 'emptyPack' (チャンネルが 1 つも無い) | 'tooLarge'
   */
  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('tooLarge');
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('notPack');
    }
    if (!json || typeof json !== 'object' || json.app !== APP || json.type !== TYPE || !Array.isArray(json.channels)) {
      throw new Error('notPack');
    }
    const name = str(json.name, 50) || 'Channel pack';
    const seen = new Set();
    const channels = [];
    for (const c of json.channels) {
      if (channels.length >= MAX_CHANNELS) break;
      if (!c || typeof c !== 'object' || !CHANNEL_RE.test(c.channelId) || seen.has(c.channelId)) continue;
      seen.add(c.channelId);
      const out = { channelId: c.channelId, name: str(c.name, 100) || c.channelId, group: str(c.group, 50) || name };
      const handle = str(c.handle, 101);
      if (HANDLE_RE.test(handle)) out.handle = handle;
      if (typeof c.icon === 'string' && ICON_RE.test(c.icon)) out.icon = c.icon.slice(0, 1000);
      channels.push(out);
    }
    if (!channels.length) throw new Error('emptyPack');
    return { name, author: str(json.author, 100), updated: str(json.updated, 30), channels };
  }

  /** パックを作る (書き出し用)。channels = チャンネル一覧の項目 */
  function build(name, channels) {
    return {
      app: APP,
      type: TYPE,
      name: str(name, 50) || 'Channel pack',
      updated: new Date().toISOString().slice(0, 10),
      channels: channels.map((f) => {
        const c = { channelId: f.channelId, name: f.nameJa || f.name || f.channelId };
        if (f.handle) c.handle = f.handle;
        if (f.group) c.group = f.group;
        if (f.icon && ICON_RE.test(f.icon)) c.icon = f.icon;
        return c;
      }),
    };
  }

  /** URL からパックを取ってくる (https だけ。Cookie などは送らない) */
  async function fetchText(url) {
    let u;
    try {
      u = new URL(url.trim());
    } catch {
      throw new Error('badUrl');
    }
    if (u.protocol !== 'https:') throw new Error('badUrl');
    const res = await fetch(u.href, { credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('tooLarge');
    return text;
  }

  return { parse, build, fetchText };
})();
