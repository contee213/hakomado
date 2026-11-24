// hakomado: 設定・チャンネル・履歴のバックアップ (JSON ファイルへの書き出し / 読み込み)
// - 拡張機能を削除して入れ直したり、ID の違う版 (開発用のフォルダ・ID を固定する前の版・ストア版) に入れ替えたりすると、
//   保存した内容は引き継がれない。そのときに、書き出したファイルを読み込んで元に戻せるようにする
//   (リリースの ZIP は manifest.json の "key" で ID を固定している。tools/release-key.js)
// - 書き出すもの: 共通設定・チャンネル一覧 (ピックアップ 📌 を含む)・初期データの状態・視聴履歴・あとで見る・再生リスト・表示言語
// - 書き出さないもの: 視聴セッション (タブごとの枠の中身)・お知らせ・取得結果の一時保存
// - 読み込むときは中身を確かめ、知っている項目・正しい形の値だけを取り込む (手で書き換えたファイルや壊れたファイルでも、
//   おかしな値を持ち込まない)。読み込むと今の内容は置き換わる
/* exported Backup */
/* global LANG_PREF, setLangPref, VideoEntry */
'use strict';

const Backup = (() => {
  const APP = 'hakomado';
  const FORMAT = 1; // ファイルの形を変えたら上げる (読み込むときに、知らない新しい形は断る)
  const CHANNEL_RE = /^(?:UC[\w-]{22}|tw:[a-z0-9_]{1,25})$/; // YouTube (UC…) と Twitch (tw:<名前>) のチャンネル
  const MAX_ITEMS = 100; // 履歴・あとで見るの上限 (history.js と同じ)
  const MAX_CHANNELS = 2000;

  /** 今の内容を書き出す形にまとめる */
  async function collect() {
    const d = await chrome.storage.local.get([
      'settings',
      'favorites',
      'presetVersion',
      'removedPresets',
      'presetsDeclined',
      'history',
      'saved',
    ]);
    // 再生リストは 1 つずつ別の項目に保存しているので、まとめて読む (ファイルの形は以前と同じ配列)
    const playlists = await Playlists.list();
    return {
      app: APP,
      format: FORMAT,
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      lang: LANG_PREF,
      data: {
        settings: d.settings || {},
        favorites: d.favorites || [],
        presetVersion: d.presetVersion || 0,
        removedPresets: d.removedPresets || [],
        presetsDeclined: d.presetsDeclined === true,
        history: d.history || [],
        saved: d.saved || [],
        playlists,
      },
    };
  }

  /** JSON ファイルとして保存させる (downloads 権限は使わず、リンクのダウンロードで) */
  async function download() {
    const body = JSON.stringify(await collect(), null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `hakomado-backup-${date}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const str = (v, max = 300) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

  /** 共通設定: 初期値にある項目で、初期値と同じ型の値だけ */
  function cleanSettings(raw, defaults) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, v] of Object.entries(defaults)) {
      if (k in raw && typeof raw[k] === typeof v && (typeof v !== 'number' || Number.isFinite(raw[k]))) out[k] = raw[k];
    }
    return out;
  }

  /** チャンネル 1 件: チャンネル ID が正しいものだけ。文字の項目と印 (preset / star) だけ残す */
  function cleanChannel(f) {
    if (!f || typeof f !== 'object' || !CHANNEL_RE.test(f.channelId)) return null;
    const out = { channelId: f.channelId };
    for (const k of ['handle', 'name', 'nameEn', 'group', 'groupEn', 'pack']) {
      const v = str(f[k]);
      if (v) out[k] = v;
    }
    // アイコンは https の画像だけ (それ以外の URL は読み込ませない)
    if (typeof f.icon === 'string' && /^https:\/\//.test(f.icon)) out.icon = f.icon.slice(0, 1000);
    if (!out.name) out.name = out.handle || out.channelId;
    if (f.preset === true) out.preset = true;
    if (f.star === true) out.star = true;
    return out;
  }

  /** 履歴・あとで見るの 1 件: 動画 ID が正しいものだけ。日時と外れた理由も残す */
  function cleanVideo(h) {
    if (!VideoEntry.valid(h)) return null;
    const out = { videoId: h.videoId, ...VideoEntry.pick(h) };
    for (const k of ['at', 'removedAt']) {
      if (Number.isFinite(h[k])) out[k] = h[k];
    }
    if (['ended', 'closed', 'members', 'replaced'].includes(h.reason)) out.reason = h.reason;
    return out;
  }

  function uniqueBy(list, key) {
    const seen = new Set();
    return list.filter((x) => x && !seen.has(x[key]) && seen.add(x[key]));
  }

  /**
   * 読み込んだファイルの中身を確かめて、取り込める形にする。
   * @param {string} text ファイルの中身
   * @param {object} settingsDefaults 共通設定の初期値 (項目と型の見本)
   * @returns {{data: object, lang: string|null, counts: {channels: number, stars: number, history: number, saved: number}}}
   * @throws {Error} hakomado のバックアップではない / 新しすぎる形のとき (message は 'notBackup' | 'tooNew')
   */
  function parse(text, settingsDefaults) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('notBackup');
    }
    if (!json || typeof json !== 'object' || json.app !== APP || !json.data || typeof json.data !== 'object') {
      throw new Error('notBackup');
    }
    if (!Number.isInteger(json.format) || json.format > FORMAT) throw new Error('tooNew');
    const d = json.data;
    const favorites = uniqueBy((Array.isArray(d.favorites) ? d.favorites : []).map(cleanChannel), 'channelId').slice(0, MAX_CHANNELS);
    const history = uniqueBy((Array.isArray(d.history) ? d.history : []).map(cleanVideo), 'videoId').slice(0, MAX_ITEMS);
    const saved = uniqueBy((Array.isArray(d.saved) ? d.saved : []).map(cleanVideo), 'videoId').slice(0, MAX_ITEMS);
    const playlists = uniqueBy((Array.isArray(d.playlists) ? d.playlists : []).map(Playlists.clean), 'id').slice(0, Playlists.MAX_LISTS);
    const removedPresets = (Array.isArray(d.removedPresets) ? d.removedPresets : []).filter((id) => CHANNEL_RE.test(id));
    const data = {
      settings: cleanSettings(d.settings, settingsDefaults),
      favorites,
      presetVersion: Number.isInteger(d.presetVersion) && d.presetVersion >= 0 ? d.presetVersion : 0,
      removedPresets: [...new Set(removedPresets)],
      presetsDeclined: d.presetsDeclined === true,
      history,
      saved,
      playlists,
    };
    const lang = ['auto', 'ja', 'en'].includes(json.lang) ? json.lang : null;
    return {
      data,
      lang,
      counts: { channels: favorites.length, stars: favorites.filter((f) => f.star).length, history: history.length, saved: saved.length, playlists: playlists.length },
    };
  }

  /** 確かめた内容で今の内容を置き換える (他のタブには storage.onChanged で伝わる) */
  // 他のタブが同じ項目を読んでから書くまでの途中に割り込まないよう、それぞれの書き込みと同じロックを取ってから置き換える
  // 再生リストは Playlists.replaceAll が自分のロックを取って置き換える (ここで同じロックを取ると、待ち合って止まる)
  const LOCKS = ['hakomado-favorites', 'hakomado-history', 'hakomado-saved', 'hakomado-settings'];
  async function apply({ data, lang }) {
    const { playlists, ...rest } = data;
    const run = (i) => (i < LOCKS.length ? navigator.locks.request(LOCKS[i], () => run(i + 1)) : chrome.storage.local.set(rest));
    await run(0);
    await Playlists.replaceAll(playlists);
    if (lang) setLangPref(lang);
  }

  return { download, parse, apply };
})();
