// アドオン: 本体から切り離した、特定のサイトに頼る機能 (配信予定サイトの読み込みなど)。1 つのアドオンは addons/ の 1 ファイル
// - アドオンのファイルは grid.html でこのファイルの後に読み込み、Addons.register({...}) で自分を登録する
// - ON / OFF は 設定 → アドオン で切り替え、共通設定の addons (文字列 'id:on,id:off') に入れる。書いていなければ defaultOn
// - アクセスするサイトは origins に書く (manifest.json の host_permissions か optional_host_permissions にも書く)。
//   ON にするときに権限を確かめ、無ければその場で聞く (任意の権限のとき)。アドオンが取りに行けるのは origins の中だけ
//
// type: 'schedule' (配信予定サイト) のアドオンが持つもの (favorites.js の「配信予定のアドオン」が使う):
//   fetchEntries({fetchText}) → 枠の一覧 [{videoId, startAt, live, channelId?, handle?, name?, icon?}]
//     startAt = 開始予定 (ミリ秒)、live = 配信中。配信者は channelId / handle で示す。分からなければ name (表示名) と
//     icon (アイコン画像の URL) を入れておくと、本体がチャンネル一覧・既定のチャンネルと突き合わせる (それでもだめなら oEmbed)
//   covers(fav) → そのチャンネルの予定がこのサイトに全部載るか。載るチャンネルは、載っていなければ「予定なし」と分かるので
//     RSS を見に行く間隔を長くする
//   (任意) listChannels({fetchText, wait}) → 配信者の一覧 [{channelId, name, group, handle?, icon?}] と
//     pack ({file, name, nameEn?, description, descriptionEn?, origins?})。origins = 一覧を読むサイトが配信予定のサイトと違うとき
//     (パック作り専用。拡張機能は通信しないので manifest.json には書かない)。tools/make-pack.js がこれでチャンネルパック (packs/) を作る。
//     pack.name は covers が「載る」とするパックの名前に合わせる。拡張機能の画面からは呼ばない
/* exported Addons */
/* global LANG */
'use strict';

const Addons = (() => {
  const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
  const registry = new Map(); // id -> アドオン
  let overrides = new Map(); // id -> true / false (設定に書いてあるもの)

  /** アドオンを登録する (アドオンのファイルから呼ぶ) */
  function register(addon) {
    if (!addon || !ID_RE.test(addon.id) || registry.has(addon.id)) throw new Error(`hakomado: アドオンの登録に失敗 (${addon?.id})`);
    if (!Array.isArray(addon.origins) || !addon.origins.every((o) => /^https:\/\/[a-z0-9.-]+\/\*$/.test(o))) {
      throw new Error(`hakomado: アドオンの origins が正しくない (${addon.id})`);
    }
    registry.set(addon.id, Object.freeze({ defaultOn: false, ...addon }));
  }

  /** 共通設定の addons ('id:on,id:off') を読む。知らない id・形の違うものは捨てる */
  function parseStates(s) {
    const m = new Map();
    for (const part of String(s || '').split(',')) {
      const [id, v] = part.trim().split(':');
      if (ID_RE.test(id || '') && (v === 'on' || v === 'off')) m.set(id, v === 'on');
    }
    return m;
  }

  /** 共通設定の addons を反映する (読み込んだとき・他のタブで変わったとき) */
  function setStates(s) {
    overrides = parseStates(s);
  }

  /** id の ON / OFF を変えたあとの共通設定の addons。初期値と同じものは書かない */
  function withState(s, id, on) {
    const m = parseStates(s);
    const a = registry.get(id);
    if (a && a.defaultOn === on) m.delete(id);
    else m.set(id, on);
    return [...m].map(([k, v]) => `${k}:${v ? 'on' : 'off'}`).join(',');
  }

  const isOn = (id) => {
    const a = registry.get(id);
    return !!a && (overrides.has(id) ? overrides.get(id) : a.defaultOn);
  };

  /** 登録されているアドオン (type を渡すとその種類だけ) */
  const list = (type) => [...registry.values()].filter((a) => !type || a.type === type);

  /** ON になっているアドオン */
  const enabled = (type) => list(type).filter((a) => isOn(a.id));

  /** 表示名・説明 ([日本語, 英語] の組) を今の言語で */
  const text = (pair) => (Array.isArray(pair) ? pair[LANG === 'ja' ? 0 : 1] || pair[0] : String(pair || ''));

  /** アドオンのサイトへアクセスする権限があるか */
  async function granted(addon) {
    try {
      return await chrome.permissions.contains({ origins: addon.origins });
    } catch {
      return false;
    }
  }

  /** url がアドオンの origins の中か (アドオンが取りに行ってよいところ) */
  function allowed(addon, url) {
    return addon.origins.some((o) => String(url).startsWith(o.slice(0, -1)));
  }

  return { register, setStates, withState, isOn, list, enabled, text, granted, allowed };
})();
