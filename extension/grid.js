/* global SyncGroups, Danmaku, LAYOUTS, ANCHORS, DEFAULT_LAYOUT_ID, MAX_SLOTS, getLayout, layoutFor, solveTracks, LANG, LANG_PREF, tr, setLangPref, Backup, UpdateCheck, qrcode, jsQR, ChannelPack, SyncOffsets, MovieAnchors, AudioAlign */
'use strict';

const MAX_TILES = MAX_SLOTS;
const YT = 'https://www.youtube.com';

const DEFAULT_SETTINGS = {
  duration: 5, // 画面を横切る秒数
  fontScale: 1,
  opacity: 0.9,
  area: 0.75, // 弾幕を流す高さ (枠の高さに対する割合)
  areaPos: 'top', // 弾幕を流す位置: 'top' | 'middle' | 'bottom'
  maxOnScreen: 60,
  authorName: 'off', // 弾幕に投稿者名を出す: 'off' = 出さない / 'staff' = 配信者とモデレーターだけ / 'all' = 全員
  showPaid: true,
  dmFont: 'standard', // 弾幕のフォント (DM_FONTS)
  dmWeight: 'bold', // 'normal' | 'bold'
  // 音が出ている枠の表示
  hlStyle: 'sky',
  liveStyle: 'pink', // ライブ配信中の枠の線の色 (HL_PRESETS のどれか / 'none' = 線を引かない)
  hlWidth: 2,
  hlGlow: 0.3,
  hlAnimate: false,
  // チャット欄
  chatZoom: 0.9,
  chatWidth: 0.3,
  chatHideAvatars: false,
  // 自動再生
  skipMembersOnly: true, // メンバーになっていないメンバー限定配信は入れない
  cruiseSec: 120, // クルーズでメイン枠 (と音声) を次の配信に回す間隔 (秒)
  prestartMin: 10, // 開始の何分前から、配信予定の枠を用意しておくか (0 = しない)
  autoArchive: false, // 自動再生: 配信中が 1 本も無いときは、最近の配信 (アーカイブ) を流す
  autoPickupMain: true, // 自動再生: ピックアップ (📌) のライブ配信をメイン枠に優先して置く
  autoMaxTiles: 8, // 自動再生で同時に再生する最大の枠数 (回線が細いときは少なく)
  autoTarget: 'all', // 自動再生の対象: 'all' = チャンネル全部 / 'fav' = ピックアップ (📌) だけ
  noticeTarget: 'all', // 通知の対象: 'all' = チャンネル全部 / 'fav' = ピックアップだけ / 'off' = 知らせない
};

const state = {
  layoutId: DEFAULT_LAYOUT_ID,
  get layout() {
    return getLayout(this.layoutId);
  },
  get count() {
    return this.layout.slots.length;
  },
  // order[k] = レイアウトの k 番目の場所に置く枠。枠の入れ替えはここを入れ替えるだけ
  // (iframe を DOM 上で動かすと再読み込みされるので、要素は動かさず CSS の位置だけ変える)
  order: Array.from({ length: MAX_TILES }, (_, i) => i),
  // 'fit' = 標準: 各枠を 16:9 に合わせる (余白は外側にまとめる) / 'fill' = ストレッチ: 余白なしで画面を埋める (映像の端を切る)
  fit: 'fit',
  // メイン + サブ / PinP の基準位置 (メインを置く角): tl / bl / tr / br。均等を使っている間も覚えておく
  anchor: 'tl',
  // 自動再生: 配信中のチャンネルを全部再生し、配信開始で枠を足し、配信終了で枠を消す
  autoMode: false,
  // クルーズ: 一定時間ごとにメイン枠と音声を次の配信へ回す (いろいろな配信を少しずつ見る)
  cruise: false,
  danmakuAll: true,
  settings: { ...DEFAULT_SETTINGS },
  // 枠ごとの保存内容。枠数を減らしても全枠分保持しておき、増やしたときに復元する
  tiles: Array.from({ length: MAX_TILES }, () => newTileState()),
};

// auto = 自動再生で入れた枠 (配信が終わったら自動再生が消してよい枠) / label = その配信のチャンネル一覧での表示名
function newTileState() {
  // danmaku: null = 自動 (メイン枠なら出す) / true・false = 枠の ≋ で自分で決めた
  // queue = 「あとで見る」を順に再生している枠
  // fill = 自動再生で、ライブの代わりに最近の配信を入れた枠
  // (アーカイブの同期再生のずれは、枠ではなく動画ごとに記録する: SyncOffsets)
  // pan = 音の左右 (-1 = 左・0 = 真ん中・1 = 右)、gain = 音量 (1 = 元のまま、0〜2)。枠の中の Web Audio で変える (content/watch.js)
  return { input: '', videoId: null, chat: false, danmaku: null, muted: true, auto: false, queue: false, fill: false, label: '', pan: 0, gain: 1, delay: 0 };
}

const gridEl = document.getElementById('grid');
const template = document.getElementById('tileTemplate');
/** @type {Array<{el: HTMLElement, danmaku: Danmaku, player: HTMLIFrameElement|null, chatFrame: HTMLIFrameElement|null}>} */
const views = [];

// ---------------------------------------------------------------- storage
// 保存は 2 種類:
//  - 共通設定 (settings): 全タブで共有。どこかのタブで変えると他のタブにもすぐ反映
//  - 視聴セッション (session:<id>): 枠・レイアウト・表示方法・自動再生など。タブ (ウィンドウ) ごとに別々
//    → 複数ウィンドウ / 複数ディスプレイで別々の配信を並べても、お互いの内容を上書きしない

const SESSION_PREFIX = 'session:';
const MAX_SAVED_SESSIONS = 8; // 保存しておく視聴セッションの数 (古いものから消す)
let sessionId = null; // このタブの視聴セッション。起動時の選択が終わるまでは null (= 保存しない)

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  // 以前の版の「投稿者名を表示」(ON / OFF) を引き継ぐ
  if (settings && !('authorName' in settings) && settings.showAuthor === true) state.settings.authorName = 'all';
}

/** 保存されている視聴セッションを state に読み込む (無ければ初期状態) */
function applySession(saved = {}) {
  state.tiles = Array.from({ length: MAX_TILES }, () => newTileState());
  state.order = Array.from({ length: MAX_TILES }, (_, i) => i);
  state.layoutId = DEFAULT_LAYOUT_ID;
  // D キーの「全部消す」は一時的なものなので、開き直したら戻す
  state.danmakuAll = true;
  state.autoMode = saved.autoMode === true;
  state.cruise = saved.cruise === true;
  if (saved.fit === 'fit' || saved.fit === 'fill') state.fit = saved.fit;
  state.anchor = ANCHORS.includes(saved.anchor) ? saved.anchor : 'tl';
  if (Array.isArray(saved.tiles)) {
    // 知っている項目だけ取り込む (古い版の項目や壊れた値を持ち込まない)
    const keys = Object.keys(newTileState());
    saved.tiles.slice(0, MAX_TILES).forEach((t, i) => {
      if (!t || typeof t !== 'object') return;
      // 以前の版は同期のずれを枠ごとに持っていた → 入っている動画のずれとして引き継ぐ (動画のほうに記録が無ければ)
      if (Number(t.syncOffset) && typeof t.videoId === 'string' && ID_RE.test(t.videoId) && !SyncOffsets.get(t.videoId)) {
        SyncOffsets.set(t.videoId, Number(t.syncOffset));
      }
      const picked = Object.fromEntries(keys.filter((k) => k in t).map((k) => [k, t[k]]));
      // 形の違う値は使わない (動画 ID は 11 文字、文字列の項目は文字列だけ)
      for (const [k, v] of Object.entries(newTileState())) {
        if (k in picked && typeof picked[k] !== typeof v && v !== null) delete picked[k];
      }
      if (picked.videoId != null && !(typeof picked.videoId === 'string' && ID_RE.test(picked.videoId))) picked.videoId = null;
      if ('pan' in picked) picked.pan = clampPan(picked.pan);
      if ('gain' in picked) picked.gain = clampGain(picked.gain);
      if ('delay' in picked) picked.delay = clampDelay(picked.delay);
      // 以前の版は弾幕の初期値が「表示」だったので、そのときの true は自動 (メイン枠だけ) として扱う
      if (!saved.dmAuto && picked.danmaku === true) picked.danmaku = null;
      // あとで見るの再生中かどうかは保存しない (開き直したら、ふつうの枠として扱う)
      state.tiles[i] = { ...newTileState(), ...picked, muted: true, queue: false };
    });
  }
  // どのチャンネルがどの枠だったか (並び順) も戻す。今は無いレイアウトなら、同じ枠数に合うものに置き換える
  const layoutId = savedLayoutId(saved);
  if (layoutId) {
    state.layoutId = layoutId;
    if (state.layout.anchor) state.anchor = state.layout.anchor;
    if (isPermutation(saved.order)) state.order = saved.order;
  }
  // 音: 閉じたときに音が出ていた枠を戻す (全部ミュートだったらミュートのまま)。
  // 記録の無い以前の版のセッションは、1 番の枠だけ音を出す
  const filled = visibleIndexes().filter((i) => state.tiles[i].videoId);
  const audible = Array.isArray(saved.audible) ? saved.audible.filter((i) => filled.includes(i)) : null;
  if (audible && (audible.length || saved.audible.length === 0)) {
    for (const i of audible) state.tiles[i].muted = false;
    if (!audible.length && filled.length) lastAudibleSet = [filled[0]]; // M キーで戻す先
  } else if (filled.length) {
    state.tiles[filled[0]].muted = false;
  }
}

// 以前の版のメイン + サブのレイアウト (m2s4r・m6s9 など。id の形が「m<メイン数>s<サブ数>」) は今は無い。
// 開き直したときは、メイン枠の数と枠数が近い左上を基準 (配置順) にしたレイアウトに置き換える
function retiredLayout(id) {
  const m = typeof id === 'string' && id.match(/^m(\d+)s(\d+)/);
  return m ? { mains: Number(m[1]), slots: Number(m[1]) + Number(m[2]) } : null;
}

/** 保存されているレイアウト (今は無いものは置き換え先)。分からなければ null */
function savedLayoutId(saved) {
  if (typeof saved.layoutId !== 'string') return null;
  if (LAYOUTS.some((l) => l.id === saved.layoutId)) return saved.layoutId;
  const old = retiredLayout(saved.layoutId);
  return old ? chooseLayoutFor(old.slots, { mains: old.mains, kind: 'single', group: 'main', anchor: 'tl' }).id : null;
}

/** 保存されているセッションで表示されていた枠の数 */
function savedVisibleCount(saved) {
  return retiredLayout(saved.layoutId)?.slots || getLayout(saved.layoutId).slots.length;
}

/** 保存されている視聴セッションの一覧 (新しい順) */
async function listSessions() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k, v]) => k.startsWith(SESSION_PREFIX) && v && typeof v === 'object')
    .map(([k, v]) => ({ id: k.slice(SESSION_PREFIX.length), data: v }))
    .sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0));
}

/** 古い / 空の視聴セッションを片付ける (使用中のものは消さない) */
async function pruneSessions(inUse) {
  const sessions = await listSessions();
  const keep = new Set([...inUse, sessionId]);
  const removable = sessions.filter((s) => !keep.has(s.id));
  const empty = removable.filter((s) => !(s.data.tiles || []).some((t) => t?.videoId));
  const tooMany = removable.filter((s) => !empty.includes(s)).slice(Math.max(0, MAX_SAVED_SESSIONS - keep.size));
  const keys = [...empty, ...tooMany].map((s) => SESSION_PREFIX + s.id);
  if (keys.length) await chrome.storage.local.remove(keys);
}

function newSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let saveTimer = 0;

/** この視聴セッションを保存 (少し待ってまとめて) */
function save() {
  if (!sessionId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  if (!sessionId) return Promise.resolve();
  broadcastShown();
  return chrome.storage.local.set({
    [SESSION_PREFIX + sessionId]: {
      layoutId: state.layoutId,
      anchor: state.anchor,
      order: state.order,
      fit: state.fit,
      autoMode: state.autoMode,
      cruise: state.cruise,
      dmAuto: true, // 枠の danmaku が null (自動) を使う版で保存した印
      tiles: state.tiles.map(({ muted, ...rest }) => rest),
      audible: audibleTiles(), // 音が出ている枠 (開き直したときに戻す。[] = 全部ミュート)
      updatedAt: Date.now(),
    },
  });
}

let settingsTimer = 0;
/** 共通設定を保存 (他のタブには storage.onChanged で伝わる) */
const dirtySettings = new Set(); // このタブで変えて、まだ書き込んでいない項目

/** key = 変えた項目 (省略時は全部) */
function saveSettings(key) {
  for (const k of key ? [key] : Object.keys(state.settings)) dirtySettings.add(k);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(writeSettings, 200);
}

function writeSettings() {
  const keys = [...dirtySettings];
  dirtySettings.clear();
  return navigator.locks.request('hakomado-settings', async () => {
    const { settings: stored = {} } = await chrome.storage.local.get('settings');
    const next = { ...stored };
    for (const k of keys) next[k] = state.settings[k];
    await chrome.storage.local.set({ settings: next });
  });
}

/** 共通設定をまとめて差し替えて、画面に反映する (他のタブでの変更・初期値に戻す) */
function replaceSettings(next) {
  const cruiseBefore = state.settings.cruiseSec;
  state.settings = { ...DEFAULT_SETTINGS, ...next };
  applyHighlight();
  applyChatLook();
  syncSettingsInputs();
  if (state.settings.cruiseSec !== cruiseBefore) restartCruise();
}

/** 設定をすべて初期値に戻す (確認してから。表示言語は別に保存しているのでそのまま) */
function resetSettings() {
  if (!confirm(tr('settingsResetConfirm'))) return;
  replaceSettings({});
  clearTimeout(settingsTimer);
  dirtySettings.clear();
  chrome.storage.local.set({ settings: state.settings });
}

// 他のタブで共通設定が変わったら、このタブにも反映する
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;
  // このタブでまだ書き込んでいない変更は残す
  const mine = Object.fromEntries([...dirtySettings].map((k) => [k, state.settings[k]]));
  replaceSettings({ ...changes.settings.newValue, ...mine });
});

// ---------------------------------------------------------------- input parsing

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** URL / 動画ID / @handle / チャンネルURL から動画IDを得る */
async function resolveVideoId(raw) {
  const input = raw.trim();
  if (!input) throw new Error(tr('inputEmpty'));
  if (ID_RE.test(input)) return input;

  if (/^@[\w.\-]+$/.test(input)) return resolveLive(`${YT}/${input}/live`);

  let url;
  try {
    url = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input);
  } catch {
    throw new Error(tr('notUrl'));
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1, 12);
    if (ID_RE.test(id)) return id;
  }
  if (host === 'youtube.com') {
    const v = url.searchParams.get('v');
    if (v && ID_RE.test(v)) return v;
    const m = url.pathname.match(/^\/(?:live|embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    const ch = url.pathname.match(/^\/(@[\w.\-]+|channel\/UC[\w-]+|c\/[^/]+|user\/[^/]+)/);
    if (ch) return resolveLive(`${YT}/${ch[1]}/live`);
  }
  throw new Error(tr('notYouTube'));
}

/** チャンネルの /live ページから、現在配信中 (または待機所) の動画IDを取り出す */
async function resolveLive(liveUrl) {
  // スマホ版 (m.youtube.com) に転送されると取得が止まる (CORS) ので、PC 版のページを指定する
  const res = await fetch(`${liveUrl}?app=desktop`, { credentials: 'include', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(tr('channelOpenFail', res.status));
  const html = await res.text();
  const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);
  if (m) return m[1];
  throw new Error(tr('channelNotLive'));
}

// ---------------------------------------------------------------- layout

function isPermutation(a) {
  return (
    Array.isArray(a) &&
    a.length === MAX_TILES &&
    new Set(a).size === MAX_TILES &&
    a.every((v) => Number.isInteger(v) && v >= 0 && v < MAX_TILES)
  );
}

function isVisible(i) {
  return state.order.indexOf(i) < state.count;
}
/** 表示中の枠を、レイアウトの場所の順 (メイン → サブ) で */
function visibleIndexes() {
  return state.order.slice(0, state.count);
}

const GRID_GAP = 4; // grid.css の --gap と同じ値

const sumOf = (a) => a.reduce((s, v) => s + v, 0);

/** 標準表示で、レイアウト l の列幅・行高 (相対値) と、今の画面に収まる倍率。W・H = 枠の間の隙間を除いた広さ */
function fitScale(l) {
  const { colW, rowH } = solveTracks(l);
  const W = Math.max(1, gridEl.clientWidth - GRID_GAP * (l.cols + 1));
  const H = Math.max(1, gridEl.clientHeight - GRID_GAP * (l.rows + 1));
  return { colW, rowH, W, H, scale: Math.min(W / sumOf(colW), H / sumOf(rowH)) };
}

/** レイアウト l の先頭 n 枠に映像を入れたとき、映像が画面を占める割合 (標準表示で) */
function filledArea(l, n) {
  const { colW, rowH, W, H, scale } = fitScale(l);
  let area = 0;
  for (const [x, y, w, h] of l.slots.slice(0, n)) {
    area += sumOf(colW.slice(x, x + w)) * scale * sumOf(rowH.slice(y, y + h)) * scale;
  }
  return area / (W * H);
}

/**
 * n 本の配信を並べるのに向いたレイアウトを選ぶ。優先する順に:
 *  1. メイン枠の数が基準 (ふつうは今のレイアウト) と同じ (無ければ近いもの)。サブ枠が空になるほどメイン枠が多いものは使わない
 *  2. 空き枠が一番少ない (枠数がちょうど n のものがあればそれ)
 *  3. 基準と同じ種類 (メイン重視 / バランス。1 種類しか無い組み合わせはどちらとも合うものとする)
 *  4. 基準と同じ基準位置 (左上 / 左下 / 右上 / 右下)
 *  5. 映像が画面を占める割合が大きい (たいてい横長の形)
 * クルーズ中は、メイン枠を回して見られるよう「メイン + サブ」のレイアウトを優先する (合うものが無ければ均等)。
 * 自動再生が枠を組み替えるときと、上部バーの「＋」「−」で使う
 * PinP は、今 PinP を使っているときだけ選ぶ (小窓に入りきらなければメイン 1 のメイン + サブ)
 * @param {number} n
 * @param {{mains: number, kind: string, group: string, anchor: string}} [base] 基準 (省略時は今のレイアウト)
 */
function chooseLayoutFor(n, base = currentBase()) {
  let pool = LAYOUTS.filter(
    (l) => l.slots.length >= n && (l.mains === 0 || l.mains < n) && (l.group !== 'pip' || base.group === 'pip'),
  );
  if (state.cruise && n >= 3) {
    const withMain = pool.filter((l) => l.mains > 0);
    if (withMain.length) pool = withMain;
  }
  if (!pool.length) return getLayout(DEFAULT_LAYOUT_ID);
  const sameKind = (l) =>
    base.kind === 'pip' ? l.kind === 'pip' : l.kind === base.kind || l.kind === 'single' || base.kind === 'single';
  const rank = (l) => [
    Math.abs(l.mains - base.mains),
    l.slots.length - n,
    sameKind(l) ? 0 : 1,
    (l.anchor ?? base.anchor) === base.anchor ? 0 : 1,
    -filledArea(l, n),
  ];
  const better = (x, y) => {
    for (let k = 0; k < x.length; k++) if (Math.abs(x[k] - y[k]) > 1e-3) return x[k] < y[k];
    return false;
  };
  let best = null;
  for (const l of pool) {
    const r = rank(l);
    if (!best || better(r, best.r)) best = { l, r };
  }
  return best.l;
}

/** 自動で選ぶときの基準 = 今のレイアウト (均等のときも、覚えている基準位置を使う) */
function currentBase() {
  return { ...state.layout, anchor: state.layout.anchor || state.anchor };
}

/** 自動再生でピックアップ (📌) を優先するか (設定が ON で、クルーズ中でないとき。クルーズはメイン枠を回すため) */
function pickupPriority() {
  return !!state.settings.autoPickupMain && !state.cruise;
}

/** ピックアップ (📌) の配信を先にする (それ以外の順は変えない) */
function pickupFirst(list, isPick) {
  if (!pickupPriority()) return list;
  return [...list.filter(isPick), ...list.filter((x) => !isPick(x))];
}

/**
 * 並び順 order (表示する枠の番号) のうち、サブ枠にあるピックアップの枠を、メイン枠にあるピックアップでない枠と入れ替える。
 * 入れ替えるだけなので、ほかの枠の並びはなるべく動かさない (自分で並べ替えた順を崩しすぎないように)。
 * メイン枠の無いレイアウト (均等) では何もしない
 * @param {number[]} order
 * @param {number} mains レイアウトのメイン枠の数
 * @param {(i: number) => boolean} isPick
 */
function promotePickups(order, mains, isPick) {
  const out = [...order];
  if (!pickupPriority()) return out;
  const m = Math.min(mains, out.length);
  for (let k = m; k < out.length; k++) {
    if (!isPick(out[k])) continue;
    const slot = out.slice(0, m).findIndex((j) => !isPick(j));
    if (slot < 0) break; // メイン枠が全部ピックアップで埋まった
    [out[slot], out[k]] = [out[k], out[slot]];
  }
  return out;
}

/** 自動再生で同時に再生する最大の枠数 (設定。1〜16) */
function autoMaxTiles() {
  return Math.min(MAX_TILES, Math.max(1, Math.round(Number(state.settings.autoMaxTiles)) || MAX_TILES));
}

/**
 * 自動再生を新しく始めるとき (ON にしたとき) のレイアウト。今のレイアウトではなく、本数ごとの決まった形を基準に選ぶ:
 *  - メイン枠の数: 1〜4 本はメイン 1、5〜6 本はメイン 2、7〜16 本はメイン 4 (2 本だけは均等の 1×2)
 *  - 3 本以上は「メイン重視」
 *  - 基準位置は今のもの (レイアウト画面で選んだもの)
 * 始めた後の組み替えは chooseLayoutFor で、今のレイアウトを引き継ぐ (自分で選び直したものを勝手に戻さない)
 */
function autoLayoutFor(n) {
  // 2 本は均等の 1×2 (1+1 は作れず、1+2 だとサブが 1 枠空くため)
  if (n === 2) return getLayout('u1x2');
  const mains = n <= 4 ? 1 : n <= 6 ? 2 : 4;
  return chooseLayoutFor(n, { mains, kind: n >= 3 ? 'focus' : 'single', group: 'main', anchor: state.anchor });
}

function layout() {
  const l = state.layout;
  if (state.fit === 'fill') {
    // ストレッチ: 格子を均等に割り、映像は枠に合わせて拡大 (端が切れる)
    gridEl.style.gridTemplateColumns = `repeat(${l.cols}, minmax(0, 1fr))`;
    gridEl.style.gridTemplateRows = `repeat(${l.rows}, minmax(0, 1fr))`;
  } else {
    // 標準: どの枠もちょうど 16:9 になる列幅・行高を、画面に収まる最大の大きさで
    const { colW, rowH, scale } = fitScale(l);
    gridEl.style.gridTemplateColumns = colW.map((v) => `${(v * scale).toFixed(2)}px`).join(' ');
    gridEl.style.gridTemplateRows = rowH.map((v) => `${(v * scale).toFixed(2)}px`).join(' ');
  }
  visibleIndexes().forEach((i, k) => {
    const [x, y, w, h] = l.slots[k];
    const el = views[i].el;
    el.style.gridColumn = `${x + 1} / span ${w}`;
    el.style.gridRow = `${y + 1} / span ${h}`;
    el.classList.toggle('main', k < l.mains);
    // PinP の小窓はメインの上に重ねて出す
    el.style.zIndex = l.overlap && k >= l.mains ? '3' : '';
    el.classList.toggle('pip-sub', !!l.overlap && k >= l.mains);
    el.querySelector('.index').textContent = String(k + 1);
    el.querySelector('.empty-title').textContent = k < l.mains ? tr('slotMain', k + 1) : tr('slot', k + 1);
    // メイン / サブが入れ替わって弾幕の出し方が変わった枠は描き直す (チャットの読み込みも合わせる)
    if (!!views[i].dmOn !== (state.danmakuAll && tileDanmaku(i))) renderTile(i);
  });
  document.getElementById('layoutName').textContent = l.name;
  updateSlotButtons();
}

/**
 * 空き枠を減らすときのレイアウト: 今より枠数の少ないレイアウトのうち、読み込んだ配信が全部入るもの。
 * 枠数ごとの選び方は chooseLayoutFor。ちょうど合うものが無い枠数 (7・11) は飛ばすので、
 * 空き枠が一度に 2 つ消えることがある。減らせなければ null
 */
function shrinkTarget() {
  const shown = visibleIndexes();
  const filled = shown.filter((j) => state.tiles[j].videoId).length;
  for (let k = shown.length - 1; k >= Math.max(1, filled); k--) {
    const l = chooseLayoutFor(k);
    if (l.slots.length < shown.length) return l;
  }
  return null;
}

/** 上部バーの「＋」「−」と、空き枠の ✕ を押せるかどうか (枠の中身が変わるたびにまとめて 1 回) */
let slotButtonsQueued = false;
function updateSlotButtons() {
  if (slotButtonsQueued) return;
  slotButtonsQueued = true;
  queueMicrotask(() => {
    slotButtonsQueued = false;
    const canShrink = !!shrinkTarget();
    document.getElementById('addTile').disabled = state.count >= MAX_TILES;
    document.getElementById('removeTile').disabled = !canShrink;
    for (let i = 0; i < MAX_TILES; i++) {
      const btn = views[i].el.querySelector('[data-act="clear"]');
      const empty = !state.tiles[i].videoId;
      btn.disabled = empty && !canShrink;
      btn.title = !empty ? tr('tileClear') : canShrink ? tr('tileRemove') : tr('tileRemoveNo');
    }
  });
}

/**
 * 空き枠を消して、枠数の少ないレイアウトにする (上部バーの「−」と、空き枠の ✕)。
 * 読み込んだ配信は並び順のまま残す。prefer を渡すとその空き枠を先に消し、残りは後ろの空き枠から消す
 */
function removeEmptySlot(prefer = null) {
  const l = shrinkTarget();
  if (!l) return;
  const shown = visibleIndexes();
  const empties = shown.filter((j) => !state.tiles[j].videoId).reverse();
  const pick = empties.includes(prefer) ? [prefer, ...empties.filter((j) => j !== prefer)] : empties;
  const removed = pick.slice(0, shown.length - l.slots.length);
  state.order = [...shown.filter((j) => !removed.includes(j)), ...removed, ...state.order.slice(state.count)];
  setLayout(l.id);
}

/**
 * 上部バーの「＋」: 枠を 1 つ足し、今の枠数 + 1 に合ったレイアウトにする (枠数ごとの選び方は chooseLayoutFor)。
 * 今見えている枠は並び順も中身 (空き枠も) もそのまま。足した位置には空き枠が来るようにする
 * (ちょうど合うレイアウトが無い枠数では、空き枠が 2 つ以上増えることがある)
 */
function addTileSlot() {
  if (state.count >= MAX_TILES) return;
  const shown = visibleIndexes();
  const hidden = state.order.slice(state.count);
  const empty = hidden.filter((j) => !state.tiles[j].videoId);
  // 隠れている枠に中身が残っていても、それは出さずに空き枠から使う
  state.order = [...shown, ...empty, ...hidden.filter((j) => state.tiles[j].videoId)];
  setLayout(chooseLayoutFor(shown.length + 1).id);
}

function setFit(mode) {
  if (state.fit === mode) return;
  state.fit = mode;
  // 各枠のプレイヤーに、映像の拡大 (端を切る) の切り替えを伝える
  for (const v of views) {
    postToFrame(v.player, { hakomado: 'fill', on: mode === 'fill' });
  }
  layout();
  save();
}

function setLayout(id) {
  // 隠れていた枠が再び表示されても勝手に音が出ないよう、今音が出ている枠以外はミュートにする
  const keep = audibleTiles();
  state.layoutId = getLayout(id).id;
  if (state.layout.anchor) state.anchor = state.layout.anchor;
  state.tiles.forEach((t, j) => {
    if (!keep.includes(j)) t.muted = true;
  });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderAll();
  save();
}

/** 表示位置 a と b の枠を入れ替える */
function swapTiles(i, j) {
  const a = state.order.indexOf(i);
  const b = state.order.indexOf(j);
  if (a < 0 || b < 0 || a === b) return;
  [state.order[a], state.order[b]] = [state.order[b], state.order[a]];
  layout();
  save();
  restartCruise(); // 自分で並べ替えた直後に回さない
}

// ---------------------------------------------------------------- tiles

function buildTiles() {
  for (let i = 0; i < MAX_TILES; i++) {
    const el = template.content.firstElementChild.cloneNode(true);
    el.dataset.index = String(i);
    el.querySelector('.index').textContent = String(i + 1);
    el.querySelector('.empty-title').textContent = tr('slot', i + 1);
    const danmaku = new Danmaku(el.querySelector('.danmaku-layer'), () => state.settings);
    const view = { el, danmaku, player: null, chatFrame: null };
    views.push(view);

    el.querySelector('.empty').addEventListener('submit', (e) => {
      e.preventDefault();
      loadInput(i, el.querySelector('.url-input').value);
    });
    el.querySelector('.pick-ch').addEventListener('click', () => openFavorites(i, 'channels'));
    el.querySelector('.pick-fav').addEventListener('click', () => openFavorites(i, 'library'));
    el.querySelector('.pick-any').addEventListener('click', () => pickAnything(i));
    setupMixPanel(i, el);
    // マウスが枠から離れたら、枠内の YouTube プレイヤーの操作 UI を隠させ、キー操作をこの画面に戻す
    // (枠の上に重ねたつかみ範囲や操作バーを通って離れると、プレイヤー側は離れたことに気づかず UI が出たままになるため)
    el.addEventListener('pointerenter', () => setTileAway(i, false));
    el.addEventListener('pointerleave', () => setTileAway(i, true));
    el.querySelector('.bar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (btn) onBarAction(i, btn.dataset.act, e);
    });
    gridEl.appendChild(el);
  }
}

async function loadInput(i, raw) {
  const errEl = views[i].el.querySelector('.error');
  errEl.textContent = tr('loading');
  try {
    const id = await resolveVideoId(raw);
    errEl.textContent = '';
    setTileVideo(i, id, raw.trim());
  } catch (e) {
    errEl.textContent = e.message || String(e);
  }
}

function setTileVideo(i, videoId, input) {
  const prev = state.tiles[i].videoId;
  if (prev && prev !== videoId) WatchHistory.removed(prev, 'replaced');
  views[i].el.querySelector('.error').textContent = '';
  views[i].danmaku.clear();
  // 手で読み込んだ枠は自動再生でも消さない
  // 音の遅延はその配信のずれに合わせた値なので、別の動画にしたら戻す
  Object.assign(state.tiles[i], { input, videoId, auto: false, queue: false, fill: false, label: '', delay: 0 });
  // 新しく読み込んだ枠は、他に音の出ている枠が無ければ音を出す
  const anyAudible = state.tiles.some((t, j) => j !== i && isVisible(j) && t.videoId && !t.muted);
  state.tiles[i].muted = anyAudible;
  renderTile(i, { reloadPlayer: true, reloadChat: true });
  save();
}

// プレイヤーは YouTube の視聴ページをそのまま枠に入れ、content/watch.js でプレイヤー以外を隠す。
// (埋め込みプレイヤーは拡張機能のページからだと YouTube に拒否される (エラー 152) ため使わない)
function playerUrl(t) {
  const p = new URLSearchParams({
    v: t.videoId,
    // スマホ版 (m.youtube.com) に転送されると、枠の中のスクリプト (www.youtube.com 用) が動かないので PC 版を指定する
    app: 'desktop',
    hakomado: '1',
    hakomado_muted: t.muted ? '1' : '0',
    hakomado_fill: state.fit === 'fill' ? '1' : '0',
  });
  return `${YT}/watch?${p}`;
}

function chatUrl(t, replay = '') {
  if (replay) {
    // アーカイブのチャットリプレイ (replay = 枠のページから受け取った continuation)。
    // 再生位置は枠のプレイヤーから受け取って、YouTube の視聴ページと同じ形で渡す
    const r = new URLSearchParams({
      continuation: replay,
      // ライブのチャット欄 (ポップアウト) と同じ暗い見た目にする (リプレイは何も付けないと明るい見た目になる)
      dark_theme: '1',
      hakomado: '1',
      hakomado_noav: state.settings.chatHideAvatars ? '1' : '0',
    });
    return `${YT}/live_chat_replay?${r}`;
  }
  const p = new URLSearchParams({
    v: t.videoId,
    // ポップアウト (別ウィンドウ) 用のチャット画面にする。埋め込み用のチャット画面は、フィードバックなどの画面を
    // 自分では出さず、親のページ (普段は YouTube の視聴ページ) に出してもらう作りなので、この画面では出ない。
    // embed_domain (外部サイトへの埋め込み用) は付けない。付けるとコメントの ⋮ →「報告」「ブロック」の画面が出なくなる
    // (iframe への表示は background.js で X-Frame-Options を外して許可している)
    is_popout: '1',
    hakomado: '1',
    hakomado_noav: state.settings.chatHideAvatars ? '1' : '0',
  });
  return `${YT}/live_chat?${p}`;
}

// 音が出ている枠の線の色 (グラデーション)。glow は光の色 (r, g, b)
// 音が出ている枠の線の色 (6 色)。映像の上でも見分けやすい、はっきりした色に絞っている
const HL_PRESETS = {
  sky: { name: tr('colorSky'), colors: ['#8fe9ff', '#29a9ff', '#5b8cff'], glow: [41, 169, 255] },
  pink: { name: tr('colorPink'), colors: ['#ffc1e0', '#ff7ab8', '#ff4f9a'], glow: [255, 110, 170] },
  orange: { name: tr('colorOrange'), colors: ['#ffd180', '#ff9800', '#f57c00'], glow: [255, 152, 0] },
  green: { name: tr('colorGreen'), colors: ['#b9f6ca', '#00e676', '#00b248'], glow: [0, 230, 118] },
  purple: { name: tr('colorPurple'), colors: ['#e1bee7', '#b388ff', '#7c4dff'], glow: [150, 110, 255] },
  white: { name: tr('colorWhite'), colors: ['#ffffff', '#dfe6ee', '#ffffff'], glow: [255, 255, 255] },
};

// 以前の版で選べた色は、近い色に読み替える
const HL_LEGACY = {
  red: 'pink', sakura: 'pink', peach: 'orange', yellow: 'orange', lemon: 'orange', gold: 'orange', sunset: 'orange',
  mint: 'green', borealis: 'green', babyblue: 'sky', lavender: 'purple', aurora: 'purple', silver: 'white',
};

function normalizeHlStyle(id) {
  if (HL_PRESETS[id]) return id;
  return HL_LEGACY[id] || 'sky';
}

/** ライブ配信中の枠の線の色 ('none' = 線を引かない。分からない値はピンク) */
function normalizeLiveStyle(id) {
  if (id === 'none' || HL_PRESETS[id]) return id;
  return HL_LEGACY[id] || 'pink';
}

function hlGradient(p) {
  return `linear-gradient(135deg, ${p.colors.join(', ')})`;
}

/** 音が出ている枠の線・上部バー・バッジの見た目を設定に合わせる */
function applyHighlight() {
  const s = state.settings;
  const p = HL_PRESETS[normalizeHlStyle(s.hlStyle)];
  const root = document.documentElement.style;
  root.setProperty('--hl-gradient', hlGradient(p));
  root.setProperty('--hl-width', `${s.hlWidth}px`);
  const blur = Math.round(4 + s.hlGlow * 16);
  root.setProperty('--hl-glow', s.hlGlow > 0 ? `0 0 ${blur}px rgba(${p.glow.join(', ')}, ${(s.hlGlow * 0.9).toFixed(2)})` : 'none');
  document.body.classList.toggle('hl-animate', !!s.hlAnimate);
  // ライブ配信中の枠の線 (太さ・光の強さは音の枠と同じ)
  const live = HL_PRESETS[normalizeLiveStyle(s.liveStyle)];
  document.body.classList.toggle('live-off', !live);
  if (live) {
    root.setProperty('--live-gradient', hlGradient(live));
    root.setProperty('--live-glow', s.hlGlow > 0 ? `0 0 ${blur}px rgba(${live.glow.join(', ')}, ${(s.hlGlow * 0.9).toFixed(2)})` : 'none');
  }
}

/** チャット欄の見た目 (文字サイズ・アイコン) を開いているチャットへ反映 */
function applyChatLook() {
  const s = state.settings;
  document.documentElement.style.setProperty('--chat-width', `${Math.round(s.chatWidth * 100)}%`);
  document.documentElement.style.setProperty('--chat-zoom', String(Math.min(1, Math.max(0.4, Number(s.chatZoom) || 1))));
  for (const v of views) {
    postToFrame(v.chatFrame, { hakomado: 'chatLook', hideAvatars: s.chatHideAvatars });
  }
}

function renderTile(i, { reloadPlayer = false, reloadChat = false } = {}) {
  const t = state.tiles[i];
  const v = views[i];
  const el = v.el;
  const visible = isVisible(i);
  el.hidden = !visible;
  el.classList.toggle('is-empty', !t.videoId);
  el.querySelector('.url-input').value = t.input;
  updateSlotButtons();

  const danmakuOn = state.danmakuAll && tileDanmaku(i);
  v.dmOn = danmakuOn;
  const needChat = visible && !!t.videoId && (t.chat || danmakuOn);

  // --- player
  if (!visible || !t.videoId) {
    v.player?.remove();
    v.player = null;
    v.archive = null;
    v.info = null;
    v.playStatus = '';
    v.ss = null;
    v.lv = null;
    Diagnose.clear(i);
    v.meta = null;
    v.social = null;
  } else if (!v.player || reloadPlayer) {
    v.player?.remove();
    const f = document.createElement('iframe');
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    Diagnose.playerCreated(i, f);
    f.src = playerUrl(t);
    f.addEventListener('load', () => {
      f.dataset.loaded = '1';
      Diagnose.playerLoaded(i, f);
      setTimeout(() => {
        applyAudio(i);
        postToFrame(f, { hakomado: 'away', on: !el.matches(':hover') });
        // まとめて一時停止の間に読み込んだ枠も止めておく
        if (pausedAll) postToFrame(f, { hakomado: 'playback', play: false });
      }, 800);
    });
    el.querySelector('.player-slot').appendChild(f);
    v.player = f;
    WatchHistory.opened(t.videoId, { label: t.label, input: t.input });
    v.meta = null;
    v.social = null;
    v.replay = ''; // アーカイブなら、読み込んだプレイヤーがリプレイを開く鍵を知らせてくる
    el.classList.remove('is-live'); // ライブかどうかも、読み込んだプレイヤーが知らせてくる
    v.archive = null; // アーカイブなら、読み込んだプレイヤーが配信の時刻を知らせてくる (同期再生用)
    v.ss = null;
    v.lv = null; // ライブなら、画面に出ている瞬間の配信開始からの経過 (🎬 本編モード用)
    v.info = null; // 種類・視聴者数など (「ℹ 枠の情報」・同期ボタン用)。読み込んだプレイヤーが知らせてくる
    v.playStatus = ''; // 見られるか (playabilityStatus.status)
  }

  // --- chat (チャット欄 表示中 or 弾幕 ON のときだけ読み込む)
  if (!needChat) {
    v.chatFrame?.remove();
    v.chatFrame = null;
  } else if (!v.chatFrame || reloadChat) {
    v.chatFrame?.remove();
    const f = document.createElement('iframe');
    f.src = chatUrl(t, v.replay || '');
    f.addEventListener('load', () => {
      f.dataset.loaded = '1';
      Diagnose.chatLoaded(i, f);
    });
    Diagnose.chatCreated(i, f);
    el.querySelector('.chat-slot').appendChild(f);
    v.chatFrame = f;
  }
  el.classList.toggle('chat-open', !!t.videoId && t.chat);

  // --- danmaku
  v.danmaku.setEnabled(visible && danmakuOn);

  // --- bar state
  const audio = el.querySelector('.bar [data-act="audio"]');
  audio.textContent = t.muted ? '🔇' : '🔊';
  audio.classList.toggle('on', !t.muted);
  el.classList.toggle('audible', visible && !!t.videoId && !t.muted && state.count > 1);
  setToggle(el.querySelector('.bar [data-act="chat"]'), t.chat);
  setToggle(el.querySelector('.bar [data-act="danmaku"]'), tileDanmaku(i));
  renderMix(i);
  updateSocialButtons(i);
  updateFavButton(i);
  updateTileName(i);
  updateNowPlaying();
  // 枠を閉じた・別の動画にしたとき、アーカイブ同期のボタン (使えるか・理由) と「ℹ 枠の情報」も合わせる
  Sync.refresh();
  TileInfo.update();
}

/**
 * 枠のバーの「チャンネル登録」「高評価」ボタン。状態は枠のプレイヤー (YouTube のページ) が知らせてくる。
 * 済んでいれば隠す。YouTube にログインしていない / まだ分からない / 操作中は押せない
 */
function updateSocialButtons(i) {
  const v = views[i];
  const s = v.social;
  for (const [act, key, offTitle] of [
    ['subscribe', 'subscribed', 'ytSubscribe'],
    ['like', 'liked', 'ytLike'],
  ]) {
    const btn = v.el.querySelector(`.bar [data-act="${act}"]`);
    const known = !!s?.loggedIn && typeof s[key] === 'boolean';
    // 済んでいるときはボタンを出さない (解除・取り消しはしない)
    btn.hidden = known && s[key];
    btn.disabled = !known || !!v.socialBusy;
    btn.title = !s ? tr('ytChecking') : !s.loggedIn ? tr('ytLogin') : !known ? tr('ytChecking') : tr(offTitle);
  }
}

/** チャンネル登録 / 高評価を、枠のプレイヤー (YouTube のページ) に頼む。済んでいるときは何もしない (解除・取り消しはしない) */
function socialAction(i, act) {
  const v = views[i];
  const s = v.social;
  if (!s?.loggedIn || v.socialBusy || s[act === 'like' ? 'liked' : 'subscribed'] !== false) return;
  v.socialBusy = true;
  updateSocialButtons(i);
  postToFrame(v.player, { hakomado: 'social', act });
  // 返事が来なければ (プレイヤーの読み込み直しなど) 押せる状態に戻す
  setTimeout(() => {
    if (!v.socialBusy) return;
    v.socialBusy = false;
    updateSocialButtons(i);
  }, 12000);
}

// ---- 枠の 📌 (ピックアップに入れる / 外す)。ピックアップ = チャンネル一覧のうち、今注目しているもの (保存上は star: true)
const favKey = (s) => {
  try {
    return decodeURIComponent(s).toLowerCase();
  } catch {
    return String(s).toLowerCase();
  }
};

let favKeyToId = new Map(); // ピックアップのチャンネルの ID / @ハンドル (小文字) → チャンネル ID

async function refreshFavKeys() {
  const list = await Favorites.list();
  favKeyToId = new Map(
    list.filter((f) => f.star).flatMap((f) => [f.channelId, f.handle].filter(Boolean).map((k) => [favKey(k), f.channelId])),
  );
  for (let i = 0; i < MAX_TILES; i++) updateFavButton(i);
  if (favDialog.open && (favMode === 'history' || favMode === 'saved') && libScope === 'star') renderVideoList();
}

/** その枠のチャンネルがピックアップに入っていれば、そのチャンネル ID */
function pickedChannelOf(i) {
  const t = state.tiles[i];
  const m = views[i].meta;
  // 自動再生で入れた枠などは入力 (@ハンドル / チャンネル ID) で、それ以外は枠のプレイヤーが知らせてきたチャンネルで判定
  const keys = [t.input, m?.handle, m?.channelId].filter(Boolean).map(favKey);
  for (const k of keys) if (favKeyToId.has(k)) return favKeyToId.get(k);
  return null;
}

function updateFavButton(i) {
  const btn = views[i].el.querySelector('[data-act="fav"]');
  const picked = !!state.tiles[i].videoId && pickedChannelOf(i) != null;
  btn.classList.toggle('on', picked);
  btn.title = tr(picked ? 'tilePickOff' : 'tilePickOn');
  // 🔖 (この配信をあとで見るに入れているか)
  const save = views[i].el.querySelector('[data-act="save"]');
  const saved = !!state.tiles[i].videoId && savedIds.has(state.tiles[i].videoId);
  save.classList.toggle('on', saved);
  save.title = tr(saved ? 'tileSaveOff' : 'tileSaveOn');
  // 📃 (この配信をどれかの再生リストに入れているか)
  const pl = views[i].el.querySelector('[data-act="playlist"]');
  pl.classList.toggle('on', !!state.tiles[i].videoId && playlistIds.has(state.tiles[i].videoId));
  pl.title = tr('tilePlaylist');
}

// あとで見るに入れた配信の動画 ID (枠の 🔖 と、ライブラリの一覧の 🔖 の表示用)
let savedIds = new Set();
async function refreshSavedIds() {
  savedIds = new Set((await SavedVideos.list()).map((h) => h.videoId));
  for (let i = 0; i < MAX_TILES; i++) if (views[i]) updateFavButton(i);
}

// あとで見るが変わったら (このタブでも他のタブでも) 🔖 の表示と、開いている一覧を直す
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SavedVideos.KEY]) return;
  refreshSavedIds().catch(() => {});
  if (favDialog.open && isVideoMode()) renderVideoList();
  else if (favDialog.open) scheduleFavRender(); // チャンネルの行で開いたアーカイブの 🔖
});

/** 枠のバーの 🔖: この枠の配信を保存する / 外す */
async function toggleSaveTile(i) {
  const t = state.tiles[i];
  if (!t.videoId) return;
  const m = views[i].meta || {};
  const r = await SavedVideos.toggle(t.videoId, { ...m, label: t.label, input: t.input });
  if (r === 'saved') showToast(i, tr('savedAdded'));
  else if (r === 'removed') showToast(i, tr('savedRemoved'));
  else if (r === 'full') showToast(i, tr('savedFull', SavedVideos.MAX));
  await refreshSavedIds();
}

// チャンネル一覧 (ピックアップ) が変わったら (このタブでも他のタブでも) 📌 の表示を直す
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.favorites) refreshFavKeys().catch(() => {});
});

/**
 * マウスが枠の外に出た (away) / 戻った。外に出たら、プレイヤーの操作 UI (シークバーなど) を隠させ、
 * プレイヤーにキーボードのフォーカスが残っていればこの画面に戻す (数字キーや M などの操作が効くように)。
 * チャット欄で入力中のときは、フォーカスを奪わない
 */
function setTileAway(i, away) {
  const v = views[i];
  postToFrame(v.player, { hakomado: 'away', on: away });
  if (away && v.player && document.activeElement === v.player) v.player.blur();
}

/** 操作バーに出すその枠の名前 (チャンネル一覧での名前 → 配信のチャンネル名 → 入力した内容) */
function tileName(i) {
  const t = state.tiles[i];
  return t.label || views[i].meta?.channel || t.input || '';
}

/**
 * 枠の種類 (「ℹ 枠の情報」と、アーカイブ同期ボタンが使えない理由に使う)
 * 'empty' | 'live' (ライブ配信中) | 'upcoming' (配信前) | 'archive' (配信のアーカイブ) | 'video' (ふつうの動画) |
 * 'blocked' (メンバー限定などで見られない) | 'loading' (まだ分からない)
 */
function tileKind(i) {
  const v = views[i];
  if (!v || !isVisible(i) || !state.tiles[i].videoId) return 'empty';
  if (v.el.classList.contains('is-live')) return 'live';
  if (v.archive) return 'archive';
  const st = v.playStatus;
  if (st && !['OK', 'LIVE_STREAM_OFFLINE', 'CONTENT_CHECK_REQUIRED'].includes(st)) return 'blocked';
  if (v.info?.kind) return v.info.kind;
  return st === 'LIVE_STREAM_OFFLINE' ? 'upcoming' : 'loading';
}

function updateTileName(i) {
  const el = views[i].el.querySelector('.tile-name');
  const name = state.tiles[i].videoId ? tileName(i) : '';
  // 同じ配信を別のタブでも表示しているときは印を付ける (複数のディスプレイで別々に並べるときの重複に気づけるように)
  const dup = shownInOtherTab(state.tiles[i].videoId);
  el.textContent = dup ? `${name} ⧉` : name;
  el.title = dup ? `${name} (${tr('shownInOtherTab')})` : name;
}

function renderAll() {
  for (let i = 0; i < MAX_TILES; i++) renderTile(i);
  layout();
  Sync.refresh();
}

/**
 * その枠に弾幕を出すか (全体の D キーの OFF は含まない)。
 * 枠の ≋ で決めていなければ、メイン枠だけ出す (小さいサブ枠では読めないので)。
 * メインの無い均等レイアウトは、2×2 以下なら全部の枠、それより細かければ出さない
 */
function tileDanmaku(i) {
  const t = state.tiles[i];
  if (typeof t.danmaku === 'boolean') return t.danmaku;
  const l = state.layout;
  const k = visibleIndexes().indexOf(i);
  if (k < 0) return false;
  return l.mains > 0 ? k < l.mains : l.slots.length <= 4;
}

/** 上部バーの ON / OFF ボタン (文字は変えず、見た目と aria-pressed で状態を出す) */
function setToggle(btn, on) {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

// ---------------------------------------------------------------- audio

function applyAudio(i) {
  const t = state.tiles[i];
  postToFrame(views[i].player, { hakomado: 'audio', muted: t.muted });
  postToFrame(views[i].player, { hakomado: 'mix', pan: t.pan, gain: t.gain, delay: t.delay });
}

// ---- 音の左右 (パン)・音量・遅延 (枠のバーの 🎚)
// 遅延はライブ配信の音ずれ用: 映像はそのまま、音だけ遅らせる (進んでいる配信の声を、ほかの配信に合わせる)。
// 追っかけ再生を切った配信は YouTube が遅れを 1 秒ほどの幅に保つので、映像ごとは遅らせられない
const clampPan = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, Math.round(v * 100) / 100)) : 0);
const clampGain = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(2, Math.round(v * 100) / 100)) : 1);
const MAX_DELAY = 60; // 秒 (0.01 秒単位)。content/watch.js の MAX_DELAY と合わせる
const clampDelay = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(MAX_DELAY, Math.round(v * 100) / 100)) : 0);

function setMix(i, { pan, gain, delay } = {}) {
  const t = state.tiles[i];
  if (pan != null) t.pan = clampPan(pan);
  if (gain != null) t.gain = clampGain(gain);
  if (delay != null) t.delay = clampDelay(delay);
  applyAudio(i);
  renderMix(i);
  save();
}

/** バーの 🎚 (L / R の印) と、開いていればパネルの表示 */
function renderMix(i) {
  const t = state.tiles[i];
  const el = views[i].el;
  const btn = el.querySelector('.bar [data-act="mix"]');
  btn.textContent = '🎚' + (t.pan < 0 ? 'L' : t.pan > 0 ? 'R' : '');
  btn.classList.toggle('on', t.pan !== 0 || t.gain !== 1 || t.delay !== 0);
  btn.disabled = !t.videoId;
  const panel = el.querySelector('.mix-panel');
  if (!t.videoId) panel.hidden = true;
  if (panel.hidden) return;
  // 遅延の行はライブ配信のときだけ出す (アーカイブは ⏱ の同期で映像ごと合わせる)。0 以外なら戻せるように出したままにする
  const showDelay = el.classList.contains('is-live') || t.delay !== 0;
  for (const row of panel.querySelectorAll('.mix-delay-row')) row.hidden = !showDelay;
  const input = panel.querySelector('.mix-delay');
  if (document.activeElement !== input) input.value = t.delay.toFixed(2);
  for (const b of panel.querySelectorAll('[data-pan]')) b.classList.toggle('on', Number(b.dataset.pan) === t.pan);
  panel.querySelector('.mix-gain').value = String(Math.round(t.gain * 100));
  panel.querySelector('.mix-gain-value').textContent = `${Math.round(t.gain * 100)}%`;
}

/** 音の出ている 2 枠を、画面の左にあるほうを左・右にあるほうを右へ (コラボの 2 視点の聞き分け用) */
function splitStereo() {
  const audible = audibleTiles();
  if (audible.length !== 2) {
    notify(tr('mixNeed2', audible.length));
    return;
  }
  const pos = (i) => {
    const r = views[i].el.getBoundingClientRect();
    return r.left + r.width / 2;
  };
  const [left, right] = audible.sort((a, b) => pos(a) - pos(b));
  setMix(left, { pan: -1 });
  setMix(right, { pan: 1 });
  showToast(left, tr('mixLeft'));
  showToast(right, tr('mixRight'));
}

function setupMixPanel(i, el) {
  const panel = el.querySelector('.mix-panel');
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pan != null) setMix(i, { pan: Number(b.dataset.pan) });
    else if (b.dataset.mix === 'split') splitStereo();
    else if (b.dataset.delay != null) setMix(i, { delay: state.tiles[i].delay + Number(b.dataset.delay) });
    else if (b.dataset.mix === 'reset') setMix(i, { pan: 0, gain: 1, delay: 0 });
  });
  const range = panel.querySelector('.mix-gain');
  range.addEventListener('input', () => setMix(i, { gain: Number(range.value) / 100 }));
  const input = panel.querySelector('.mix-delay');
  const commit = () => {
    const v = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(v)) setMix(i, { delay: v });
    input.value = state.tiles[i].delay.toFixed(2);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      input.blur();
    }
  });
}

/**
 * 枠の iframe (YouTube) に指示を送る。読み込みが終わる前の iframe は中身がまだ空のページで、
 * 送ると「宛先のオリジンが違う」エラーになるので送らない (読み込み後に URL の指定と load 時の再送で反映される)
 */
function postToFrame(frame, msg) {
  if (!frame || frame.dataset.loaded !== '1' || !frame.contentWindow) return;
  frame.contentWindow.postMessage(msg, YT);
}

// 音声の操作は 2 通り:
//  - 拡張機能側 (枠の 🔊 / 数字キー / 上部バー / 全画面): solo。その枠だけ音を出し、他はミュート
//  - 枠内の YouTube プレイヤーのスピーカー: その枠だけ切り替え。他の枠はそのまま (複数枠の同時再生用)

/** i 番の枠の音を切り替える。solo なら i 番だけ音を出し、他はミュート */
function setAudio(i, { solo, on } = {}) {
  const t = state.tiles[i];
  if (!t.videoId) return;
  if (solo) {
    const turnOn = on ?? t.muted;
    state.tiles.forEach((x, j) => {
      x.muted = j === i ? !turnOn : true;
    });
  } else {
    t.muted = on != null ? !on : !t.muted;
  }
  refreshAudio();
  restartCruise(); // 自分で音を切り替えた直後に回さない
}

const ARROW_DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * 矢印キー: 今音が出ている枠 (無ければ 1 番) から見て、その方向にある一番近い枠だけ音を出す。
 * 方向は画面上の枠の位置 (中心) で決めるので、どのレイアウトでも見た目どおりに動く (PinP の小窓も)。
 * その方向に枠が無ければ何もしない
 */
function moveAudio([dx, dy]) {
  const filled = visibleIndexes().filter((i) => state.tiles[i].videoId);
  if (!filled.length) return;
  const cur = audibleTiles()[0];
  if (cur == null) {
    setAudio(filled[0], { solo: true, on: true });
    return;
  }
  const center = (i) => {
    const r = views[i].el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const [cx, cy] = center(cur);
  let best = null;
  for (const i of filled) {
    if (i === cur) continue;
    const [x, y] = center(i);
    const along = (x - cx) * dx + (y - cy) * dy; // 押した方向への距離
    if (along <= 1) continue;
    const across = Math.abs((x - cx) * dy) + Math.abs((y - cy) * dx); // 横へのずれ
    const score = along + across * 2; // まっすぐ先にある枠を優先
    if (!best || score < best.score) best = { i, score };
  }
  if (best) setAudio(best.i, { solo: true, on: true });
}

/** list の枠だけ音を出す (他はミュート) */
function setAudioSet(list) {
  state.tiles.forEach((t, j) => {
    t.muted = !list.includes(j);
  });
  refreshAudio();
}

function refreshAudio() {
  const now = audibleTiles();
  if (now.length) lastAudibleSet = now;
  save(); // どの枠の音が出ているかも視聴セッションに残す
  for (let j = 0; j < MAX_TILES; j++) {
    applyAudio(j);
    renderTile(j);
  }
}

/** 音の出ている (表示中の) 枠。表示順 */
function audibleTiles() {
  return visibleIndexes().filter((i) => state.tiles[i].videoId && !state.tiles[i].muted);
}

let lastAudibleSet = []; // ミュートを解除したときに戻す枠 (複数枠のこともある)

function muteAll() {
  const now = audibleTiles();
  if (now.length) lastAudibleSet = now;
  state.tiles.forEach((t) => (t.muted = true));
  refreshAudio();
}

/** 上部バーの音声ボタン / M キー: 音が出ていればミュート、全部ミュートなら直前の状態 (複数枠ならその全部) に戻す */
// まとめて一時停止中か (開き直したときは再生に戻るので保存しない)
let pausedAll = false;

/** 全部の枠をまとめて一時停止 / 再開する (再開するとき、ライブ配信は最新の位置に戻す) */
function togglePauseAll() {
  pausedAll = !pausedAll;
  for (const i of visibleIndexes()) {
    if (!pausedAll && Sync.isWaiting(i)) continue; // 同期の「止めて待つ」中の枠は、止めたままにする
    postToFrame(views[i].player, { hakomado: 'playback', play: !pausedAll });
  }
  updatePauseButton();
}

function updatePauseButton() {
  const btn = document.getElementById('pauseAll');
  setToggle(btn, pausedAll);
  // 再開の印は ⏯ (▶ は「前回の続きから」などの選択肢で使っているので、見分けがつくように)
  btn.querySelector('.tb-icon').textContent = pausedAll ? '⏯' : '⏸';
  btn.querySelector('.tb-label').textContent = tr(pausedAll ? 'resumeAll' : 'pauseLabel');
}

function toggleMuteAll() {
  if (audibleTiles().length) {
    muteAll();
    return;
  }
  const restore = lastAudibleSet.filter((i) => isVisible(i) && state.tiles[i].videoId);
  if (restore.length) {
    setAudioSet(restore);
  } else {
    const first = visibleIndexes().find((i) => state.tiles[i].videoId);
    if (first != null) setAudio(first, { solo: true, on: true });
  }
}

/** 上部バーに、今どの枠から音が出ているかを表示 */
function updateNowPlaying() {
  const btn = document.getElementById('nowPlaying');
  if (!btn || views.length < MAX_TILES) return;
  const now = audibleTiles();
  btn.classList.toggle('on', now.length > 0);
  if (now.length === 0) {
    btn.replaceChildren(tr('muted'));
    btn.title = tr('mutedTitle');
    return;
  }
  const order = visibleIndexes();
  const parts = now.map((i) => {
    return { n: order.indexOf(i) + 1, name: tileName(i) };
  });
  const num = document.createElement('b');
  num.className = 'np-num';
  num.textContent = parts.map((p) => p.n).join('・');
  const name = document.createElement('span');
  name.className = 'np-name';
  name.textContent = parts.length === 1 ? parts[0].name : tr('multiAudio', parts.length);
  btn.replaceChildren('🔊 ', num, name);
  const list = parts.map((p) => `${p.n}: ${p.name || tr('loadingName')}`).join('\n');
  btn.title = `${list}\n${tr('clickToMute')}`;
}

// ---------------------------------------------------------------- 上部バーの幅
// 入りきらないときは、ボタンの文字を消してアイコンだけにする (compact)。それでも入らなければ、
// 今の音声のチャンネル名も消して番号だけにする (tiny)。決めた幅の境目ではなく、実際に並べてはみ出すかで決める
// (アーカイブ同期中のつまみ・言語・レイアウト名などで、要る幅が変わるため)
let fitQueued = false;
function fitToolbar() {
  fitQueued = false;
  const bar = document.querySelector('.toolbar');
  const over = () => bar.scrollWidth > bar.clientWidth + 1;
  bar.classList.add('measuring');
  bar.classList.remove('compact', 'tiny');
  if (over()) {
    bar.classList.add('compact');
    if (over()) bar.classList.add('tiny');
  }
  bar.classList.remove('measuring');
}
function queueFitToolbar() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(fitToolbar);
}
function setupToolbarFit() {
  const bar = document.querySelector('.toolbar');
  new ResizeObserver(queueFitToolbar).observe(bar);
  // 中身が変わったとき (今の音声の名前・同期のつまみを出す / 隠す・レイアウト名など)。
  // 測るときに付け外しする class は見ない (見ると測り直しが止まらなくなる)
  new MutationObserver(queueFitToolbar).observe(bar, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  queueFitToolbar();
}

// ---------------------------------------------------------------- bar actions

function onBarAction(i, act, e) {
  const t = state.tiles[i];
  switch (act) {
    case 'audio':
      setAudio(i, { solo: true });
      return;
    case 'danmaku':
      t.danmaku = !tileDanmaku(i);
      if (t.danmaku && !state.danmakuAll) {
        state.danmakuAll = true;
        renderAll();
      } else {
        renderTile(i);
      }
      break;
    case 'chat':
      t.chat = !t.chat;
      renderTile(i);
      layout();
      break;
    case 'syncAdj':
      Sync.openFor(i);
      break;
    case 'mix': {
      const panel = views[i].el.querySelector('.mix-panel');
      panel.hidden = !panel.hidden;
      renderMix(i);
      return;
    }
    case 'reload':
      renderTile(i, { reloadPlayer: true, reloadChat: true });
      return;
    case 'fav':
      addTileToFavorites(i);
      return;
    case 'subscribe':
    case 'like':
      socialAction(i, act);
      return;
    case 'save':
      toggleSaveTile(i);
      return;
    case 'playlist':
      if (t.videoId) openPlaylistPicker({ ...views[i].meta, label: t.label, input: t.input, videoId: t.videoId });
      return;
    case 'max':
      toggleFullscreen(i);
      return;
    case 'clear':
      // 空き枠の ✕ は枠ごと消して、枠数の少ないレイアウトにする
      if (!t.videoId) {
        removeEmptySlot(i);
        return;
      }
      // 自動再生 ON の間に自分で閉じた配信は入れ直さない
      if (t.videoId) autoDismissed.add(t.videoId);
      WatchHistory.removed(t.videoId, 'closed');
      state.tiles[i] = newTileState();
      views[i].danmaku.clear();
      renderTile(i);
      // 自動再生中は空いた枠を残さず、残りの件数に合ったレイアウトに詰める
      if (state.autoMode) compactToContent();
      else layout();
      break;
  }
  save();
}

// ---------------------------------------------------------------- fullscreen (1 枠だけ全画面)

let fullscreenAudioBefore = null; // 全画面にする前に音が出ていた枠の一覧 (戻したときに復元。[] = ミュートだった)
let fullscreenTile = null;

// ---- 分割したままの全画面 (上部バーを隠して画面全体を枠に使う)
// F11 (ブラウザの全画面) のときも同じく上部バーを隠す。上端にマウスを寄せるとバーが出る
const browserFullscreenQuery = matchMedia('(display-mode: fullscreen)');

async function toggleGridFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    // 枠の全画面の上に重なっていた場合は、もう一段戻す
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch (e) {
    console.warn('hakomado: 全画面にできませんでした', e);
  }
}

function updateGridFullscreen() {
  const appFs = document.fullscreenElement === document.documentElement;
  document.body.classList.toggle('grid-fs', appFs || browserFullscreenQuery.matches);
  setToggle(document.getElementById('gridFullscreen'), appFs);
}
browserFullscreenQuery.addEventListener('change', updateGridFullscreen);

/** 1 つの枠が全画面になっているか (分割したままの全画面とは別) */
function isTileFullscreen() {
  return !!document.fullscreenElement?.classList?.contains('tile');
}

async function toggleFullscreen(i) {
  const el = views[i].el;
  if (document.fullscreenElement === el) {
    // 分割したままの全画面から開いていた場合は、そちらに戻る
    await document.exitFullscreen().catch(() => {});
    return;
  }
  if (!state.tiles[i].videoId) return;
  // 別の枠が全画面中なら、その状態 (音声の復元先) を引き継いだまま切り替える
  if (!isTileFullscreen()) fullscreenAudioBefore = audibleTiles();
  try {
    await el.requestFullscreen();
  } catch (e) {
    console.warn('hakomado: 全画面にできませんでした', e);
    fullscreenAudioBefore = null;
    return;
  }
  fullscreenTile = i;
  // 全画面で見る枠だけ音を出す (複数枠で鳴らしていても、全画面中はその枠だけ)
  setAudio(i, { solo: true, on: true });
}

document.addEventListener('fullscreenchange', () => {
  updateGridFullscreen();
  if (isTileFullscreen()) return;
  // 枠の全画面を終えたら (分割したままの全画面に戻った場合も)、その前に音が出ていた枠に戻す
  // (全画面中に自分で別の枠の音に切り替えていたら、それを尊重して何もしない)
  const before = fullscreenAudioBefore;
  const fsTile = fullscreenTile;
  fullscreenAudioBefore = null;
  fullscreenTile = null;
  if (before == null) return;
  const now = audibleTiles();
  if (!(now.length === 1 && now[0] === fsTile)) return;
  if (before.length === 0) muteAll();
  else setAudioSet(before.filter((j) => isVisible(j) && state.tiles[j].videoId));
});

// ---------------------------------------------------------------- chat messages → danmaku

window.addEventListener('message', (e) => {
  if (e.origin !== YT) return;
  const data = e.data;
  if (!data || (data.hakomado !== 'chat' && data.hakomado !== 'chatReady')) return;
  const i = views.findIndex((v) => v.chatFrame && v.chatFrame.contentWindow === e.source);
  if (i < 0) return;
  Diagnose.chatSeen(i);
  if (data.hakomado !== 'chat' || !Array.isArray(data.messages)) return;
  for (const msg of data.messages.slice(0, 50)) views[i].danmaku.add(msg);
});

// ---------------------------------------------------------------- ⏱ アーカイブの同期再生
// コラボ配信を、参加者それぞれの視点のアーカイブで、同じ瞬間にそろえて見る。
// - そろえる基準は実際の時刻: 各アーカイブの 0 秒 = その配信が始まった時刻 (動画の liveBroadcastDetails.startTimestamp)。
//   ずれ (配信の遅延の違いなど) は、同期の調整パネル (画面の右の列) で直せる (← → キー・◀ ▶・0.01 秒単位で秒数を直接入れる)。
//   ずれは動画ごとに記録する (SyncOffsets)。別の枠に入れても、次に開いても、視聴セットで人に渡しても同じ値を使う
// - アーカイブは冒頭 (開始前の待機画面など) が切られていることがあり、そのときは「0 秒 = 開始時刻」がずれる。
//   配信していた時間 (end − start) よりアーカイブが短ければパネルに知らせ、冒頭が切られた場合の値を候補として出す
// - 同期グループ: A・B と C・D のように、別々の組でそろえられる (最大 4 組)。時間帯が重なるアーカイブどうしを自動でまとめ
//   (SyncGroups)、パネルの各行で手で付け替えられる (手で決めた分は、その枠の中身が変わるまで保つ)。
//   グループごとに、そろえ方 (🕒 実際の時刻 / 🎬 本編)・基準の枠・「同期の時計」・一時停止・つまみを持つ
// - 時計は基準の枠の再生位置に合わせて進む (基準の枠の中で一時停止・シークすると、同じグループのほかの枠もついてくる)。
//   ほかの枠は時計に合わせてシーク・一時停止・再生・速度の微調整 (少しのずれは速度で吸収し、大きくずれたときだけシーク) を受ける
// - 実際の時刻のグループでは、基準の枠と配信の時間帯 (開始〜終了) が重ならないアーカイブは同期しない (手で入れたときだけ起きる)。
//   まだ始まっていない / もう終わっている時刻の枠は止めて、そのことを枠に出す
// - 広告中の枠は待たずに進め、広告が終わったら追いつかせる
// - 上部バーのつまみは、音を出している枠のグループ (無ければ番号の小さいグループ) を動かす。各グループのつまみはパネルにある
// - 基準の枠は、グループができたときに音を出している枠 (複数ならレイアウトで一番前、無ければ先頭)。その後は音を切り替えても
//   変わらない (音を聞き比べるたびに基準が黙って変わらないように)。基準の枠には「基準」の印を付け、パネルの ◉ で選び直せる。
//   基準の枠を閉じたら、同じ決め方で選び直して知らせる
// - 「止めて待つ」: 先に進んでいる枠を止めて、ほかが追いつくのを待ってから再生すると、そこでずれが決まる。
//   基準でない枠は、枠の中のプレイヤーで一時停止するだけでよい (同期が再生し直さず待つ)。基準の枠を含め、パネルの ⏸ でもできる
//   (基準の枠をプレイヤーで一時停止したときは、これまでどおりグループ全部が止まる)。待っている間は、時計は基準の枠に合わせず進む
// - 基準でない枠を、枠の中のプレイヤーでシーク (シークバー・← → キー) すると、引き戻さずに、その位置でずれを決める
//   (進みすぎた枠をシークバーで戻す、など)。基準の枠をシークしたときは、これまでどおりほかの枠がついてくる
// - ずれを変えたら (パネル・止めて待つ・シーク・🎧)、直前の値に 1 回だけ戻せる (パネルの「元に戻す」)
// ON / OFF は保存しない (開き直したら OFF。視聴セットを開いたときは、ずれが入っていれば自動で ON にする)
//
// 🎬 本編モード (パネルのグループの見出しで「🕒 実際の時刻 / 🎬 本編」を切り替える): 時間のずれた同時視聴 (先月のアーカイブと今のライブなど) を、
// 見ている作品 (映画など) の同じ場面でそろえる。実際の時刻は使わない
// - 動画ごとに「本編 0:00 に当たる再生位置」(MovieAnchors) を持つ。パネルの「▶ ここが 0:00」か「今は本編の h:mm:ss」で決める。
//   ライブは配信開始からの経過で表す (プレイヤーが知らせる、画面に出ている瞬間の実際の時刻から。見ている人の遅れによらない)
// - 時計 = 本編の時刻 (ミリ秒)。ほかの枠の目標位置 = 本編の位置 + 時計。シーク・速度・止めて待つなどは実際の時刻のときと同じ
// - 本編モードにしたグループは、そのときの枠を手で決めたことにする (自動のまとめ直しで崩れないように)。ライブは手で入れる
// - ライブは基準にだけできる (動かせないため)。ライブが基準なら、時計はライブの位置で進む (止められない)
// - 本編の位置を決めていない枠は動かさず、そのことを枠に出す。時間帯の重なりも配信の開始時刻も要らない
const Sync = (() => {
  const TICK_MS = 500;
  const SEEK_DRIFT = 2; // これ以上ずれたらシーク (秒)
  // 音を重ねて聞いても気にならないよう、数十ミリ秒までそろえる。少しのずれは速度をわずかに変えて詰める
  // (始める・やめるの幅を変えて、行ったり来たりしないように)
  const RATE_DRIFT = 0.04; // これ以上ずれたら速度で詰め始める (秒)
  const RATE_STOP = 0.012; // 詰めている途中は、ここまで詰める (秒)
  const FORCE_SEEK_DRIFT = 0.5; // ずれを変えた直後は、これ以上ずれていればシークする (細かな変更は速度で詰める)
  const SEEK_GAP_MS = 3000; // 同じ枠を続けてシークしない (読み込み中の位置で判断してシークし直さないように)
  const CMD_GAP_MS = 1500; // 再生・一時停止の指示を続けて送らない

  let on = false;
  let timer = 0;
  /**
   * @typedef {{g: number, mode: 'time'|'movie', ref: number|null, clock: {R0: number, at: number, playing: boolean},
   *   holdUntil: number, paused: boolean, init: boolean, lo: number, hi: number, dragging: boolean}} Group
   * mode: 'time' = 実際の時刻 / 'movie' = 🎬 本編。clock の R = 実際の時刻か本編の時刻 (ミリ秒)。
   * holdUntil: つまみで動かした直後は、基準の枠が追いつくまで時計を基準に合わせない。paused: パネルの ⏸ で止めた。
   * init: 時計をまだ基準の枠に合わせていない。lo / hi: つまみの範囲
   */
  /** @type {Map<number, Group>} */
  const groups = new Map();
  const manual = new Map(); // i -> {vid, g} 手で決めたグループ (0 = 同期しない)。枠の中身が変わったら捨てる
  let assigned = { groups: new Map(), excluded: new Map() }; // 今のグループ分け (SyncGroups.assign の結果)
  const sent = new Map(); // i -> {seekAt, cmd, cmdAt, rate}
  const forceSeek = new Set(); // ずれを微調整した枠 (速度で詰めず、すぐシークする)
  const waiting = new Map(); // i -> {paused} 「止めて待つ」中の枠 (paused = 止まったのを確かめた)
  const seenSeeks = new Map(); // i -> 最後に見た、枠の中でユーザーがシークした回数
  const drift = new Map(); // i -> 'ok' | 'fix' | 'ref' 追いつき具合 (パネルの点)
  let lastChange = null; // 元に戻せる、直前のずれの変更: [{vid, movie, prev, at}]
  const UNDO_MERGE_MS = 5000; // 同じ枠をこの間隔より短く続けて動かしたら、1 回の変更にまとめる

  const now = () => performance.now();
  const newGroup = (g, mode = 'time') => ({ g, mode, ref: null, clock: { R0: 0, at: 0, playing: true }, holdUntil: 0, paused: false, init: true, lo: 0, hi: 1000, dragging: false });
  const nowR = (G) => (G.clock.playing ? G.clock.R0 + (now() - G.clock.at) : G.clock.R0);
  const setClock = (G, R, playing) => (G.clock = { R0: R, at: now(), playing });
  const off = (i) => SyncOffsets.get(state.tiles[i].videoId);
  const anchor = (i) => MovieAnchors.get(state.tiles[i].videoId);
  const isMovie = (G) => G.mode === 'movie';
  /** 動かせる枠 (アーカイブ。再生位置と長さが分かる) */
  const movable = (i) => isVisible(i) && !!state.tiles[i].videoId && !!views[i].archive;
  /** 本編モードで基準にできるライブの枠 (位置の知らせが届いている) */
  const liveTile = (i) => isVisible(i) && !!state.tiles[i].videoId && !views[i].archive && !!views[i].lv;
  /** 同期に加われる枠 (グループに入れられる) */
  const candidate = (i) => movable(i) || liveTile(i);
  /** グループ G に加われる枠 (実際の時刻: アーカイブ / 本編: アーカイブとライブ) */
  const fits = (G, i) => movable(i) || (isMovie(G) && liveTile(i));
  const timeRange = (i) => [views[i].archive.start, views[i].archive.start + views[i].archive.dur * 1000];
  const rangeOf = (G, i) => {
    if (isMovie(G)) {
      const a = anchor(i);
      if (a == null || !views[i].archive) return [-Infinity, Infinity];
      return [-a * 1000, (views[i].archive.dur - a) * 1000];
    }
    return timeRange(i);
  };
  const overlapsTime = (i, j) => {
    const [a, b] = timeRange(i);
    const [c, d] = timeRange(j);
    return a < d && c < b;
  };
  /** 今の再生位置 (秒)。最後に届いた位置から、再生中なら経った分を足す */
  const posOf = (i) => {
    const lv = views[i].lv;
    if (lv && !views[i].archive) return lv.pos + (lv.ps === 1 ? (now() - lv.at) / 1000 : 0); // ライブ: 配信開始からの経過
    const ss = views[i].ss;
    if (!ss) return null;
    const moving = ss.ps === 1 && !ss.ad;
    return ss.t + (moving ? ((now() - ss.at) / 1000) * (ss.r || 1) : 0);
  };
  // 時計の時刻 R (実際の時刻か本編の時刻。ミリ秒) と、枠の再生位置 t (秒) の読み替え
  const realOf = (G, i, t) => (isMovie(G) ? (t - anchor(i)) * 1000 : views[i].archive.start + (t - off(i)) * 1000);
  const targetOf = (G, i, R) => (isMovie(G) ? anchor(i) + R / 1000 : (R - views[i].archive.start) / 1000 + off(i));

  // ---- グループ分け
  /** 今の枠でのグループ分けを求める (中身が変わった枠の手の決めごとは捨てる) */
  function computeAssign(prev) {
    for (const [i, m] of manual) if (state.tiles[i].videoId !== m.vid || !candidate(i)) manual.delete(i);
    const tiles = visibleIndexes()
      .filter(candidate)
      .map((i) => ({ i, range: movable(i) ? timeRange(i) : null }));
    return SyncGroups.assign(tiles, new Map([...manual].map(([i, m]) => [i, m.g])), prev);
  }
  /** グループ分けをし直して、グループの状態 (モード・基準・時計) を合わせる */
  function regroup() {
    const prev = new Map();
    for (const [g, list] of assigned.groups) for (const i of list) prev.set(i, g);
    const a = computeAssign(prev);
    for (const [g, list] of [...a.groups]) {
      if (!groups.has(g)) groups.set(g, newGroup(g));
      const G = groups.get(g);
      // 実際の時刻のグループに手で入れたライブは、加われない
      const ok = list.filter((i) => fits(G, i));
      for (const i of list) if (!ok.includes(i)) a.excluded.set(i, 'live');
      if (ok.length) a.groups.set(g, ok);
      else a.groups.delete(g);
    }
    for (const g of [...groups.keys()]) if (!a.groups.has(g)) groups.delete(g);
    assigned = a;
  }
  const membersOf = (g) => assigned.groups.get(g) || [];
  /** 同期できるグループ (2 本以上で、動かせる枠がある) */
  const active = (G) => {
    const list = membersOf(G.g);
    return list.length >= 2 && list.some(movable);
  };
  const activeGroups = () => [...groups.values()].filter(active);
  /** 枠 i の入っているグループ (同期できないグループも含む) */
  function groupOfTile(i) {
    for (const [g, list] of assigned.groups) if (list.includes(i)) return groups.get(g);
    return null;
  }
  /** 共有・再生リストに使うグループ (番号の一番小さい、同期できるグループ) */
  const primary = () => (on ? (activeGroups()[0] ?? null) : null);
  /** 上部バーのつまみで動かすグループ: 音を出している枠のグループ (無ければ primary) */
  function topGroup() {
    for (const i of audibleTiles()) {
      const G = groupOfTile(i);
      if (G && active(G)) return G;
    }
    return primary();
  }
  const GROUP_COLORS = ['#f5b942', '#5ad19a', '#c08cff', '#ff8a5c'];
  const colorOf = (g) => GROUP_COLORS[(g - 1) % GROUP_COLORS.length];

  /** 基準にする枠の初期値: 音を出している枠 (複数ならレイアウトで一番前)。無ければ先頭。本編モードでライブがあればライブ */
  function initialReference(G, list = membersOf(G.g)) {
    if (isMovie(G)) {
      const live = list.find(liveTile); // ライブは動かせないため
      if (live != null) return live;
    }
    return list.find((i) => !state.tiles[i].muted) ?? list[0] ?? null;
  }
  /** グループの基準の枠 (グループから外れていたら選び直す。閉じられていたら知らせる) */
  function reference(G) {
    const list = membersOf(G.g);
    if (G.ref == null || !list.includes(G.ref) || (isMovie(G) && list.some(liveTile) && !liveTile(G.ref))) {
      const prev = G.ref;
      G.ref = initialReference(G, list);
      if (on && prev != null && G.ref != null && !candidate(prev)) notify(tr('syncRefMoved', refLabel(G.ref)));
    }
    return G.ref;
  }
  const tileNo = (i) => visibleIndexes().indexOf(i) + 1;
  const refLabel = (i) => `${tileNo(i)} ${tileName(i) || ''}`.trim();

  /** 基準の枠を選び直す (時計はそのまま。新しい基準の枠も、今の時刻に合っているので飛ばない) */
  function setReference(i) {
    const G = on ? groupOfTile(i) : null;
    if (!G || i === G.ref || !fits(G, i) || (isMovie(G) && !liveTile(i) && membersOf(G.g).some(liveTile))) return;
    G.ref = i;
    if (G === primary()) playlistRefChanged(state.tiles[i].videoId);
    G.holdUntil = 0;
    forceSeek.delete(i);
    rate(i, 1);
    tick();
  }

  /** 同期を始められるか: 'time' = 時間帯の重なるアーカイブがある / 'movie' = 無いが、本編モードならできる / null */
  function canStart() {
    if (on) return null;
    const a = computeAssign(new Map());
    for (const list of a.groups.values()) if (list.length >= 2) return 'time';
    const c = visibleIndexes().filter(candidate);
    return c.length >= 2 && c.some(movable) ? 'movie' : null;
  }

  function send(i, msg) {
    postToFrame(views[i].player, { hakomado: 'sync', ...msg });
  }
  function seek(i, t) {
    const s = sent.get(i) || {};
    if (now() - (s.seekAt || 0) < SEEK_GAP_MS) return;
    send(i, { op: 'seek', t });
    sent.set(i, { ...s, seekAt: now() });
  }
  function cmd(i, op) {
    const s = sent.get(i) || {};
    if (s.cmd === op && now() - (s.cmdAt || 0) < CMD_GAP_MS) return;
    send(i, { op });
    sent.set(i, { ...s, cmd: op, cmdAt: now() });
  }
  function rate(i, r) {
    const s = sent.get(i) || {};
    if (s.rate === r) return;
    send(i, { op: 'rate', r });
    sent.set(i, { ...s, rate: r });
  }

  const pad = (n) => String(n).padStart(2, '0');
  const clockText = (ms) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const spanText = (sec) => hms(Math.ceil(sec));
  /** 本編の時刻 (ミリ秒) → 「本編 0:47:12」(本編の前なら − を付ける) */
  const movieText = (ms) => tr('movieClock', (ms < 0 ? '−' : '') + hms(Math.floor(Math.abs(ms) / 1000)));

  function overlay(i, text) {
    const el = views[i].el.querySelector('.sync-overlay');
    el.hidden = !text;
    if (text && el.textContent !== text) el.textContent = text;
  }

  function tick() {
    if (!on) return;
    regroup();
    const act = activeGroups();
    // 同期できるグループが無くなった (手で分けている途中は、そのまま待つ)
    if (!act.length && !manual.size) {
      stop();
      notify(tr('syncStopped'));
      return;
    }
    const touched = new Set();
    for (const G of act) {
      tickGroup(G);
      for (const i of membersOf(G.g)) touched.add(i);
    }
    // グループに入っていない (同期できないグループの) 枠は、ふつうに再生させる
    for (const i of visibleIndexes()) {
      if (touched.has(i)) continue;
      waiting.delete(i);
      drift.delete(i);
      if (movable(i)) rate(i, 1);
      overlay(i, '');
    }
    updateTop();
    updateMarks();
    Dock.update();
  }

  /** 時計を基準の枠に合わせ直す (グループができたとき・そろえ方を変えたとき) */
  function initClock(G) {
    const ref = reference(G);
    const p = posOf(ref);
    const R0 = isMovie(G) ? (anchor(ref) != null && p != null ? realOf(G, ref, p) : 0) : p != null ? realOf(G, ref, p) : rangeOf(G, ref)[0];
    setClock(G, R0, !pausedAll && !G.paused);
    G.init = false;
  }

  function tickGroup(G) {
    const list = membersOf(G.g);
    const ref = reference(G);
    if (G.init) initClock(G);
    const movie = isMovie(G);
    // 時計を基準の枠に合わせる (基準の枠が配信の時間帯の中で、知らせが新しく、広告中でないとき)
    const rs = views[ref].ss;
    let playing = !pausedAll && !G.paused;
    let R = nowR(G);
    if (movie && liveTile(ref)) {
      // ライブが基準: 時計はライブの位置で進む (止められない)。本編の位置を決めるまでは、時計はそのまま
      const lv = views[ref].lv;
      if (anchor(ref) != null && now() - lv.at < 3000) {
        R = realOf(G, ref, posOf(ref));
        playing = lv.ps === 1;
      }
    } else if (now() > G.holdUntil && !waiting.has(ref) && rs && !rs.ad && now() - rs.at < 2000 && (!movie || anchor(ref) != null)) {
      const [s, e] = rangeOf(G, ref);
      const Rref = realOf(G, ref, posOf(ref));
      if (Rref >= s && Rref < e - 1000) {
        R = Rref;
        if (rs.ps === 2) playing = false; // 基準の枠の中で一時停止した → グループ全部止める
      }
    }
    setClock(G, R, playing);

    // 本編モードで基準の枠の本編の位置がまだ無ければ、時計が決まらないので、ほかの枠も動かさない
    const idle = movie && anchor(ref) == null;
    for (const i of list) {
      if (idle && i !== ref && anchor(i) != null) {
        overlay(i, tr('movieNeedRefAnchor'));
        if (!liveTile(i)) rate(i, 1);
        drift.delete(i);
        continue;
      }
      if (movie && anchor(i) == null) {
        overlay(i, tr('movieNeedAnchor')); // 本編の位置を決めるまでは動かさない
        if (!liveTile(i)) rate(i, 1);
        drift.delete(i);
        continue;
      }
      if (movie && liveTile(i)) {
        overlay(i, i === ref ? '' : tr('movieLiveRefOnly')); // ライブは動かせない
        if (i === ref) drift.set(i, 'ref');
        else drift.delete(i);
        continue;
      }
      const userSeek = sawUserSeek(i);
      const inRange = movie || i === ref || overlapsTime(i, ref);
      if (waiting.has(i) && inRange) {
        tickWaiting(G, i);
        continue;
      }
      if (!inRange) {
        // 時間帯が重ならない (手で入れた枠): 同期しない (ふつうに再生させる)
        overlay(i, tr('syncNoOverlap'));
        rate(i, 1);
        drift.delete(i);
        continue;
      }
      // 基準の枠は動かさない (つまみで動かした直後だけ、ほかと同じように合わせる)
      if (i === ref && now() > G.holdUntil) {
        overlay(i, '');
        drift.set(i, 'ref');
        rate(i, 1);
        continue;
      }
      const ss = views[i].ss;
      const [s, e] = rangeOf(G, i);
      if (R < s) {
        overlay(i, movie ? tr('movieStartsLater', hms(Math.ceil(s / 1000))) : tr('syncStartsIn', spanText((s - R) / 1000)));
        cmd(i, 'pause');
        if (ss && ss.t > 1) seek(i, 0);
        drift.delete(i);
        continue;
      }
      if (R >= e) {
        overlay(i, tr('syncEnded'));
        cmd(i, 'pause');
        drift.delete(i);
        continue;
      }
      overlay(i, '');
      if (!ss || ss.ad) continue; // 広告中は待たずに進める (終わったら追いつかせる)
      // 枠の中のプレイヤーでシークした → 引き戻さず、その位置でずれを決める
      if (userSeek) {
        adoptOffset(G, i, R);
        continue;
      }
      // 枠の中のプレイヤーで一時停止した → 再生し直さず、ほかが追いつくのを待つ
      if (playing && ss.ps === 2 && ss.up && now() - ss.at < 2000) {
        beginWait(i, true);
        continue;
      }
      const target = targetOf(G, i, R);
      const d = posOf(i) - target;
      if (!playing) {
        rate(i, 1);
        if (ss.ps === 1 || ss.ps === 3) cmd(i, 'pause');
        if (Math.abs(d) > 0.5) seek(i, target);
        drift.set(i, Math.abs(d) > 0.5 ? 'fix' : 'ok');
        continue;
      }
      if (ss.ps !== 1 && ss.ps !== 3) cmd(i, 'play');
      const ad = Math.abs(d);
      const correcting = (sent.get(i)?.rate ?? 1) !== 1;
      if (ad > SEEK_DRIFT || (forceSeek.has(i) && ad > FORCE_SEEK_DRIFT)) {
        forceSeek.delete(i);
        rate(i, 1);
        seek(i, target + 0.2); // 読み込みに掛かる分、少し先へ (速度で詰め始めるずれより小さく)
        drift.set(i, 'fix');
      } else if (ad > RATE_DRIFT || (correcting && ad > RATE_STOP)) {
        // 3 秒ほどで詰め終わる速さ (1〜10% 速く / 遅く。0.5% 単位で丸めて、指示を送り直しすぎないように)
        forceSeek.delete(i);
        const k = Math.round(Math.min(0.1, Math.max(0.01, ad / 3)) * 200) / 200;
        rate(i, d > 0 ? 1 - k : 1 + k);
        drift.set(i, 'fix');
      } else {
        forceSeek.delete(i);
        rate(i, 1);
        drift.set(i, 'ok');
      }
    }
    groupRange(G, list);
  }

  /** つまみの範囲: グループの枠の時間帯を全部まとめた範囲 (本編モードは 0:00 から、一番長く続く枠の終わりまで) */
  function groupRange(G, list) {
    const ranges = list.map((i) => rangeOf(G, i)).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    G.lo = isMovie(G) ? Math.min(0, ...ranges.map((r) => r[0])) : Math.min(...ranges.map((r) => r[0]));
    G.hi = ranges.length ? Math.max(...ranges.map((r) => r[1])) : G.lo + 1000;
  }

  /** つまみ (上部バーかパネル) を、グループ G の今に合わせる */
  function fillSeek(input, nowEl, endEl, G) {
    const text = isMovie(G) ? movieText : clockText;
    input.dataset.g = String(G.g);
    input.dataset.lo = String(G.lo);
    input.max = String(Math.max(1, Math.round((G.hi - G.lo) / 1000)));
    input.disabled = isMovie(G) && G.ref != null && liveTile(G.ref); // ライブが基準なら動かせない
    if (!G.dragging) {
      input.value = String(Math.round((nowR(G) - G.lo) / 1000));
      nowEl.textContent = text(nowR(G));
    }
    endEl.textContent = text(G.hi);
  }
  /** つまみを動かしている途中 (時刻だけ出す) と、放したとき (グループ全部をその時刻へ) */
  function bindSeek(input, nowEl) {
    const groupOf = () => groups.get(Number(input.dataset.g));
    input.addEventListener('input', () => {
      const G = groupOf();
      if (!G) return;
      G.dragging = true;
      nowEl.textContent = (isMovie(G) ? movieText : clockText)(Number(input.dataset.lo) + Number(input.value) * 1000);
    });
    input.addEventListener('change', () => {
      const G = groupOf();
      input.blur();
      if (!G) return;
      G.dragging = false;
      seekGroup(G, Number(input.dataset.lo) + Number(input.value) * 1000);
    });
  }
  /** グループ全部を、時計の時刻 R へ動かす (基準の枠が追いつくまで、時計は基準の枠に合わせない) */
  function seekGroup(G, R) {
    setClock(G, R, !pausedAll && !G.paused);
    G.holdUntil = now() + 4000;
    for (const i of membersOf(G.g)) sent.delete(i);
    tick();
  }

  /** 上部バー: 音を出している枠のグループのつまみ (グループが 2 つ以上なら、色と番号を出す) */
  function updateTop() {
    const G = topGroup();
    const seekEl = document.getElementById('syncSeek');
    const dot = document.getElementById('syncGroupDot');
    if (!G) {
      seekEl.disabled = true;
      dot.hidden = true;
      return;
    }
    fillSeek(seekEl, document.getElementById('syncNow'), document.getElementById('syncEnd'), G);
    dot.hidden = activeGroups().length < 2;
    dot.textContent = String(G.g);
    dot.style.setProperty('--g', colorOf(G.g));
    seekEl.title = tr('syncSeekGroup', G.g);
  }

  /** グループの一時停止 / 再開 (パネルの ⏸)。止めて待っている枠は止めたまま */
  function togglePauseGroup(G) {
    G.paused = !G.paused;
    for (const i of membersOf(G.g)) {
      if (!G.paused && waiting.has(i)) continue;
      postToFrame(views[i].player, { hakomado: 'playback', play: !G.paused && !pausedAll });
    }
    tick();
  }

  function start() {
    const how = canStart();
    if (!how) return;
    groups.clear();
    manual.clear();
    assigned = { groups: new Map(), excluded: new Map() };
    // 時間帯の重なるアーカイブが無ければ、全部を 1 つの本編モードのグループにする
    if (how === 'movie') pin(visibleIndexes().filter(candidate), 1, 'movie');
    sent.clear();
    lastChange = null;
    on = true;
    regroup();
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    tick();
    notifyStarted();
    Dock.autoShow();
    refresh();
  }
  function notifyStarted() {
    const act = activeGroups();
    const n = act.reduce((s, G) => s + membersOf(G.g).length, 0);
    if (act.length > 1) notify(tr('syncOnGroups', act.length, n));
    else if (act[0]) notify(tr(isMovie(act[0]) ? 'movieOn' : 'syncOn', n));
  }

  /** 枠をまとめてグループ g に手で入れる (mode を渡すと、そのそろえ方にする) */
  function pin(list, g, mode) {
    if (!groups.has(g)) groups.set(g, newGroup(g, mode || 'time'));
    const G = groups.get(g);
    if (mode && G.mode !== mode) {
      G.mode = mode;
      G.init = true;
    }
    for (const i of list) if (state.tiles[i].videoId) manual.set(i, { vid: state.tiles[i].videoId, g });
  }

  /** グループのそろえ方 (実際の時刻 / 本編) を切り替える。そのときの枠は、手で決めたことにする */
  function setMode(G, m) {
    if (!on || m === G.mode) return;
    const list = membersOf(G.g);
    pin(list, G.g, m);
    for (const i of list) {
      waiting.delete(i);
      sent.delete(i);
      forceSeek.delete(i);
      drift.delete(i);
    }
    G.holdUntil = 0;
    G.init = true;
    regroup();
    notify(tr(isMovie(G) ? 'movieOn' : 'syncOn', membersOf(G.g).length));
    tick();
  }

  /** 枠 i を別のグループへ (g = 'auto' は自動に戻す、0 は同期しない、1〜4 はそのグループ。無ければ作る) */
  function moveTile(i, g) {
    const vid = state.tiles[i].videoId;
    if (!on || !vid) return;
    if (g === 'auto') manual.delete(i);
    else {
      // 新しいグループ: ライブを入れるなら本編モード (実際の時刻ではライブは加われない)
      if (g > 0 && !groups.has(g)) groups.set(g, newGroup(g, liveTile(i) ? 'movie' : 'time'));
      manual.set(i, { vid, g });
    }
    waiting.delete(i);
    sent.delete(i);
    drift.delete(i);
    forceSeek.add(i);
    if (movable(i)) rate(i, 1);
    overlay(i, '');
    tick();
  }

  function stop() {
    on = false;
    groups.clear();
    manual.clear();
    assigned = { groups: new Map(), excluded: new Map() };
    waiting.clear();
    seenSeeks.clear();
    drift.clear();
    lastChange = null;
    clearInterval(timer);
    timer = 0;
    for (let i = 0; i < MAX_TILES; i++) {
      if (!views[i]) continue;
      if (views[i].archive) send(i, { op: 'rate', r: 1 });
      overlay(i, '');
    }
    sent.clear();
    Dock.hide();
    refresh();
  }

  /** ボタン・つまみ・枠の印の表示を今の状態に合わせる (枠の中身が変わったとき・アーカイブだと分かったとき) */
  function refresh() {
    if (views.length < MAX_TILES) return;
    if (pending) checkPending();
    for (const i of [...waiting.keys()]) if (!candidate(i)) waiting.delete(i); // 閉じた・別の動画にした枠は待つのをやめる
    if (on) {
      tick();
      if (!on) return; // 同期できる枠が無くなって止めた
    }
    // ボタンはいつも出す (アーカイブを並べるまで隠れていると、機能に気づけないため)。使えないときは薄くして、理由を出す
    const can = on || !!canStart();
    const btn = document.getElementById('syncToggle');
    const off = !can;
    btn.classList.toggle('unavailable', off);
    btn.setAttribute('aria-disabled', String(off));
    btn.title = off ? [tr('syncTitle'), '', ...whyNot()].join('\n') : tr('syncTitle');
    setToggle(btn, on);
    document.getElementById('syncBar').hidden = !on;
    if (!on) updateMarks();
  }

  /** 同期できないときの理由 (ボタンのツールチップ・押したときのお知らせ)。1 行目は使える条件、続けて今の枠で足りないこと */
  function whyNot() {
    const kinds = visibleIndexes().map(tileKind).filter((k) => k !== 'empty');
    const count = (k) => kinds.filter((x) => x === k).length;
    const lines = [tr('syncWhyNeed')];
    if (!kinds.length) return [...lines, tr('syncWhyEmpty')];
    if (count('archive') >= 2) return [...lines, tr('syncWhyNoOverlap')];
    lines.push(tr('syncWhyArchives', count('archive')));
    if (count('live')) lines.push(tr('syncWhyLive', count('live')));
    if (count('upcoming')) lines.push(tr('syncWhyUpcoming', count('upcoming')));
    if (count('video')) lines.push(tr('syncWhyVideo', count('video')));
    if (count('blocked')) lines.push(tr('syncWhyBlocked', count('blocked')));
    if (count('loading')) lines.push(tr('syncWhyLoading', count('loading')));
    return lines;
  }

  /** 枠ごとの同期の状態 (「ℹ 枠の情報」の一覧用): {ok: 同期中・同期できる, text} */
  function tileStatus(i) {
    const kind = tileKind(i);
    if (kind === 'archive' && !movable(i)) return { ok: false, text: tr('infoSync_loading') }; // 配信の時刻がまだ届いていない
    const G = on ? groupOfTile(i) : null;
    if (G && active(G) && fits(G, i)) {
      const text = tr(i === G.ref ? 'infoSyncRef' : 'infoSyncOn');
      return { ok: true, text: activeGroups().length > 1 ? `${text} · ${tr('syncGroupN', G.g)}` : text };
    }
    if (kind === 'archive') {
      if (on) return { ok: false, text: tr('infoSyncNoOverlap') };
      const others = visibleIndexes().filter((j) => j !== i && movable(j));
      if (others.some((j) => overlapsTime(i, j))) return { ok: true, text: tr('infoSyncCan') };
      return { ok: false, text: tr(others.length ? 'infoSyncNoOverlap' : 'infoSyncAlone') };
    }
    return { ok: false, text: tr('infoSync_' + kind) };
  }

  let marksKey = '';
  /** 枠の印: 「基準」(グループが 2 つ以上なら、グループの番号と色も) と、バーの ⏱ (同期の処理のたびにも呼ぶ。変わったときだけ書き換える) */
  function updateMarks() {
    const act = activeGroups();
    const multi = act.length > 1;
    const key = JSON.stringify([on, LANG, [...assigned.groups], act.map((G) => [G.g, G.ref])]);
    if (key !== marksKey) {
      marksKey = key;
      for (let i = 0; i < MAX_TILES; i++) {
        const G = on ? groupOfTile(i) : null;
        const inSync = !!G && active(G);
        const isRef = inSync && i === G.ref;
        const badge = views[i].el.querySelector('.sync-ref-badge');
        badge.hidden = !(isRef || (inSync && multi));
        badge.textContent = multi && inSync ? (isRef ? `${G.g} ${tr('syncRefShort')}` : String(G.g)) : tr('syncRefShort');
        badge.title = isRef ? tr('syncRefBadgeTitle') : multi && inSync ? tr('syncGroupN', G.g) : '';
        badge.classList.toggle('is-member', inSync && !isRef);
        if (inSync && multi) views[i].el.style.setProperty('--g', colorOf(G.g));
        else views[i].el.style.removeProperty('--g');
        views[i].el.classList.toggle('sync-grouped', inSync && multi);
        views[i].el.querySelector('.sync-adj').hidden = !(on && candidate(i));
        if (!on || !candidate(i)) overlay(i, '');
      }
    }
    for (let i = 0; i < MAX_TILES; i++) if (on && candidate(i)) updateChip(i);
  }

  /** 枠のバーの ⏱ (ずれか本編の位置を短く。押すとパネルでこの枠を選ぶ) */
  function updateChip(i) {
    const adj = views[i].el.querySelector('.sync-adj');
    const G = groupOfTile(i);
    const wait = waiting.get(i);
    let text = '⏱';
    let warn = false;
    if (G && isMovie(G)) {
      const a = (wait ? offsetAt(G, i, nowR(G)) : null) ?? anchor(i);
      text = wait ? '⏸ 🎬' : a == null ? '🎬' : '🎬 ✓';
      warn = a == null && !liveTile(i); // まだ決めていなければ目立たせる
    } else if (movable(i)) {
      const v = (wait && G ? offsetAt(G, i, nowR(G)) : null) ?? off(i);
      text = wait ? `⏸ ${signedSec(v)}` : v ? `⏱ ${signedSec(v)}` : '⏱';
      warn = trimmedOf(i) >= TRIM_MIN && v === 0; // 切られたアーカイブで、まだずらしていなければ知らせる
    }
    if (adj.textContent !== text) adj.textContent = text;
    adj.classList.toggle('is-waiting', !!wait);
    adj.classList.toggle('has-trim', warn);
  }

  /** 「止めて待つ」を始める (paused = もう止まっている。パネルのボタンからなら、止める指示を送る) */
  function beginWait(i, paused) {
    if (!on || waiting.has(i)) return;
    waiting.set(i, { paused });
    rate(i, 1);
    if (!paused) cmd(i, 'pause');
    overlay(i, '');
    showToast(i, tr('syncWaitStart'));
    Dock.update();
  }
  /** 「止めて待つ」を終える: 今の再生位置が今の時刻に合うように、ずれを決める */
  function endWait(G, i) {
    if (!waiting.delete(i)) return;
    adoptOffset(G, i, nowR(G));
  }
  /** 今の再生位置が時刻 R に合うずれ (秒、0.01 秒単位。本編は本編の位置、0.1 秒単位)。位置が分からなければ null */
  function offsetAt(G, i, R) {
    const p = posOf(i);
    if (p == null) return null;
    if (isMovie(G)) return Math.round((p - R / 1000) * 10) / 10;
    if (!views[i].archive) return null;
    return Math.round((p - (R - views[i].archive.start) / 1000) * 100) / 100;
  }
  /** ずれ (実際の時刻) か本編の位置 (本編) を書き込む。v = null は本編の位置を消す。戻すための元の値を返す */
  function storeOffset(movie, i, v) {
    const vid = state.tiles[i].videoId;
    const change = { vid, movie, prev: movie ? anchor(i) : off(i) };
    if (movie) {
      if (v == null) MovieAnchors.remove(vid);
      else MovieAnchors.set(vid, v);
    } else {
      SyncOffsets.set(vid, v);
      playlistOffsetChanged(vid, v);
    }
    return change;
  }
  /** 今の再生位置のまま合うように、ずれを決める (「止めて待つ」の再生・枠の中でのシーク) */
  function adoptOffset(G, i, R) {
    const v = offsetAt(G, i, R);
    if (v == null) return Dock.update();
    lastChange = [storeOffset(isMovie(G), i, v)];
    sent.delete(i);
    forceSeek.delete(i);
    rate(i, 1);
    showToast(i, isMovie(G) ? tr('movieAnchorSet', hms(Math.max(0, Math.round(v)))) : tr('syncOffsetSet', signedSec(v)));
    Dock.update();
  }
  /** 前の確認のあとで、枠の中でユーザーがシークしたか (同期を始めて最初に見たときは、数を覚えるだけ) */
  function sawUserSeek(i) {
    const sk = views[i].ss?.sk;
    if (sk == null) return false;
    const prev = seenSeeks.get(i);
    seenSeeks.set(i, sk);
    return prev != null && sk !== prev;
  }
  /** 待っている枠: 止まったのを確かめたあと、再生されたら (枠の中のプレイヤーでもパネルでも) そこでずれを決める */
  function tickWaiting(G, i) {
    const w = waiting.get(i);
    const ss = views[i].ss;
    if (!ss) return;
    if (ss.ps === 2) w.paused = true;
    else if (w.paused && ss.ps === 1 && now() - ss.at < 2000) {
      endWait(G, i);
      return;
    }
    if (!w.paused) cmd(i, 'pause');
  }
  /** パネルの「止めて待つ / ここで合わせる」 */
  function toggleWait(i) {
    if (!waiting.has(i)) return beginWait(i, false);
    const w = waiting.get(i);
    if (!w.paused) {
      waiting.delete(i); // まだ止まっていない: 取りやめる
      Dock.update();
      return;
    }
    send(i, { op: 'play' }); // 再生が始まったら tickWaiting がずれを決める
    w.paused = true;
  }

  // 視聴セットを開いたあと、アーカイブだと分かりしだい同期を始める ({tiles, ref, until, at, mode})
  let pending = null;
  let pendingTimer = 0;
  /**
   * tiles の枠がアーカイブだと分かったら (最長 30 秒待って、分かった分だけで)、ref の枠を基準にして同期を始める。
   * at (同期の時計。実際の時刻のミリ秒) を渡すと、始めたあとにその時刻へ動かす (再生リストの続きから)。
   * mode = 'movie' なら、tiles を 1 つの本編モードのグループにまとめる
   */
  function startWhenReady(tiles, ref, { at = null, mode: m = 'time' } = {}) {
    pending = { tiles, ref, until: now() + 30000, at, mode: m };
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(refresh, 30500);
    setTimeout(refresh, 0); // もう読み込んである動画だけなら、すぐ始める
  }
  function checkPending() {
    const { tiles, ref, until, at, mode: m } = pending;
    const ready = tiles.every((i) => movable(i) || (m === 'movie' && liveTile(i)) || !state.tiles[i].videoId);
    if (!ready && now() < until) return;
    pending = null;
    clearTimeout(pendingTimer);
    setTimeout(() => {
      if (!on && canStart()) start();
      if (!on) return;
      if (m === 'movie') {
        // 視聴セットの枠を 1 つの本編モードのグループに (基準の枠のグループの番号を使う)
        const g = groupOfTile(ref)?.g ?? [1, 2, 3, 4].find((x) => !groups.has(x)) ?? 1;
        pin(tiles.filter(candidate), g, 'movie');
        tick();
      }
      const G = groupOfTile(ref);
      if (!G) return;
      if (m === 'time' && isMovie(G)) setMode(G, 'time');
      setReference(ref);
      if (at && !isMovie(G)) seekGroup(G, at);
    }, 0);
  }
  /** 今どこを見ているか ({at: 時計, pos: 基準の動画の再生位置 (秒)})。同期していなければ null (共有と同じく、番号の小さいグループ) */
  function resumePoint() {
    const G = primary();
    if (!G || isMovie(G)) return null;
    const ref = reference(G);
    if (ref == null) return null;
    const R = nowR(G);
    return { at: Math.round(R), pos: Math.max(0, targetOf(G, ref, R)) };
  }
  /** ほかのタブなどで動画のずれが変わった */
  function offsetsChanged(ids) {
    for (const i of visibleIndexes()) {
      if (!ids.includes(state.tiles[i].videoId)) continue;
      sent.delete(i);
      forceSeek.add(i);
    }
    if (on) Dock.update();
  }

  /** +1.25 / -300.00 のような符号付きの秒 (0.01 秒単位) */
  const signedSec = (v) => (v > 0 ? '+' : '') + v.toFixed(2);

  const TRIM_MIN = 30; // アーカイブが配信よりこれ以上 (秒) 短ければ、切られていると知らせる
  /** アーカイブが配信していた時間より何秒短いか (冒頭か末尾が切られたぶん。どちらかはわからない) */
  function trimmedOf(i) {
    const a = views[i].archive;
    if (!a || !(a.end > a.start)) return 0;
    return Math.round((a.end - a.start) / 1000 - a.dur);
  }
  const approxText = (sec) => (sec >= 120 ? tr('approxMin', Math.round(sec / 60)) : tr('approxSec', sec));

  /** 「今は本編の h:mm:ss」(h:mm:ss / m:ss / 秒。頭に − も可) を秒に。読めなければ null */
  function parseClock(text) {
    const t = String(text).trim().replace(/^[−-]/, '-');
    const neg = t.startsWith('-');
    const body = neg ? t.slice(1) : t;
    if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(body)) return null;
    const v = body.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
    return neg ? -v : v;
  }
  /** 本編の位置 (秒) → 「12:34.5」(小数 1 桁。0 なら付けない) */
  const anchorText = (a) => (a < 0 ? '−' : '') + hms(Math.floor(Math.abs(a))) + (Math.round(Math.abs(a) * 10) % 10 ? '.' + (Math.round(Math.abs(a) * 10) % 10) : '');

  /** この枠のずれ (本編モードなら本編の位置) を v にして、すぐ合わせ直す */
  function setOffset(i, v, { record = true } = {}) {
    const G = groupOfTile(i);
    const change = storeOffset(!!G && isMovie(G), i, v);
    if (record) {
      // 同じ枠を続けて動かしている間 (← → を何度も押すなど) は、まとめて 1 回で、動かし始める前に戻せるように
      const last = lastChange?.length === 1 ? lastChange[0] : null;
      if (last && last.vid === change.vid && last.movie === change.movie && now() - last.at < UNDO_MERGE_MS) change.prev = last.prev;
      change.at = now();
      lastChange = [change];
    }
    sent.delete(i);
    forceSeek.add(i); // 速度で詰めず、すぐ合わせ直す
    tick();
    return change;
  }
  /** 🎧 の結果など、いくつかの枠のずれをまとめて変える (まとめて 1 回で元に戻せる) */
  function applyOffsets(pairs) {
    lastChange = pairs.map(([i, v]) => setOffset(i, v, { record: false }));
  }
  /** 直前のずれの変更を元に戻す */
  function undo() {
    if (!lastChange) return;
    for (const c of lastChange) {
      if (c.movie) {
        if (c.prev == null) MovieAnchors.remove(c.vid);
        else MovieAnchors.set(c.vid, c.prev);
      } else {
        SyncOffsets.set(c.vid, c.prev);
        playlistOffsetChanged(c.vid, c.prev);
      }
    }
    offsetsChanged(lastChange.map((c) => c.vid));
    lastChange = null;
    notify(tr('syncUndone'));
    tick();
  }
  /** ← → キー・◀ ▶: ずれ (本編の位置) を d 秒動かす */
  function nudge(i, d) {
    const G = groupOfTile(i);
    if (!G || !active(G)) return;
    if (isMovie(G)) {
      if (anchor(i) != null && !liveTile(i)) setOffset(i, Math.round((anchor(i) + d) * 100) / 100);
      return;
    }
    if (movable(i)) setOffset(i, Math.round((off(i) + d) * 100) / 100);
  }

  // ---------------------------------------------------------------- 同期の調整パネル (浮かぶ小窓 / 画面の右の列)
  // グループごとに見出し (番号と色・そろえ方・⏸・🎧・つまみ) と、枠の行 (基準・ずれ・止めて待つ・🎧 の候補・追いつき具合・グループ) を並べる。
  // 置き方は 2 通り (見出しのボタンで切り替え。この画面を開いたブラウザで覚える):
  // - 浮かぶ小窓: 枠の上に半透明で重ねる (枠の大きさは変わらない)。見出しをつかんで動かせる。左上の位置は固定で、中身が増えると下へ伸びる
  // - 右の列: 枠の並びを横に縮めて置く (枠に重ねない)
  // どちらも、たたむと番号とずれだけの細い形になる。
  // 行を選んで ← → (Shift で 0.01 秒・Ctrl で 1 秒) でずれを動かし、↑ ↓ で行を移る
  const Dock = (() => {
    const el = () => document.getElementById('syncDock');
    const body = () => document.getElementById('syncDockBody');
    let shown = false;
    let wanted = true; // ✕ で閉じたら、次に同期を始めたときも出さない (上部バーの ☰ で出す)
    let mini = false;
    const PREF_KEY = 'hakomado.syncDock'; // 置き方と小窓の位置 (この画面のブラウザだけで覚える。消えても既定に戻るだけ)
    let floating = true;
    let pos = null; // 小窓の左上 {x, y} (null = 右上の既定の位置)
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (p && typeof p === 'object') {
        floating = p.floating !== false;
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) pos = { x: p.x, y: p.y };
      }
    } catch {
      /* 読めなければ既定のまま */
    }
    const savePref = () => {
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify({ floating, ...(pos || {}) }));
      } catch {
        /* 覚えられなくても動く */
      }
    };
    let sel = null; // 選んでいる枠
    let hl = null; // 枠の並びで光らせている枠 (行にマウスを乗せた・行を選んだ)
    let structKey = '';
    const rows = new Map(); // i -> {row, val, wait, cand, dot, short, now, minus, plus}
    const heads = new Map(); // g -> {play, audio, range, now, end, note}

    function show(i = null) {
      if (!on) return;
      shown = true;
      el().hidden = false;
      document.body.classList.add('sync-dock-open');
      document.body.classList.toggle('sync-dock-mini', mini);
      document.getElementById('syncDockToggle').classList.add('on');
      place();
      if (i != null) sel = i;
      structKey = '';
      update();
      if (i != null) rows.get(i)?.row.focus({ preventScroll: false });
    }
    function hide() {
      shown = false;
      el().hidden = true;
      document.body.classList.remove('sync-dock-open', 'sync-dock-mini');
      document.getElementById('syncDockToggle').classList.remove('on');
      setHl(null);
    }
    function setMini(v) {
      mini = v;
      document.body.classList.toggle('sync-dock-mini', mini);
      el().classList.toggle('mini', mini);
      const b = document.getElementById('syncDockMini');
      b.textContent = mini ? '⇤' : '⇥';
      b.title = tr(mini ? 'syncDockExpand' : 'syncDockCollapse');
      place();
    }
    /** 浮かぶ小窓 / 右の列を切り替える */
    function setFloating(v) {
      floating = v;
      document.body.classList.toggle('sync-dock-float', floating);
      el().classList.toggle('floating', floating);
      const b = document.getElementById('syncDockFloat');
      b.textContent = floating ? '⇲' : '⧉';
      b.title = tr(floating ? 'syncDockToSide' : 'syncDockToFloat');
      place();
      savePref();
    }
    /** 小窓の位置を画面の中に収めて置く (右の列のときは位置を外す) */
    function place() {
      const d = el();
      if (!floating) {
        d.style.removeProperty('left');
        d.style.removeProperty('top');
        d.style.removeProperty('max-height');
        return;
      }
      const w = d.offsetWidth || 290;
      const top = document.body.classList.contains('grid-fs') ? 0 : 36;
      const x = pos ? pos.x : innerWidth - w - 16;
      const y = pos ? pos.y : top + 12;
      d.style.left = Math.round(Math.max(0, Math.min(innerWidth - w, x))) + 'px';
      const t = Math.round(Math.max(top, Math.min(innerHeight - 120, y))); // 上部バーには重ねない
      d.style.top = t + 'px';
      d.style.maxHeight = innerHeight - t - 12 + 'px'; // 下へ伸びて画面からはみ出す分は、中をスクロールさせる
    }
    /** 見出しをつかんで小窓を動かす (ボタンの上では始めない。動かしている間は枠の iframe にマウスを取られないように) */
    function setupDrag() {
      const head = el().querySelector('.dock-head');
      let start = null;
      head.addEventListener('pointerdown', (e) => {
        if (!floating || e.button !== 0 || e.target.closest('button')) return;
        const r = el().getBoundingClientRect();
        start = { px: e.clientX, py: e.clientY, x: r.left, y: r.top };
        try {
          head.setPointerCapture(e.pointerId);
        } catch {
          /* つかめなくても、ページの上で動かす分には動く */
        }
        document.body.classList.add('dragging');
        e.preventDefault();
      });
      const end = () => {
        if (!start) return;
        start = null;
        document.body.classList.remove('dragging');
        const r = el().getBoundingClientRect();
        pos = { x: Math.round(r.left), y: Math.round(r.top) };
        savePref();
      };
      addEventListener('pointermove', (e) => {
        if (!start) return;
        if (!(e.buttons & 1)) return end(); // 放したのを取りこぼしていた
        pos = { x: start.x + e.clientX - start.px, y: start.y + e.clientY - start.py };
        place();
      });
      // どこで放しても・つかみが外れても終える (終わらないと、枠の iframe がマウスを受け付けないままになる)
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
      head.addEventListener('lostpointercapture', end);
      addEventListener('pointerup', end);
      addEventListener('blur', end);
      addEventListener('resize', () => shown && place());
    }
    function setHl(i) {
      if (hl === i) return;
      if (hl != null) views[hl]?.el.classList.remove('sync-hl');
      hl = i;
      if (hl != null) views[hl]?.el.classList.add('sync-hl');
    }

    const groupOptions = (i) => {
      const cur = manual.has(i) ? String(manual.get(i).g) : 'auto';
      const opts = [['auto', tr('syncGroupAuto')]];
      for (let g = 1; g <= SyncGroups.MAX; g++) opts.push([String(g), groups.has(g) ? tr('syncGroupN', g) : tr('syncGroupNew', g)]);
      opts.push(['0', tr('syncGroupNone')]);
      return opts.map(([v, label]) => mk('option', { value: v, selected: v === cur }, label));
    };

    function rowEl(i, G) {
      const movie = !!G && isMovie(G);
      const isRef = !!G && i === G.ref;
      const r = {};
      r.dot = mk('span', { class: 'dr-dot' });
      r.short = mk('span', { class: 'dr-short' });
      const groupSel = mk('select', { class: 'dr-group', title: tr('syncGroupTitle') }, groupOptions(i));
      groupSel.addEventListener('change', () => {
        const v = groupSel.value;
        moveTile(i, v === 'auto' ? 'auto' : Number(v));
      });
      const line1 = mk(
        'div',
        { class: 'dr-line' },
        G
          ? mk('button', {
              type: 'button',
              class: 'dr-ref' + (isRef ? ' on' : ''),
              textContent: isRef ? '◉' : '○',
              title: tr(isRef ? 'syncRefBadgeTitle' : 'syncSetRefTitle'),
              disabled: isRef || (movie && !liveTile(i) && membersOf(G.g).some(liveTile)),
              onclick: () => setReference(i),
            })
          : null,
        mk('span', { class: 'dr-num' }, String(tileNo(i))),
        mk('span', { class: 'dr-name', title: tileName(i) || '' }, tileName(i) || state.tiles[i].videoId),
        r.short,
        r.dot,
        groupSel,
      );
      const parts = [line1];
      if (G && active(G)) {
        const step = (d) =>
          mk('button', { type: 'button', class: 'dr-step', textContent: d < 0 ? '◀' : '▶', title: tr(d < 0 ? 'syncStepBack' : 'syncStepFwd'), onclick: () => nudge(i, d) });
        r.minus = step(-0.1);
        r.plus = step(0.1);
        r.val = mk('input', { type: 'text', class: 'dr-val sync-input', inputMode: 'decimal', spellcheck: false, title: tr(movie ? 'syncAnchorInputTitle' : 'syncInputTitle') });
        r.val.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitVal(i, r.val);
            r.row.focus();
          } else if (e.key === 'Escape') {
            r.val.value = '';
            r.row.focus();
          }
          e.stopPropagation();
        });
        r.val.addEventListener('change', () => commitVal(i, r.val));
        // 入れ始めるときは今の値を出して選んでおく (少し直すだけで済むように)。離れたら空に戻す (値は薄い文字で出す)
        r.val.addEventListener('focus', () => {
          r.val.value = r.val.dataset.shown || '';
          r.val.select();
        });
        r.val.addEventListener('blur', () => (r.val.value = ''));
        r.wait = mk('button', { type: 'button', class: 'dr-wait sync-wait', title: tr('syncWaitTitle'), onclick: () => toggleWait(i) });
        r.cand = mk('span', { class: 'dr-cand' });
        const live = liveTile(i);
        const line2 = live
          ? mk('div', { class: 'dr-line dr-sub' }, mk('span', { class: 'dr-note' }, tr(isRef ? 'syncLiveRef' : 'movieLiveRefOnly')))
          : mk('div', { class: 'dr-line dr-sub' }, r.minus, r.val, r.plus, r.wait, r.cand);
        parts.push(line2);
        if (movie && !live) {
          const nowIn = mk('input', { type: 'text', class: 'dr-movie-now sync-input', inputMode: 'numeric', placeholder: '0:47:12', title: tr('syncMovieNowTitle') });
          nowIn.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const c = parseClock(nowIn.value);
            const p = posOf(i);
            if (c == null || p == null) {
              showToast(i, tr('movieBadClock'));
              return;
            }
            setOffset(i, Math.round((p - c) * 10) / 10);
            nowIn.value = '';
            r.row.focus();
          });
          const here = mk('button', {
            type: 'button',
            class: 'dr-here',
            textContent: tr('syncMovieHere'),
            title: tr('syncMovieHereTitle'),
            onclick: () => {
              const p = posOf(i);
              if (p != null) setOffset(i, Math.round(p * 10) / 10);
            },
          });
          const clear = mk('button', { type: 'button', class: 'dr-clear', textContent: '✕', title: tr('movieClear'), onclick: () => setOffset(i, null) });
          parts.push(mk('div', { class: 'dr-line dr-sub' }, here, mk('label', { class: 'dr-movie-label' }, tr('syncMovieNow'), nowIn), clear));
        } else if (live && movie) {
          const here = mk('button', {
            type: 'button',
            class: 'dr-here',
            textContent: tr('syncMovieHere'),
            title: tr('syncMovieHereTitle'),
            onclick: () => {
              const p = posOf(i);
              if (p != null) setOffset(i, Math.round(p * 10) / 10);
            },
          });
          parts.push(mk('div', { class: 'dr-line dr-sub' }, here));
        }
        // 切られたアーカイブ: 自動では直さず (冒頭か末尾かわからないため)、冒頭が切られた場合の値をワンクリックで出す
        const trimmed = trimmedOf(i);
        if (!movie && trimmed >= TRIM_MIN) {
          r.trim = mk('button', { type: 'button', class: 'dr-trim-head', textContent: tr('syncTrimHead', -trimmed), onclick: () => setOffset(i, -trimmed) });
          parts.push(mk('div', { class: 'dr-line dr-sub dr-trim' }, mk('span', { class: 'dr-trim-text' }, tr('syncTrimmed', approxText(trimmed))), r.trim));
        }
      } else {
        const reason = assigned.excluded.get(i) || (G ? 'wait' : 'alone');
        parts.push(mk('div', { class: 'dr-line dr-sub' }, mk('span', { class: 'dr-note' }, tr('syncWhyRow_' + reason))));
      }
      r.row = mk('div', { class: 'dock-row' + (isRef ? ' is-ref' : '') + (sel === i ? ' is-sel' : ''), tabIndex: 0, dataset: { i: String(i) } }, parts);
      r.row.addEventListener('mouseenter', () => setHl(i));
      r.row.addEventListener('mouseleave', () => setHl(r.row.contains(document.activeElement) ? i : null));
      r.row.addEventListener('focusin', () => {
        sel = i;
        for (const x of rows.values()) x.row.classList.toggle('is-sel', x.row === r.row);
        setHl(i);
      });
      r.row.addEventListener('focusout', (e) => {
        if (!r.row.contains(e.relatedTarget)) setHl(null);
      });
      r.row.addEventListener('keydown', (e) => onRowKey(e, i));
      rows.set(i, r);
      return r.row;
    }

    /** 行の入力欄で Enter / 欄を離れた: 秒 (本編モードは h:mm:ss も) を入れる。空なら何もしない (本編は消す) */
    function commitVal(i, input) {
      const G = groupOfTile(i);
      const text = input.value.trim();
      input.value = '';
      if (!G || text === '' || text === input.dataset.shown) return update();
      if (isMovie(G)) {
        const v = parseClock(text);
        if (v == null) showToast(i, tr('movieBadClock'));
        else setOffset(i, Math.round(v * 10) / 10);
        return update();
      }
      const v = Number(text.replace('−', '-').replace(/^\+/, ''));
      if (Number.isFinite(v)) setOffset(i, v);
      update();
    }

    function onRowKey(e, i) {
      if (e.target !== e.currentTarget) return; // 入力欄・ボタンの中のキーは、そちらに任せる
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = e.shiftKey ? 0.01 : e.ctrlKey ? 1 : 0.1;
        nudge(i, e.key === 'ArrowLeft' ? -step : step);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const list = [...body().querySelectorAll('.dock-row')];
        const k = list.indexOf(e.currentTarget) + (e.key === 'ArrowUp' ? -1 : 1);
        list[Math.max(0, Math.min(list.length - 1, k))]?.focus();
      } else if (e.key === 'Enter') {
        rows.get(i)?.val?.focus();
      } else if (e.key === 'Escape') {
        e.currentTarget.blur();
      } else return;
      e.preventDefault();
      e.stopPropagation(); // 上の操作 (矢印キーで音の枠を移すなど) にしない
    }

    function groupEl(G) {
      const list = membersOf(G.g);
      const h = {};
      const modeSel = mk(
        'select',
        { class: 'dg-mode', title: tr('syncModeTitle') },
        mk('option', { value: 'time', selected: G.mode === 'time' }, tr('syncModeTime')),
        mk('option', { value: 'movie', selected: G.mode === 'movie' }, tr('syncModeMovie')),
      );
      modeSel.addEventListener('change', () => {
        modeSel.blur();
        setMode(G, modeSel.value === 'movie' ? 'movie' : 'time');
      });
      h.play = mk('button', { type: 'button', class: 'dg-play', onclick: () => togglePauseGroup(G) });
      h.audio = mk('button', { type: 'button', class: 'dg-audio sync-audio', title: tr('syncAudioTitle'), onclick: () => AudioSync.toggle(G.g) });
      h.now = mk('span', { class: 'sync-time dg-now' });
      h.end = mk('span', { class: 'sync-time dg-end' });
      h.range = mk('input', { type: 'range', class: 'dg-range', min: 0, max: 1, step: 1, value: 0, title: tr('syncSeekGroup', G.g) });
      bindSeek(h.range, h.now);
      h.note = mk('div', { class: 'dg-note' });
      const ok = active(G);
      const kids = [
        mk('div', { class: 'dg-head' }, mk('span', { class: 'dg-num', title: tr('syncGroupN', G.g) }, String(G.g)), modeSel, ok ? h.play : null, ok && !isMovie(G) ? h.audio : null),
        ok ? mk('div', { class: 'dg-seek' }, h.now, h.range, h.end) : null,
        h.note,
        ok ? AudioSync.resultEl(G.g) : null,
        ...list.map((i) => rowEl(i, G)),
      ];
      heads.set(G.g, h);
      return mk('section', { class: 'dock-group' + (ok ? '' : ' is-idle'), style: `--g: ${colorOf(G.g)}`, dataset: { g: String(G.g) } }, kids);
    }

    function render() {
      rows.clear();
      heads.clear();
      const focusedRow = document.activeElement?.closest?.('.dock-row')?.dataset.i;
      const kids = [...groups.values()].sort((a, b) => a.g - b.g).map(groupEl);
      const rest = [...assigned.excluded.keys()].filter((i) => !groupOfTile(i)).sort((a, b) => tileNo(a) - tileNo(b));
      if (rest.length) kids.push(mk('section', { class: 'dock-group dock-rest' }, mk('div', { class: 'dg-head' }, mk('span', { class: 'dg-title' }, tr('syncGroupNone'))), ...rest.map((i) => rowEl(i, null))));
      if (!kids.length) kids.push(mk('p', { class: 'dock-empty' }, tr('syncDockEmpty')));
      body().replaceChildren(...kids);
      if (focusedRow != null) rows.get(Number(focusedRow))?.row.focus({ preventScroll: true });
    }

    /** 同期の処理のたびに呼ぶ: 形 (グループ・行) が変わったら作り直し、数字・点・時刻を書き換える */
    function update() {
      if (!shown || !on) return;
      const key = JSON.stringify([
        LANG,
        mini,
        [...groups.values()].map((G) => [G.g, G.mode, G.ref, active(G), membersOf(G.g)]),
        [...assigned.excluded],
        [...manual].map(([i, m]) => [i, m.g]),
        visibleIndexes().map((i) => [i, tileName(i), trimmedOf(i) >= TRIM_MIN, liveTile(i)]),
        AudioSync.resultKey(),
      ]);
      if (key !== structKey) {
        structKey = key;
        render();
      }
      for (const [g, h] of heads) {
        const G = groups.get(g);
        if (!G || !active(G)) {
          h.note.textContent = tr(membersOf(g).length < 2 ? 'syncGroupNeedMore' : 'syncGroupNeedArchive');
          continue;
        }
        const playing = G.clock.playing && !G.paused;
        h.play.textContent = playing ? '⏸' : '▶';
        h.play.title = tr(playing ? 'syncGroupPause' : 'syncGroupPlay');
        fillSeek(h.range, h.now, h.end, G);
        const a = AudioSync.progressText(g);
        h.audio.textContent = a || '🎧';
        h.audio.classList.toggle('is-measuring', !!a);
        h.audio.disabled = AudioSync.busyOther(g);
        h.note.textContent = isMovie(G) && anchor(G.ref) == null ? tr('syncGroupNeedAnchor') : '';
      }
      for (const [i, r] of rows) {
        const G = groupOfTile(i);
        const wait = waiting.get(i);
        const movie = !!G && isMovie(G);
        let v = null;
        if (G && active(G)) v = (wait ? offsetAt(G, i, nowR(G)) : null) ?? (movie ? anchor(i) : off(i));
        const txt = v == null ? (movie ? tr('syncAnchorUnset') : '') : movie ? anchorText(v) : signedSec(v);
        r.short.textContent = G && active(G) && !liveTile(i) ? txt || '—' : '';
        if (r.val && document.activeElement !== r.val) {
          r.val.placeholder = txt;
          r.val.dataset.shown = txt;
        }
        if (r.wait) {
          r.wait.textContent = wait ? '▶' : '⏸';
          r.wait.title = tr(wait ? 'syncWaitResumeTitle' : 'syncWaitTitle');
          r.wait.classList.toggle('is-waiting', !!wait);
        }
        if (r.minus) r.minus.disabled = r.plus.disabled = movie && anchor(i) == null;
        if (r.cand) {
          const c = AudioSync.candidateFor(i);
          r.cand.textContent = c == null ? '' : c === false ? '🎧 —' : `🎧 ${signedSec(c)}`;
        }
        const st = wait ? 'wait' : drift.get(i) || 'none';
        r.dot.className = 'dr-dot is-' + st;
        r.dot.title = tr('syncDot_' + st);
        if (r.trim) r.trim.disabled = off(i) === -trimmedOf(i);
      }
      const undoBtn = document.getElementById('syncUndo');
      undoBtn.hidden = !lastChange;
      if (lastChange) undoBtn.title = tr('syncUndoTitle', lastChange.length);
    }

    function setup() {
      document.getElementById('syncDockToggle').addEventListener('click', (e) => {
        e.currentTarget.blur();
        wanted = !shown;
        if (shown) hide();
        else show();
      });
      document.getElementById('syncDockClose').addEventListener('click', () => {
        wanted = false;
        hide();
      });
      document.getElementById('syncDockMini').addEventListener('click', () => {
        setMini(!mini);
        structKey = '';
        update();
      });
      document.getElementById('syncUndo').addEventListener('click', undo);
      document.getElementById('syncDockFloat').addEventListener('click', () => setFloating(!floating));
      setupDrag();
      setMini(false);
      setFloating(floating);
    }

    /** 自分で出した (枠の ⏱ など): 次に同期を始めたときも出す */
    function open(i) {
      wanted = true;
      show(i);
    }
    return { show: open, hide, update, setup, autoShow: () => wanted && show() };
  })();

  function setup() {
    SyncOffsets.onChange(offsetsChanged);
    MovieAnchors.onChange(offsetsChanged);
    document.getElementById('syncToggle').addEventListener('click', (e) => {
      e.currentTarget.blur(); // Space キーでボタンが押し直されないように
      if (on) stop();
      else if (canStart()) start();
      else notify(whyNot().join('\n'));
    });
    bindSeek(document.getElementById('syncSeek'), document.getElementById('syncNow'));
    Dock.setup();
  }

  /** グループの様子 (🎧 音で合わせる用): {ref, tiles, movie, active}。無ければ null */
  function groupInfo(g) {
    const G = on ? groups.get(g) : null;
    if (!G) return null;
    return { ref: reference(G), tiles: membersOf(g), movie: isMovie(G), active: active(G), paused: G.paused };
  }

  return {
    setup,
    refresh,
    /** 枠のバーの ⏱: パネルを出して、この枠を選ぶ */
    openFor: (i) => Dock.show(i),
    startWhenReady,
    offsetsChanged,
    isOn: () => on,
    /** 共有・再生リスト用 (番号の一番小さいグループ): 本編モードか・基準の枠 */
    isMovie: () => !!primary() && isMovie(primary()),
    refIfOn: () => (primary() ? reference(primary()) : null),
    tileStatus,
    resumePoint,
    isWaiting: (i) => on && waiting.has(i),
    groupInfo,
    offOf: off,
    applyOffsets,
    dockChanged: () => Dock.update(),
  };
})();

// ---------------------------------------------------------------- 🎧 音で合わせる (アーカイブの同期再生のずれを、音で測って直す)
// コラボの各視点には通話の声が共通して入っているので、同期しているグループの枠の音を 90 秒聞いて突き合わせ、ずれを求める。
// - 同期の調整パネルのグループの見出しの 🎧 で始める (一度に 1 グループ)。今の位置からそのまま再生しながら測る
//   (基準の枠が再生している間だけ数える)。もう一度押すとやめる
// - 測っている間は、各枠の中 (content/watch.js の Mix) が音の大きさを記録して送ってくる。消音中の枠もプレイヤーの消音を外して
//   Web Audio 側で消音するので、聞こえ方は変わらない。終わったら元の消音に戻す
// - 計算は audio-align.js。結果はパネルの各行に候補として出し、「反映」で各枠のずれ (SyncOffsets) に書き込む。基準の枠のずれはそのまま
// - 2 枠のときは「中間 (映像がそろう)」が既定。それぞれの人の声に合わせる値も選べる (通話の遅れのぶん、もう一人の声はずれる)
// - 声が少ない区間などで決められなければ、そう知らせて、別の場面で測り直してもらう
// - 🎬 本編モードのグループでは使わない (共通の音が無い前提のため)
const AudioSync = (() => {
  const MEASURE_SEC = 90;
  let run = null; // 測っている間: {g, tiles, ref, offs, ids, tracks, blocked, played, last, timer, closed}
  let result = null; // 結果の候補: {g, tiles, ref, offs, ids, res, choice, n}
  let resultSeq = 0;

  function toggle(g) {
    if (run) {
      if (run.g === g) cancel();
      return;
    }
    start(g);
  }

  function start(g) {
    const info = Sync.groupInfo(g);
    if (!info || !info.active || info.movie) return;
    const { ref, tiles } = info;
    if (ref == null || tiles.length < 2) return;
    if (pausedAll || info.paused || views[ref].ss?.ps === 2) {
      notify(tr('syncAudioNeedPlay'));
      return;
    }
    result = null;
    run = {
      g,
      tiles,
      ref,
      offs: new Map(tiles.map((i) => [i, Sync.offOf(i)])),
      ids: new Map(tiles.map((i) => [i, state.tiles[i].videoId])),
      tracks: new Map(),
      blocked: new Set(),
      played: 0,
      last: performance.now(),
      closed: false,
    };
    for (const i of tiles) postToFrame(views[i].player, { hakomado: 'measure', on: true, muted: !!state.tiles[i].muted });
    run.timer = setInterval(progress, 500);
    notify(tr('syncAudioStart', MEASURE_SEC));
    Sync.dockChanged();
  }

  function progress() {
    const t = performance.now();
    const dt = (t - run.last) / 1000;
    run.last = t;
    // 同期が止まった・本編モードにした・グループの枠が変わった → やめる
    const info = Sync.groupInfo(run.g);
    if (!info || info.movie || run.tiles.some((i) => !info.tiles.includes(i) || state.tiles[i].videoId !== run.ids.get(i))) {
      cancel();
      return;
    }
    // 基準の枠が再生している (広告でない) 間だけ数える
    const ss = views[run.ref]?.ss;
    if (ss && ss.ps === 1 && !ss.ad && !pausedAll && !info.paused) run.played += dt;
    if (run.played >= MEASURE_SEC) finish();
    else Sync.dockChanged();
  }

  const stopFrames = (tiles) => {
    for (const i of tiles) postToFrame(views[i]?.player, { hakomado: 'measure', on: false });
  };

  function cancel(msg = tr('syncAudioCancelled')) {
    if (!run) return;
    clearInterval(run.timer);
    stopFrames(run.tiles);
    run = null;
    Sync.dockChanged();
    notify(msg);
  }

  async function finish() {
    const r = run;
    clearInterval(r.timer);
    stopFrames(r.tiles);
    r.closed = true;
    Sync.dockChanged();
    await new Promise((res) => setTimeout(res, 1500)); // 止めたときに枠が送る最後の記録を待つ
    if (run !== r) return;
    const tiles = r.tiles.filter((i) => !r.blocked.has(i) && r.tracks.has(i) && views[i].archive);
    const refK = tiles.indexOf(r.ref);
    let res = null;
    if (refK >= 0 && tiles.length >= 2) {
      const items = tiles.map((i) => ({ track: r.tracks.get(i), startMs: views[i].archive.start, off: r.offs.get(i) }));
      try {
        res = await AudioAlign.analyze(items, refK);
      } catch (e) {
        console.warn('hakomado: 音で合わせる計算に失敗しました', e);
      }
    }
    if (run !== r) return;
    run = null;
    if (!res?.ok) {
      Sync.dockChanged();
      notify(tr(res?.reason === 'short' || refK < 0 ? 'syncAudioShort' : 'syncAudioWeak'));
      return;
    }
    result = { g: r.g, tiles, ref: r.ref, offs: r.offs, ids: r.ids, res, choice: 'mid', n: ++resultSeq };
    notify(tr('syncAudioDone'));
    Sync.dockChanged();
  }

  /** 枠から届いた記録 (形を確かめてから貯める) */
  function chunk(i, d) {
    if (!run || !run.tiles.includes(i)) return;
    const sr = Number(d.sr);
    const per = Number(d.per);
    if (!(sr >= 8000 && sr <= 192000) || !Number.isInteger(per) || per < 1 || per > 1000) return;
    if (!(d.bins instanceof Float32Array) || !Array.isArray(d.marks) || d.bins.length > 200000) return;
    const marks = d.marks.filter((m) => Array.isArray(m) && m.slice(0, 3).every(Number.isFinite)).map((m) => [m[0], m[1], m[2] || 1]);
    let tk = run.tracks.get(i);
    if (!tk || tk.sr !== sr || tk.per !== per) run.tracks.set(i, (tk = { sr, per, bins: [], marks: [] }));
    if (tk.bins.length > 600000) return; // 長くなりすぎない (10 分)
    for (const v of d.bins) tk.bins.push(v);
    tk.marks.push(...marks);
  }

  /** 枠の中で音を処理できなかった (AudioContext が動かない) */
  function blocked(i) {
    if (!run || !run.tiles.includes(i)) return;
    run.blocked.add(i);
    showToast(i, tr('mixBlocked'));
    if (i === run.ref || run.tiles.length - run.blocked.size < 2) cancel(tr('syncAudioBlocked'));
  }

  // ---- 結果の候補
  /** 枠 i に入れる新しいずれ (秒)。決められなければ null */
  function proposed(i) {
    const { tiles, ref, offs, res, choice } = result;
    const k = tiles.indexOf(i);
    if (k < 0 || i === ref) return null;
    const d = res.two && choice !== 'mid' ? res.two[choice] : res.deltas[k];
    return d == null ? null : Math.round((offs.get(i) + d) * 100) / 100;
  }
  /** 結果がまだ使えるか (グループの基準・枠の動画が測ったときのまま) */
  function resultValid() {
    if (!result) return false;
    const info = Sync.groupInfo(result.g);
    return !!info && !info.movie && info.ref === result.ref && result.tiles.every((i) => state.tiles[i].videoId === result.ids.get(i));
  }
  /** パネルの行の 🎧 の候補: 数 / false (決められなかった) / null (候補なし) */
  function candidateFor(i) {
    if (!resultValid() || !result.tiles.includes(i) || i === result.ref) return null;
    return proposed(i) ?? false;
  }
  /** パネルの形が変わる目印 (結果が出た・消えた・選び方を変えた) */
  const resultKey = () => (resultValid() ? [result.n, result.choice] : null);

  /** パネルのグループの見出しの下に出す、結果の操作 (2 枠なら合わせ方の選択・反映・閉じる)。結果が無ければ null */
  function resultEl(g) {
    if (!resultValid() || result.g !== g) return null;
    const { tiles, ref, res } = result;
    const kids = [mk('div', { class: 'dga-title' }, tr('syncAudioResultTitle'))];
    if (res.two) {
      const other = tiles.find((i) => i !== ref);
      const name = (i) => tileName(i) || String(visibleIndexes().indexOf(i) + 1);
      const opts = [
        ['mid', tr('syncAudioMid')],
        ['refVoice', tr('syncAudioVoice', name(ref))],
        ['otherVoice', tr('syncAudioVoice', name(other))],
      ];
      kids.push(
        mk(
          'div',
          { class: 'dga-choice' },
          opts.map(([key, label]) =>
            mk(
              'label',
              {},
              mk('input', {
                type: 'radio',
                name: 'syncAudioChoice',
                value: key,
                checked: result.choice === key,
                onchange: () => {
                  result.choice = key;
                  Sync.dockChanged();
                },
              }),
              ' ' + label,
            ),
          ),
        ),
      );
    }
    kids.push(
      mk(
        'div',
        { class: 'dga-buttons' },
        mk('button', { type: 'button', class: 'primary', textContent: tr('syncAudioApply'), onclick: applyResult }),
        mk('button', { type: 'button', textContent: tr('syncAudioClose'), onclick: dismiss }),
      ),
    );
    return mk('div', { class: 'dg-audio-result' }, kids);
  }

  function dismiss() {
    result = null;
    Sync.dockChanged();
  }

  function applyResult() {
    if (!resultValid()) return dismiss();
    // 測ったあとで別の動画にした枠は直さない
    const pairs = result.tiles.map((i) => [i, proposed(i)]).filter(([i, v]) => v != null && state.tiles[i].videoId === result.ids.get(i));
    result = null;
    Sync.applyOffsets(pairs);
    notify(tr('syncAudioApplied', pairs.length));
  }

  /** グループ g の見出しの 🎧 に出す進み具合 (測っていなければ '') */
  function progressText(g) {
    if (!run || run.g !== g) return '';
    return run.closed ? tr('syncAudioAnalyzing') : tr('syncAudioMeasuring', Math.floor(run.played), MEASURE_SEC);
  }

  return {
    toggle,
    chunk,
    blocked,
    isMeasuring: () => !!run,
    /** ほかのグループで測っている (このグループの 🎧 は押せない) */
    busyOther: (g) => !!run && run.g !== g,
    progressText,
    candidateFor,
    resultKey,
    resultEl,
  };
})();

// ---------------------------------------------------------------- ℹ 枠の情報
// 表示中の枠ごとに、種類 (ライブ・配信前・アーカイブ・動画)・チャンネル・タイトル・配信の時間や公開日・
// 今の視聴者数 (ライブ配信中だけ)・再生数・再生位置・アーカイブ同期できるかを一覧で見る。
// 情報は枠の中のプレイヤーが知らせてくる (watch-main.js の 'hakomado:info')。開いている間だけ、数秒ごとに求め直す
const TileInfo = (() => {
  const REQ_MS = 5000;
  const dialog = document.getElementById('infoDialog');
  let timer = 0;
  let renderQueued = false;
  const numText = (n) => (n == null ? '—' : n.toLocaleString(LANG === 'ja' ? 'ja-JP' : 'en-US'));
  const dateText = (ms) => {
    const d = new Date(ms);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    const date = sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  /**
   * 「開始 / 公開」「終了」「長さ」の 3 欄
   * ライブ = 配信開始・「配信中」・配信している長さ / アーカイブ = 配信の開始・終了・配信していた長さ /
   * 配信前 = 開始予定 / 動画 = 公開日・動画の長さ
   */
  function timeCells(kind, info) {
    const none = ['—', '—', '—'];
    if (!info) return none;
    if (kind === 'live' && info.start != null) return [dateText(info.start), tr('infoLiveNow'), hms((Date.now() - info.start) / 1000)];
    if (kind === 'archive' && info.start != null) {
      const end = info.end ?? (info.dur != null ? info.start + info.dur * 1000 : null);
      return [dateText(info.start), end != null ? dateText(end) : '—', end != null ? hms((end - info.start) / 1000) : '—'];
    }
    if (kind === 'upcoming' && info.start != null) return [tr('infoPlanned', dateText(info.start)), '—', '—'];
    if (kind === 'video' && info.publish != null) return [dateText(info.publish).split(' ')[0], '—', info.dur ? hms(info.dur) : '—'];
    return none;
  }
  /** 再生位置 (アーカイブ・動画だけ)。同期の知らせ (0.5 秒ごと) があればそちら、無ければ最後に求めたときの位置 */
  function posText(i, kind, info) {
    if (kind !== 'archive' && kind !== 'video') return '—';
    const ss = views[i].ss;
    const t = ss ? ss.t + (ss.ps === 1 && !ss.ad ? ((performance.now() - ss.at) / 1000) * (ss.r || 1) : 0) : info?.t;
    if (t == null) return '—';
    return info?.dur ? `${hms(t)} / ${hms(info.dur)}` : hms(t);
  }

  function row(i, n) {
    const kind = tileKind(i);
    const info = views[i].info;
    const meta = views[i].meta;
    const tr_ = document.createElement('tr');
    const td = (text, cls) => {
      const c = document.createElement('td');
      if (cls) c.className = cls;
      c.textContent = text;
      tr_.append(c);
      return c;
    };
    td(String(n), 'info-num');
    td(tr('infoKind_' + kind), 'info-kind kind-' + kind);
    const v = document.createElement('td');
    v.className = 'info-video';
    const ch = document.createElement('div');
    ch.className = 'info-channel';
    ch.textContent = meta?.channel || tileName(i) || '—';
    const ti = document.createElement('div');
    ti.className = 'info-title';
    ti.textContent = meta?.title || '';
    ti.title = meta?.title || '';
    v.append(ch, ti);
    tr_.append(v);
    for (const text of timeCells(kind, info)) td(text, 'info-time');
    td(kind === 'live' ? numText(info?.viewers) : '—', 'info-n');
    td(numText(info?.views), 'info-n');
    td(posText(i, kind, info), 'info-n');
    const st = Sync.tileStatus(i);
    td((st.ok ? '○ ' : '× ') + st.text, st.ok ? 'info-sync ok' : 'info-sync');
    return tr_;
  }

  function render() {
    renderQueued = false;
    if (!dialog.open) return;
    const list = visibleIndexes()
      .map((i, k) => [i, k + 1])
      .filter(([i]) => state.tiles[i].videoId);
    document.getElementById('infoRows').replaceChildren(...list.map(([i, n]) => row(i, n)));
    document.getElementById('infoEmpty').hidden = list.length > 0;
    dialog.querySelector('.info-scroll').hidden = !list.length;
  }
  /** 知らせが続けて届いても、書き直すのは 1 回にまとめる */
  function update() {
    if (!dialog.open || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }
  function request() {
    for (const i of visibleIndexes()) if (views[i].player) postToFrame(views[i].player, { hakomado: 'infoReq' });
    update();
  }

  function open() {
    if (dialog.open) return;
    dialog.showModal();
    render();
    request();
    clearInterval(timer);
    timer = setInterval(request, REQ_MS);
  }

  function setup() {
    document.getElementById('openInfo').addEventListener('click', open);
    document.getElementById('infoClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      clearInterval(timer);
      timer = 0;
    });
    closeOnBackdrop(dialog);
  }

  return { setup, open, update };
})();

// ---------------------------------------------------------------- 自己診断 (YouTube 側の変更に気づく)
// 枠の中のスクリプト (content/*.js) は YouTube のページの作りに頼っているので、YouTube が作りを変えると
// 黙って動かなくなる。枠を読み込んでからしばらく待っても、届くはずの知らせが来なければ、止まった機能を枠のバーの ⚠ と
// お知らせで出す (同じ機能のお知らせは、この画面を開いている間 1 度だけ)。
//   frame  … 枠の中のスクリプトから何も届かない (watch.js が動いていない)
//   player … プレイヤーの状態が届かない (watch-main.js: ミュート・まとめて一時停止・終了の検知・見られるかの確認)
//   meta   … チャンネル名が届かない (枠の名前・📌 の判定)
//   chat   … チャット欄が見つからない (chat.js: 弾幕・チャット欄。ライブ配信かアーカイブのときだけ確かめる)
const Diagnose = (() => {
  const WAIT_MS = 30 * 1000;
  const state_ = new Map(); // i -> {frame, seen: Set, chatFrame, chatOk, problems: Set}
  const announced = new Set();
  const get = (i) => {
    if (!state_.has(i)) state_.set(i, { seen: new Set(), problems: new Set() });
    return state_.get(i);
  };

  /** ページが裏に回っている間はタイマーが間引かれるので、表に出てから確かめる */
  function later(fn) {
    setTimeout(function run() {
      if (document.hidden) document.addEventListener('visibilitychange', run, { once: true });
      else fn();
    }, WAIT_MS);
  }

  /**
   * 枠のプレイヤーを作った (読み込み始めた)。届いた知らせの記録はここで消す。
   * (読み込みが終わったとき (load) に消すと、それより前に届いた知らせ (チャンネル名など。同じ内容は 1 度しか送られない) まで
   * 消えてしまい、届いているのに「止まった」と判定してしまう。YouTube のページは load までに数秒以上かかる)
   */
  function playerCreated(i, f) {
    const d = get(i);
    Object.assign(d, { frame: f, seen: new Set() });
    d.problems.clear();
    show(i);
  }

  /** 枠のプレイヤーの読み込みが終わった → 30 秒後に、届くはずの知らせが届いたかを確かめる */
  function playerLoaded(i, f) {
    const d = get(i);
    if (d.frame !== f) playerCreated(i, f); // 念のため (作ったことを知らされていない枠)
    later(() => {
      if (views[i].player !== f) return; // 読み込み直した / 片付けた
      if (!d.seen.size) d.problems.add('frame');
      else {
        if (!d.seen.has('playability') && !d.seen.has('social')) d.problems.add('player');
        if (!d.seen.has('meta')) d.problems.add('meta');
      }
      report(i);
    });
  }

  /**
   * 枠のチャット欄を作った (読み込み始めた)。届いた知らせの記録はここで消す。
   * (chat.js は document_idle で動くので、読み込みが終わる (load) より前にチャット欄を見つけて知らせてくることがある。
   * load で消すとその知らせまで消え、新しいコメントが 30 秒来ない静かなチャットでは「止まった」と判定してしまう)
   */
  function chatCreated(i, f) {
    const d = get(i);
    Object.assign(d, { chatFrame: f, chatOk: false });
    d.problems.delete('chat');
    show(i);
  }

  /** 枠のチャット欄の読み込みが終わった → 30 秒後に、チャット欄が見つかったかを確かめる */
  function chatLoaded(i, f) {
    const d = get(i);
    if (d.chatFrame !== f) chatCreated(i, f); // 念のため (作ったことを知らされていない枠)
    later(() => {
      if (views[i].chatFrame !== f || d.chatOk) return;
      // 開始前・終わった動画などでチャット欄が無いのは正常なので、ライブ配信中かアーカイブ (リプレイ) のときだけ
      if (!views[i].el.classList.contains('is-live') && !views[i].replay) return;
      d.problems.add('chat');
      report(i);
    });
  }

  function seen(i, type) {
    get(i).seen.add(type);
  }

  function chatSeen(i) {
    const d = get(i);
    d.chatOk = true;
    if (d.problems.delete('chat')) show(i);
  }

  function clear(i) {
    state_.delete(i);
    show(i);
  }

  function report(i) {
    const d = get(i);
    show(i);
    const fresh = [...d.problems].filter((p) => !announced.has(p));
    if (!fresh.length) return;
    for (const p of fresh) announced.add(p);
    console.warn('hakomado: 動いていない機能があります', tileName(i), [...d.problems]);
    notify(tr('diagNotice', fresh.map((p) => tr('diag_' + p)).join(tr('sep'))));
  }

  /** 枠のバーの ⚠ (マウスを乗せると止まった機能が出る) */
  function show(i) {
    const badge = views[i]?.el.querySelector('.diag-badge');
    if (!badge) return;
    const problems = [...(state_.get(i)?.problems || [])];
    badge.hidden = !problems.length;
    badge.title = problems.length ? tr('diagTitle', problems.map((p) => tr('diag_' + p)).join('\n・')) : '';
  }

  return { playerCreated, playerLoaded, chatCreated, chatLoaded, seen, chatSeen, clear };
})();

// プレイヤー (watch ページ) からの連絡
window.addEventListener('message', (e) => {
  if (e.origin !== YT) return;
  const data = e.data;
  if (!data || typeof data.hakomado !== 'string') return;
  const i = views.findIndex((v) => v.player && v.player.contentWindow === e.source);
  if (i < 0) return;
  Diagnose.seen(i, data.hakomado);
  if (data.hakomado === 'syncState') {
    // 位置を読んだ時刻が分かれば、それをこのページの時刻に直して使う (届くまでの遅れの揺れを除く)。おかしな値なら届いた時刻
    const recv = performance.now();
    const sampled = Number(data.ts) - performance.timeOrigin;
    const at = sampled > recv - 1000 && sampled <= recv + 5 ? Math.min(sampled, recv) : recv;
    views[i].ss = { t: Number(data.t), ps: Number(data.ps), ad: !!data.ad, r: Number(data.r) || 1, up: !!data.up, sk: Number(data.sk) || 0, at };
    return;
  }
  if (data.hakomado === 'livePos') {
    // ライブの、画面に出ている瞬間の配信開始からの経過 (秒)。🎬 本編モードでライブを基準にするため
    const pos = Number(data.pos);
    if (Number.isFinite(pos) && pos >= 0 && pos < 30 * 86400) views[i].lv = { pos, ps: Number(data.ps), at: performance.now() };
    if (!views[i].lvSeen) {
      views[i].lvSeen = true;
      Sync.refresh();
    }
    return;
  }
  if (data.hakomado === 'archive') {
    const [start, end, dur] = [Number(data.start), Number(data.end), Number(data.dur)];
    if ([start, end, dur].every(Number.isFinite) && dur > 0) views[i].archive = { start, end, dur };
    Sync.refresh();
    return;
  }
  if (data.hakomado === 'userAudio') {
    // 枠内のプレイヤーのスピーカーで切り替え → この枠だけ切り替える (他の枠はそのまま。複数枠の同時再生用)
    setAudio(i, { on: !data.muted });
  } else if (data.hakomado === 'mix') {
    // 枠の中で左右・音量の経路を作れなかった (AudioContext が動かない)
    if (data.ok === false) showToast(i, tr('mixBlocked'));
  } else if (data.hakomado === 'envChunk') {
    AudioSync.chunk(i, data); // 🎧 音で合わせる: 枠の音の大きさの記録
  } else if (data.hakomado === 'measure') {
    if (data.ok === false) AudioSync.blocked(i);
  } else if (data.hakomado === 'live') {
    views[i].el.classList.toggle('is-live', !!data.on);
    renderMix(i);
    Sync.refresh();
    TileInfo.update();
  } else if (data.hakomado === 'replay') {
    // アーカイブだと分かった → チャットをリプレイに切り替える (弾幕・チャット欄のどちらかが ON のとき)
    const c = String(data.continuation || '');
    if (/^[\w%=-]{10,2000}$/.test(c) && views[i].replay !== c) {
      views[i].replay = c;
      renderTile(i, { reloadChat: true });
    }
  } else if (data.hakomado === 'progress') {
    const v = views[i];
    const sec = Number(data.t);
    if (v.replay && v.chatFrame?.dataset.loaded === '1' && Number.isFinite(sec)) {
      // リプレイの画面の中のスクリプト (chat.js) に渡し、そこから YouTube のリプレイに中継してもらう
      v.chatFrame.contentWindow.postMessage({ hakomado: 'progress', t: sec, id: state.tiles[i].videoId }, YT);
    }
  } else if (data.hakomado === 'meta') {
    views[i].meta = {
      title: String(data.title || ''),
      channel: String(data.channel || ''),
      handle: String(data.handle || ''),
      channelId: String(data.channelId || ''),
    };
    updateTileName(i);
    updateFavButton(i);
    TileInfo.update();
    WatchHistory.update(state.tiles[i].videoId, { ...views[i].meta, label: state.tiles[i].label });
    if (savedIds.has(state.tiles[i].videoId)) SavedVideos.update(state.tiles[i].videoId, views[i].meta);
    if (playlistIds.has(state.tiles[i].videoId)) Playlists.update(state.tiles[i].videoId, views[i].meta);
    updateNowPlaying();
  } else if (data.hakomado === 'playability') {
    views[i].playStatus = String(data.status || '');
    onPlayability(i, String(data.status || ''), String(data.text || ''));
    Sync.refresh();
    TileInfo.update();
  } else if (data.hakomado === 'info') {
    const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    views[i].info = {
      kind: ['live', 'upcoming', 'archive', 'video'].includes(data.kind) ? data.kind : '',
      viewers: num(data.viewers),
      views: num(data.views),
      start: num(data.start),
      end: num(data.end),
      publish: num(data.publish),
      dur: num(data.dur),
      t: num(data.t),
      at: Date.now(),
    };
    Sync.refresh();
    TileInfo.update();
  } else if (data.hakomado === 'ended') {
    onEnded(i, data.reason === 'played' ? 'played' : 'already');
  } else if (data.hakomado === 'social') {
    views[i].social = {
      loggedIn: !!data.loggedIn,
      subscribed: typeof data.subscribed === 'boolean' ? data.subscribed : null,
      liked: typeof data.liked === 'boolean' ? data.liked : null,
    };
    views[i].socialBusy = false;
    updateSocialButtons(i);
    if (data.failed) notify(tr('ytFailed', tileName(i)));
  }
});

/**
 * 枠のプレイヤーが「配信・動画が終わった」と知らせてきたとき。終わった配信として覚え (自動再生で入れ直さない)、
 * 自動再生中なら枠をすぐ外す:
 *  - played (最後まで再生した): 自分で読み込んだ枠も含めて外す (ライブ配信・アーカイブ・動画のどれでも)
 *  - already (開いた時点でもう終わっていた): 自動再生で入れた枠だけ (自分で開いたアーカイブはすぐ消さない)
 * 自動再生が OFF のときはどの枠もそのまま
 */
function onEnded(i, reason) {
  const t = state.tiles[i];
  if (!t.videoId) return;
  finishedIds.add(t.videoId);
  // 最後まで再生した → あとで見るから消す
  const done = reason === 'played' && savedIds.has(t.videoId) ? SavedVideos.remove(t.videoId).then(refreshSavedIds) : Promise.resolve();
  if (queueMode && t.queue && reason === 'played') {
    queueDoneIds.add(t.videoId);
    if (queueSource) Playlists.updateItem(queueSource, t.videoId, { watched: true });
    WatchHistory.removed(t.videoId, 'ended');
    done.then(() => queueNext(i));
    return;
  }
  if (state.autoMode && t.fill && reason === 'played') {
    // 最近の配信の枠が最後まで再生した → 空けて、次を入れる (自動再生 OFF のときは、ほかの枠と同じくそのまま)
    WatchHistory.removed(t.videoId, 'ended');
    state.tiles[i] = newTileState();
    views[i].danmaku.clear();
    if (document.fullscreenElement === views[i].el) document.exitFullscreen().catch(() => {});
    renderTile(i);
    if (state.settings.autoArchive) refillArchives();
    else compactToContent();
    save();
    return;
  }
  if (!state.autoMode || (!t.auto && reason !== 'played')) return;
  const name = tileName(i);
  const wasAudible = !t.muted;
  autoMissing.delete(t.videoId);
  WatchHistory.removed(t.videoId, 'ended');
  state.tiles[i] = newTileState();
  views[i].danmaku.clear();
  if (document.fullscreenElement === views[i].el) document.exitFullscreen().catch(() => {});
  renderTile(i);
  compactToContent();
  if (wasAudible && audibleTiles().length === 0) {
    const first = visibleIndexes().find((j) => state.tiles[j].videoId);
    if (first != null) setAudioSet([first]);
  }
  notify(tr('ended', name));
}

/**
 * 枠のプレイヤーが「見られない」と知らせてきたとき。メンバー限定でメンバーではない配信を
 * 自動再生で入れていたなら (設定が ON のとき) 枠を外す。自分で読み込んだ枠はそのまま
 */
function onPlayability(i, status, text) {
  const t = state.tiles[i];
  // 開始前 (待機画面) はメンバーでも OK にならないので判定しない。始まると枠のプレイヤーがもう一度知らせてくる
  if (!t.videoId || status === 'OK' || status === 'LIVE_STREAM_OFFLINE') return;
  const members = Favorites.isMembersBlock(text);
  if (members) {
    Favorites.rememberMembersOnly(t.videoId);
    membersBlocked.add(t.videoId);
  }
  // 順に再生の枠は、見られなければ飛ばして次を入れる (止まったままにしない)。
  // 年齢などの確認画面 (CONTENT_CHECK_REQUIRED) は押せば見られるので飛ばさない
  if (queueMode && t.queue && status !== 'CONTENT_CHECK_REQUIRED') {
    skipQueueTile(i, members);
    return;
  }
  if (!members) return;
  if (!state.settings.skipMembersOnly || !state.autoMode || !t.auto) return;
  const name = tileName(i);
  const wasAudible = !t.muted;
  WatchHistory.removed(t.videoId, 'members');
  state.tiles[i] = newTileState();
  views[i].danmaku.clear();
  if (document.fullscreenElement === views[i].el) document.exitFullscreen().catch(() => {});
  renderTile(i);
  compactToContent();
  if (wasAudible && audibleTiles().length === 0) {
    const first = visibleIndexes().find((j) => state.tiles[j].videoId);
    if (first != null) setAudioSet([first]);
  }
  notify(tr('membersRemoved', name));
}

// ---------------------------------------------------------------- layout picker

/**
 * レイアウトの縮小図。レイアウトの実際の縦横比で描き、16:9 の枠の中央に置く
 * (格子のマスで描くと、マスの多いレイアウトで枠の間の隙間が目立って形が崩れるため、位置を % で置く)
 */
function layoutThumb(l) {
  const box = document.createElement('div');
  box.className = 'layout-thumb';
  const shape = document.createElement('div');
  shape.className = 'layout-shape';
  const { colW, rowH, aspect } = solveTracks(l);
  const screen = 16 / 9;
  if (aspect >= screen) {
    shape.style.width = '100%';
    shape.style.height = `${(screen / aspect) * 100}%`;
  } else {
    shape.style.height = '100%';
    shape.style.width = `${(aspect / screen) * 100}%`;
  }
  const sumW = sumOf(colW);
  const sumH = sumOf(rowH);
  const span = (arr, from, n) => sumOf(arr.slice(from, from + n));
  l.slots.forEach(([x, y, w, h], k) => {
    const cell = document.createElement('div');
    cell.className = k < l.mains ? 'cell main' : 'cell';
    cell.style.left = `${(span(colW, 0, x) / sumW) * 100}%`;
    cell.style.top = `${(span(rowH, 0, y) / sumH) * 100}%`;
    cell.style.width = `${(span(colW, x, w) / sumW) * 100}%`;
    cell.style.height = `${(span(rowH, y, h) / sumH) * 100}%`;
    shape.appendChild(cell);
  });
  box.appendChild(shape);
  return box;
}

const KIND_LABEL = { focus: 'kindFocus', balance: 'kindBalance' };

/** レイアウトの説明 (ツールチップ用): 「2+8 (10 枠) ・ メイン重視」 */
function layoutTitle(l) {
  const kind = KIND_LABEL[l.kind] ? ` ・ ${tr(KIND_LABEL[l.kind])}` : '';
  return tr('layoutTitle', l.name, l.slots.length) + kind;
}

/** 上部バーのレイアウト名の幅を、一番長い名前に合わせて固定する (レイアウトを変えてもボタンが動かないように) */
function fixLayoutLabelWidth() {
  const label = document.getElementById('layoutName');
  const ctx = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(label);
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const w = Math.max(...LAYOUTS.map((l) => ctx.measureText(l.name).width));
  label.style.width = `${Math.ceil(w) + 2}px`;
}

// レイアウト画面の「おすすめ」タブ (よく使う見やすいもの)。基準位置は選んでいるものに合わせて出す
const RECOMMENDED_LAYOUTS = ['u1x2', 'u2x2', 'u3x3', 'u4x4', 'm1s3-sw', 'm1s5-fw', 'm2s4-sw', 'm2s8-sw', 'm4s4-sw', 'm4s9-sw', 'pip1'];
const LAYOUT_TABS = ['recommend', 'uniform', 'main1', 'main2', 'pip'];
const MAIN1_MAX_SLOTS = 10; // 「メイン + サブ①」は総枠数 10 まで、「②」は 11 以上

/** 一覧の並び: 総枠数の少ない順 → 同じなら均等が先、メイン枠の少ない順 → 横長が先 */
function layoutOrder(a, b) {
  return (
    a.slots.length - b.slots.length ||
    a.mains - b.mains ||
    Number(solveTracks(b).aspect >= 16 / 9) - Number(solveTracks(a).aspect >= 16 / 9)
  );
}
let layoutTab = 'recommend';

function setupLayoutPicker() {
  fixLayoutLabelWidth();
  const dialog = document.getElementById('layoutPicker');
  const body = document.getElementById('layoutGroups');
  const tabs = document.getElementById('layoutTabs');
  const anchorSeg = document.getElementById('layoutAnchor');

  const option = (l) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'layout-option';
    btn.dataset.id = l.id;
    btn.title = layoutTitle(l);
    btn.classList.toggle('current', l.id === state.layoutId);
    const label = document.createElement('span');
    label.className = 'layout-name';
    label.textContent = l.name;
    btn.append(layoutThumb(l), label);
    btn.addEventListener('click', () => {
      setLayout(l.id);
      dialog.close();
    });
    return btn;
  };
  const list = (items) => {
    const el = document.createElement('div');
    el.className = 'layout-list';
    el.append(...items.map(option));
    return el;
  };
  // 今のタブの中身を、選んでいる基準位置で描く
  const renderTab = () => {
    const at = (l) => !l.anchor || l.anchor === state.anchor;
    let items;
    if (layoutTab === 'recommend') {
      items = RECOMMENDED_LAYOUTS.map((k) => layoutFor(k, state.anchor)).filter(Boolean);
    } else if (layoutTab === 'main1' || layoutTab === 'main2') {
      const small = layoutTab === 'main1';
      items = LAYOUTS.filter((l) => l.group === 'main' && at(l) && (l.slots.length <= MAIN1_MAX_SLOTS) === small);
    } else {
      items = LAYOUTS.filter((l) => l.group === layoutTab && at(l));
    }
    body.replaceChildren(list(items.sort(layoutOrder)));
    for (const t of tabs.children) {
      const on = t.dataset.tab === layoutTab;
      t.classList.toggle('selected', on);
      t.setAttribute('aria-selected', String(on));
    }
    for (const b of anchorSeg.querySelectorAll('[data-anchor]')) {
      b.classList.toggle('selected', b.dataset.anchor === state.anchor);
    }
  };
  for (const t of LAYOUT_TABS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.tab = t;
    tab.textContent = tr('layoutTab_' + t);
    tab.addEventListener('click', () => {
      layoutTab = t;
      renderTab();
    });
    tabs.appendChild(tab);
  }
  // 基準位置 (メインを置く角)。今のレイアウトがメイン + サブ / PinP なら、同じ形のまま基準位置だけ変える
  for (const a of ANCHORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.anchor = a;
    b.textContent = tr('anchor_' + a);
    b.addEventListener('click', () => {
      state.anchor = a;
      const cur = state.layout;
      if (cur.anchor && cur.anchor !== a) setLayout(layoutFor(cur.key, a).id);
      else save();
      renderTab();
    });
    anchorSeg.appendChild(b);
  }

  const fitButtons = dialog.querySelectorAll('[data-fit]');
  const refresh = () => {
    for (const b of fitButtons) b.classList.toggle('selected', b.dataset.fit === state.fit);
    renderTab();
  };
  for (const b of fitButtons) {
    b.addEventListener('click', () => {
      setFit(b.dataset.fit);
      refresh();
    });
  }
  document.getElementById('openLayout').addEventListener('click', () => {
    refresh();
    dialog.showModal();
  });
  document.getElementById('layoutClose').addEventListener('click', () => dialog.close());
  closeOnBackdrop(dialog);
  document.getElementById('addTile').addEventListener('click', addTileSlot);
  document.getElementById('removeTile').addEventListener('click', () => removeEmptySlot());
}

/**
 * ダイアログの背景 (枠の外) をクリックしたら閉じる。
 * 押した場所と離した場所の両方が背景のときだけ閉じる (スライダーや文字の選択を枠の外まで動かして
 * 離したときは、クリックがダイアログ自身に届くので、それで閉じないように)
 */
function closeOnBackdrop(dialog) {
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === dialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) dialog.close();
    downOnBackdrop = false;
  });
}

// ---------------------------------------------------------------- drag to swap

function setupDragSwap() {
  let dragFrom = null;
  // ボタンを押したまま少し動かしたときは、ドラッグではなくボタンの操作として扱う
  let pressedControl = false;
  document.addEventListener('pointerdown', (e) => (pressedControl = !!e.target.closest?.('button, input, select')), true);
  for (const [i, v] of views.entries()) {
    // つかめる場所: 操作バー (ボタン以外) と、枠の上 2 割
    for (const handle of [v.el.querySelector('.bar'), v.el.querySelector('.drag-zone')]) {
      handle.addEventListener('dragstart', (e) => onDragStart(e, i, v));
      handle.addEventListener('dragend', onDragEnd);
    }
    v.el.addEventListener('dragover', (e) => {
      if (dragFrom == null || dragFrom === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      v.el.classList.add('drag-over');
    });
    v.el.addEventListener('dragleave', (e) => {
      if (!v.el.contains(e.relatedTarget)) v.el.classList.remove('drag-over');
    });
    v.el.addEventListener('drop', (e) => {
      e.preventDefault();
      v.el.classList.remove('drag-over');
      if (dragFrom != null && dragFrom !== i) swapTiles(dragFrom, i);
    });
  }

  function onDragStart(e, i, v) {
    // ボタンから動かしたとき・1 枠だけ全画面で見ているとき (入れ替える相手がいない) はドラッグしない
    if (pressedControl || document.fullscreenElement === v.el) {
      e.preventDefault();
      return;
    }
    {
      dragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      // ドラッグ中の影は、つかんだ場所がカーソルの下に来るように出す (枠の左上に固定すると、右の方をつかんだときに影がずれる)
      const r = v.el.getBoundingClientRect();
      const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
      const y = Math.min(Math.max(0, e.clientY - r.top), r.height);
      e.dataTransfer.setDragImage(v.el, Math.round(x), Math.round(y));
      // iframe の上ではドラッグのイベントが取れないので、ドラッグ中は iframe を無視させる
      document.body.classList.add('dragging');
      v.el.classList.add('drag-source');
    }
  }

  function onDragEnd() {
    dragFrom = null;
    document.body.classList.remove('dragging');
    views.forEach((x) => x.el.classList.remove('drag-source', 'drag-over'));
  }
}

// ---------------------------------------------------------------- toolbar & settings

/** 使い方を開く。page = 開く項目 (省くと、このタブで最後に見ていたもの) */
let openHelp = () => {};

function setupHelp() {
  const dialog = document.getElementById('help');
  const tabs = dialog.querySelectorAll('[data-help]');
  const KEY = 'hakomado.helpPage';
  const show = (name) => {
    const page = [...tabs].some((t) => t.dataset.help === name) ? name : 'start';
    for (const t of tabs) {
      t.classList.toggle('selected', t.dataset.help === page);
      t.setAttribute('aria-selected', String(t.dataset.help === page));
    }
    for (const p of dialog.querySelectorAll('.help-page')) p.hidden = p.dataset.helpPage !== page;
    dialog.querySelector('.help-content').scrollTop = 0;
    try {
      sessionStorage.setItem(KEY, page);
    } catch {
      /* ignore */
    }
  };
  for (const t of tabs) t.addEventListener('click', () => show(t.dataset.help));
  openHelp = (page) => {
    let last = null;
    try {
      last = sessionStorage.getItem(KEY);
    } catch {
      /* ignore */
    }
    show(typeof page === 'string' ? page : last);
    if (!dialog.open) dialog.showModal();
  };
}

// ---------------------------------------------------------------- 不具合の報告 (エラーの記録は errlog.js)
const ISSUE_NEW = 'https://github.com/contee213/hakomado/issues/new';
const ISSUE_BODY_MAX = 6000; // URL に入れる本文の長さ (エンコード後)。GitHub の URL の上限より十分短く

function errTime(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 報告の本文 (GitHub の Issue とコピーで同じもの)。fit = URL に入る長さまで記録を減らす */
function errReportText(list, fit) {
  const m = chrome.runtime.getManifest();
  const brand = navigator.userAgentData?.brands?.find((b) => /Chrome|Chromium/.test(b.brand));
  const browser = brand ? `${brand.brand} ${brand.version}` : (navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? '?');
  const head = [
    tr('errBodyWhat'),
    '',
    tr('errBodyEnv'),
    `- Hakomado: ${appVersionText()}${m.update_url ? ' (store)' : ''}`,
    `- Browser: ${browser}`,
    `- OS: ${navigator.userAgentData?.platform || navigator.platform || '?'}`,
    `- Language: ${LANG}`,
    '',
  ];
  const lines = list.map((e) => `${errTime(e.t)}${e.n > 1 ? ` ×${e.n}` : ''} [${e.src}/${e.kind}] ${e.msg}`);
  const build = (k) =>
    [...head, tr('errBodyLog', k, list.length), ...(k ? ['```', ...lines.slice(0, k), '```'] : [tr('errBodyNone')])].join('\n');
  let k = lines.length;
  if (fit) while (k > 0 && encodeURIComponent(build(k)).length > ISSUE_BODY_MAX) k--;
  return build(k);
}

function setupErrLog() {
  const dialog = document.getElementById('help');
  const tab = document.getElementById('helpReportTab');
  const listEl = document.getElementById('errList');
  const page = dialog.querySelector('[data-help-page="report"]');
  let list = [];

  const render = async () => {
    list = await ErrLog.list();
    // 記録があれば、使い方の項目に件数を出す
    if (list.length) tab.dataset.count = String(list.length);
    else delete tab.dataset.count;
    if (!dialog.open || page.hidden) return;
    document.getElementById('errEmpty').hidden = list.length > 0;
    document.getElementById('errClear').disabled = !list.length;
    listEl.replaceChildren(
      ...list.map((e) => {
        const li = document.createElement('li');
        li.className = `errlog-item ${e.kind}`;
        const meta = document.createElement('div');
        meta.className = 'errlog-meta';
        meta.textContent = [errTime(e.t), tr('errSrc_' + e.src), e.n > 1 ? tr('errTimes', e.n) : ''].filter(Boolean).join(' · ');
        const msg = document.createElement('div');
        msg.className = 'errlog-msg';
        msg.textContent = e.msg;
        li.append(meta, msg);
        return li;
      }),
    );
  };

  // 使い方の項目を切り替えた・開いたときに描き直す
  new MutationObserver(render).observe(page, { attributes: true, attributeFilter: ['hidden'] });
  dialog.addEventListener('toggle', render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ErrLog.KEY in changes) render();
  });

  document.getElementById('errReport').addEventListener('click', () => {
    const first = list[0]?.msg.replace(/^hakomado:\s*/, '').slice(0, 60) || '';
    const url = new URL(ISSUE_NEW);
    url.searchParams.set('title', tr('errIssueTitle') + first);
    url.searchParams.set('body', errReportText(list, true));
    window.open(url.href, '_blank', 'noopener,noreferrer');
  });
  document.getElementById('errCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(errReportText(list, false));
      notify(tr('errCopied'));
    } catch (e) {
      console.warn('hakomado: 不具合の報告をコピーできませんでした', e);
    }
  });
  document.getElementById('errClear').addEventListener('click', async () => {
    if (!confirm(tr('errClearConfirm'))) return;
    await ErrLog.clear();
    notify(tr('errCleared'));
  });
  render();
}

// ---------------------------------------------------------------- 🔗 共有 / 📥 読み込み
// 共有するもの (今の枠 = 視聴セット、または再生リスト) を「共有セット」という 1 つの形にそろえ、そこから 4 つの形式を作る:
// - 画像: レイアウトの形にサムネイルを並べ (切り替えで各枠に枠の名前も)、コードを入れた QR を添えたもの (X は画像を文字数に数えない)
// - コード: 「#Hakomado <レイアウト>.<動画 ID をつなげたもの>~<ずれ> "名前"」の 1 行。動画 ID は必ず 11 文字なので区切らない。
//   16 本でも X に貼れる長さ (拡張機能の画面の URL は入れた環境ごとに ID が違うので、共有には使えない)
// - テキスト: 1 行に 1 本 (playlistText)。名前・同期再生・レイアウト・ずれ・枠の名前まで全部入る
// - リンク: YouTube の watch_videos の URL (playlistImportLink)。Hakomado が無い人も YouTube で開ける
// 読み込むときは、どの形式も (投稿の本文をまるごと貼っても) parseIncoming で同じ形に読み、枠に並べるか再生リストとして保存する
const SHARE_MAX = MAX_TILES;

/**
 * 共有セット: 共有するもの (今の枠 / 再生リスト) と、読み込んだものの共通の形
 * movie = 🎬 本編モード (items の anchor = 本編の位置。sync は false)
 * @typedef {{name: string, items: {videoId: string, label?: string, channel?: string, offset?: number, anchor?: number|null}[],
 *   sync: boolean, movie?: boolean, layoutId: string|null, ref: string|null}} ShareSet
 */
// コードの読み書き (formatShareCode / parseShareCode / shareName)・取り込み用リンク・1 行 1 本のテキストの読み取りは share-code.js

/** 表示中の枠のうち、配信の入っている枠 (並び順。空き枠は詰める) */
const shareTiles = () => visibleIndexes().filter((i) => state.tiles[i].videoId);

/** 今の枠を共有セットにする (同期中か、ずれを決めた動画があれば同期再生として、基準とずれも入れる) */
function tilesShareSet(name = '') {
  const items = tileEntries();
  const refTile = Sync.refIfOn();
  if (Sync.isMovie()) {
    const withAnchor = items.map((h) => ({ ...h, anchor: MovieAnchors.get(h.videoId) }));
    return { name, items: withAnchor, sync: false, movie: true, layoutId: state.layoutId, ref: refTile != null ? state.tiles[refTile].videoId : null };
  }
  const sync = Sync.isOn() || items.some((x) => x.offset);
  return { name, items, sync, layoutId: state.layoutId, ref: sync && refTile != null ? state.tiles[refTile].videoId : null };
}

/** 取り込み用リンクに入れる動画の数 (YouTube の一時的な再生リストが開ける数) */
const IMPORT_LINK_MAX = 50;

/**
 * 貼られたテキストを共有セットとして読む (どの形式でも。投稿の本文をまるごと貼ってもよい)。
 * - 視聴セットのコード (#Hakomado …) があれば、それを並び順のまま (ずれが入っていれば同期再生にする)
 * - それ以外は 1 行に 1 本として読む (parseVideoLines。「# playlist=…」か取り込み用リンクの名前が名前、
 *   「# layout=…」がレイアウト、「~秒」が同期のずれ、行の後ろの「# …」が枠の名前)
 * 最大は再生リストに入る数 (200 本)。枠に並べるときは先頭から 16 本
 * @returns {Promise<ShareSet & {bad: number, tooMany: boolean}>}
 */
async function parseIncoming(text, onProgress) {
  // Hakomado Feed の短縮リンク (sets-link.js。機能フラグがオフなら読まない) は、Feed からコードを取ってきて読む
  if (SetsLink.isLink(text) && !parseShareCode(text) && !parseShareLink(text)) {
    onProgress?.(0, 0, 'short');
    try {
      text = await SetsLink.resolve(text);
    } catch (e) {
      throw new Error(tr('shortResolveFail', e.message || e));
    }
  }
  const code = parseShareCode(text) || parseShareLink(text);
  if (code?.movie) {
    const items = code.ids.map((videoId, k) => ({ videoId, anchor: code.movie[k] }));
    return { name: code.name, items, sync: false, movie: true, layoutId: code.layoutId, ref: code.ids[code.ref], bad: 0, tooMany: false };
  }
  if (code) {
    const sync = !!code.offsets;
    const items = code.ids.map((videoId, k) => (sync ? { videoId, offset: code.offsets[k] } : { videoId }));
    return { name: code.name, items, sync, layoutId: code.layoutId, ref: sync ? code.ids[code.ref] : null, bad: 0, tooMany: false };
  }
  const { items, ref, hasOffsets, meta, bad, tooMany } = await parseVideoLines(text, Playlists.MAX_ITEMS, onProgress);
  const sync = hasOffsets || !!ref || metaOn(meta.sync);
  return { name: meta.playlist || '', items, sync, layoutId: meta.layout || null, ref, bad, tooMany };
}

// ---- 共有セットの書き出し (各形式)

/** 行の後ろに付ける名前 (# や改行は入れない) */
const lineLabel = (h) => String(h.label || h.channel || '').replace(/[\r\n#]/g, ' ').replace(/\s+/g, ' ').trim();

/** テキスト形式 (parseVideoLines で読める。名前・同期再生の設定・レイアウト・ずれ・各行の名前もそのまま戻る) */
function playlistText(pl) {
  const lines = [];
  if (pl.name) lines.push(`# playlist=${pl.name}`);
  if (pl.sync) lines.push('# sync=on');
  if (pl.layoutId) lines.push(`# layout=${pl.layoutId}`);
  const first = pl.items[0]?.videoId;
  for (const h of pl.items) {
    const parts = [`${YT}/watch?v=${h.videoId}`];
    const isRef = pl.sync && pl.ref && h.videoId === pl.ref && h.videoId !== first;
    // ずれは決めてあれば 0 でも書く (受け取った側で「決めていない」にならないように)
    const o = h.offset ?? SyncOffsets.get(h.videoId);
    if (pl.sync && (h.offset != null || o || isRef)) parts.push(`~${isRef ? '*' : ''}${o}`);
    const l = lineLabel(h);
    if (l) parts.push(`# ${l}`);
    lines.push(parts.join('  '));
  }
  return lines.join('\n');
}

/** 取り込み用リンク (先頭から 50 本。ずれは入らない) */
function playlistImportLink(pl) {
  const ids = pl.items.slice(0, IMPORT_LINK_MAX).map((h) => h.videoId);
  // title= は YouTube のリストの名前 (無いと「Untitled List」)。以前の版は hakomado= から名前を読むので両方に入れる
  const name = encodeURIComponent(pl.name);
  return `${YT}/watch_videos?video_ids=${ids.join(',')}${pl.name ? `&title=${name}` : ''}&hakomado=${name}`;
}

/** 同期再生で一度に並べる分 (同期再生の再生リストは 16 本までなので全部。順に再生の再生リストをコードにするときは先頭から 16 本) */
const syncItems = (pl) => pl.items.slice(0, SHARE_MAX);

/** 同期再生のレイアウト (決めていないか本数に足りなければ、本数に合わせて選ぶ) */
function playlistLayoutId(pl) {
  const n = Math.max(1, syncItems(pl).length);
  return LAYOUTS.find((l) => l.id === pl.layoutId && l.slots.length >= n)?.id || chooseLayoutFor(n).id;
}

/**
 * 共有セットをコードにする (先頭から 16 本。同期再生ならずれと基準も入れる。名前も入れる)。format = formatShareLink なら QR 用のリンクにする。
 * format は (レイアウト, 動画, ずれ, 基準, 名前, 本編の位置) を受け取る (本編モードでなければ本編の位置は null)
 */
function shareSetCode(pl, format = formatShareCode) {
  const items = syncItems(pl);
  if (!items.length) return '';
  const ids = items.map((h) => h.videoId);
  const keepRef = pl.sync || pl.movie;
  return format(
    playlistLayoutId(pl),
    ids,
    pl.sync ? items.map((h) => h.offset ?? SyncOffsets.get(h.videoId)) : [],
    keepRef ? Math.max(0, ids.indexOf(pl.ref)) : 0,
    pl.name,
    pl.movie ? items.map((h) => h.anchor ?? null) : null,
  );
}

/** X の投稿の文字数の上限 (無料のアカウント) */
const X_TEXT_MAX = 280;

/**
 * X での文字数 (twitter-text の数え方: ラテン文字・一部の記号は 1、日本語・絵文字などは 2。URL は含まない前提)
 */
function xLength(text) {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const light = c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247);
    n += light ? 1 : 2;
  }
  return n;
}

/** X の代替テキスト (ALT) の上限 */
const X_ALT_MAX = 1000;

/**
 * 共有画像に付ける ALT の文: 名前・本数・レイアウト・並べている配信 (チャンネル名) と、読み込み用のコード。
 * 長すぎるときは配信の並びを途中で切る (コードは必ず全部入れる)
 */
function shareAltText(set) {
  const items = syncItems(set);
  const layout = LAYOUTS.find((x) => x.id === playlistLayoutId(set));
  const head = tr('shareAltHead', shareName(set.name) || `${SHARE_TAG} ${tr('shareImageTitle')}`, items.length, layout?.name || '');
  const code = tr('shareAltCode', shareSetCode(set));
  const room = X_ALT_MAX - head.length - code.length - 2;
  let list = items.map((h, k) => `${k + 1}. ${lineLabel(h) || h.videoId}`).join(tr('shareAltSep'));
  if (list.length > room) list = room > 1 ? list.slice(0, room - 1) + '…' : '';
  return [head, list, code].filter(Boolean).join('\n');
}

/** 読み込んだ共有セットを今の枠に並べる (先頭から 16 本) */
async function applyShareSet(set) {
  const items = syncItems(set);
  const ids = items.map((h) => h.videoId);
  await applyViewingSet(ids, set.layoutId, {
    offsets: set.sync ? items.map((h) => h.offset || 0) : null,
    anchors: set.movie ? items.map((h) => h.anchor ?? null) : null,
    ref: Math.max(0, ids.indexOf(set.ref)),
    labels: items.map((h) => h.label || ''),
  });
}

/**
 * 視聴セットで今の枠を置き換える (同じ配信を表示中の枠はそのまま使い、読み込み直さない)。
 * offsets (動画ごとの同期のずれ) があれば記録し、アーカイブだと分かりしだい ref 番目の動画を基準に同期を始める
 */
async function applyViewingSet(ids, layoutId, { offsets = null, anchors = null, ref = 0, labels = [], resumeAt = null } = {}) {
  playlistSyncSession = null;
  if (state.autoMode) await setAutoMode(false); // 自動再生が枠を入れ替えないように
  stopQueue();
  const used = new Set();
  const assigned = ids.map((id) => {
    const i = state.tiles.findIndex((t, j) => !used.has(j) && t.videoId === id);
    if (i >= 0) used.add(i);
    return i;
  });
  for (const [k, id] of ids.entries()) {
    if (assigned[k] >= 0) continue;
    const i = state.tiles.findIndex((_, j) => !used.has(j) && !assigned.includes(j));
    used.add(i);
    assigned[k] = i;
    setTileVideo(i, id, `${YT}/watch?v=${id}`);
    if (labels[k]) state.tiles[i].label = labels[k].slice(0, 80); // URL の行の後ろの「# …」を枠の名前にする
  }
  // 使わない枠は空にする (隠れても再生し続けないように)
  state.tiles.forEach((t, j) => {
    if (!used.has(j) && t.videoId) {
      WatchHistory.removed(t.videoId, 'replaced');
      state.tiles[j] = newTileState();
      views[j].danmaku.clear();
      renderTile(j, { reloadPlayer: true, reloadChat: true });
    }
  });
  const fixed = LAYOUTS.find((l) => l.id === layoutId && l.slots.length >= ids.length);
  state.layoutId = (fixed || chooseLayoutFor(ids.length)).id;
  if (state.layout.anchor) state.anchor = state.layout.anchor;
  state.order = [...assigned, ...state.order.filter((j) => !assigned.includes(j))];
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const refK = (offsets || anchors) && ref < ids.length ? ref : 0;
  setAudioSet([assigned[refK]]); // 音は先頭 (メイン) の枠。同期のずれ付き・本編モードなら基準の枠
  if (offsets) offsets.forEach((o, k) => SyncOffsets.set(ids[k], o));
  // 🎬 本編モード: 本編の位置を記録して、本編モードで同期を始める (決めていない動画の位置は消さない)
  if (anchors) anchors.forEach((a, k) => a != null && MovieAnchors.set(ids[k], a));
  renderAll();
  save();
  if (offsets) Sync.startWhenReady(assigned, assigned[refK], { at: resumeAt });
  else if (anchors) Sync.startWhenReady(assigned, assigned[refK], { mode: 'movie' });
}

// ---- 共有画像
const SHARE_W = 1600;
const SHARE_H = 900;
const SHARE_FONT = '"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
// 共有画像のタイトルは、同梱のフォント (M PLUS Rounded 1c の ExtraBold。fonts/OFL.txt) で描く (どの PC でも同じ見た目に)。
// 読み込めなければ SHARE_FONT
const SHARE_TITLE_FONT = `"Hakomado Title", ${SHARE_FONT}`;
let shareTitleFont = null;
function loadShareTitleFont() {
  shareTitleFont ||= new FontFace('Hakomado Title', 'url(fonts/MPLUSRounded1c-ExtraBold.ttf)', { weight: '800' })
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => null);
  return shareTitleFont;
}

const thumbCache = new Map(); // videoId -> Promise (名前を変えて画像を作り直すたびに読み込み直さない)

/** サムネイルを読み込む (大きいものから順に試す。i.ytimg.com は CORS を許しているので、画像として書き出せる) */
function loadThumb(videoId) {
  if (!thumbCache.has(videoId)) thumbCache.set(videoId, loadThumbNow(videoId));
  return thumbCache.get(videoId);
}

async function loadThumbNow(videoId) {
  const load = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  // maxresdefault が無い動画は 120×90 の代わりの画像が返るので、小さいものは使わない
  const max = await load(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
  if (max && max.naturalWidth >= 640) return { img: max, crop: null };
  // hqdefault は 4:3 で上下に黒帯があるので、真ん中の 16:9 を切り出す
  const hq = await load(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  if (hq && hq.naturalWidth >= 400) return { img: hq, crop: [0, hq.naturalHeight / 8, hq.naturalWidth, (hq.naturalHeight * 3) / 4] };
  return null;
}

/** ctx の (x, y, w, h) に画像を、はみ出た分を切って敷き詰める */
function drawCover(ctx, { img, crop }, x, y, w, h) {
  let [sx, sy, sw, sh] = crop || [0, 0, img.naturalWidth, img.naturalHeight];
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  sx += (sw - cw) / 2;
  sy += (sh - ch) / 2;
  ctx.drawImage(img, sx, sy, cw, ch, x, y, w, h);
}

/** 文字を幅に収まるように切って描く */
function fillTextFit(ctx, text, x, y, maxW) {
  let s = text;
  if (ctx.measureText(s).width > maxW) {
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    s += '…';
  }
  ctx.fillText(s, x, y);
}

// QR の周りの余白 (マス)。1 マスは整数の画素にする (端数があると、X で縮められたときに読めなくなりやすい)。
// 誤り訂正は L (データが少ないほど QR が小さくなる)。1 マスは 4 画素。
// 中身はリンク (formatShareLink)。大きさをそろえるため、型は 14 (73 マス。4 画素で 316px 角) に決めておく
// (16 本 + ずれ + 日本語 40 文字の名前でも、ふつうは入る。大きなずれが多くて入らないときだけ、入る大きさにする)
const SHARE_QR_QUIET = 3;
const SHARE_QR_TYPE = 14;
const SHARE_ACCENT = '#29a9ff'; // ロゴと同じ青 (差し色)

/** QR を作る。cell = 1 マスの画素数 (4。短縮リンクのように中身が短く、型が小さいときは、型 14 と同じくらいの大きさになるまで大きくする)、size = 余白を含めた 1 辺の画素数 */
function makeShareQr(text, { auto = false } = {}) {
  // 名前に日本語などが入るので UTF-8 で入れる (jsQR は UTF-8 として読む。ASCII だけなら以前と同じ中身)
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const build = (type) => {
    const q = qrcode(type, 'L');
    q.addData(text);
    q.make();
    return q;
  };
  let qr;
  try {
    qr = build(auto ? 0 : SHARE_QR_TYPE); // auto = 中身に合う一番小さい型 (短縮リンク)
  } catch {
    qr = build(0); // 入りきらない (code length overflow)
  }
  const n = qr.getModuleCount();
  const cell = Math.max(4, Math.floor(((SHARE_QR_TYPE * 4 + 17 + SHARE_QR_QUIET * 2) * 4) / (n + SHARE_QR_QUIET * 2)));
  return { qr, n, cell, size: (n + SHARE_QR_QUIET * 2) * cell };
}

/** QR を (x, y) に描く: 青い縁の付いた、角の丸い白いカード (影で背景から浮かせる) の中に */
function drawQr(ctx, { qr, n, cell, size }, x, y) {
  const r = Math.min(14, SHARE_QR_QUIET * cell - 2); // 角の丸みは余白の中に収める (マスを欠かない)
  const B = 5; // 青い縁の太さ
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = SHARE_ACCENT;
  ctx.beginPath();
  ctx.roundRect(x - B, y - B, size + B * 2, size + B * 2, r + B);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, r);
  ctx.fill();
  ctx.fillStyle = '#000';
  const off = SHARE_QR_QUIET * cell;
  for (let row = 0; row < n; row++) {
    for (let c = 0; c < n; c++) if (qr.isDark(row, c)) ctx.fillRect(x + off + c * cell, y + off + row * cell, cell, cell);
  }
}

/** 共有画像に描くロゴ (拡張機能の中の icons/icon.svg。読めなければ null で、文字だけにする) */
let shareLogo = null;
function loadShareLogo() {
  shareLogo ||= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'icons/icon.svg';
  });
  return shareLogo;
}

/** 共有画像に描く作者名 (改行などは入れない) */
const SHARE_AUTHOR_MAX = 30;
const shareAuthor = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, SHARE_AUTHOR_MAX);

/**
 * 共有セットの画像 (PNG の Blob) を作る (先頭から 16 本)。サムネイルの並びを画像いっぱいに敷いて背景にし、
 * その上に、左下に名前 (大きく。左に青い線) と本数・レイアウト・作者名 (小さく)、QR と、その上に付けたタブ (ロゴと「Hakomado」) を重ねる。
 * QR はいつも右下の角に、同じ大きさで重ねる:
 *   ┌──────────────────────────┐
 *   │ サムネイルの並び (画像いっぱい。labels なら枠の名前を各枠の左上に) │
 *   │                                         [ロゴ Hakomado] │
 *   │                                                   QR  │
 *   │ ░░░░░░░░ 左下だけ暗くぼかす ░░░░░                QR  │
 *   │ ▌名前 (大きく) / 本数 · レイアウト · 作者 (小さく)       QR  │
 *   └──────────────────────────┘
 */
async function renderShareImage(set, { labels = false, author = '', qrText = '' } = {}) {
  const filled = syncItems(set);
  const title = shareName(set.name) || `${SHARE_TAG} ${tr('shareImageTitle')}`;
  // QR にはコードと同じ中身のリンクを入れる (スマホのカメラで読むと YouTube で開ける)。
  // qrText (Hakomado Feed の短縮リンク) を渡したときはそれを入れる (読むと Feed のページが開く)
  const code = qrText || shareSetCode(set, (l, ids, o, r, n, mv) => formatShareLink(l, ids, o, r, n, title, false, mv));
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  ctx.textBaseline = 'alphabetic';
  const M = 28; // 重ねる文字・QR の、画像の端からの余白
  const SP = 24;

  // サムネイルの並び: レイアウトの形 (枠は 16:9) で画像いっぱいに (16:9 のレイアウトならちょうど全体。違う形なら真ん中に)
  const l = LAYOUTS.find((x) => x.id === playlistLayoutId(set));
  const { colW, rowH } = solveTracks(l);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const scale = Math.min(SHARE_W / sum(colW), SHARE_H / sum(rowH));
  const ox = (SHARE_W - sum(colW) * scale) / 2;
  const oy = (SHARE_H - sum(rowH) * scale) / 2;
  const GAP = 4;
  const rects = l.slots.map(([cx, cy, cw, chh]) => ({
    x: ox + sum(colW.slice(0, cx)) * scale + GAP / 2,
    y: oy + sum(rowH.slice(0, cy)) * scale + GAP / 2,
    w: sum(colW.slice(cx, cx + cw)) * scale - GAP,
    h: sum(rowH.slice(cy, cy + chh)) * scale - GAP,
  }));
  const thumbs = await Promise.all(filled.map((h) => loadThumb(h.videoId)));
  rects.forEach(({ x, y, w, h }, k) => {
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(x, y, w, h);
    if (k >= filled.length) return;
    const item = filled[k];
    if (thumbs[k]) drawCover(ctx, thumbs[k], x, y, w, h);
    if (!labels) return;
    // 枠の名前は枠の左上 (下は名前と QR を重ねるので)。上に暗いぼかしを敷いて読めるように
    const fs = Math.max(14, Math.min(26, Math.round(h / 10)));
    const grad = ctx.createLinearGradient(0, y, 0, y + fs * 2.4);
    grad.addColorStop(0, 'rgba(0,0,0,.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, fs * 2.4);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${fs}px ${SHARE_FONT}`;
    fillTextFit(ctx, item.label || item.channel || item.videoId, x + fs * 0.5, y + fs * 1.3, w - fs);
  });

  // QR はいつも右下の角に、同じ大きさで (空き枠があっても合わせない)
  const qr = makeShareQr(code, { auto: !!qrText });
  const qx = SHARE_W - M - qr.size;
  const qy = SHARE_H - M - qr.size;
  // 名前と説明は QR の左まで
  const textW = qx - 5 - SP - M;

  // 左下の名前 (大きく。長ければ 40px まで縮め、それでも入らなければ切る) と、本数・レイアウト (小さく)。左に青い線
  const BAR = 6;
  const tx = M + BAR + 16;
  const tw = textW - BAR - 16;
  await loadShareTitleFont();
  let fs = 64;
  for (; fs > 40; fs -= 4) {
    ctx.font = `800 ${fs}px ${SHARE_TITLE_FONT}`;
    if (ctx.measureText(title).width <= tw) break;
  }
  ctx.font = `800 ${fs}px ${SHARE_TITLE_FONT}`;
  const titleW = Math.min(tw, ctx.measureText(title).width);
  const by = shareAuthor(author);
  const info = tr('shareImageCount', filled.length, l.name) + (by ? ` · ${tr('shareImageBy', by)}` : '');
  ctx.font = `400 22px ${SHARE_FONT}`;
  const infoW = Math.min(tw, ctx.measureText(info).width);
  // 文字の下だけ暗くぼかす (下へ濃く、文字の右から先は薄くして、下の段のサムネイルをくすませない)
  const SCRIM_H = 300;
  const fadeEnd = Math.min(SHARE_W, tx + Math.max(titleW, infoW) + 380);
  const shade = document.createElement('canvas');
  shade.width = SHARE_W;
  shade.height = SCRIM_H;
  const sctx = shade.getContext('2d');
  const vg = sctx.createLinearGradient(0, 0, 0, SCRIM_H);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.55, 'rgba(0,0,0,.7)');
  vg.addColorStop(1, 'rgba(0,0,0,.9)');
  sctx.fillStyle = vg;
  sctx.fillRect(0, 0, SHARE_W, SCRIM_H);
  const hg = sctx.createLinearGradient(0, 0, fadeEnd, 0);
  hg.addColorStop(0, 'rgba(0,0,0,1)');
  hg.addColorStop(Math.max(0, (fadeEnd - 380) / fadeEnd), 'rgba(0,0,0,1)');
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.globalCompositeOperation = 'destination-in';
  sctx.fillStyle = hg;
  sctx.fillRect(0, 0, SHARE_W, SCRIM_H);
  ctx.drawImage(shade, 0, SHARE_H - SCRIM_H);

  const titleY = SHARE_H - M - 40;
  ctx.fillStyle = SHARE_ACCENT;
  ctx.fillRect(M, titleY - fs * 0.78, BAR, SHARE_H - M + 4 - (titleY - fs * 0.78));
  ctx.shadowColor = 'rgba(0,0,0,.8)';
  ctx.shadowBlur = 10;
  ctx.font = `800 ${fs}px ${SHARE_TITLE_FONT}`;
  ctx.fillStyle = '#fff';
  fillTextFit(ctx, title, tx, titleY, tw);
  ctx.font = `400 22px ${SHARE_FONT}`;
  ctx.fillStyle = '#d0d0da';
  fillTextFit(ctx, info, tx, SHARE_H - M, tw);
  ctx.shadowBlur = 0;

  drawQr(ctx, qr, qx, qy);

  // QR の上に、青い縁につなげたタブ (ロゴと「Hakomado」。右寄せ)
  const logo = await loadShareLogo();
  const TAB_H = 42;
  const LOGO = 30;
  ctx.font = `700 24px ${SHARE_FONT}`;
  const tabW = 12 + (logo ? LOGO + 8 : 0) + ctx.measureText(SHARE_TAG).width + 14;
  const tabX = qx + qr.size + 5 - tabW;
  const tabY = qy - 5 - TAB_H + 6; // 下の 6px は縁の角の丸みに重ねて、すき間を作らない
  ctx.fillStyle = SHARE_ACCENT;
  ctx.beginPath();
  ctx.roundRect(tabX, tabY, tabW, TAB_H, [12, 12, 0, 0]);
  ctx.fill();
  if (logo) ctx.drawImage(logo, tabX + 12, tabY + 6, LOGO, LOGO);
  ctx.fillStyle = '#fff';
  ctx.fillText(SHARE_TAG, tabX + 12 + (logo ? LOGO + 8 : 0), tabY + 30);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}

/** 画像 (Blob) の中の QR を読む。読めなければ null */
async function readQrFromImage(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    const W = bmp.width;
    const H = bmp.height;
    const fit = Math.min(1, 1600 / Math.max(W, H)); // 大きすぎる画像は縮めて読む (読み取りが遅くなるため)
    // 順に試す: 全体 (縮めたもの・元の大きさ)、右半分を拡大したもの (QR は右側にある。X で縮められた画像は、
    // 拡大し直すと読めることがある)、全体を拡大したもの、全体を少し縮めたもの。[左, 上, 幅, 高さ] (割合) と倍率
    const tries = [
      [[0, 0, 1, 1], fit],
      [[0, 0, 1, 1], 1],
      [[0.5, 0, 0.5, 1], Math.min(2, 1600 / Math.max(W / 2, H))],
      [[0, 0, 1, 1], Math.min(2, 2400 / Math.max(W, H))], // 小さい画像は全体を拡大して (以前の版の画像は、QR が空き枠の真ん中寄りにあることがある)
      [[0, 0, 1, 1], fit * 0.75],
    ];
    const seen = new Set();
    for (const [[rx, ry, rw, rh], k] of tries) {
      const sx = Math.round(W * rx);
      const sy = Math.round(H * ry);
      const sw = Math.round(W * rw);
      const sh = Math.round(H * rh);
      const w = Math.round(sw * k);
      const h = Math.round(sh * k);
      const key = `${sx},${sy},${w},${h}`;
      if (seen.has(key) || w < 50 || h < 50) continue;
      seen.add(key);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
      const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (hit?.data) return hit.data;
    }
    return null;
  } finally {
    bmp.close();
  }
}

// ---- 𝕏 に投稿: 文章と URL を入れた投稿画面を開き、画像も添付する (投稿ボタンは利用者が押す)
// 画像は URL では渡せないので、開いたタブに chrome.scripting でスクリプトを入れ、投稿欄の画像の入力欄に入れる
// (人が画像を選んだときと同じ)。x.com の権限は任意の権限で、初めて押したときに聞く。
// 許可されなかったとき・X の画面が変わって入れられなかったときは、クリップボードの画像を Ctrl+V で貼ってもらう
const X_ORIGIN = 'https://x.com/*';

/** タブの読み込みが終わるのを待つ (最大 ms。終わらなくても進む) */
function waitTabComplete(tabId, ms) {
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    timer = setTimeout(done, ms);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && done(), done);
  });
}

/**
 * X の投稿画面 (タブの中) で動かす: 投稿欄のある画面の画像の入力欄に画像を入れ、添付されたら true。
 * 投稿欄が出るまで待つ (ログインしていない・画面の作りが変わったときは見つからずに false)。
 * chrome.scripting で入れるので、この関数の外のものは使えない
 */
async function xAttachImage(base64, name) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = () => {
    const box = document.querySelector('[data-testid="tweetTextarea_0"]');
    return box && (box.closest('[role="dialog"]') || document).querySelector('input[type="file"][data-testid="fileInput"]');
  };
  let input = null;
  for (let i = 0; i < 40 && !(input = find()); i++) await sleep(500);
  if (!input) return false;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type: 'image/png' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[data-testid="attachments"]')) return true;
    await sleep(250);
  }
  return false;
}

/** 開いた X の投稿画面のタブに画像を入れる。入れられたら true */
async function attachImageToX(tabId, blob) {
  await waitTabComplete(tabId, 20000);
  const base64 = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => resolve('');
    r.readAsDataURL(blob);
  });
  if (!base64) return false;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: xAttachImage, args: [base64, 'hakomado.png'] });
    return res?.result === true;
  } catch {
    return false; // ログインの画面に移った・タブが閉じられた など
  }
}

/** 入力欄の文字をクリップボードへ (使えないときは選んでコピー) */
async function copyField(el) {
  try {
    await navigator.clipboard.writeText(el.value);
  } catch {
    el.select();
    document.execCommand('copy');
  }
}

/** 共有画面で今の枠に付ける名前 (このタブで最後に付けたもの。読み込んで枠に並べたときはその名前) */
let shareTilesName = '';

/** 共有画面を開く。source = 'tiles' (今の枠) か、再生リストの ID */
let openShareDialog = () => {};

function setupShare() {
  const dialog = document.getElementById('shareDialog');
  const sourceEl = document.getElementById('shareSource');
  const nameEl = document.getElementById('shareName');
  const status = document.getElementById('shareStatus');
  const imgEl = document.getElementById('shareImg');
  const codeEl = document.getElementById('shareCode');
  const textEl = document.getElementById('shareText');
  const linkEl = document.getElementById('shareLink');
  const xCountEl = document.getElementById('shareXCount');
  const tabs = dialog.querySelectorAll('[data-stab]');
  const imgBtns = ['shareToX', 'shareImgCopy', 'shareImgSave'].map((id) => document.getElementById(id));
  const outBtns = [...imgBtns, ...['shareAltCopy', 'shareCopyCode', 'shareCopyText', 'shareCopyLink'].map((id) => document.getElementById(id))];
  const TAB_KEY = 'hakomado.shareTab';
  const LABELS_KEY = 'hakomado.shareImgLabels'; // 画像の各枠に枠の名前を入れるか (既定は入れない)
  const labelsEl = document.getElementById('shareImgLabels');
  const AUTHOR_KEY = 'hakomado.shareAuthor'; // 画像に描く作者名 (次に開いたときも同じ)
  const authorEl = document.getElementById('shareAuthor');
  let authorTimer = 0;
  let source = 'tiles';
  let set = null; // 今の共有セット (共有するものが無ければ null)
  let tab = 'image';
  let imageBlob = null;
  let imageUrl = '';
  let imageStale = true;
  let renderSeq = 0;
  let refreshSeq = 0;
  let nameTimer = 0;
  // Hakomado Feed の短縮リンク (sets-link.js の機能フラグがオンのときだけ)。作ったときのコードと同じ間だけ使う
  // (名前や中身を変えたら作り直してもらう。押したときだけ送る)
  let short = null; // { code, url }
  const shortEl = document.getElementById('shareShort');
  const shortCopyBtn = document.getElementById('shareShortCopy');
  const shortState = document.getElementById('shareImgShortState');
  const shortBtns = ['shareShortMake', 'shareImgShort'].map((id) => document.getElementById(id));
  for (const el of dialog.querySelectorAll('[data-sets-link]')) el.hidden = !SetsLink.enabled;
  const shortUrl = () => (short && set && short.code === shareSetCode(set) ? short.url : '');
  const showShort = () => {
    const url = shortUrl();
    shortEl.value = url;
    shortEl.hidden = shortCopyBtn.hidden = !url;
    shortState.textContent = url ? tr('shortQrOn') : '';
    for (const b of shortBtns) b.disabled = !set || !!url;
  };
  closeOnBackdrop(dialog);

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('share-error', isError);
  };

  const clearImage = () => {
    renderSeq++;
    imageBlob = null;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = '';
    imgEl.removeAttribute('src');
    imageStale = true;
  };

  /** 共有するものの選択肢 (今の枠と、再生リスト) を作り直す。今選んでいる再生リストが消えていたら今の枠に戻す */
  const fillSources = async () => {
    const lists = await Playlists.list();
    const n = shareTiles().length;
    const tiles = new Option(n ? tr('shareSourceTiles', n) : tr('shareSourceTilesEmpty'), 'tiles');
    const group = document.createElement('optgroup');
    group.label = tr('shareSourcePlaylists');
    group.append(...lists.map((p) => new Option(tr('shareSourcePl', p.name, p.items.length), p.id)));
    sourceEl.replaceChildren(tiles, ...(lists.length ? [group] : []));
    const gone = source !== 'tiles' && !lists.some((p) => p.id === source);
    if (gone) source = 'tiles';
    sourceEl.value = source;
    return gone;
  };

  /** 選んだものの名前を名前欄に入れる (今の枠はこのタブで最後に付けた名前、再生リストはその名前) */
  const fillName = async () => {
    nameEl.value = source === 'tiles' ? shareTilesName : (await Playlists.get(source))?.name || '';
  };

  /** 共有するものを読み直して、各形式を作り直す */
  const refresh = async () => {
    const seq = ++refreshSeq;
    const name = nameEl.value.trim();
    let next = null;
    if (source === 'tiles') next = tilesShareSet(name);
    else {
      const pl = await Playlists.get(source);
      if (pl) next = { ...pl, name };
    }
    if (seq !== refreshSeq) return;
    set = next?.items.length ? next : null;
    const n = set?.items.length || 0;
    const count = (max) => (n > max ? tr('shareFirstN', max, n) : tr('shareAllN', n));
    codeEl.value = set ? shareSetCode(set) : '';
    // X の本文に入るか (入らなければ画像で共有してもらう)
    const xLen = set ? xLength(codeEl.value) : 0;
    xCountEl.textContent = set ? tr(xLen > X_TEXT_MAX ? 'shareXOver' : 'shareXCount', xLen, X_TEXT_MAX) : '';
    xCountEl.classList.toggle('share-error', xLen > X_TEXT_MAX);
    textEl.value = set ? playlistText(set) : '';
    linkEl.value = set ? playlistImportLink(set) : '';
    document.getElementById('shareNoteImage').textContent = tr('shareNoteImage', count(SHARE_MAX));
    document.getElementById('shareNoteCode').textContent = tr('shareNoteCode', count(SHARE_MAX));
    document.getElementById('shareNoteText').textContent = tr('shareNoteText', count(Infinity));
    document.getElementById('shareNoteLink').textContent = tr('shareNoteLink', count(IMPORT_LINK_MAX));
    for (const b of outBtns) b.disabled = !set;
    showShort();
    setStatus(set ? '' : tr(source === 'tiles' ? 'shareEmpty' : 'shareEmptyPl'));
    imageStale = true;
    if (!set) clearImage();
    else if (tab === 'image') makeImage();
  };

  /** 共有画像を作り直す (作っている途中で作り直したときは、最後のものだけ使う) */
  const makeImage = async () => {
    if (!set) return;
    imageStale = false;
    const seq = ++renderSeq;
    setStatus(tr('shareImageMaking'));
    for (const b of imgBtns) b.disabled = true;
    try {
      const blob = await renderShareImage(set, { labels: labelsEl.checked, author: authorEl.value, qrText: shortUrl() });
      if (seq !== renderSeq) return;
      imageBlob = blob;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(blob);
      imgEl.src = imageUrl;
      setStatus('');
      for (const b of imgBtns) b.disabled = false;
    } catch (e) {
      if (seq === renderSeq) setStatus(tr('shareImageFail', e.message || e), true);
    }
  };

  // タブ (最後に開いていた形式を次も開く)。中身は同じ場所に重ねてあるので、切り替えても画面の大きさは変わらない
  const showTab = (name) => {
    tab = [...tabs].some((t) => t.dataset.stab === name) ? name : 'image';
    for (const t of tabs) {
      t.classList.toggle('selected', t.dataset.stab === tab);
      t.setAttribute('aria-selected', String(t.dataset.stab === tab));
    }
    for (const p of dialog.querySelectorAll('.share-panel')) p.hidden = p.dataset.spanel !== tab;
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
    if (tab === 'image' && imageStale) makeImage();
  };
  for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.stab));
  try {
    tab = localStorage.getItem(TAB_KEY) || tab;
    labelsEl.checked = localStorage.getItem(LABELS_KEY) === '1';
    authorEl.value = localStorage.getItem(AUTHOR_KEY) || '';
  } catch {
    /* ignore */
  }
  showTab(tab);
  labelsEl.addEventListener('change', () => {
    try {
      localStorage.setItem(LABELS_KEY, labelsEl.checked ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (set) makeImage();
  });
  authorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  authorEl.addEventListener('input', () => {
    try {
      localStorage.setItem(AUTHOR_KEY, shareAuthor(authorEl.value));
    } catch {
      /* ignore */
    }
    clearTimeout(authorTimer);
    authorTimer = setTimeout(() => set && makeImage(), 300);
  });

  openShareDialog = async ({ source: src = 'tiles' } = {}) => {
    source = src;
    await fillSources();
    await fillName();
    clearImage();
    setStatus('');
    if (!dialog.open) dialog.showModal();
    await refresh();
  };
  document.getElementById('openShare').addEventListener('click', () => openShareDialog());

  sourceEl.addEventListener('change', async () => {
    source = sourceEl.value;
    await fillName();
    clearImage();
    await refresh();
  });
  // Enter で画面 (form method="dialog") が閉じないように
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  nameEl.addEventListener('input', () => {
    if (source === 'tiles') shareTilesName = nameEl.value.trim();
    clearTimeout(nameTimer);
    nameTimer = setTimeout(refresh, 300);
  });

  const copy = async (el, msg) => {
    await copyField(el);
    setStatus(tr(msg));
  };
  // 短縮リンクを作る (リンクのタブ・画像のタブのどちらからでも。作ったら画像の QR もそれにする)
  const makeShort = async () => {
    if (!set || !SetsLink.enabled) return;
    const code = shareSetCode(set);
    for (const b of shortBtns) b.disabled = true;
    setStatus(tr('shortMaking'));
    try {
      const url = await SetsLink.create(code);
      if (!set || shareSetCode(set) !== code) return; // 作っている間に中身が変わった
      short = { code, url };
      showShort();
      setStatus(tr('shortMade'));
      if (tab === 'image') makeImage();
      else imageStale = true;
    } catch (e) {
      setStatus(tr('shortFail', e.message || e), true);
      showShort();
    }
  };
  for (const b of shortBtns) b.addEventListener('click', makeShort);
  shortCopyBtn.addEventListener('click', () => copy(shortEl, 'shortCopied'));

  document.getElementById('shareCopyCode').addEventListener('click', () => copy(codeEl, 'shareCopied'));
  document.getElementById('shareCopyText').addEventListener('click', () => copy(textEl, 'plShareCopiedText'));
  document.getElementById('shareCopyLink').addEventListener('click', () => copy(linkEl, 'plShareCopiedLink'));
  document.getElementById('shareImgCopy').addEventListener('click', async () => {
    if (!imageBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
      setStatus(tr('shareImageCopied'));
    } catch (e) {
      setStatus(tr('shareImageFail', e.message || e), true);
    }
  });
  document.getElementById('shareToX').addEventListener('click', async () => {
    if (!imageBlob || !set) return;
    // x.com の権限は、押した操作の中で最初に聞く (await の後では聞けない)。許可済みなら聞かずに true
    const asked = chrome.permissions.request({ origins: [X_ORIGIN] }).catch(() => false);
    const blob = imageBlob;
    const title = shareName(set.name) || `${SHARE_TAG} ${tr('shareImageTitle')}`;
    // X の本文に入れるリンクは名前も % にする (X は URL の途中の日本語でリンクを切る)
    const url = formatXPostUrl(`${title} #${SHARE_TAG}`, shareSetCode(set, (l, ids, o, r, n, mv) => formatShareLink(l, ids, o, r, n, title, true, mv)));
    const allowed = await asked;
    // 入れられなかったときのために、画像はいつもクリップボードにも入れておく
    let copied = false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copied = true;
    } catch {
      /* 画面がフォーカスを失った など */
    }
    let tab;
    try {
      tab = await chrome.tabs.create({ url });
    } catch (e) {
      setStatus(tr('shareImageFail', e.message || e), true);
      return;
    }
    const fallback = () => setStatus(tr(copied ? 'shareXPaste' : 'shareXNoImage'), !copied);
    if (!allowed) return fallback();
    setStatus(tr('shareXAttaching'));
    if (await attachImageToX(tab.id, blob)) setStatus(tr('shareXAttached'));
    else fallback();
  });
  document.getElementById('shareAltCopy').addEventListener('click', async () => {
    if (!set) return;
    try {
      await navigator.clipboard.writeText(shareAltText(set));
      setStatus(tr('shareAltCopied'));
    } catch {
      setStatus(tr('shareAiFailed'), true);
    }
  });
  document.getElementById('shareImgSave').addEventListener('click', () => {
    if (!imageUrl) return;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `hakomado-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
    a.click();
  });

  // 開いている間に再生リストが編集・削除されたら作り直す (名前欄は書きかけを残す)
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !Playlists.isChange(changes) || !dialog.open) return;
    if (await fillSources()) await fillName();
    if (source !== 'tiles') {
      clearImage();
      await refresh();
    }
  });
}

// ---------------------------------------------------------------- 📥 読み込む
// 画像・コード・テキスト・取り込み用リンク・URL のどれを貼っても (画像はドロップでも) parseIncoming で読み取り、
// 内容を確かめてから「枠に並べる」か「再生リストとして保存」を選ぶ。Enter で押すほう (主ボタン) は開いた入口で変える
// (ツールバー = 枠に並べる、ライブラリ・取り込み用リンク = 保存)。画面のどこかで Ctrl+V しても、ここに入れて開く。
// AI チャットへの頼み文のコピーもここ (折りたたみの中)

/**
 * 読み込み画面を開く。primary = Enter で押すボタン ('apply' 枠に並べる / 'save' 保存)。
 * text を渡すと貼り付け欄に入れて読み取り、image (Blob) を渡すと QR を読む。lead は読み取った内容の上に出す一言
 */
let openReadDialog = () => {};

function setupRead() {
  const dialog = document.getElementById('readDialog');
  const input = document.getElementById('readIn');
  const summary = document.getElementById('readSummary');
  const nameEl = document.getElementById('readName');
  const applyBtn = document.getElementById('readApply');
  const saveBtn = document.getElementById('readSave');
  const aiCopied = document.getElementById('readAiCopied');
  let primary = 'apply';
  let parsed = null; // 読み取った共有セット (読み取り中・読めなかったときは null)
  let parseSeq = 0;
  let parseTimer = 0;
  let nameTimer = 0;
  let nameTouched = false; // 名前を自分で書いたら、読み取った名前で上書きしない
  let busy = false;
  let lead = '';
  closeOnBackdrop(dialog);

  const setSummary = (text, isError = false) => {
    summary.textContent = [lead, text].filter(Boolean).join('\n');
    summary.classList.toggle('share-error', isError);
  };
  const updateButtons = () => {
    applyBtn.disabled = saveBtn.disabled = busy || !parsed;
  };
  const setPrimary = (p) => {
    primary = p === 'save' ? 'save' : 'apply';
    applyBtn.classList.toggle('primary-action', primary === 'apply');
    saveBtn.classList.toggle('primary-action', primary === 'save');
  };
  const primaryBtn = () => (primary === 'save' ? saveBtn : applyBtn);
  /** 保存するときの名前 (名前欄か読み取った名前。再生リストと同じく改行を除いて 40 文字まで。空なら '') */
  const saveName = (set) => (nameEl.value.trim() || set.name || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, Playlists.NAME_MAX).trim();

  /** 読み取った内容 (1 行目に名前・本数・レイアウト・同期、続けて注意) */
  const describe = async (set) => {
    const parts = [];
    if (set.name) parts.push(tr('readName', set.name));
    parts.push(tr('readCount', set.items.length));
    const layout = set.layoutId && LAYOUTS.find((l) => l.id === set.layoutId);
    if (layout) parts.push(tr('readLayout', layout.name));
    if (set.sync) parts.push(tr(set.items.some((h) => h.offset) ? 'readSyncOffsets' : 'readSync'));
    if (set.movie) parts.push(tr('readMovie'));
    const notes = [];
    if (set.bad) notes.push(tr('shareBadLines', set.bad));
    if (set.tooMany) notes.push(tr('plTooMany', Playlists.MAX_ITEMS));
    if (set.items.length > SHARE_MAX) notes.push(tr(set.sync ? 'readOverSync' : 'readOverTiles', SHARE_MAX));
    const name = saveName(set);
    if (name && (await Playlists.list()).some((p) => p.name === name)) notes.push(tr('readReplace', name));
    return [parts.join(' / '), ...notes].join('\n');
  };

  /** 貼り付け欄を読み取る (読み取っている途中で書き換えたときは、最後のものだけ使う) */
  const parse = async () => {
    clearTimeout(parseTimer);
    const seq = ++parseSeq;
    parsed = null;
    updateButtons();
    const text = input.value;
    if (!text.trim()) {
      setSummary('');
      return;
    }
    try {
      const set = await parseIncoming(text, (done, total, what) => {
        if (seq === parseSeq) setSummary(what === 'short' ? tr('shortResolving') : tr('shareLoading', done, total));
      });
      if (seq !== parseSeq) return;
      if (!set.items.length) {
        setSummary(tr('readNothing'), true);
        return;
      }
      if (!nameTouched) nameEl.value = set.name.slice(0, Playlists.NAME_MAX);
      const text2 = await describe(set);
      if (seq !== parseSeq) return;
      parsed = set;
      setSummary(text2);
      updateButtons();
    } catch (e) {
      if (seq === parseSeq) setSummary(String(e?.message || e), true);
    }
  };
  const parseSoon = () => {
    clearTimeout(parseTimer);
    parseSeq++; // 読み取り中のものは捨てる
    parsed = null;
    updateButtons();
    parseTimer = setTimeout(parse, 600);
  };

  /** 画像の QR を読んで、読めたら貼り付け欄に入れて読み取る */
  const readImage = async (blob) => {
    clearTimeout(parseTimer);
    const seq = ++parseSeq;
    parsed = null;
    updateButtons();
    setSummary(tr('shareImageReading'));
    let text = null;
    try {
      text = await readQrFromImage(blob);
    } catch {
      /* 画像として読めない */
    }
    if (seq !== parseSeq) return;
    if (!text || !(SHARE_CODE_RE.test(text) || parseShareLink(text) || SetsLink.isLink(text))) {
      setSummary(tr('shareImageNoQr'), true);
      return;
    }
    input.value = text;
    await parse();
  };

  openReadDialog = async ({ primary: p = 'apply', text, image, lead: l = '' } = {}) => {
    setPrimary(p);
    lead = l;
    aiCopied.textContent = '';
    if (text != null || image) {
      input.value = text ?? '';
      nameEl.value = '';
      nameTouched = false;
    }
    if (!dialog.open) dialog.showModal();
    if (image) await readImage(image);
    else await parse(); // 前に貼ったものが残っていれば読み直す (名前の重なりなどが変わっているかもしれないので)
    (parsed ? primaryBtn() : input).focus();
  };

  input.addEventListener('input', () => {
    lead = '';
    parseSoon();
  });
  // 画像の貼り付け (X の画像を「画像をコピー」したものなど)
  input.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    lead = '';
    readImage(file);
  });
  // 画像ファイル・ほかのタブの画像のドロップ
  dialog.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list')) e.preventDefault();
  });
  dialog.addEventListener('drop', async (e) => {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    const url = e.dataTransfer.getData('text/uri-list').split(/\r?\n/).find((u) => /^https:\/\//.test(u));
    if (!file && !url) return;
    e.preventDefault();
    lead = '';
    if (file) {
      readImage(file);
      return;
    }
    // ほかのタブからドラッグした画像は URL で届くので、取りに行く (X の画像は CORS で読める)。画像でなければ URL として読む
    try {
      const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(20000) });
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) {
        readImage(blob);
        return;
      }
    } catch {
      /* 取れなければ URL として読む */
    }
    input.value = url;
    parse();
  });

  // 名前: 書いたら読み取った名前で上書きしない。Enter で主ボタン
  nameEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (!primaryBtn().disabled) primaryBtn().click();
  });
  nameEl.addEventListener('input', () => {
    nameTouched = true;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(async () => {
      const set = parsed;
      if (!set) return;
      const text = await describe(set);
      if (parsed === set) setSummary(text);
    }, 300);
  });
  // 貼り付け欄は Ctrl+Enter で主ボタン
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !primaryBtn().disabled) {
      e.preventDefault();
      primaryBtn().click();
    }
  });

  const reset = () => {
    input.value = '';
    nameEl.value = '';
    nameTouched = false;
    parsed = null;
    lead = '';
    setSummary('');
  };

  applyBtn.addEventListener('click', async () => {
    const set = parsed && { ...parsed, name: nameEl.value.trim() || parsed.name };
    if (!set) return;
    busy = true;
    updateButtons();
    try {
      await applyShareSet(set);
      shareTilesName = set.name; // 共有画面にも同じ名前を出す
      const n = Math.min(set.items.length, SHARE_MAX);
      const notes = [set.bad ? tr('shareBadLines', set.bad) : '', set.items.length > SHARE_MAX ? tr('shareTooMany') : ''].filter(Boolean);
      notify([tr(set.sync ? 'shareLoadedSync' : 'shareLoaded', n), ...notes].join(' / '));
      reset();
      dialog.close();
      if (favDialog.open) favDialog.close(); // ライブラリから開いたときは、並べた枠が見えるように
    } finally {
      busy = false;
      updateButtons();
    }
  });

  saveBtn.addEventListener('click', async () => {
    const set = parsed;
    if (!set) return;
    busy = true;
    updateButtons();
    try {
      const r = await Playlists.save(saveName(set) || defaultPlaylistName(), set.items, {
        sync: set.sync,
        layoutId: set.layoutId,
        ref: set.ref,
      });
      if (!r?.playlist) {
        setSummary(r?.full ? tr('plFull', Playlists.MAX_LISTS) : tr('plSaveFailed'), true);
        return;
      }
      const saved = r.playlist.items.length;
      const cut = set.tooMany || saved < set.items.length;
      const tooManyNote = r.playlist.sync ? tr('plTooManySync', Playlists.SYNC_MAX) : tr('plTooMany', Playlists.MAX_ITEMS);
      const notes = [set.bad ? tr('shareBadLines', set.bad) : '', cut ? tooManyNote : ''].filter(Boolean);
      notify([tr(r.replaced ? 'plReplaced' : 'plSaved', r.playlist.name, saved), ...notes].join(' / '));
      reset();
      dialog.close();
      // 保存した再生リストをライブラリで開く (そのまま再生できるように)
      selectPlaylist(r.playlist.id);
      rememberLibraryTab('playlists');
      openFavorites(null, 'library');
    } finally {
      busy = false;
      updateButtons();
    }
  });

  const aiWant = document.getElementById('readAiWant');
  aiWant.addEventListener('input', () => {
    aiCopied.textContent = '';
  });
  document.getElementById('readAi').addEventListener('click', async () => {
    const want = aiWant.value.trim();
    try {
      await navigator.clipboard.writeText(await aiPromptText(want));
      aiCopied.textContent = tr(want ? 'shareAiCopied' : 'shareAiCopiedEmpty');
    } catch {
      aiCopied.textContent = tr('shareAiFailed');
    }
  });

  document.getElementById('openRead').addEventListener('click', () => openReadDialog({ primary: 'apply' }));

  // 画面のどこかで貼り付けた (入力欄の外で Ctrl+V) ときも、共有されたものならここで読む。
  // ほかの画面 (設定など) を開いているときは何もしない。共有画面からは、こちらに切り替える
  document.addEventListener('paste', (e) => {
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const open = [...document.querySelectorAll('dialog[open]')];
    if (open.some((d) => d !== dialog && d.id !== 'shareDialog')) return;
    const image = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!image && !text.trim()) return;
    e.preventDefault();
    document.getElementById('shareDialog').close();
    openReadDialog({ primary: 'apply', text: image ? null : text, image });
  });
}

/** 名前を付けずに保存したときの再生リストの名前 (例: 再生リスト 11/21 20:05) */
function defaultPlaylistName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return tr('plDefaultName', `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`);
}

/**
 * AI チャットに貼る頼み文。見たいもの (読み込む画面で書いたもの。空なら AI チャットで書き足してもらう)・進め方・
 * 書き方 (Hakomado が読める形式)・選び方と調べ方のヒント・頼み方の例・登録しているチャンネルの一覧を入れる。
 * 特定の事務所・サイトに寄せた内容は入れない (どのチャンネルを登録していても使えるように)
 */
async function aiPromptText(want = '') {
  const favs = await Favorites.list();
  const ja = LANG === 'ja';
  const channels = favs.map((f) => `- ${f.star ? '📌 ' : ''}${f.name}${f.handle ? ` (${f.handle})` : ''} channel_id=${f.channelId}`);
  const today = new Date().toLocaleString(ja ? 'ja-JP' : 'en-US', { dateStyle: 'full', timeStyle: 'short' });
  if (ja) {
    return [
      'Hakomado (YouTube の配信・動画を最大 16 枠まで並べて同時に見る Chrome 拡張機能) で見る再生リストを作ってください。',
      `今は ${today} です。「昨日」「今週」「今夜」などは、この日時を基準にしてください。`,
      '',
      '## 見たいもの',
      want || '(ここに見たいものを書いてください。下の「頼み方の例」も参考に)',
      '',
      '## 進め方',
      '1. 見たいものに合う配信・動画を、Web 検索や YouTube で調べる',
      '2. 一つひとつ、実際の YouTube のページや RSS で動画 ID・チャンネル・タイトル・配信日時を確かめる',
      '3. 見る順に並べて、下の形式で出力する',
      '',
      '## 出力してほしいもの',
      '1. 再生リストのテキスト (コードブロックで。1 行に 1 本、見る順に。最大 200 本):',
      '```',
      '# playlist=再生リストの名前',
      'https://www.youtube.com/watch?v=動画ID  # チャンネル名 / 配信タイトル',
      '```',
      '2. 取り込み用リンク (50 本まで。名前は URL エンコード):',
      'https://www.youtube.com/watch_videos?video_ids=動画ID,動画ID,...&hakomado=再生リストの名前',
      '3. 選んだ理由 (1 本につき 1 行。リストの外に)',
      '4. 見つからなかったもの・確かめられなかったもの (あれば。リストの外に)',
      '',
      '## 選び方のヒント',
      '- 本数の指定がなければ、同時に並べて見る前提で 4〜16 本くらいにする (再生リストの「▶ 順に再生」なら、16 本を超えた分は見終わった枠に順に入る)',
      '- 「話題になった」「盛り上がった」配信は、再生数・同時接続数、切り抜き動画の多さ、ニュース記事や SNS での言及を手がかりに選ぶ',
      '- 同じ企画 (コラボ・大会・合同の配信など) を複数の人がそれぞれの視点で配信していたら、まとめて並べる',
      '- 下の登録チャンネルを優先してよいが、見たいものに合えば登録していないチャンネルも入れてよい',
      '- まだ始まっていない配信予定を入れるときは、開始予定の日時をコメント (# の後ろ) に書く',
      '- メンバー限定・非公開・削除済みのものは入れない',
      '- 動画 ID は実際に確認できたものだけを使い、推測で作らない',
      '',
      '## 調べ方のヒント',
      '- チャンネルのライブ配信 (予定を含む) の RSS: https://www.youtube.com/feeds/videos.xml?playlist_id=UULV + channel_id の 3 文字目以降',
      '- チャンネルの動画の RSS: https://www.youtube.com/feeds/videos.xml?channel_id=チャンネルID',
      '- チャンネルの配信の一覧: https://www.youtube.com/@ハンドル/streams',
      '',
      '## 頼み方の例 (参考。今回の依頼は上の「見たいもの」です)',
      '- 昨日の配信で話題になっていたものを 10 本',
      '- 今週のコラボ企画を、参加した全員の視点で',
      '- 明日の夜に見られる歌枠',
      '- ○○ (ゲーム名) の大会を、出場した配信者ごとの視点で',
      '- 登録チャンネルの最新のアーカイブを 1 本ずつ',
      '- 作業しながら流せる雑談配信を 6 本',
      '- 今週の新衣装・記念配信のまとめ',
      '',
      '## 私が登録しているチャンネル (📌 = 特によく見る)',
      ...(channels.length ? channels : ['(なし)']),
    ].join('\n');
  }
  return [
    'Please make a playlist for Hakomado (a Chrome extension for watching up to 16 YouTube streams or videos side by side).',
    `It is now ${today}. Read “yesterday”, “this week”, “tonight” and so on from this date and time.`,
    '',
    '## What I want to watch',
    want || '(Write it here. See “Example requests” below)',
    '',
    '## How to go about it',
    '1. Find streams and videos that match, using web search and YouTube',
    '2. Check each one on its actual YouTube page or RSS feed: video ID, channel, title and date',
    '3. Put them in watching order and output them in the format below',
    '',
    '## Output',
    '1. Playlist text (in a code block, one per line in watching order, up to 200):',
    '```',
    '# playlist=Playlist name',
    'https://www.youtube.com/watch?v=VIDEO_ID  # Channel name / stream title',
    '```',
    '2. Import link (up to 50 videos; URL-encode the name):',
    'https://www.youtube.com/watch_videos?video_ids=VIDEO_ID,VIDEO_ID,...&hakomado=Playlist%20name',
    '3. Why you picked each one (one line each, outside the list)',
    '4. Anything you could not find or confirm (if any, outside the list)',
    '',
    '## Tips for choosing',
    '- If no number is given, aim for about 4–16, since they are watched side by side (with “▶ In order”, any beyond 16 go into tiles as they finish)',
    '- For streams people were “talking about”, go by views and concurrent viewers, how many clips were made, and mentions in news and on social media',
    '- When several people streamed the same event (a collab, tournament or joint stream) from their own view, put them together',
    '- Prefer the channels I follow below, but include others when they fit',
    '- For streams that have not started yet, put the scheduled date and time in the comment (after #)',
    '- Leave out members-only, private and deleted videos',
    '- Only use video IDs you actually confirmed; never guess them',
    '',
    '## Tips for searching',
    '- RSS of a channel’s live streams (including upcoming): https://www.youtube.com/feeds/videos.xml?playlist_id=UULV + channel_id without its first 2 characters',
    '- RSS of a channel’s videos: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID',
    '- A channel’s list of streams: https://www.youtube.com/@handle/streams',
    '',
    '## Example requests (for reference; my request is “What I want to watch” above)',
    '- 10 of yesterday’s streams people were talking about',
    '- This week’s collab, from every participant’s view',
    '- Karaoke streams I can watch tomorrow night',
    '- The ○○ (game) tournament, from each player’s view',
    '- The latest archive from each channel I follow',
    '- 6 chatting streams to play while I work',
    '- This week’s new outfit reveals and anniversary streams',
    '',
    '## Channels I follow (📌 = watch most)',
    ...(channels.length ? channels : ['(none)']),
  ].join('\n');
}

/**
 * 取り込み用リンクから開いたとき (#import=…)。リンクの中身を読み込み画面の貼り付け欄に入れて開き、名前を確かめて保存してもらう
 * (枠に並べることもできる)。
 * (YouTube の watch_videos の URL を、background.js がこの画面に付け替えて開く)
 */
function handleImportLink() {
  const PREFIX = '#import=';
  if (!location.hash.startsWith(PREFIX)) return;
  const raw = location.hash.slice(PREFIX.length);
  // 再読み込みでもう一度出さないよう、先に URL から外す
  history.replaceState(null, '', location.pathname + location.search);
  let url = '';
  let link = null;
  try {
    url = `${YT}/watch_videos?${decodeURIComponent(raw)}`;
    link = parseWatchVideosLink(url);
  } catch {
    /* 壊れたリンク */
  }
  if (!link?.ids.length) {
    notify(tr('importNothing'));
    return;
  }
  // 共有画像の QR のリンク (レイアウト・ずれ入り) は、リンクのまま入れる (コードと同じに読める)
  if (parseShareLink(url)) {
    openReadDialog({ primary: 'apply', text: url, lead: tr('importReceived', link.ids.length) });
    return;
  }
  // 名前は「# playlist=」の行にして入れる (読み取った内容と名前欄にそのまま出る)
  const name = link.name.replace(/[\r\n]/g, ' ').trim();
  openReadDialog({
    primary: 'save',
    text: [...(name ? [`# playlist=${name}`] : []), ...link.ids.map((id) => `${YT}/watch?v=${id}`)].join('\n'),
    lead: tr('importReceived', link.ids.length),
  });
}

// ---- 右クリックのメニュー「Hakomado の空き枠に追加」(background.js から届く / 画面が無ければ #add=<ID> で開く)

/**
 * 動画を空き枠に入れる。空き枠が無ければ (16 枠未満なら) 枠を 1 つ足す。結果は画面に短く出す。
 * @returns {'added'|'already'|'full'}
 */
function addVideoFromMenu(videoId) {
  const shown = visibleIndexes().find((i) => state.tiles[i].videoId === videoId);
  if (shown != null) {
    showToast(shown, tr('menuAlready'));
    return 'already';
  }
  const target = emptyTileOrAdd();
  if (target == null) {
    notify(tr('menuFull', MAX_TILES));
    return 'full';
  }
  forgetAutoMarks(videoId);
  setTileVideo(target, videoId, `${YT}/watch?v=${videoId}`);
  showToast(target, tr('menuAdded'));
  return 'added';
}

/** 新しいタブで開いたとき (#add=<動画 ID>) */
function handleAddLink() {
  const m = location.hash.match(/^#add=([A-Za-z0-9_-]{11})$/);
  if (!m) return;
  // 再読み込みでもう一度入れないよう、先に URL から外す
  history.replaceState(null, '', location.pathname + location.search);
  addVideoFromMenu(m[1]);
}

/** 開いている画面に届いた「追加」。届くのは全部の画面なので、自分のタブ宛てのものだけに返事をする */
function listenAddVideo(myTabId) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'add-video' || sender.id !== chrome.runtime.id || sender.tab || msg.tabId !== myTabId) return false;
    if (!ID_RE.test(msg.videoId)) return false;
    sendResponse({ handled: true, result: addVideoFromMenu(msg.videoId) });
    return false;
  });
}

// 設定画面のスライダーの表示形式
const SETTING_FORMATS = {
  duration: (v) => tr('sec', v),
  fontScale: (v) => `${Math.round(v * 100)}%`,
  opacity: (v) => `${Math.round(v * 100)}%`,
  area: (v) => `${Math.round(v * 100)}%`,
  maxOnScreen: (v) => tr('items', v),
  chatZoom: (v) => `${Math.round(v * 100)}%`,
  chatWidth: (v) => `${Math.round(v * 100)}%`,
  hlWidth: (v) => `${v} px`,
  hlGlow: (v) => (v === 0 ? tr('off') : `${Math.round(v * 100)}%`),
  cruiseSec: (v) => formatCruise(v),
  prestartMin: (v) => (v ? tr('minBefore', v) : tr('never')),
  autoMaxTiles: (v) => tr('tilesCount', v),
};
// 決まった値から選ぶスライダー (スライダーの位置 = 配列の番号)。クルーズの間隔は細かく選ぶ必要がないので、
// 短い間隔は細かく、長い間隔は大きく刻む
const SETTING_STEPS = {
  cruiseSec: [10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800],
  prestartMin: [0, 5, 10, 15, 30, 60],
};

/** 保存されている値にいちばん近い段階の番号 (以前の版の半端な値も近いものに寄せる) */
function stepIndex(key, v) {
  const steps = SETTING_STEPS[key];
  let best = 0;
  for (let k = 1; k < steps.length; k++) {
    if (Math.abs(Math.log(steps[k] / v)) < Math.abs(Math.log(steps[best] / v))) best = k;
  }
  return best;
}

const SETTING_CHECKBOXES = ['showPaid', 'chatHideAvatars', 'hlAnimate', 'skipMembersOnly', 'autoArchive', 'autoPickupMain'];
const SETTING_SELECTS = ['dmFont', 'dmWeight', 'authorName', 'autoTarget', 'noticeTarget'];

/** 設定画面の入力欄を state.settings に合わせる (他のタブで設定が変わったときも呼ぶ) */
function syncSettingsInputs() {
  for (const [key, fmt] of Object.entries(SETTING_FORMATS)) {
    const steps = SETTING_STEPS[key];
    const input = document.getElementById(key);
    if (steps) {
      const k = stepIndex(key, Number(state.settings[key]) || steps[0]);
      Object.assign(input, { min: '0', max: String(steps.length - 1), step: '1' });
      input.value = String(k);
      document.getElementById(key + 'Out').textContent = fmt(steps[k]);
    } else {
      input.value = String(state.settings[key]);
      document.getElementById(key + 'Out').textContent = fmt(state.settings[key]);
    }
  }
  for (const key of SETTING_CHECKBOXES) document.getElementById(key).checked = !!state.settings[key];
  for (const key of SETTING_SELECTS) document.getElementById(key).value = state.settings[key];
  for (const b of document.querySelectorAll('#hlSwatches .hl-swatch')) b.classList.toggle('selected', b.dataset.id === normalizeHlStyle(state.settings.hlStyle));
  const liveId = normalizeLiveStyle(state.settings.liveStyle);
  for (const b of document.querySelectorAll('#liveSwatches .hl-swatch')) b.classList.toggle('selected', b.dataset.id === liveId);
  for (const b of document.querySelectorAll('.dm-pos-seg [data-pos]')) {
    const on = b.dataset.pos === (state.settings.areaPos || 'top');
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  }
  applyDanmakuArea();
  applyDanmakuLook();
}

// 弾幕の文字の見た目。フォントは PC に入っているものを使い、無ければ次の候補 → 標準のゴシックになる
const DM_FONTS = {
  standard: 'system-ui, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif',
  round: '"Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, "Yu Gothic UI", sans-serif',
  mincho: '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", "MS PMincho", serif',
  ud: '"BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", sans-serif',
};
/** 弾幕のフォント・太さを CSS 変数に出す (枠の弾幕と、設定画面の見本の両方に効く)。文字色・縁取りは固定 */
function applyDanmakuLook() {
  const s = state.settings;
  const root = document.documentElement.style;
  root.setProperty('--dm-font', DM_FONTS[s.dmFont] || DM_FONTS.standard);
  root.setProperty('--dm-weight', s.dmWeight === 'normal' ? '400' : '700');
  root.setProperty('--dm-opacity', String(s.opacity));
  for (const v of ['off', 'staff', 'all']) document.body.classList.toggle(`dm-author-${v}`, s.authorName === v);
}

/** 弾幕が流れる帯を CSS 変数に出す (設定画面の見本と、枠に重ねる帯で使う) */
function applyDanmakuArea() {
  const { top, height } = Danmaku.band(state.settings);
  const root = document.documentElement.style;
  root.setProperty('--dm-band-top', `${(top * 100).toFixed(1)}%`);
  root.setProperty('--dm-band-height', `${(height * 100).toFixed(1)}%`);
}

/** 流れる場所を変えている間、実際の各枠に帯を重ねて見せる (少し経つと消える) */
let dmAreaTimer = 0;
function flashDanmakuArea() {
  document.body.classList.add('show-dm-area');
  clearTimeout(dmAreaTimer);
  dmAreaTimer = setTimeout(() => document.body.classList.remove('show-dm-area'), 1800);
}

/**
 * 版の表示 (例: "0.2.0 · build 120 (2026-11-22)")。
 * version = manifest.json のリリースバージョン、build = コミット時にフックが build.js に書き込むビルド番号と日付 (無ければ version だけ)
 */
function appVersionText() {
  const { version } = chrome.runtime.getManifest();
  const b = typeof BUILD === 'object' && BUILD ? BUILD : null;
  return b?.n ? `${version} · build ${b.n}${b.date ? ` (${b.date})` : ''}` : version;
}

/** 使い方・設定の画面の下にバージョンを出す */
function showAppVersion() {
  const text = `Hakomado ${appVersionText()}`;
  for (const el of document.querySelectorAll('.app-version')) el.textContent = text;
  showUpdateLink();
}

/** 新しいバージョンが出ていれば、バージョン表示の横にリリースのページへのリンクを出す (その版で初めてなら、お知らせも出す) */
async function showUpdateLink() {
  let info = null;
  try {
    info = await UpdateCheck.check();
  } catch (e) {
    console.warn('hakomado: 新しいバージョンの確認に失敗', e);
  }
  if (!info) return;
  for (const el of document.querySelectorAll('.app-version')) {
    el.querySelector('.update-link')?.remove();
    const a = document.createElement('a');
    a.className = 'update-link';
    a.href = info.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = tr('updateLink', info.latest);
    el.append(' · ', a);
  }
  if (info.notify) {
    notify(tr('updateNotice', info.latest));
    UpdateCheck.markNotified(info.latest);
  }
}

/** 設定画面の「バックアップ」タブ: ファイルに書き出す / ファイルから読み込む */
function setupBackup() {
  document.getElementById('backupExport').addEventListener('click', () => {
    Backup.download().catch((e) => notify(tr('backupFail', e.message)));
  });
  const file = document.getElementById('backupFile');
  document.getElementById('backupImport').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = ''; // 同じファイルをもう一度選んでも change が来るように
    if (!f) return;
    let parsed;
    try {
      parsed = Backup.parse(await f.text(), DEFAULT_SETTINGS);
    } catch (e) {
      alert(tr(e.message === 'tooNew' ? 'backupTooNew' : 'backupNotFile'));
      return;
    }
    const c = parsed.counts;
    if (!confirm(tr('backupConfirm', c.channels, c.stars, c.history, c.saved, c.playlists))) return;
    try {
      // まだ書き込んでいない設定の変更は捨てる (読み込んだ設定を上書きしないように)
      clearTimeout(settingsTimer);
      dirtySettings.clear();
      await Backup.apply(parsed);
      await saveNow();
    } catch (e) {
      notify(tr('backupFail', e.message));
      return;
    }
    // チャンネル一覧・📌・表示言語などをまとめて反映するため、画面を読み込み直す (枠の中身は視聴セッションから戻る)
    notify(tr('backupImported'));
    setTimeout(() => location.reload(), 800);
  });
}

function setupToolbar() {
  setupLayoutPicker();

  document.getElementById('brandHome').addEventListener('click', backToStart);

  document.getElementById('nowPlaying').addEventListener('click', toggleMuteAll);
  document.getElementById('pauseAll').addEventListener('click', (e) => {
    e.currentTarget.blur(); // Space キーでボタンが押し直されないように
    togglePauseAll();
  });

  const dialog = document.getElementById('settings');
  document.getElementById('openSettings').addEventListener('click', () => {
    updatePacks();
    dialog.showModal();
  });
  document.getElementById('settingsReset').addEventListener('click', resetSettings);
  setupBackup();
  setupHelp();
  setupErrLog();
  setupShare();
  setupRead();
  setupPlaylistPicker();
  setupPacks();
  Sync.setup();
  showAppVersion();
  document.getElementById('openHelp').addEventListener('click', () => openHelp());
  document.getElementById('tourReplay').addEventListener('click', () => {
    document.getElementById('help').close();
    startTour();
  });
  document.getElementById('gridFullscreen').addEventListener('click', (e) => {
    // 押したボタンにフォーカスを残さない (全画面中に上部バーを隠すため)
    e.currentTarget.blur();
    toggleGridFullscreen();
  });
  updateGridFullscreen();
  // ダイアログは背景 (枠の外) をクリックしても閉じる
  for (const d of document.querySelectorAll('#settings, #help')) closeOnBackdrop(d);

  // 設定画面のタブ (最後に開いていたタブを次回も開く)
  const tabs = dialog.querySelectorAll('.settings-tabs [data-tab]');
  const showTab = (name) => {
    for (const t of tabs) {
      t.classList.toggle('selected', t.dataset.tab === name);
      t.setAttribute('aria-selected', String(t.dataset.tab === name));
    }
    for (const p of dialog.querySelectorAll('.settings-panel')) p.hidden = p.dataset.panel !== name;
    try {
      localStorage.setItem('hakomado.settingsTab', name);
    } catch {
      /* ignore */
    }
  };
  for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab));
  // 「? 詳しい説明」: 今のタブの設定の説明を、使い方の画面で開く
  const HELP_OF_TAB = { danmaku: 'look', audio: 'look', chat: 'look', auto: 'auto', channels: 'channels', backup: 'backup' };
  document.getElementById('settingsHelp').addEventListener('click', () => {
    const tab = [...tabs].find((t) => t.classList.contains('selected'))?.dataset.tab;
    openHelp(HELP_OF_TAB[tab] || 'start');
  });

  // 表示言語 (変えたらページを読み込み直す。視聴中の枠はこのタブのセッションとしてそのまま戻る)
  const langSelect = document.getElementById('langSelect');
  langSelect.value = LANG_PREF;
  langSelect.addEventListener('change', async () => {
    setLangPref(langSelect.value);
    await saveNow();
    location.reload();
  });
  let initialTab = 'danmaku';
  try {
    initialTab = localStorage.getItem('hakomado.settingsTab') || initialTab;
  } catch {
    /* ignore */
  }
  showTab([...tabs].some((t) => t.dataset.tab === initialTab) ? initialTab : 'danmaku');

  const chatKeys = new Set(['chatZoom', 'chatWidth', 'chatHideAvatars']);
  const hlKeys = new Set(['hlWidth', 'hlGlow', 'hlAnimate']);
  const dmLookKeys = new Set(['dmFont', 'dmWeight', 'authorName', 'opacity']);
  const onSettingChanged = (key) => {
    if (chatKeys.has(key)) applyChatLook();
    if (hlKeys.has(key)) applyHighlight();
    if (key === 'area' || key === 'areaPos') {
      applyDanmakuArea();
      flashDanmakuArea();
    }
    if (key === 'cruiseSec') restartCruise();
    if (dmLookKeys.has(key)) applyDanmakuLook();
    saveSettings(key);
  };
  // 弾幕の流れる位置 (上 / 中央 / 下)
  for (const b of document.querySelectorAll('.dm-pos-seg [data-pos]')) {
    b.addEventListener('click', () => {
      state.settings.areaPos = b.dataset.pos;
      syncSettingsInputs();
      onSettingChanged('areaPos');
    });
  }
  for (const key of Object.keys(SETTING_FORMATS)) {
    const input = document.getElementById(key);
    input.addEventListener('input', () => {
      const steps = SETTING_STEPS[key];
      state.settings[key] = steps ? steps[Math.round(parseFloat(input.value))] : parseFloat(input.value);
      document.getElementById(key + 'Out').textContent = SETTING_FORMATS[key](state.settings[key]);
      onSettingChanged(key);
    });
  }
  for (const key of SETTING_CHECKBOXES) {
    const input = document.getElementById(key);
    input.addEventListener('change', () => {
      state.settings[key] = input.checked;
      onSettingChanged(key);
    });
  }
  for (const key of SETTING_SELECTS) {
    const input = document.getElementById(key);
    input.addEventListener('change', () => {
      state.settings[key] = input.value;
      onSettingChanged(key);
      if (key === 'noticeTarget') knownLive = null; // 対象が変わったら、次の確認は今の状態を覚えるだけ
    });
  }

  // 音が出ている枠・ライブ配信中の枠の線の色 (見本をクリックで選択)
  const swatch = (id, name, background, key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hl-swatch' + (id === 'none' ? ' none' : '');
    b.dataset.id = id;
    const chip = document.createElement('i');
    if (background) chip.style.background = background;
    const label = document.createElement('span');
    label.textContent = name;
    b.title = name;
    b.append(chip, label);
    b.addEventListener('click', () => {
      state.settings[key] = id;
      syncSettingsInputs();
      applyHighlight();
      saveSettings(key);
    });
    return b;
  };
  for (const [id, p] of Object.entries(HL_PRESETS)) {
    document.getElementById('hlSwatches').appendChild(swatch(id, p.name, hlGradient(p), 'hlStyle'));
    document.getElementById('liveSwatches').appendChild(swatch(id, p.name, hlGradient(p), 'liveStyle'));
  }
  document.getElementById('liveSwatches').appendChild(swatch('none', tr('off'), '', 'liveStyle'));
  syncSettingsInputs();
  applyChatLook();
  applyHighlight();

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, dialog')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Shift+数字: その枠を全画面 (Shift を押すと記号になる配列もあるので e.code で見る)
    const digit = e.code?.match(/^(?:Digit|Numpad)([1-9])$/)?.[1];
    if (e.shiftKey && digit) {
      const i = visibleIndexes()[parseInt(digit, 10) - 1];
      if (i != null) toggleFullscreen(i);
      return;
    }
    // Shift+F: 分割したまま全画面 (F だけならチャンネル、B はライブラリ)
    if (e.shiftKey && e.code === 'KeyF') {
      toggleGridFullscreen();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault(); // ページのスクロールやボタンの押し直しにしない
      togglePauseAll();
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMuteAll();
    } else if (e.key === 'd' || e.key === 'D') {
      toggleDanmakuAll();
    } else if (e.key === '?') {
      openHelp();
    } else if (e.key === 'f' || e.key === 'F') {
      openFavorites(null, 'channels');
    } else if (e.key === 'b' || e.key === 'B') {
      openFavorites(null, 'library');
    } else if (e.key === 'l' || e.key === 'L') {
      setAutoMode(!state.autoMode);
    } else if (e.key === 'c' || e.key === 'C') {
      setCruise(!state.cruise);
    } else if (e.key === 'i' || e.key === 'I') {
      TileInfo.open();
    } else if (/^[1-9]$/.test(e.key)) {
      const i = visibleIndexes()[parseInt(e.key, 10) - 1];
      if (i != null) setAudio(i, { solo: true });
    } else if (ARROW_DIRS[e.key] && !isTileFullscreen()) {
      // 矢印キー: 今音が出ている枠の、その方向にある枠だけ音を出す (ページのスクロールはしない)
      e.preventDefault();
      moveAudio(ARROW_DIRS[e.key]);
    }
  });

  new ResizeObserver(() => layout()).observe(gridEl);
  setupFavorites();
  setupNotices();
  TileInfo.setup();
  setupToolbarFit();
}

// ---------------------------------------------------------------- favorites

/* global Favorites */
const favDialog = document.getElementById('favorites');
const favListEl = document.getElementById('favList');
const favErrorEl = document.getElementById('favError');
let favTarget = null; // 読み込み先の枠 (null = 空いている枠)
const favStatus = new Map(); // channelId -> 'loading' | 'error' | {state, videoId, title, startAt}

function displayNumber(i) {
  return visibleIndexes().indexOf(i) + 1;
}

function firstEmptyTile() {
  return visibleIndexes().find((i) => !state.tiles[i].videoId);
}

/** 空き枠。無ければ (16 枠未満なら) 枠を 1 つ足して、その枠。16 枠埋まっていれば null */
function emptyTileOrAdd() {
  if (firstEmptyTile() == null && state.count < MAX_TILES) addTileSlot();
  return firstEmptyTile() ?? null;
}

/** 手で読み込み直した配信について、自動再生の「終わった」「✕ で閉じた」「メンバー限定」の記録を消す (誤判定・誤操作から戻せるように) */
function forgetAutoMarks(videoId) {
  for (const set of [finishedIds, autoDismissed, membersBlocked]) set.delete(videoId);
  autoMissing.delete(videoId);
}

/**
 * チャンネル / ライブラリの画面を開く (同じ画面を入り口で使い分ける)。
 * view: 'channels' = 📺 チャンネル (配信中・配信予定と、チャンネルの追加・ピックアップ) /
 *       'library'  = 📚 ライブラリ (最近の配信・視聴履歴・あとで見る。前回見ていたタブを開く)
 * modal: false = 使い方ツアーで見せるとき。モーダルにすると最前面に出てツアーのボタンが押せなくなるので、普通に開く
 */
function openFavorites(target, view, { modal = true } = {}) {
  favTarget = target;
  const favView = view === 'channels' ? 'channels' : 'library';
  favErrorEl.textContent = '';
  document.getElementById('favTitle').textContent = tr(favView === 'channels' ? 'chTitle' : 'libTitle');
  document.querySelector('.fav-tabs').hidden = favView === 'channels';
  setFavMode(favView === 'channels' ? 'all' : savedLibraryTab(), { render: false });
  if (!favDialog.open) {
    if (modal) favDialog.showModal();
    else favDialog.show();
  }
  refreshFavorites(false);
  if (isVideoMode()) renderVideoList();
  // チャンネルパックで足した、アイコンの無いチャンネルのアイコンを少しずつ取る (取れたら一覧を描き直す)
  if (favView === 'channels') {
    Favorites.fillIcons()
      .then((n) => n && favDialog.open && !isVideoMode() && refreshFavorites(false))
      .catch(() => {});
  }
}

/** ライブラリで前回見ていたタブ */
function savedLibraryTab() {
  try {
    const t = localStorage.getItem('hakomado.libTab');
    if (['archive', 'history', 'saved', 'playlists'].includes(t)) return t;
  } catch {
    /* ignore */
  }
  return 'archive';
}

// 配信状況の取得待ち行列。同時に取りに行くのは 4 件まで
const favQueue = [];
let favWorkers = 0;

async function refreshFavorites(force) {
  const favs = await Favorites.list();
  queueFavStatuses(favs, force);
  renderFavorites(favs);
}

/**
 * 使い方ツアーを始める。ツアーで見せるチャンネル・ライブラリの画面が、そのステップに来たときに
 * 読み込み済みで出るよう、説明を読んでいる間に、その画面を開いたときに取るものを裏で取っておく。
 * - 配信状況: 自動再生を ON にした最初と同じ速い取り方 (ホロジュールで分かるチャンネルは RSS を取らない)。数秒で済む
 * - 最近の配信: チャンネルごとの RSS。1 本ずつ順に取るので、同梱の 77 チャンネルで 1 分ほど (1 本 0.7 秒ほど)。
 *   ライブラリは 6 番目なので、説明を読みながら進めばおおむね間に合う。急いで進めた場合も、読めた分から並ぶ
 */
function startTour() {
  Tour.start();
  Favorites.list()
    .then((favs) => {
      queueFavStatuses(favs, false, { quick: true });
      loadArchives(libScopeNow(favs) === 'star' ? favs.filter((f) => f.star) : favs);
    })
    .catch((e) => console.warn('hakomado: ツアー用の先読みに失敗', e));
}

/**
 * チャンネルの配信状況を取る行列に入れて、取りに行く (取れたら、画面が開いていれば描き直す)。
 * quick = ホロジュールで分かるチャンネルは RSS を取り直さない (Favorites.fetchStatus の quick)
 */
function queueFavStatuses(favs, force, { quick = false } = {}) {
  for (const f of favs) {
    const st = favStatus.get(f.channelId);
    if (!force && st && st !== 'error' && st !== 'loading') continue;
    if (st === 'loading' && favQueue.some((q) => q.f.channelId === f.channelId)) continue;
    if (st === 'loading' && !force) continue; // 取得中
    favStatus.set(f.channelId, 'loading');
    favQueue.push({ f, force, quick });
  }
  while (favWorkers < 4 && favQueue.length) {
    favWorkers++;
    favWorker().finally(() => favWorkers--);
  }
}

async function favWorker() {
  for (let q = favQueue.shift(); q; q = favQueue.shift()) {
    try {
      favStatus.set(q.f.channelId, await Favorites.fetchStatus(q.f, { force: q.force, quick: q.quick }));
    } catch (e) {
      console.warn('hakomado: 配信状況の取得に失敗', q.f.name, e);
      favStatus.set(q.f.channelId, 'error');
    }
    if (favDialog.open) scheduleFavRender();
  }
}

// 件数が多いので、状況が届くたびではなく 1 フレームにまとめて描き直す
let favRenderPending = false;
function scheduleFavRender() {
  if (favRenderPending) return;
  favRenderPending = true;
  requestAnimationFrame(async () => {
    favRenderPending = false;
    renderFavorites(await Favorites.list());
  });
}

function formatStart(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString(LANG === 'ja' ? 'ja-JP' : undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

let favFilter = '';

/** 見出し付きの一覧 */
function favSection(title, items, { cls = '' } = {}) {
  const ul = document.createElement('ul');
  ul.className = 'fav-sub';
  ul.append(...items.flat());
  const sec = document.createElement('section');
  sec.className = `fav-section ${cls}`;
  const h = document.createElement('h3');
  const label = document.createElement('span');
  label.textContent = `${title} (${items.length})`; // 開いたアーカイブは数えない (items は行ごと)
  h.append(label);
  sec.append(h, ul);
  return sec;
}

function renderFavorites(favs) {
  if (isVideoMode()) return; // 保存・履歴を表示中 (配信状況の取得が終わって描き直すときなど)
  const scope = libScopeNow(favs);
  updateLibScopeButtons(); // 最初に開いたときは、ここで決まった値 (ピックアップが無ければ「すべて」) をボタンにも出す
  if (scope === 'star') favs = favs.filter((f) => f.star); // 📌 ピックアップだけ
  const q = favFilter.trim().toLowerCase();
  const shown = q
    ? favs.filter((f) => [f.name, f.nameJa, f.handle, f.group].some((s) => String(s ?? '').toLowerCase().includes(q)))
    : favs;
  const entries = shown.map((f) => ({ f, st: favStatus.get(f.channelId) }));
  const live = entries.filter((e) => e.st?.state === 'live').sort((a, b) => (a.st.startAt || 0) - (b.st.startAt || 0));
  const upcoming = entries
    .filter((e) => e.st?.state === 'upcoming')
    .sort((a, b) => (a.st.startAt || Infinity) - (b.st.startAt || Infinity));
  const rest = entries.filter((e) => e.st?.state !== 'live' && e.st?.state !== 'upcoming');

  const sections = [];
  if (live.length) {
    sections.push(
      favSection(tr('secLive'), live.map(favItem), { cls: 'live-sec' }),
    );
  }
  if (upcoming.length) sections.push(favSection(tr('secUpcoming'), upcoming.map(favItem), { cls: 'upcoming-sec' }));
  // それ以外はまとめて 1 つの一覧 (自分で追加したチャンネル → 既定のチャンネルの順)
  rest.sort((a, b) => Number(!!a.f.preset) - Number(!!b.f.preset));
  if (rest.length) sections.push(favSection(live.length || upcoming.length ? tr('secOther') : tr('secAll'), rest.map(favItem), { cls: 'rest-sec' }));
  favListEl.replaceChildren(...sections);
  document.getElementById('favEmpty').textContent = q
    ? tr('favNoMatch', favFilter)
    : tr(scope === 'star' ? 'starEmpty' : 'favEmpty');
  document.getElementById('favLiveCount').textContent = live.length ? tr('liveCount', live.length) : '';
}

function favItem({ f, st }) {
  const li = document.getElementById('favItemTemplate').content.firstElementChild.cloneNode(true);
  const icon = li.querySelector('.fav-icon');
  // アイコンが無い / 読めないときは灰色の丸だけ見せる
  const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  icon.addEventListener('error', () => (icon.src = blank), { once: true });
  icon.loading = 'lazy';
  icon.src = f.icon || blank;
  li.querySelector('.fav-name').textContent = f.name;
  li.title = f.handle || f.name;

  const badge = li.querySelector('.badge');
  const title = li.querySelector('.fav-title');
  const thumb = li.querySelector('.fav-thumb');
  if (st === 'loading') {
    li.classList.add('loading');
    badge.textContent = tr('checking');
  } else if (st === 'error' || !st) {
    li.classList.add('error');
    badge.textContent = tr('unavailable');
  } else if (st.state === 'offline') {
    li.classList.add('offline');
    badge.textContent = '';
  } else {
    li.classList.add(st.state);
    badge.textContent = st.state === 'live' ? '● LIVE' : tr('upcomingAt', formatStart(st.startAt)).trim();
    title.textContent = st.title || '';
    thumb.src = `https://i.ytimg.com/vi/${st.videoId}/mqdefault.jpg`;
    li.querySelector('.fav-where').textContent = whereShown(st.videoId);
    li.addEventListener('click', () => pickFavorite(f, st));
  }

  // 「最近 ⌄」: このチャンネルの最近の配信アーカイブを、行の下に開く
  // (以前の ▸ は再生ボタンに見えて、枠に入れるつもりで押されやすかったので、文字で出す)
  const arch = li.querySelector('.fav-arch');
  const open = archiveOpen.has(f.channelId);
  arch.textContent = tr(open ? 'archiveBtnOpen' : 'archiveBtn');
  arch.title = tr(open ? 'archiveClose' : 'archiveOpen');
  arch.classList.toggle('on', open);
  arch.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (archiveOpen.has(f.channelId)) archiveOpen.delete(f.channelId);
    else {
      archiveOpen.add(f.channelId);
      loadArchives([f]);
    }
    renderFavorites(await Favorites.list());
  });

  const star = li.querySelector('.fav-star');
  star.textContent = '📌';
  star.classList.toggle('on', !!f.star);
  star.title = tr(f.star ? 'starOff' : 'starOn');
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    await Favorites.setStar(f.channelId, !f.star);
    renderFavorites(await Favorites.list());
  });

  // ピックアップで絞っているときは ✕ (チャンネル一覧から外す) は出さない (📌 を外すのと紛らわしいので)
  if (libScope === 'star') li.querySelector('.fav-del').remove();
  li.querySelector('.fav-del')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await Favorites.remove(f.channelId);
    favStatus.delete(f.channelId);
    renderFavorites(await Favorites.list());
    updatePacks();
  });
  if (!open) return li;
  // 開いているときは、行のすぐ下にアーカイブの一覧を足す
  const sub = document.createElement('li');
  sub.className = 'fav-arch-list';
  const data = archiveData.get(f.channelId);
  if (!data || data === 'loading' || data === 'error' || !data.length) {
    const p = document.createElement('p');
    p.className = 'fav-arch-msg';
    p.textContent = tr(!data || data === 'loading' ? 'archiveLoading' : data === 'error' ? 'archiveError' : 'archiveNone');
    sub.append(p);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'fav-sub video-grid compact';
    ul.append(...data.filter((v) => isFinishedArchive(v, f)).map((v) => archiveItem(v, f)));
    sub.append(ul);
  }
  return [li, sub];
}

// ---------------------------------------------------------------- 最近の配信 (ライブラリの「🎞 最近の配信」タブと、チャンネルの行の「最近 ⌄」)

const archiveData = new Map(); // channelId -> 'loading' | 'error' | [{videoId, title, at}]
const archiveOpen = new Set(); // 「最近 ⌄」で開いているチャンネル
const ARCHIVE_DAYS = 7; // 「最近の配信」に出す範囲 (日)
const archiveQueue = [];
let archiveWorkers = 0;

/** チャンネルのアーカイブを取りに行く (同時に 3 件まで)。force = 覚えている結果を使わない */
function loadArchives(favs, { force = false } = {}) {
  for (const f of favs) {
    const d = archiveData.get(f.channelId);
    // 取得に失敗したチャンネルは、「⟳ 更新」を押すまで取り直さない (描き直すたびに取りに行かないように)
    if (d === 'loading' || (!force && d)) continue;
    archiveData.set(f.channelId, 'loading');
    archiveQueue.push({ f, force });
  }
  while (archiveWorkers < 3 && archiveQueue.length) {
    archiveWorkers++;
    (async () => {
      for (let q = archiveQueue.shift(); q; q = archiveQueue.shift()) {
        try {
          archiveData.set(q.f.channelId, await Favorites.fetchArchives(q.f.channelId, { force: q.force }));
        } catch (e) {
          console.warn('hakomado: アーカイブの取得に失敗', q.f.name, e);
          archiveData.set(q.f.channelId, 'error');
        }
        scheduleArchiveRender();
      }
    })().finally(() => archiveWorkers--);
  }
}

// 届くたびに描き直すと重いので、少しまとめてから描き直す
let archiveRenderTimer = 0;
function scheduleArchiveRender() {
  if (archiveRenderTimer || !favDialog.open) return;
  archiveRenderTimer = setTimeout(async () => {
    archiveRenderTimer = 0;
    if (favMode === 'archive') renderArchiveTab();
    else if (!isVideoMode()) renderFavorites(await Favorites.list());
  }, 150);
}

/**
 * ライブラリの対象のチャンネル (どのタブでも共通): 'all' = すべて / 'star' = ピックアップ (📌) だけ。
 * 選んだものを覚えておく。決めていなければ、ピックアップがあればピックアップ。
 * ピックアップが 1 つも無いときは、何も出ない画面にならないよう、開いた最初は「すべて」にする
 */
let libScope = null;
function libScopeNow(favs) {
  if (libScope) return libScope;
  if (!favs.some((f) => f.star)) return (libScope = 'all'); // 開いた最初だけ。自分でピックアップを選んだときは、空でも説明を出す
  const get = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const saved = get('hakomado.libScope');
  libScope = saved === 'star' || saved === 'all' ? saved : 'star'; // ここに来るのはピックアップがあるときだけ
  return libScope;
}

function setLibScope(scope) {
  libScope = scope;
  try {
    localStorage.setItem('hakomado.libScope', scope);
  } catch {
    /* ignore */
  }
  updateLibScopeButtons();
  renderFavPane();
}

function updateLibScopeButtons() {
  for (const b of document.querySelectorAll('#libScope [data-scope]')) {
    b.classList.toggle('selected', b.dataset.scope === libScope);
    b.setAttribute('aria-checked', String(b.dataset.scope === libScope));
  }
}

/** ライブラリを 📌 ピックアップで絞っているか */
async function pickedOnly() {
  return libScopeNow(await Favorites.list()) === 'star';
}

/** 視聴履歴・あとで見るの 1 件が、ピックアップのチャンネルのものか (チャンネル ID / @ハンドル / 入力で照らし合わせる) */
function isPickedEntry(h) {
  return [h.channelId, h.handle, h.input].filter(Boolean).some((k) => favKeyToId.has(favKey(k)));
}

/** 「最近の配信」タブ: 対象のチャンネルの直近 7 日に終わった配信を、新しい順に 1 つの一覧で */
async function renderArchiveTab({ force = false } = {}) {
  if (favMode !== 'archive') return;
  const favs = await Favorites.list();
  const scope = libScopeNow(favs);
  updateLibScopeButtons();
  const targets = scope === 'star' ? favs.filter((f) => f.star) : favs;
  loadArchives(targets, { force });
  const since = Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  const q = favFilter.trim().toLowerCase();
  let done = 0;
  const items = [];
  for (const f of targets) {
    const d = archiveData.get(f.channelId);
    if (d !== 'loading') done++;
    if (!Array.isArray(d)) continue;
    for (const v of d) {
      if (v.at < since || !isFinishedArchive(v, f)) continue;
      if (q && ![v.title, f.name, f.handle].some((s) => String(s ?? '').toLowerCase().includes(q))) continue;
      items.push({ v, f });
    }
  }
  if (favMode !== 'archive') return;
  items.sort((a, b) => b.v.at - a.v.at);
  const ul = document.createElement('ul');
  ul.className = 'fav-sub video-grid';
  ul.append(...items.map(({ v, f }) => archiveItem(v, f)));
  favListEl.replaceChildren(...(items.length ? [ul] : []));
  document.getElementById('savedCount').textContent =
    done < targets.length ? tr('archiveProgress', done, targets.length) : tr('items', items.length);
  document.getElementById('favEmpty').textContent = q
    ? tr('archiveNoMatch', favFilter)
    : !targets.length
      ? tr(scope === 'star' ? 'archiveNoPick' : 'favEmpty')
      : done < targets.length
        ? tr('archiveLoading')
        : tr('archiveEmpty', ARCHIVE_DAYS);
}

/** 配信中・配信予定と分かっている配信は、アーカイブには出さない (チャンネルの配信状況と照らし合わせる) */
function isFinishedArchive(v, f) {
  const st = favStatus.get(f.channelId);
  return !(st && typeof st === 'object' && st.videoId === v.videoId && (st.state === 'live' || st.state === 'upcoming'));
}

/** アーカイブの 1 行 (履歴と同じ見た目。🔖 で保存できる。✕ は無し) */
function archiveItem(v, f) {
  const h = { videoId: v.videoId, title: v.title, label: f.name, channelId: f.channelId, handle: f.handle || '', at: v.at, input: `${YT}/watch?v=${v.videoId}` };
  const li = videoItem(h, false);
  li.querySelector('.fav-del')?.remove();
  return li;
}

// ---------------------------------------------------------------- 視聴履歴・あとで見る (ライブラリの「🕘 視聴履歴」「🔖 あとで見る」タブ)

// 'all' = チャンネル / 'archive' = 最近の配信 / 'history' = 視聴履歴 / 'saved' = あとで見る (🔖)。
// ピックアップ (📌) で絞るのはタブではなく、共通の絞り込み (libScope)
let favMode = 'all';
/** 配信・動画の一覧 (最近の配信 / 視聴履歴 / あとで見る) を表示中か */
const isVideoMode = () => favMode === 'archive' || favMode === 'saved' || favMode === 'history' || favMode === 'playlists';

/** ライブラリのタブを、次に開いたときのために覚えておく */
function rememberLibraryTab(tab) {
  try {
    localStorage.setItem('hakomado.libTab', tab);
  } catch {
    /* ignore */
  }
}

/** チャンネル / 最近の配信 / 視聴履歴 / あとで見る を切り替える。配信・動画の一覧ではチャンネルの追加欄を隠す */
function setFavMode(mode, { render = true } = {}) {
  favMode = ['all', 'archive', 'saved', 'history', 'playlists'].includes(mode) ? mode : 'all';
  if (favMode !== 'all') rememberLibraryTab(favMode);
  const isHistory = isVideoMode();
  for (const b of document.querySelectorAll('[data-favtab]')) {
    const on = b.dataset.favtab === favMode;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-selected', String(on));
  }
  // 「⟳ 更新」はチャンネルとアーカイブで使う (アーカイブでは取り直し)
  document.getElementById('favRefresh').hidden = favMode === 'saved' || favMode === 'history' || favMode === 'playlists';
  document.getElementById('favLiveCount').hidden = isHistory;
  document.getElementById('favAdd').hidden = isHistory;
  document.getElementById('historyClear').hidden = favMode !== 'history';
  const queueBtn = document.getElementById('queuePlay');
  queueBtn.hidden = favMode !== 'saved' && favMode !== 'playlists';
  queueBtn.disabled = false; // 再生リストのタブでは、中身が無ければ描くときに押せなくする
  // 再生リストのタブでは、再生のしかた (順に / 同期) に合わせて描くときに書き換える
  queueBtn.textContent = tr(favMode === 'playlists' ? 'plPlayQueue' : 'savedPlay');
  queueBtn.title = tr(favMode === 'playlists' ? 'plPlayTitle' : 'savedPlayTitle');
  document.getElementById('savedCount').hidden = favMode !== 'saved' && favMode !== 'archive' && favMode !== 'playlists';
  // 再生リストは自分で選んで並べたものなので、ピックアップ (📌) では絞らない
  const isPl = favMode === 'playlists';
  document.getElementById('libScope').hidden = isPl;
  for (const id of ['plSelect', 'plNew', 'plFromTiles', 'plImport']) document.getElementById(id).hidden = !isPl;
  // 再生リストは行の ▶ で読み込む (行そのものは編集に使うので、クリックで読み込む案内は出さない)
  favErrorEl.textContent = '';
  if (render) renderFavPane();
}

async function renderFavPane() {
  if (isVideoMode()) await renderVideoList();
  else renderFavorites(await Favorites.list());
}

const REASON_KEYS = { ended: 'reasonEnded', closed: 'reasonClosed', members: 'reasonMembers', replaced: 'reasonReplaced' };

/** 視聴履歴 / あとで見る の一覧を描く */
async function renderVideoList() {
  const mode = favMode;
  if (!isVideoMode()) return;
  if (mode === 'archive') return renderArchiveTab();
  if (mode === 'playlists') return renderPlaylistTab();
  const saved = mode === 'saved';
  const all = await (saved ? SavedVideos : WatchHistory).list();
  const picked = await pickedOnly();
  updateLibScopeButtons();
  const q = favFilter.trim().toLowerCase();
  const shown = all.filter(
    (h) =>
      (!picked || isPickedEntry(h)) &&
      (!q || [h.title, h.channel, h.handle, h.label, h.input].some((s) => String(s ?? '').toLowerCase().includes(q))),
  );
  if (favMode !== mode) return; // 読み込んでいる間に切り替えられた
  const ul = document.createElement('ul');
  ul.className = 'fav-sub video-grid';
  ul.append(...shown.map((h) => videoItem(h, saved)));
  favListEl.replaceChildren(...(shown.length ? [ul] : []));
  document.getElementById('favEmpty').textContent = q
    ? tr(saved ? 'savedNoMatch' : 'historyNoMatch', favFilter)
    : picked && all.length
      ? tr('scopeNoPicked')
      : tr(saved ? 'savedEmpty' : 'historyEmpty');
  if (saved) document.getElementById('savedCount').textContent = tr('savedCount', all.length, SavedVideos.MAX);
  else document.getElementById('historyClear').hidden = all.length === 0;
}

/**
 * 視聴履歴 / あとで見る / 再生リスト の 1 行。saved = あとで見るの一覧 (✕ で外す)。それ以外の行には 🔖 を付けて、あとで見るに入れられるようにする。
 * onRemove を渡すと、✕ はそれを呼ぶ (再生リストから外す)
 */
function videoItem(h, saved, { onRemove, removeTitle } = {}) {
  const li = document.getElementById('favItemTemplate').content.firstElementChild.cloneNode(true);
  li.classList.add('history');
  li.title = tr('historyPick');
  li.querySelector('.fav-name').textContent = h.label || h.channel || h.handle || h.videoId;
  li.querySelector('.fav-title').textContent = h.title || '';
  li.querySelector('.badge').textContent = !saved && h.reason ? tr(REASON_KEYS[h.reason] || 'reasonReplaced') : '';
  const star = li.querySelector('.fav-star');
  if (saved) {
    star.remove();
  } else {
    const on = savedIds.has(h.videoId);
    star.textContent = '🔖';
    star.classList.toggle('on', on);
    star.title = tr(on ? 'savedOff' : 'savedOn');
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await SavedVideos.toggle(h.videoId, h);
      if (r === 'full') favErrorEl.textContent = tr('savedFull', SavedVideos.MAX);
      await refreshSavedIds();
      renderVideoList();
    });
  }
  // 📃: 再生リストに入れる / 外す (どれかの再生リストに入っていれば点灯)
  const plBtn = document.createElement('button');
  plBtn.type = 'button';
  plBtn.className = 'fav-pl';
  plBtn.textContent = '📃';
  plBtn.classList.toggle('on', playlistIds.has(h.videoId));
  plBtn.title = tr('plAddTitle');
  plBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPlaylistPicker(h);
  });
  li.querySelector('.fav-del').before(plBtn);
  const where = [formatStart(h.at)];
  const shown = whereShown(h.videoId);
  if (shown) where.push(shown);
  li.querySelector('.fav-where').textContent = where.filter(Boolean).join(' ・ ');
  const thumb = li.querySelector('.fav-thumb');
  thumb.addEventListener('error', () => thumb.removeAttribute('src'), { once: true });
  thumb.loading = 'lazy';
  thumb.src = `https://i.ytimg.com/vi/${h.videoId}/mqdefault.jpg`;
  li.addEventListener('click', () => loadFromHistory(h));
  const del = li.querySelector('.fav-del');
  del.title = removeTitle || tr(saved ? 'savedOff' : 'historyDel');
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (onRemove) {
      await onRemove();
      renderVideoList();
      return;
    }
    await (saved ? SavedVideos : WatchHistory).remove(h.videoId);
    if (saved) await refreshSavedIds();
    renderVideoList();
  });
  return li;
}

/**
 * 履歴から枠に読み込む。空いている枠が無ければ (16 枠未満なら) 枠を 1 つ足す。
 * 誤判定や誤操作から戻せるように、自動再生の「終わった」「✕ で閉じた」「メンバー限定」の記録はこの配信について消す。
 * 自動再生中で、いま配信中・配信予定のチャンネルの配信なら自動再生の枠として扱う (終わったら片付ける)
 */
function loadFromHistory(h) {
  const target = favTarget ?? emptyTileOrAdd();
  if (target == null) {
    favErrorEl.textContent = tr('noEmptyTile');
    return;
  }
  forgetAutoMarks(h.videoId);
  setTileVideo(target, h.videoId, h.input || `https://www.youtube.com/watch?v=${h.videoId}`);
  const t = state.tiles[target];
  t.label = h.label || '';
  const st = [...favStatus.values()].find(
    (s) => s && typeof s === 'object' && s.videoId === h.videoId && (s.state === 'live' || s.state === 'upcoming'),
  );
  if (state.autoMode && st) t.auto = true;
  updateTileName(target);
  updateFavButton(target);
  updateNowPlaying();
  save();
  favDialog.close();
}

// 他のタブで見たものも含め、履歴が変わったら表示中の一覧を描き直す
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[WatchHistory.KEY] && favDialog.open && favMode === 'history') renderVideoList();
});

// ---------------------------------------------------------------- 📃 再生リスト (ライブラリの「📃 再生リスト」タブ)

/** 表示中の再生リストの id (次に開いたときのために覚えておく) */
let plSelected = (() => {
  try {
    return localStorage.getItem('hakomado.libPlaylist');
  } catch {
    return null;
  }
})();
function selectPlaylist(id) {
  plSelected = id;
  try {
    if (id) localStorage.setItem('hakomado.libPlaylist', id);
  } catch {
    /* ignore */
  }
}

// ---- 📃 再生リストの編集 (ライブラリの「📃 再生リスト」タブ)
// 上の選択欄で再生リストを選ぶと、その再生リストを縦一列で編集できる:
//   見出し … 名前 (その場で書き換え)・本数・🔗 共有・🗑 削除
//   設定   … 再生のしかた (▶ 順に再生 / ⏱ まとめて同期再生)。同期再生ならレイアウトも
//   一覧   … ⠿ をドラッグで並べ替え、名前 (枠に出す名前) の書き換え、同期再生なら基準とずれ、▶ で枠に読み込む、✕ で外す
//   追加欄 … URL / 動画 ID / @チャンネル名を入れて追加、今の枠の配信を追加
// 同期再生で再生している間に ⏱ で直したずれ・選び直した基準は、その再生リストにも書き戻す (playlistSyncSession)

/** 追加欄に打ちかけの文字 (書き込みで一覧を描き直しても消えないように) */
let plAddDraft = '';
/** 次に描いたときに名前の欄を選んでおく (新しく作った直後) */
let plFocusName = false;

/** 再生リストの 1 本を、ほかの一覧と同じ形 (読み込みや 📃 で使う形) にする */
const playlistEntry = (h) => ({ ...h, input: `${YT}/watch?v=${h.videoId}` });

/** 再生リストのタブを描く */
async function renderPlaylistTab() {
  const lists = await Playlists.list();
  if (favMode !== 'playlists') return; // 読み込んでいる間に切り替えられた
  if (!lists.some((p) => p.id === plSelected)) selectPlaylist(lists[0]?.id ?? null);
  const pl = lists.find((p) => p.id === plSelected);
  const sel = document.getElementById('plSelect');
  sel.replaceChildren(...lists.map((p) => new Option(`${p.sync ? '⏱ ' : ''}${p.name} (${p.items.length})`, p.id, false, p.id === plSelected)));
  sel.disabled = !lists.length;
  const queueBtn = document.getElementById('queuePlay');
  queueBtn.disabled = !pl?.items.length;
  const watched = pl ? pl.items.filter((x) => x.watched).length : 0;
  const resumable = pl?.sync && pl.resume;
  queueBtn.textContent = resumable
    ? tr('plPlaySyncResume', hms(pl.resume.pos))
    : tr(pl?.sync ? 'plPlaySync' : watched && watched < pl.items.length ? 'plPlayQueueResume' : 'plPlayQueue');
  queueBtn.title = tr(pl?.sync ? 'plPlaySyncTitle' : 'plPlayTitle');
  document.getElementById('savedCount').textContent = '';
  document.getElementById('favEmpty').textContent = tr('plEmpty');

  // 描き直しても、入力中の欄・スクロール位置はそのまま
  const active = document.activeElement;
  const fk = favListEl.contains(active) ? active.dataset.fk : null;
  const selRange = fk && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = favListEl.scrollTop;
  favListEl.replaceChildren(...(pl ? [playlistEditor(pl)] : []));
  favListEl.scrollTop = scroll;
  if (pl) {
    fetchPlaylistMeta(pl.items);
    refreshPlaylistStates(pl);
  }
  if (plFocusName) {
    plFocusName = false;
    const name = favListEl.querySelector('.pl-name-input');
    name?.focus();
    name?.select();
  } else if (fk) {
    const el = favListEl.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) {
      el.focus();
      if (selRange) el.setSelectionRange?.(...selRange);
    }
  }
}

/** 要素を作る小さな手伝い */
function mk(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/** 再生リスト 1 件の編集画面 */
function playlistEditor(pl) {
  const q = favFilter.trim().toLowerCase();
  const shown = pl.items.filter(
    (x) => !q || [x.title, x.channel, x.handle, x.label].some((s) => String(s ?? '').toLowerCase().includes(q)),
  );
  const refId = pl.ref || pl.items[0]?.videoId;

  // 見出し: 名前・本数・共有・削除
  const nameInput = mk('input', {
    type: 'text',
    class: 'pl-name-input',
    value: pl.name,
    maxLength: Playlists.NAME_MAX,
    spellcheck: false,
    title: tr('plNameTitle'),
    dataset: { fk: 'name' },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing) e.target.blur();
      if (e.key === 'Escape') {
        e.target.value = pl.name;
        e.target.blur();
        e.stopPropagation();
      }
    },
    onchange: async (e) => {
      const r = await Playlists.rename(pl.id, e.target.value);
      favErrorEl.textContent = r === 'exists' ? tr('plNameExists', e.target.value.trim()) : '';
      if (r !== 'ok') e.target.value = pl.name;
    },
  });
  const head = mk(
    'div',
    { class: 'pl-head' },
    nameInput,
    mk('span', { class: 'fav-count', textContent: tr('savedCount', pl.items.length, Playlists.limitOf(pl)) }),
    mk('span', { class: 'spacer' }),
    mk('button', { type: 'button', textContent: tr('plShareBtn'), title: tr('plShareBtnTitle'), disabled: !pl.items.length, onclick: () => openShareDialog({ source: pl.id }) }),
    mk('button', { type: 'button', textContent: tr('plDuplicate'), title: tr('plDuplicateTitle'), onclick: () => duplicatePlaylist(pl.id) }),
    mk('button', { type: 'button', class: 'pl-delete', textContent: '🗑', title: tr('plDeleteTitle'), onclick: deleteSelectedPlaylist }),
  );

  // 再生のしかた
  const mode = mk(
    'span',
    { class: 'seg pl-mode', role: 'radiogroup' },
    mk('button', { type: 'button', class: pl.sync ? '' : 'selected', textContent: tr('plModeQueue'), title: tr('plModeQueueTitle'), onclick: () => Playlists.setOptions(pl.id, { sync: false }) }),
    mk('button', { type: 'button', class: pl.sync ? 'selected' : '', textContent: tr('plModeSync'), title: tr('plModeSyncTitle'), onclick: () => switchToSync(pl) }),
  );
  const opts = mk('div', { class: 'pl-opts' }, mk('span', { class: 'pl-opt-label', textContent: tr('plModeLabel') }), mode);
  if (pl.sync) {
    const n = Math.max(1, syncItems(pl).length);
    const fits = (id) => LAYOUTS.some((l) => l.id === id && l.slots.length >= n);
    const nameOf = (id) => LAYOUTS.find((l) => l.id === id)?.name || id;
    const layoutSel = mk('select', { class: 'pl-layout', title: tr('plLayoutTitle'), dataset: { fk: 'layout' } });
    layoutSel.append(new Option(tr('plLayoutAuto', nameOf(chooseLayoutFor(n).id)), ''));
    if (pl.layoutId) layoutSel.append(new Option(`${nameOf(pl.layoutId)}${fits(pl.layoutId) ? '' : ` (${tr('plLayoutShort')})`}`, pl.layoutId));
    if (state.layoutId !== pl.layoutId && fits(state.layoutId)) layoutSel.append(new Option(tr('plLayoutCurrent', nameOf(state.layoutId)), state.layoutId));
    layoutSel.value = pl.layoutId || '';
    layoutSel.addEventListener('change', () => Playlists.setOptions(pl.id, { layoutId: layoutSel.value || null }));
    opts.append(mk('label', { class: 'pl-opt-label' }, tr('plLayoutLabel'), layoutSel));
  }
  if (pl.sync && pl.resume) {
    opts.append(
      mk('button', {
        type: 'button',
        class: 'pl-small',
        textContent: tr('plSyncFromStart'),
        title: tr('plSyncFromStartTitle', hms(pl.resume.pos)),
        onclick: () => playPlaylistSynced(pl, { resume: false }),
      }),
    );
  }
  const watched = pl.items.filter((x) => x.watched).length;
  if (!pl.sync && watched) {
    opts.append(
      mk('button', {
        type: 'button',
        class: 'pl-small',
        textContent: tr('plClearWatched', watched),
        title: tr('plClearWatchedTitle'),
        onclick: () => Playlists.setWatched(pl.id, null, false),
      }),
    );
  }
  opts.append(
    mk('span', {
      class: 'pl-opt-note',
      textContent: pl.sync ? tr('plSyncNote', Playlists.SYNC_MAX) : tr('plQueueNote', watched, pl.items.length),
    }),
  );

  // 一覧
  const ol = mk('ol', { class: 'pl-rows' + (pl.sync ? ' sync' : '') });
  ol.append(...shown.map((x) => playlistRow(pl, x, { refId, draggable: !q })));
  if (!q) setupPlaylistDrag(ol, pl.id);
  const empty = !shown.length
    ? mk('p', { class: 'fav-empty', textContent: q && pl.items.length ? tr('savedNoMatch', favFilter) : tr('plNoItems') })
    : null;

  // 追加欄
  const addInput = mk('input', {
    type: 'text',
    class: 'pl-add-input',
    value: plAddDraft,
    spellcheck: false,
    placeholder: tr('plAddPlaceholder'),
    dataset: { fk: 'add' },
    oninput: (e) => (plAddDraft = e.target.value),
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        addToPlaylistFromText(pl.id, e.target.value);
      }
    },
    // 複数行 (URL を何行か) を貼ったときは、そのまま全部追加する
    onpaste: (e) => {
      const text = e.clipboardData?.getData('text') || '';
      if (!/\n/.test(text.trim())) return;
      e.preventDefault();
      addToPlaylistFromText(pl.id, text);
    },
  });
  const add = mk(
    'div',
    { class: 'pl-add' },
    addInput,
    mk('button', { type: 'button', textContent: tr('plAddBtn'), onclick: () => addToPlaylistFromText(pl.id, addInput.value) }),
    mk('button', { type: 'button', textContent: tr('plAddTiles'), title: tr('plAddTilesTitle'), onclick: () => addTilesToPlaylist(pl.id) }),
  );

  return mk('div', { class: 'pl-editor' }, head, opts, ol, empty, add);
}

/** 時間 (秒) を 1:23:45 / 12:34 の形に */
function hms(sec) {
  const t = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s2 = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}`;
}

/** 行の印: 見た (押すと外す) / 配信中 / 配信予定 / 見られない */
function playlistBadges(pl, x) {
  const out = [];
  const st = plVideoStates.get(x.videoId);
  const avail = playerBlocked.get(x.videoId) || st?.avail;
  if (!pl.sync && x.watched) {
    out.push(
      mk('button', {
        type: 'button',
        class: 'pl-badge watched',
        textContent: tr('plWatched'),
        title: tr('plWatchedTitle'),
        onclick: () => Playlists.updateItem(pl.id, x.videoId, { watched: false }),
      }),
    );
  }
  const badge = (cls, text, title = '') => out.push(mk('span', { class: `pl-badge ${cls}`, textContent: text, title }));
  if (avail === 'gone') badge('bad', tr('plStGone'), tr('plStGoneTitle'));
  else if (avail === 'members') badge('bad', tr('plStMembers'));
  else if (avail === 'blocked') badge('warn', tr('plStBlocked'));
  if (st?.state === 'live') badge('live', tr('plStLive'));
  else if (st?.state === 'upcoming') badge('upcoming', st.startAt ? tr('plStUpcomingAt', formatStart(st.startAt)) : tr('plStUpcoming'));
  return out;
}

/** 1 本外す (知らせ欄の「元に戻す」で、同じ位置に戻せる) */
async function removePlaylistItem(pl, x) {
  const at = pl.items.findIndex((h) => h.videoId === x.videoId);
  await Playlists.removeItem(pl.id, x.videoId);
  const name = x.label || x.channel || x.title || x.videoId;
  const undo = mk('button', {
    type: 'button',
    class: 'fav-restore',
    textContent: tr('plUndo'),
    onclick: async () => {
      favErrorEl.textContent = '';
      const r = await Playlists.insertItem(pl.id, x, at);
      if (r === 'full') favErrorEl.textContent = tr('plItemsFull', pl.name, Playlists.limitOf(pl));
    },
  });
  favErrorEl.replaceChildren(tr('plRemoved', name), ' ', undo);
}

/** 複製して、複製したほうを開く */
async function duplicatePlaylist(id) {
  const r = await Playlists.duplicate(id, (name) => tr('plCopyName', name));
  if (r.full) {
    favErrorEl.textContent = tr('plFull', Playlists.MAX_LISTS);
    return;
  }
  if (r.playlist) {
    notify(tr('plDuplicated', r.playlist.name));
    showNewPlaylist(r.playlist);
  }
}

// ---- 再生リストの動画のタイトル・チャンネル名と、配信中・配信予定・見られないの印
// タイトルとチャンネル名は oEmbed (軽い) で、足した直後・開いたときに取る (分かっていないものだけ。このタブで 1 回)。
// 配信中・配信予定・見られないかは動画のページ (重い) で調べる: 同期再生なら全部、順に再生ならまだ見ていない先頭の 20 本。
// 開くたびに調べ直すのではなく、同じ再生リストは 2 分あける (配信状況と同じ記録を使い、確かめ直しが要るものだけ取る)
const oembedTried = new Set();
const oembedQueue = [];
let oembedBusy = false;
/** 動画 ID -> {state, startAt, avail, ...} (Favorites の記録と、このタブで分かったもの) */
const plVideoStates = new Map();
let plInspected = { id: null, at: 0 };
let plInspectToken = 0;
let plRenderTimer = 0;

/** 再生リストのタブを少しあとで描き直す (印がまとめて分かったときに、何度も描かないように) */
function schedulePlaylistRender() {
  clearTimeout(plRenderTimer);
  plRenderTimer = setTimeout(() => {
    if (favDialog.open && favMode === 'playlists') renderVideoList();
  }, 300);
}

/** タイトルの分からない動画を oEmbed で調べる */
function fetchPlaylistMeta(items) {
  for (const x of items) {
    if (x.title || oembedTried.has(x.videoId)) continue;
    oembedTried.add(x.videoId);
    oembedQueue.push(x.videoId);
  }
  runOembed();
}

async function runOembed() {
  if (oembedBusy || !oembedQueue.length) return;
  oembedBusy = true;
  try {
    while (oembedQueue.length) {
      const id = oembedQueue.shift();
      try {
        const url = `${YT}/oembed?format=json&url=${encodeURIComponent(`${YT}/watch?v=${id}`)}`;
        const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const j = await res.json();
          const handle = String(j.author_url || '').match(/\/(@[\w.\-]+)/)?.[1];
          const info = {};
          if (j.title) info.title = String(j.title);
          if (j.author_name) info.channel = String(j.author_name);
          if (handle) info.handle = handle;
          queueMetaWrite(id, info);
        } else if (res.status === 404 || res.status === 400) {
          // 存在しない (削除・非公開など)。動画のページを調べるまでもないので、ここで印を付ける
          plVideoStates.set(id, { ...plVideoStates.get(id), avail: 'gone' });
          schedulePlaylistRender();
        }
      } catch {
        /* 次に開いたときにまた試す */
        oembedTried.delete(id);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    oembedBusy = false; // 分かった分は queueMetaWrite が少しためてから書く
  }
}

// 分かったタイトル・チャンネル名は、少しためてからまとめて書く
// (1 本ごとに全部の再生リストを書き直して、開いている全タブで描き直しが続かないように)
let metaPending = {};
let metaTimer = 0;
function queueMetaWrite(videoId, info) {
  metaPending[videoId] = { ...metaPending[videoId], ...info };
  // 最初の 1 件から 3 秒後 (か 20 件たまったら) に書く。届くたびに待ち直すと、少しずつ届くときに結局 1 件ずつになる
  if (Object.keys(metaPending).length >= 20) flushMetaWrites();
  else if (!metaTimer) metaTimer = setTimeout(flushMetaWrites, 3000);
}
function flushMetaWrites() {
  clearTimeout(metaTimer);
  metaTimer = 0;
  const batch = metaPending;
  metaPending = {};
  if (Object.keys(batch).length) Playlists.updateMany(batch).catch(() => {});
}

/** 覚えている状態を読み、必要なら調べ直す (分かりしだい描き直す) */
async function refreshPlaylistStates(pl) {
  const ids = pl.items.map((x) => x.videoId);
  let changed = false;
  for (const [id, st] of Object.entries(await Favorites.videoStates(ids))) {
    const old = plVideoStates.get(id);
    const next = old?.avail === 'gone' && !st.avail ? { ...st, avail: 'gone' } : st;
    if (JSON.stringify(old) !== JSON.stringify(next)) {
      plVideoStates.set(id, next);
      changed = true;
    }
  }
  if (changed) schedulePlaylistRender();
  if (plInspected.id === pl.id && Date.now() - plInspected.at < 2 * 60 * 1000) return;
  plInspected = { id: pl.id, at: Date.now() };
  const targets = pl.sync ? ids : pl.items.filter((x) => !x.watched).slice(0, 20).map((x) => x.videoId);
  const token = ++plInspectToken;
  Favorites.inspectVideos(targets, {
    max: 20,
    shouldStop: () => token !== plInspectToken || !favDialog.open || favMode !== 'playlists',
    onEach: (vid, st) => {
      plVideoStates.set(vid, st);
      // 分かったタイトル・チャンネル名は再生リストにも書く (まだ無いものだけ。まとめて)
      queueMetaWrite(vid, { title: st.title, channel: st.channel, channelId: st.channelId });
      schedulePlaylistRender();
    },
  }).catch((e) => console.warn('hakomado: 再生リストの動画の確認に失敗', e));
}

/** 「⏱ まとめて同期再生」に切り替える。16 本を超えていれば、17 本目以降を外してよいか確かめる */
async function switchToSync(pl) {
  const r = await Playlists.setOptions(pl.id, { sync: true });
  if (r !== 'tooMany') return;
  const extra = pl.items.length - Playlists.SYNC_MAX;
  if (!confirm(tr('plSyncCutConfirm', Playlists.SYNC_MAX, extra))) return;
  await Playlists.setOptions(pl.id, { sync: true }, { cut: true });
  favErrorEl.textContent = tr('plSyncCut', extra);
}

/** 再生リストの 1 行 */
function playlistRow(pl, x, { refId, draggable }) {
  const k = pl.items.indexOf(x);
  const thumb = mk('img', { class: 'pl-thumb', alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
  thumb.addEventListener('error', () => thumb.removeAttribute('src'), { once: true });
  thumb.src = `https://i.ytimg.com/vi/${x.videoId}/mqdefault.jpg`;
  const fallback = x.channel || x.handle || x.videoId;
  const label = mk('input', {
    type: 'text',
    class: 'pl-label',
    value: x.label || '',
    placeholder: fallback,
    maxLength: Playlists.LABEL_MAX,
    spellcheck: false,
    title: tr('plLabelTitle'),
    dataset: { fk: `label:${x.videoId}` },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing) e.target.blur();
    },
    onchange: (e) => Playlists.updateItem(pl.id, x.videoId, { label: e.target.value }),
  });
  const where = whereShown(x.videoId);
  const sub = mk(
    'div',
    { class: 'pl-sub' },
    playlistBadges(pl, x),
    [x.title, x.label && x.channel !== x.label ? x.channel : '', where].filter(Boolean).join(' ・ '),
  );
  const row = mk(
    'li',
    { class: 'pl-row' + (!pl.sync && x.watched ? ' watched' : ''), dataset: { videoId: x.videoId } },
    mk('span', { class: 'pl-grip', textContent: draggable ? '⠿' : '', title: draggable ? tr('plItemDrag') : '' }),
    mk('span', { class: 'pl-num', textContent: String(k + 1) }),
    thumb,
    mk('div', { class: 'pl-main' }, label, sub),
  );
  if (pl.sync) {
    const isRef = x.videoId === refId;
    row.append(
      mk(
        'label',
        { class: 'pl-ref' + (isRef ? ' on' : ''), title: tr('plRefTitle') },
        mk('input', {
          type: 'radio',
          name: `plref-${pl.id}`,
          checked: isRef,
          dataset: { fk: `ref:${x.videoId}` },
          onchange: () => Playlists.setOptions(pl.id, { ref: x.videoId }),
        }),
        tr('plRef'),
      ),
      mk(
        'label',
        { class: 'pl-off', title: tr('plOffsetTitle') },
        mk('input', {
          type: 'number',
          step: '0.01',
          value: String(x.offset ?? SyncOffsets.get(x.videoId)),
          dataset: { fk: `off:${x.videoId}` },
          onkeydown: (e) => {
            if (e.key === 'Enter') e.target.blur();
          },
          onchange: (e) => {
            const v = Number(e.target.value) || 0;
            Playlists.updateItem(pl.id, x.videoId, { offset: v });
            // 同期再生でいま表示しているなら、枠にもすぐ効かせる
            if (playlistSyncSession?.id === pl.id && whereShown(x.videoId)) SyncOffsets.set(x.videoId, v);
          },
        }),
        tr('secUnit'),
      ),
    );
  }
  // 順に再生: この行から順に再生 (同期再生は全部まとめて並べるので無い)
  if (!pl.sync) {
    row.append(
      mk('button', {
        type: 'button',
        class: 'pl-from',
        textContent: tr('plFromHere'),
        title: tr('plFromHereTitle'),
        onclick: () => startQueue({ fromId: x.videoId }),
      }),
    );
  }
  row.append(
    mk('button', {
      type: 'button',
      class: 'pl-load',
      textContent: '⊕',
      title: tr('plLoadOne'),
      onclick: () => loadFromHistory(playlistEntry(x)),
    }),
    mk('button', {
      type: 'button',
      class: 'fav-del',
      textContent: '✕',
      title: tr('plItemRemove'),
      onclick: () => removePlaylistItem(pl, x),
    }),
  );
  // ⠿ をつかんだときだけドラッグできるようにする (名前の欄で文字を選べるように)
  if (draggable) {
    const grip = row.querySelector('.pl-grip');
    grip.addEventListener('pointerdown', () => {
      row.draggable = true;
      // ドラッグせずに離したときも戻す (ドラッグしたときは dragend で戻す)
      document.addEventListener('pointerup', () => (row.draggable = false), { once: true, capture: true });
    });
    row.addEventListener('dragend', () => (row.draggable = false));
  }
  return row;
}

/** 再生リストの一覧のドラッグでの並べ替え (落とした行の位置へ動かす) */
function setupPlaylistDrag(ol, playlistId) {
  let dragged = null;
  const clearDrop = () => ol.querySelectorAll('.pl-drop').forEach((el) => el.classList.remove('pl-drop'));
  ol.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('li[data-video-id]');
    if (!li || !li.draggable) return;
    dragged = li.dataset.videoId;
    li.classList.add('pl-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged);
  });
  ol.addEventListener('dragend', () => {
    dragged = null;
    clearDrop();
    ol.querySelectorAll('.pl-dragging').forEach((el) => el.classList.remove('pl-dragging'));
  });
  ol.addEventListener('dragover', (e) => {
    const li = e.target.closest?.('li[data-video-id]');
    if (!dragged || !li) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!li.classList.contains('pl-drop')) {
      clearDrop();
      if (li.dataset.videoId !== dragged) li.classList.add('pl-drop');
    }
  });
  ol.addEventListener('drop', async (e) => {
    const li = e.target.closest?.('li[data-video-id]');
    if (!dragged || !li) return;
    e.preventDefault();
    const to = [...ol.querySelectorAll('li[data-video-id]')].indexOf(li);
    const id = dragged;
    dragged = null;
    clearDrop();
    await Playlists.move(playlistId, id, to);
  });
}

/** 足すときに、その動画で合わせたことのある同期のずれも持たせる */
const withOffset = (info) => {
  const o = SyncOffsets.get(info.videoId);
  return o ? { ...info, offset: o } : info;
};

/** 足した結果を知らせる */
function reportPlaylistAdd(pl, r, { bad = 0, tooMany = false } = {}) {
  if (!r) return;
  const notes = [];
  if (r.added) notes.push(tr('plAdded', r.added));
  if (r.exists) notes.push(tr('plAlready', r.exists));
  if (r.full || tooMany) notes.push(tr(pl.sync ? 'plItemsFullSync' : 'plItemsFull', pl.name, Playlists.limitOf(pl)));
  if (bad) notes.push(tr('shareBadLines', bad));
  favErrorEl.textContent = notes.join(' / ');
}

/** 追加欄の文字 (URL / 動画 ID / @チャンネル名。何行でも) を再生リストの最後に足す */
async function addToPlaylistFromText(id, text) {
  const pl = await Playlists.get(id);
  if (!pl || !text.trim()) return;
  favErrorEl.textContent = '';
  const room = Playlists.limitOf(pl) - pl.items.length;
  if (room <= 0) {
    reportPlaylistAdd(pl, { added: 0, exists: 0, full: true });
    return;
  }
  const { items, bad, tooMany } = await parseVideoLines(text, room, (done, total) => {
    favErrorEl.textContent = tr('shareLoading', done, total);
  });
  if (!items.length) {
    favErrorEl.textContent = tr(bad ? 'plAddFailed' : 'shareNothing');
    return;
  }
  plAddDraft = '';
  const r = await Playlists.addItems(id, items.map((x) => (x.offset ? x : withOffset(x))));
  reportPlaylistAdd(pl, r, { bad, tooMany });
}

/** 今の枠の配信 (並び順。名前とチャンネル名、同期のずれ付き) */
function tileEntries() {
  return shareTiles().map((i) => withOffset({ ...views[i].meta, label: state.tiles[i].label, videoId: state.tiles[i].videoId }));
}

/** 今の枠の配信を再生リストの最後に足す */
async function addTilesToPlaylist(id) {
  const pl = await Playlists.get(id);
  const items = tileEntries();
  if (!pl) return;
  if (!items.length) {
    favErrorEl.textContent = tr('shareEmpty');
    return;
  }
  reportPlaylistAdd(pl, await Playlists.addItems(id, items));
}

/** 作った再生リストをライブラリで開き、名前を書き換えられるようにする */
function showNewPlaylist(pl) {
  selectPlaylist(pl.id);
  plFocusName = true;
  rememberLibraryTab('playlists');
  if (favDialog.open && favMode === 'playlists') renderVideoList();
  else openFavorites(null, 'library');
}

/** ＋ 新規: 空の再生リストを作る (名前は今の日時。作ったらすぐ名前を書き換えられる) */
async function newPlaylist() {
  const r = await Playlists.create(defaultPlaylistName(), [], {}, { unique: true });
  if (r.full) favErrorEl.textContent = tr('plFull', Playlists.MAX_LISTS);
  else if (r.playlist) showNewPlaylist(r.playlist);
}

/**
 * ▦ 今の枠から作る: 表示中の枠の配信を、並び順・枠の名前・レイアウト・同期のずれごと新しい再生リストにする。
 * 同期再生中か、ずれを合わせた動画があれば「同期再生」にして、今の基準の枠を基準にする
 */
async function playlistFromTiles() {
  const { items, sync, layoutId, ref } = tilesShareSet();
  if (!items.length) {
    favErrorEl.textContent = tr('shareEmpty');
    return;
  }
  const r = await Playlists.create(defaultPlaylistName(), items, { sync, layoutId: sync ? layoutId : null, ref }, { unique: true });
  if (!r.playlist) {
    favErrorEl.textContent = tr(r.full ? 'plFull' : 'plSaveFailed', Playlists.MAX_LISTS);
    return;
  }
  notify(tr('plSaved', r.playlist.name, items.length));
  showNewPlaylist(r.playlist);
}

async function deleteSelectedPlaylist() {
  const pl = plSelected && (await Playlists.get(plSelected));
  if (!pl || !confirm(tr('plDeleteConfirm', pl.name, pl.items.length))) return;
  if (queueMode && queueSource === pl.id) stopQueue();
  if (playlistSyncSession?.id === pl.id) playlistSyncSession = null;
  await Playlists.remove(pl.id);
  selectPlaylist(null);
  renderVideoList();
}

// ---- ⏱ 再生リストの同期再生
// 先頭から 16 本を一度に並べ (視聴セットを開くのと同じ)、アーカイブだと分かりしだい基準の動画に合わせて同期を始める。
// 再生している間に ⏱ で直したずれ・選び直した基準は、その再生リストにも書き戻す (次に開いたとき・共有したときにそろうように)
/** 同期再生している再生リスト ({id, ids: Set}。枠を入れ替えて、その再生リストの動画が無くなったら終わり) */
let playlistSyncSession = null;

/** resume = 前回見ていたところから (false なら最初から。続きの位置も消す) */
async function playPlaylistSynced(pl, { resume = true } = {}) {
  const items = syncItems(pl);
  if (!items.length) return;
  const ids = items.map((x) => x.videoId);
  const from = resume ? pl.resume : null;
  if (!resume && pl.resume) await Playlists.setResume(pl.id, null);
  await applyViewingSet(ids, playlistLayoutId(pl), {
    offsets: items.map((x) => x.offset ?? SyncOffsets.get(x.videoId)),
    ref: Math.max(0, ids.indexOf(pl.ref)),
    labels: items.map((x) => x.label || ''),
    resumeAt: from?.at || null,
  });
  playlistSyncSession = { id: pl.id, ids: new Set(ids) };
  favDialog.close();
  notify(tr(from ? 'plSyncResumed' : 'plSyncStarted', pl.name, ids.length, hms(from?.pos)));
}

/** 同期再生している再生リストの、見ている位置を保存する (15 秒ごとと、画面を閉じるとき) */
function savePlaylistResume() {
  const s = playlistSyncSession;
  if (!s || !Sync.isOn()) return;
  if (!visibleIndexes().some((i) => s.ids.has(state.tiles[i].videoId))) {
    playlistSyncSession = null;
    return;
  }
  const r = Sync.resumePoint();
  if (r) return Playlists.setResume(s.id, { ...r, savedAt: Date.now() });
}
setInterval(savePlaylistResume, 15000);
addEventListener('pagehide', savePlaylistResume);

/** 同期再生中の再生リストの動画が、まだ枠に出ているか */
function inPlaylistSync(videoId) {
  const s = playlistSyncSession;
  if (!s || !videoId || !s.ids.has(videoId)) return false;
  if (!visibleIndexes().some((i) => s.ids.has(state.tiles[i].videoId))) {
    playlistSyncSession = null; // 枠を全部入れ替えた
    return false;
  }
  return visibleIndexes().some((i) => state.tiles[i].videoId === videoId);
}

/** ⏱ でずれを決めた (同期再生中の再生リストの動画なら、再生リストにも書く) */
function playlistOffsetChanged(videoId, v) {
  if (inPlaylistSync(videoId)) Playlists.setOffsets(playlistSyncSession.id, { [videoId]: v });
}

/** 同期の基準を選び直した (同期再生中の再生リストの動画なら、再生リストの基準にもする) */
function playlistRefChanged(videoId) {
  if (inPlaylistSync(videoId)) Playlists.setOptions(playlistSyncSession.id, { ref: videoId });
}

// ---- 📃 再生リストに入れる (枠のバーや一覧の 📃 で開く小さな画面)
// 再生リストを押すと最後に足して閉じる。もう入っている再生リストを押すと外す。名前を入れて新しく作って入れることもできる
let pickTarget = null;

async function openPlaylistPicker(info) {
  if (!info?.videoId) return;
  pickTarget = info;
  const dialog = document.getElementById('plPickDialog');
  document.getElementById('plPickTarget').textContent = [info.label || info.channel, info.title].filter(Boolean).join(' / ') || info.videoId;
  document.getElementById('plPickName').value = '';
  document.getElementById('plPickStatus').textContent = '';
  await renderPlaylistPicker();
  if (!dialog.open) dialog.showModal();
}

async function renderPlaylistPicker() {
  const ul = document.getElementById('plPickList');
  const lists = await Playlists.list();
  if (!lists.length) {
    const li = document.createElement('li');
    li.className = 'pl-pick-empty';
    li.textContent = tr('plPickNone');
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(
    ...lists.map((p) => {
      const has = p.items.some((h) => h.videoId === pickTarget.videoId);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.classList.toggle('on', has);
      b.title = tr(has ? 'plPickRemove' : 'plPickAdd');
      const name = document.createElement('span');
      name.className = 'pl-pick-name-text';
      name.textContent = `${has ? '✓ ' : ''}${p.name}`;
      const n = document.createElement('span');
      n.className = 'pl-pick-count';
      n.textContent = tr('savedCount', p.items.length, Playlists.limitOf(p));
      b.append(name, n);
      b.addEventListener('click', () => pickPlaylist(p, has));
      li.append(b);
      return li;
    }),
  );
}

async function pickPlaylist(p, has) {
  const status = document.getElementById('plPickStatus');
  if (has) {
    await Playlists.removeItem(p.id, pickTarget.videoId);
    notify(tr('plPickRemoved', p.name));
  } else {
    const r = await Playlists.addItem(p.id, withOffset(pickTarget));
    if (r === 'full') {
      status.textContent = tr(p.sync ? 'plItemsFullSync' : 'plItemsFull', p.name, Playlists.limitOf(p));
      return;
    }
    notify(tr('plPickAdded', p.name));
  }
  document.getElementById('plPickDialog').close();
}

function setupPlaylistPicker() {
  const dialog = document.getElementById('plPickDialog');
  const nameEl = document.getElementById('plPickName');
  const status = document.getElementById('plPickStatus');
  closeOnBackdrop(dialog);
  const create = async () => {
    const r = await Playlists.create(nameEl.value, [withOffset(pickTarget)]);
    if (r.empty) {
      status.textContent = tr('plPickNeedName');
      nameEl.focus();
    } else if (r.exists) {
      // 同じ名前があれば、そこに入れる
      await pickPlaylist(r.exists, r.exists.items.some((h) => h.videoId === pickTarget.videoId));
    } else if (r.full) {
      status.textContent = tr('plFull', Playlists.MAX_LISTS);
    } else {
      notify(tr('plPickAdded', r.playlist.name));
      dialog.close();
    }
  };
  // Enter で作って入れる (form method="dialog" で閉じてしまわないように)
  nameEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    create();
  });
  document.getElementById('plPickNew').addEventListener('click', create);
}

/** どれかの再生リストに入っている動画 (📃 の点灯と、タイトルなどが分かったときに再生リストにも書き足すため) */
let playlistIds = new Set();
async function refreshPlaylistIds() {
  playlistIds = new Set((await Playlists.list()).flatMap((p) => p.items.map((h) => h.videoId)));
  for (let i = 0; i < MAX_TILES; i++) if (views[i]) updateFavButton(i);
}

// 再生リストを保存できなかったとき (拡張機能の保存の上限に届いたなど) は知らせる (知らせないと、黙って消えたように見える)
Playlists.onError((e, isQuota) => notify(tr(isQuota ? 'plStorageFull' : 'plWriteFailed', String(e?.message || e))));

// 他のタブで保存・削除したときも、表示中の一覧と 📃 の表示を直す
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !Playlists.isChange(changes)) return;
  await refreshPlaylistIds().catch(() => {});
  // 再生リストのタブは、続けて書き込まれても描き直しは少しまとめる
  if (favDialog.open && favMode === 'playlists') schedulePlaylistRender();
  else if (favDialog.open && isVideoMode()) renderVideoList();
  else if (favDialog.open) scheduleFavRender(); // チャンネルの行で開いたアーカイブの 📃
  if (document.getElementById('plPickDialog').open && pickTarget) renderPlaylistPicker();
});

// ---------------------------------------------------------------- チャンネルパック (設定の「チャンネル」タブ)
/**
 * チャンネルパックの一覧と、書き出すグループの選択肢を作り直す。
 * 先頭は最初から入っているホロライブのパック (初期データ。中身は presets.js で、拡張機能の更新で増える)。
 * 外したあとも一覧に残し、「戻す」で戻せるようにする
 */
async function updatePacks() {
  const list = document.getElementById('packList');
  const button = (text, onClick, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  };
  const row = (text, ...buttons) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'pack-name';
    label.textContent = text;
    label.title = text;
    li.append(label, ...buttons);
    return li;
  };
  const [packs, presetIn, presetOut] = await Promise.all([Favorites.packs(), Favorites.presetCount(), Favorites.removedPresetCount()]);
  const builtin = row(
    tr('packCount', tr('packBuiltin'), presetIn),
    button(tr('packRemove'), async () => {
      if (!confirm(tr('removePresetsConfirm', presetIn))) return;
      const n = await Favorites.removeAllPresets();
      await afterPresetsChanged();
      notify(tr('packRemoved', tr('packBuiltin'), n));
    }, presetIn === 0),
    button(tr('packRestore', presetOut), async () => {
      await Favorites.restorePresets();
      await afterPresetsChanged();
    }, presetOut === 0),
  );
  list.replaceChildren(
    builtin,
    ...packs.map(({ name, count }) =>
      row(
        tr('packCount', name, count),
        button(tr('packRemove'), async () => {
          if (!confirm(tr('packRemoveConfirm', name, count))) return;
          const n = await Favorites.removePack(name);
          await afterPresetsChanged();
          notify(tr('packRemoved', name, n));
        }),
      ),
    ),
  );
  // 書き出す範囲 (パック単位): すべて / 同梱のホロライブ / 読み込んだ各パック / 自分で追加したチャンネル (チャンネルがあるものだけ)
  const sel = document.getElementById('packGroup');
  const prev = sel.value;
  const favs = await Favorites.list();
  const opt = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
  const options = [opt('*', tr('packAllGroups'))];
  if (favs.some((f) => f.preset)) options.push(opt('@builtin', tr('packBuiltin')));
  for (const { name } of packs) options.push(opt(`pack:${name}`, name));
  if (favs.some(isMyChannel)) options.push(opt('@mine', tr('packMine')));
  sel.replaceChildren(...options);
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

/** 自分で追加したチャンネル (同梱のホロライブでも、読み込んだパックでもないもの) */
const isMyChannel = (f) => !f.preset && !f.pack;

/** 書き出す範囲の値 → {パックの名前, そのチャンネル} */
function exportSelection(value, favs) {
  if (value === '@builtin') return { name: tr('packBuiltinExport'), list: favs.filter((f) => f.preset) };
  if (value === '@mine') return { name: tr('packMine'), list: favs.filter(isMyChannel) };
  if (value.startsWith('pack:')) {
    const name = value.slice('pack:'.length);
    return { name, list: favs.filter((f) => f.pack === name) };
  }
  return { name: tr('packAllGroups'), list: favs };
}

/** 「パックを探す」の一覧を作り直す (一覧を取得したあとだけ。setupPacks で入れる) */
let refreshCatalog = async () => {};

function setupPacks() {
  const input = document.getElementById('packIn');
  const status = document.getElementById('packStatus');
  const file = document.getElementById('packFile');
  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('share-error', isError);
  };
  const errorText = (e) =>
    ({ notPack: tr('packNotPack'), emptyPack: tr('packEmpty'), tooLarge: tr('packTooLarge'), badUrl: tr('packBadUrl') })[e.message] ||
    tr('packFetchFail', e.message || e);

  /**
   * パックの中身 (JSON) を確かめて、確認してから足す。report = 結果を出す場所。
   * 戻り値: 読めたパック (足すものが無かったときも)。読めなかった・やめたときは null
   */
  const importText = async (text, report = setStatus) => {
    let pack;
    try {
      pack = ChannelPack.parse(text);
    } catch (e) {
      report(errorText(e), true);
      return null;
    }
    const { added, existing } = await Favorites.previewPack(pack);
    if (!added) {
      report(tr('packNothing', pack.name));
      return pack;
    }
    if (!confirm(tr('packConfirm', pack.name, added, existing))) {
      report('');
      return null;
    }
    const n = await Favorites.importPack(pack);
    if (report === setStatus) input.value = '';
    report(tr('packAdded', pack.name, n));
    await afterPresetsChanged();
    return pack;
  };

  // ---- パックを探す (リポジトリの packs/ の一覧)。開いたときには取りに行かず、「一覧を取得」を押したときだけ取る
  const catalogList = document.getElementById('catalogList');
  const catalogStatus = document.getElementById('catalogStatus');
  const setCatalogStatus = (text, isError = false) => {
    catalogStatus.textContent = text;
    catalogStatus.classList.toggle('share-error', isError);
  };
  let catalog = null;
  const span = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });
  refreshCatalog = async () => {
    if (!catalog) return;
    const [have, dates] = await Promise.all([Favorites.packs(), ChannelPack.importedDates()]);
    const names = new Set(have.map((p) => p.name));
    catalogList.replaceChildren(
      ...catalog.map((p) => {
        const li = document.createElement('li');
        const body = document.createElement('div');
        body.className = 'catalog-body';
        const name = LANG === 'ja' ? p.name : p.nameEn;
        const meta = [p.author && tr('catalogBy', p.author), p.updated && tr('catalogUpdated', p.updated), p.channels && tr('catalogChannels', p.channels)];
        body.append(span('pack-name', name), span('catalog-meta', meta.filter(Boolean).join(' ・ ')));
        const desc = LANG === 'ja' ? p.description : p.descriptionEn;
        if (desc) body.append(span('catalog-desc', desc));
        // 読み込み済み = そのパックから足したチャンネルが一覧にある。一覧の更新日が、読み込んだときより新しければ更新あり
        const imported = names.has(p.name);
        const newer = imported && !!p.updated && !!dates[p.name] && p.updated > dates[p.name];
        if (newer) body.append(span('catalog-new', tr('catalogUpdateNote')));
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = tr(newer ? 'catalogUpdate' : imported ? 'catalogImported' : 'catalogImport');
        b.disabled = imported && !newer;
        b.addEventListener('click', async () => {
          b.disabled = true;
          setCatalogStatus(tr('packLoading'));
          try {
            const pack = await importText(await ChannelPack.fetchText(p.url), setCatalogStatus);
            if (pack) await ChannelPack.markImported(pack.name, p.updated);
          } catch (e) {
            setCatalogStatus(errorText(e), true);
          }
          await refreshCatalog();
        });
        li.append(body, b);
        return li;
      }),
    );
  };
  document.getElementById('catalogLoad').addEventListener('click', async () => {
    setCatalogStatus(tr('packLoading'));
    try {
      catalog = await ChannelPack.fetchIndex();
      setCatalogStatus(catalog.length ? '' : tr('catalogEmpty'));
      await refreshCatalog();
    } catch (e) {
      setCatalogStatus(e.message === 'notIndex' ? tr('catalogBad') : errorText(e), true);
    }
  });

  document.getElementById('packLoad').addEventListener('click', async () => {
    const raw = input.value.trim();
    if (!raw) return;
    setStatus(tr('packLoading'));
    // URL なら取りに行く (中身を貼った場合はそのまま)
    if (/^https?:\/\//i.test(raw)) {
      try {
        await importText(await ChannelPack.fetchText(raw));
      } catch (e) {
        setStatus(errorText(e), true);
      }
      return;
    }
    await importText(raw);
  });
  document.getElementById('packFileBtn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (f) await importText(await f.text());
  });

  // 書き出す: 選んだパック (同梱のホロライブ・読み込んだパック・自分で追加したチャンネル・すべて) を、JSON ファイルで保存。
  // チャンネルごとのグループ (ホロライブの「0期生」など) はそのまま残す
  document.getElementById('packExport').addEventListener('click', async () => {
    const { name, list: favs } = exportSelection(document.getElementById('packGroup').value, await Favorites.list());
    if (!favs.length) return;
    const body = JSON.stringify(ChannelPack.build(name, favs), null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `hakomado-pack-${name.replace(/[\\/:*?"<>|\s]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

/** 初期データ・チャンネルパックのチャンネルを足した / 外したあと、📌 の表示や開いている一覧を直す */
async function afterPresetsChanged() {
  await refreshFavKeys();
  await updatePacks();
  await refreshCatalog();
  if (favDialog.open && !isVideoMode()) await refreshFavorites(false);
}

function pickFavorite(f, st) {
  const target = favTarget ?? firstEmptyTile();
  if (target == null) {
    favErrorEl.textContent = tr('noEmptyTile');
    return;
  }
  setTileVideo(target, st.videoId, f.handle || `https://www.youtube.com/channel/${f.channelId}`);
  favDialog.close();
}

// ---------------------------------------------------------------- 自動再生

/**
 * チャンネル (または対象のピックアップ) の配信状況を (待って) 取り、配信中のものと配信予定を返す。
 * lives = 配信中 (チャンネル一覧の並び順)、upcoming = 配信予定 (開始が早い順。配信中と同じ配信は除く)
 * errors = 取得に失敗した件数、failedKeys = 取得に失敗したチャンネルの ID と @ハンドル (小文字)。
 * 自動再生は、取得に失敗したチャンネルの枠だけ消さない (1 件の失敗で全体の片付けが止まらないように)
 */
/**
 * target = 'fav' ならピックアップ (📌) のチャンネルだけ、それ以外はチャンネル全部を確認する
 */
/**
 * 対象のチャンネルの配信状況をまとめて取る。
 * quick = 自動再生を ON にした最初の 1 回 (待たせないように、ホロジュールで分かるチャンネルの RSS は取り直さない。
 *   動画のページを確かめる件数も 1 分ごとの確認と同じに抑える)
 */
async function collectLiveFavorites({ force = false, auto = false, quick = false, onProgress = null, target = 'all' } = {}) {
  const favs = (await Favorites.list()).filter((f) => target !== 'fav' || f.star);
  let done = 0;
  onProgress?.(0, favs.length);
  // 1 回の確認で動画のページ (重い) を確かめる件数の上限。残りは次の回に回す (一度にまとめて取りに行かないように)。
  // 自動再生の確認では少なめ (開始予定が近いものから確かめるので、開始の検知は遅れない)
  const budget = { watch: auto || quick ? 8 : 30 };
  const results = [];
  let errors = 0;
  const failedKeys = new Set();
  let next = 0;
  const worker = async () => {
    while (next < favs.length) {
      const f = favs[next++];
      try {
        const st = await Favorites.fetchStatus(f, { force, auto, budget, quick });
        favStatus.set(f.channelId, st);
        results.push({ f, st });
      } catch (e) {
        console.warn('hakomado: 配信状況の取得に失敗', f.name, e);
        favStatus.set(f.channelId, 'error');
        errors++;
        for (const k of [f.channelId, f.handle]) if (k) failedKeys.add(favKey(k));
      }
      onProgress?.(++done, favs.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // 同じ配信 (コラボ等) は 1 つにまとめ、チャンネル一覧の並び順 (自分で追加したもの → 既定) にそろえる
  const seen = new Set();
  const order = new Map(favs.map((f, n) => [f.channelId, (f.preset ? 1e6 : 0) + n]));
  const lives = results
    .filter(({ st }) => st?.state === 'live' && !seen.has(st.videoId) && seen.add(st.videoId))
    .sort((a, b) => order.get(a.f.channelId) - order.get(b.f.channelId));
  const upcoming = results
    .filter(({ st }) => st?.state === 'upcoming' && st.startAt && !seen.has(st.videoId) && seen.add(st.videoId))
    .sort((a, b) => a.st.startAt - b.st.startAt || order.get(a.f.channelId) - order.get(b.f.channelId));
  return { lives, upcoming, errors, failedKeys };
}

const FALLBACK_WINDOW_MS = 60 * 60 * 1000; // 配信中が無いときに載せる配信予定の範囲 (次の配信の開始から 1 時間以内)

/**
 * 自動再生で枠に載せる配信を決める。
 * - 配信中のもの + 開始まで prestartMin 分以内の配信予定 (始まる前から枠を用意して、最初から見られるように)
 * - 配信中が 1 つも無いときは、次に始まる配信予定と、その開始から 1 時間以内に始まる配信予定を全部
 * @returns {{targets: Array, fallback: boolean}} fallback = 配信中が無いので配信予定を載せている
 */
function autoTargets(collected) {
  // 終わったと分かっている配信は除く (ホロジュールにはしばらく残る)
  const lives = collected.lives.filter((l) => !finishedIds.has(l.st.videoId));
  const upcoming = collected.upcoming.filter((u) => !finishedIds.has(u.st.videoId));
  const now = Date.now();
  const preMs = (Number(state.settings.prestartMin) || 0) * 60 * 1000;
  const soon = preMs > 0 ? upcoming.filter((u) => u.st.startAt - now <= preMs) : [];
  if (lives.length) return { targets: [...lives, ...soon], fallback: false };
  if (!upcoming.length) return { targets: [], fallback: false };
  const first = Math.min(...upcoming.map((u) => u.st.startAt));
  const until = Math.max(first + FALLBACK_WINDOW_MS, now + preMs);
  return { targets: upcoming.filter((u) => u.st.startAt <= until), fallback: true };
}

/** 「配信予定の枠を用意する」の時間内に始まる配信予定か */
function isSoonUpcoming(u) {
  const preMs = (Number(state.settings.prestartMin) || 0) * 60 * 1000;
  return preMs > 0 && (u.st.startAt || Infinity) - Date.now() <= preMs;
}

/** 配信予定なら「名前 (開始時刻)」、配信中なら名前だけ */
function targetLabel({ f, st }) {
  return st.state === 'upcoming' ? `${f.name} (${formatStart(st.startAt)})` : f.name;
}

/**
 * 自動再生を ON にしたときの最初の 1 回: 対象のチャンネルで配信中のものを全部 (最大枠数まで)、件数に合ったレイアウトで再生する。
 * 表示中の配信は読み込み直さずに残し、配信中でない枠は空にする
 */
async function startAllLive() {
  try {
    await withAutoLock(startAllLiveInner);
  } finally {
    hideAutoProgress();
  }
}

/**
 * 自動再生が枠を足す処理を、タブ間で 1 つずつ順番に行う (hakomado を複数のタブ・ウィンドウで開いて、
 * どれも自動再生 ON のとき)。足し終わったら表示中の配信を他のタブに知らせ、届くのを少し待ってから次のタブに渡す。
 * 次のタブは「別のタブで表示中」の配信を飛ばすので、同じ配信が 2 つのタブに入らない
 */
function withAutoLock(fn) {
  const run = async () => {
    try {
      return await fn();
    } finally {
      broadcastShown({ force: true });
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  return navigator.locks.request('hakomado-auto-add', run);
}

async function startAllLiveInner() {
  // 進み具合: 配信状況の確認 0〜70% → 見られる配信かの確認 70〜95% → 枠の準備 95〜100%
  showAutoProgress(tr('progressStatus', 0, 0), 0);
  const collected = await collectLiveFavorites({
    force: true,
    quick: true,
    target: state.settings.autoTarget,
    onProgress: (done, total) => showAutoProgress(tr('progressStatus', done, total), total ? (done / total) * 0.7 : 0.7),
  });
  const auto = autoTargets(collected);
  // 最近の配信で埋めるときは、ライブが無いときの「先の配信予定」は出さない (代わりに最近の配信を流す)。
  // 「配信予定の枠を用意する」の時間内に始まるものは、いつもどおり用意する
  if (state.settings.autoArchive && auto.fallback) auto.targets = auto.targets.filter(isSoonUpcoming);
  const { targets: allTargets, fallback } = auto;
  // すでに表示している配信を先にしてから、見られるものを最大枠数まで選ぶ
  const shownFirst = visibleIndexes().map((i) => state.tiles[i].videoId);
  // 別のタブ (別のディスプレイの hakomado など) で表示中の配信は飛ばす (このタブで表示中のものは残す)
  const targets = allTargets.filter((l) => shownFirst.includes(l.st.videoId) || !shownInOtherTab(l.st.videoId));
  if (!targets.length && allTargets.length) {
    notify(tr('allInOtherTabs'));
    return;
  }
  const rankShown = (l) => {
    const k = shownFirst.indexOf(l.st.videoId);
    return k < 0 ? 1e9 : k;
  };
  // 最大枠数に収まらないときに、ピックアップ (📌) のライブ配信が押し出されないよう、表示していないものの中では先にする
  const pickRank = (l) => (pickupPriority() && l.f.star && l.st.state === 'live' ? 0 : 1);
  targets.sort((a, b) => rankShown(a) - rankShown(b) || pickRank(a) - pickRank(b));
  const { ok, blocked } = await filterAccessible(targets, {
    limit: autoMaxTiles(),
    onProgress: (done, total) => showAutoProgress(tr('progressAccess', done, total), 0.7 + (total ? (done / total) * 0.25 : 0.25)),
  });
  if (!state.autoMode) return; // 準備している間に OFF にされた
  showAutoProgress(tr('progressTiles'), 0.97);
  let lives = ok;
  // 自分で入れた枠 (自動再生が入れたものではない枠) が置き換わるなら、先に確かめる。やめたら自動再生は OFF に戻す。
  // ライブが無くて最近の配信で埋めるときは全部、ライブがあるときは配信中のものに入っていない枠が置き換わる
  const keepIds = new Set(lives.map((l) => l.st.videoId));
  const archiveOnly = lives.length === 0 && state.settings.autoArchive;
  const replaced = visibleIndexes().filter((i) => {
    const t = state.tiles[i];
    return t.videoId && !t.auto && !t.fill && (archiveOnly || (lives.length > 0 && !keepIds.has(t.videoId)));
  });
  if (replaced.length) {
    hideAutoProgress();
    const names = replaced.map((i) => tileName(i) || state.tiles[i].videoId);
    const list = names.slice(0, 3).join(tr('sep')) + (names.length > 3 ? tr('andMore', names.length - 3) : '');
    if (!confirm(tr('autoReplaceConfirm', replaced.length, list))) {
      await setAutoMode(false);
      notify(tr('autoReplaceCanceled'));
      return;
    }
    if (!state.autoMode) return; // 確かめている間に OFF にされた
  }
  if (lives.length === 0) {
    if (state.settings.autoArchive) {
      // ライブが無い → 最近の配信で
      for (const [j, t] of state.tiles.entries()) {
        if (t.videoId) {
          WatchHistory.removed(t.videoId, 'replaced');
          state.tiles[j] = newTileState();
          views[j].danmaku.clear();
        }
      }
      if (favDialog.open) favDialog.close();
      const n = await refillArchives({ lock: false });
      renderAll();
      save();
      notify(n ? tr('fillOnly', n) : tr('noneLive'));
      return;
    }
    notify(
      blocked.length
        ? tr('onlyMembers', blocked.join(tr('sep')))
        : tr('noneLive'),
    );
    return;
  }
  // 配信中・配信予定の全件 (見られないものを除く前の数。「16 件のうち 12 件を再生」の表示用)
  const total = Math.max(lives.length, targets.length - blocked.length);

  const audibleBefore = audibleTiles().map((i) => state.tiles[i].videoId);
  const layout = autoLayoutFor(lives.length);

  // 枠の割り当て: 同じ配信を表示中の枠はそのまま使う (読み込み直さない)。残りは空いている枠へ
  const assigned = [];
  const used = new Set();
  for (const { st } of lives) {
    const i = state.tiles.findIndex((t, j) => !used.has(j) && t.videoId === st.videoId);
    assigned.push(i >= 0 ? i : null);
    if (i >= 0) used.add(i);
  }
  for (let k = 0; k < lives.length; k++) {
    if (assigned[k] != null) continue;
    const i = state.tiles.findIndex((_, j) => !used.has(j));
    assigned[k] = i;
    used.add(i);
  }
  // 使わない枠は空にする (隠れても再生し続けないように)
  state.tiles.forEach((t, j) => {
    if (!used.has(j) && t.videoId) {
      WatchHistory.removed(t.videoId, 'replaced');
      state.tiles[j] = newTileState();
      views[j].danmaku.clear();
    }
  });
  // ピックアップ (📌) のライブ配信はメイン枠へ
  const placed = promotePickups(assigned, layout.mains, (i) => pickRank(lives[assigned.indexOf(i)]) === 0);
  state.order = [...placed, ...state.order.filter((j) => !placed.includes(j))];
  state.layoutId = layout.id;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

  lives.forEach(({ f, st }, k) => {
    const i = assigned[k];
    if (state.tiles[i].videoId !== st.videoId) {
      Object.assign(state.tiles[i], { ...newTileState(), input: f.handle || f.channelId, videoId: st.videoId });
      views[i].danmaku.clear();
      renderTile(i, { reloadPlayer: true, reloadChat: true });
    }
    Object.assign(state.tiles[i], { auto: true, label: f.name });
  });

  // 音: 直前に聞いていた配信が残っていればそのまま、無ければ 1 番 (メイン) の枠
  const keep = assigned.filter((i) => audibleBefore.includes(state.tiles[i].videoId));
  setAudioSet(keep.length ? keep : [placed[0]]);
  renderAll();
  save();
  if (favDialog.open) favDialog.close();
  restartCruise();
  const skipped = blocked.length ? tr('skippedCount', blocked.length) : '';
  const soonCount = lives.filter((l) => l.st.state === 'upcoming').length;
  const head = fallback
    ? tr('upcomingShown', lives.map(targetLabel).join(tr('sep')), layout.name)
    : total > autoMaxTiles()
      ? tr('playingSome', total, autoMaxTiles(), layout.name)
      : soonCount
        ? tr('playingWithSoon', total - soonCount, soonCount, layout.name)
        : tr('playingAll', total, layout.name);
  notify(head + skipped);
  await refillArchives({ lock: false });
}

// ---- メンバー限定の除外
const membersBlocked = new Set(); // 枠のプレイヤーが「メンバー限定で見られない」と知らせてきた配信
const membersAnnounced = new Set(); // 除外したことを知らせた配信 (同じ配信を何度も知らせない)

/**
 * 設定が ON なら、メンバー限定でメンバーではない配信を除く。
 * @returns {Promise<{ok: Array, blocked: string[]}>} blocked = 今回初めて除外した配信の名前
 */
async function filterAccessible(lives, { limit = Infinity, onProgress = null } = {}) {
  if (!state.settings.skipMembersOnly || lives.length === 0) return { ok: lives.slice(0, limit), blocked: [] };
  // 並び順のとおりに確かめ、見られるものが limit 本そろったら残りは確かめない (1 本ごとに動画ページを取るので時間がかかる)
  const results = new Array(lives.length);
  let next = 0;
  let okCount = 0;
  let checked = 0;
  onProgress?.(0, lives.length);
  const worker = async () => {
    while (next < lives.length && okCount < limit) {
      const k = next++;
      const id = lives[k].st.videoId;
      results[k] = membersBlocked.has(id) ? 'members' : await Favorites.checkAccess(id);
      if (results[k] !== 'members') okCount++;
      onProgress?.(++checked, lives.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const ok = lives.filter((_, k) => results[k] && results[k] !== 'members').slice(0, limit);
  const blocked = lives
    .filter((l, k) => results[k] === 'members' && !membersAnnounced.has(l.st.videoId))
    .map((l) => (membersAnnounced.add(l.st.videoId), l.f.name));
  return { ok, blocked };
}

const AUTO_INTERVAL_MS = 60 * 1000;
const AUTO_MISS_LIMIT = 2; // 何回続けて「配信中に無い」なら枠を消すか (一時的な取りこぼしで消さないため)
const autoMissing = new Map(); // videoId -> 続けて見つからなかった回数
const autoDismissed = new Set(); // 自分で ✕ で閉じた配信 (自動で入れ直さない)
// 枠のプレイヤーが「終わった」と知らせてきた配信。プレミア公開はホロジュールで赤枠にならず、
// 開始時刻から 30 分ほど「予定」のまま載り続けるので、これで除かないと終わった後も枠が残る
const finishedIds = new Set();
let autoTimer = 0;
let autoBusy = false;

/**
 * 自動再生の ON / OFF。
 * ON にするたびに「閉じた配信」の記録を消して、配信中のものを全部再生し直す。
 * resume = 前回 ON のまま閉じたページを開き直したとき (今の枠はそのままで確認だけ再開)
 */
async function setAutoMode(on, { resume = false } = {}) {
  if (on) stopQueue(); // 自動再生とあとで見るの再生は同時に動かさない (同じ枠を取り合うので)
  state.autoMode = on;
  clearInterval(autoTimer);
  autoTimer = 0;
  save();
  const btn = document.getElementById('autoMode');
  setToggle(btn, on);
  if (!on) return; // OFF: 今の枠はそのまま、増減だけ止める
  // 確認の途中 (OFF → すぐ ON など) なら、終わるのを待ってから始める
  while (autoBusy) {
    await new Promise((r) => setTimeout(r, 200));
    if (!state.autoMode) return; // 待っている間に OFF にされた
  }

  autoDismissed.clear();
  finishedIds.clear(); // 「終わった」の誤判定もやり直せるように
  autoMissing.clear();
  membersAnnounced.clear();
  membersBlocked.clear();
  autoBusy = true;
  // 確認中は文字を変えずにアイコンを回す (ボタンの幅を変えないため)
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    if (resume) await autoTickOnce();
    else await startAllLive();
  } catch (e) {
    notify(tr('statusFailed', e.message || e));
  } finally {
    autoBusy = false;
    btn.disabled = false;
    btn.classList.remove('busy');
  }
  if (state.autoMode) autoTimer = setInterval(autoTick, AUTO_INTERVAL_MS);
}

// ---------------------------------------------------------------- あとで見る・再生リストを、今の枠で順に再生
// 今ある枠に、あとで見るを入れた順 (古いもの) から入れる。最後まで再生した枠は一覧から消え、次が入る。
// 再生リストは並んでいる順に入れる (再生しても再生リストからは消えない)。
// 枠は増やさない。自動再生とは同時に動かさない (どちらかを始めると、もう一方は止まる)
let queueMode = false;
/** 何を再生しているか: null = あとで見る / 文字 = 再生リストの id */
let queueSource = null;
/** 再生リストを「ここから再生」したときの最初の動画 (null = 見ていないものを上から) */
let queueFromId = null;
/** この再生の間に最後まで見たもの (再生リストは見ても消えないので、次を選ぶときに飛ばす) */
const queueDoneIds = new Set();

/** 再生する順。あとで見るは入れた順で、📌 ピックアップで絞っているときはピックアップのチャンネルのものだけ */
async function queueList() {
  if (queueSource) {
    // 再生リスト: ふつうは見ていないものを上から (続きから)。「ここから再生」なら、その行から下を全部
    // 見られないと分かっているものは除く (「ここから」の位置は、除く前の並びで決める)
    const items = (await Playlists.get(queueSource))?.items || [];
    const playable = (h) => !knownUnplayable(h.videoId);
    if (!queueFromId) return items.filter((h) => !h.watched && playable(h));
    return items.slice(Math.max(0, items.findIndex((h) => h.videoId === queueFromId))).filter(playable);
  }
  const list = [...(await SavedVideos.list())].reverse().filter((h) => !knownUnplayable(h.videoId));
  return (await pickedOnly()) ? list.filter(isPickedEntry) : list;
}

/**
 * あとで見る / 選んでいる再生リストを、今の枠で順に再生する。
 * fromId = 再生リストの「ここから再生」(その行から下を全部)。同期再生の再生リストは、まとめて並べて同期する
 */
async function startQueue({ fromId = null } = {}) {
  stopQueue();
  queueSource = favMode === 'playlists' ? plSelected : null;
  queueFromId = queueSource ? fromId : null;
  if (queueSource) {
    const pl = await Playlists.get(queueSource);
    if (pl?.sync && pl.items.length) {
      queueSource = null;
      await playPlaylistSynced(pl, { resume: true });
      return;
    }
    // 全部見たあとなら、見た印を消して最初から
    if (!fromId && pl?.items.length && pl.items.every((h) => h.watched)) {
      if (!confirm(tr('plAllWatched', pl.name))) return;
      await Playlists.setWatched(pl.id, null, false);
    }
  }
  playlistSyncSession = null;
  const list = await queueList();
  if (!list.length) {
    favErrorEl.textContent = tr(queueSource ? 'plQueueEmpty' : 'queueEmpty');
    return;
  }
  if (state.autoMode) await setAutoMode(false);
  queueMode = true;
  queueDoneIds.clear();
  const tiles = visibleIndexes();
  // 余った枠に、これから入れる動画が前の再生のまま残っていれば空ける (同じ動画が 2 枠に並ばないように)
  const loading = new Set(list.slice(0, tiles.length).map((h) => h.videoId));
  tiles.forEach((i, k) => {
    if (list[k]) queueLoad(i, list[k]);
    else if (loading.has(state.tiles[i].videoId)) {
      state.tiles[i] = newTileState();
      views[i].danmaku.clear();
      renderTile(i, { reloadPlayer: true, reloadChat: true });
    }
  });
  setAudioSet([tiles[0]]); // 1 本目の音を出す
  favDialog.close();
  if (queueSource) {
    const pl = await Playlists.get(queueSource);
    notify(tr('plStarted', pl?.name || '', list.length));
  } else {
    notify(tr('queueStarted', list.length));
  }
}

function stopQueue() {
  if (!queueMode) return;
  queueMode = false;
  queueDoneIds.clear();
  for (const t of state.tiles) t.queue = false;
}

function queueLoad(i, h) {
  setTileVideo(i, h.videoId, h.input || `${YT}/watch?v=${h.videoId}`);
  Object.assign(state.tiles[i], { queue: true, label: h.label || h.channel || '' });
  updateTileName(i);
  save();
}

/** 順に再生の枠の動画が見られなかった → 飛ばして次を入れる (再生リストなら行に印を付ける。見た印は付けない) */
function skipQueueTile(i, members) {
  const t = state.tiles[i];
  const name = tileName(i) || t.videoId;
  queueDoneIds.add(t.videoId);
  playerBlocked.set(t.videoId, members ? 'members' : 'blocked');
  WatchHistory.removed(t.videoId, members ? 'members' : 'replaced');
  notify(tr('queueSkipped', name));
  queueNext(i);
}

/** 枠のプレイヤーが「見られない」と知らせてきた動画 (このタブの間だけ。ページを調べた結果より確か) -> 'members' | 'blocked' */
const playerBlocked = new Map();

/** 見られないと分かっている動画 (削除・非公開・メンバー限定・枠で再生できなかった)。順に再生では最初から入れない */
function knownUnplayable(videoId) {
  const a = plVideoStates.get(videoId)?.avail;
  return a === 'gone' || a === 'members' || membersBlocked.has(videoId) || playerBlocked.has(videoId);
}

/** あとで見るの枠が最後まで再生し終わった → まだ枠に出ていない次のものを入れる。無ければ枠を空ける。
 *  ほぼ同時に 2 枠終わっても同じものを入れないよう、1 つずつ順番に処理する */
let queueChain = Promise.resolve();
function queueNext(i) {
  queueChain = queueChain.then(() => queueNextNow(i)).catch((e) => console.warn('hakomado: あとで見るの次の読み込みに失敗', e));
  return queueChain;
}
async function queueNextNow(i) {
  if (!queueMode) return;
  const shown = new Set(visibleIndexes().map((j) => state.tiles[j].videoId));
  const next = (await queueList()).find((h) => !shown.has(h.videoId) && !queueDoneIds.has(h.videoId));
  const wasAudible = !state.tiles[i].muted;
  if (next) {
    queueLoad(i, next);
    if (wasAudible) setAudioSet([i]);
    notify(tr(queueSource ? 'plNext' : 'queueNext', next.label || next.title || next.videoId));
    return;
  }
  state.tiles[i] = newTileState();
  views[i].danmaku.clear();
  renderTile(i);
  save();
  if (!visibleIndexes().some((j) => state.tiles[j].queue)) {
    queueMode = false;
    notify(tr(queueSource ? 'plDone' : 'queueDone'));
  }
}

// ---------------------------------------------------------------- 🎲 おまかせ (空き枠のボタン)
// 「今のライブはもういいかな、ほかの番組も見るか」用。まだどの枠にも出ていない配信を、次の順で探して 1 本入れる:
//   ① ピックアップ (📌) のライブ配信中 → ② それ以外のライブ配信中 → ③ ピックアップの最近の配信 → ④ それ以外の最近の配信
// 同じ段の中からはランダムに選ぶ (押すたびに違うものが出るように)。最近の配信は一度見たものを除く
let pickBusy = false;
async function pickAnything(i) {
  if (pickBusy) return;
  pickBusy = true;
  const btn = views[i].el.querySelector('.pick-any');
  btn.disabled = true;
  // 進み具合: ① 配信状況の確認 0〜55% → ② 見られる配信かの確認 55〜70% → ③ 最近の配信を探す 70〜100%
  // (見つかった段で終わるので、途中から 100% に飛ぶことがある)
  const progress = pickProgress(i);
  progress.show(tr('pickSearching'), 0);
  const step = (key, from, to) => (done, total) => progress.show(tr(key, done, total), from + (total ? (done / total) * (to - from) : to - from));
  try {
    const favs = await Favorites.list();
    const shown = new Set(state.tiles.map((t) => t.videoId).filter(Boolean));
    const shownNames = new Set(visibleIndexes().map((j) => state.tiles[j].label).filter(Boolean));
    const random = (list) => list[Math.floor(Math.random() * list.length)];
    // ①② ライブ配信中 (配信予定は除く)
    const { lives } = await collectLiveFavorites({ target: 'all', onProgress: step('progressStatus', 0, 0.55) });
    const liveOk = lives.filter((l) => l.st.state === 'live' && !shown.has(l.st.videoId) && !shownInOtherTab(l.st.videoId));
    for (const group of [liveOk.filter((l) => l.f.star), liveOk.filter((l) => !l.f.star)]) {
      // メンバー限定で見られないものは飛ばす (ランダムな順で 1 本見つかるまで確かめる)
      const shuffled = [...group].sort(() => Math.random() - 0.5);
      const { ok } = await filterAccessible(shuffled, { limit: 1, onProgress: step('progressAccess', 0.55, 0.7) });
      if (ok.length) {
        const { f, st } = ok[0];
        loadPicked(i, st.videoId, f.handle || f.channelId, f.name, true);
        return;
      }
    }
    // ③④ 最近の配信 (同じチャンネルが表示中なら除く)
    const watched = await watchedIds();
    const usable = ({ v, f }) => !shown.has(v.videoId) && !watched.has(v.videoId) && !shownNames.has(f.name) && !shownInOtherTab(v.videoId);
    const [starChs, otherChs] = [favs.filter((f) => f.star), favs.filter((f) => !f.star)];
    const archFrom = (chs) => (chs === starChs ? 0.7 : 0.7 + 0.3 * (starChs.length / Math.max(1, favs.length)));
    for (const chs of [starChs, otherChs]) {
      const from = archFrom(chs);
      const to = from + 0.3 * (chs.length / Math.max(1, favs.length));
      const picks = (await archiveCandidates(chs, { onProgress: step('progressArchive', from, to) })).filter(usable);
      if (picks.length) {
        const { v, f } = random(picks);
        loadPicked(i, v.videoId, `${YT}/watch?v=${v.videoId}`, f.name, false);
        return;
      }
    }
    showToast(i, tr('pickNothing'));
  } catch (e) {
    showToast(i, tr('statusFailed', e.message || e));
  } finally {
    progress.hide();
    pickBusy = false;
    btn.disabled = false;
  }
}

/** 空き枠の中に出す、🎲 おまかせの進み具合 (frac = 0〜1) */
function pickProgress(i) {
  const box = views[i].el.querySelector('.pick-progress');
  return {
    show(text, frac) {
      box.hidden = false;
      box.querySelector('.pick-progress-text').textContent = text;
      box.querySelector('.pick-progress-bar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    },
    hide() {
      box.hidden = true;
    },
  };
}

function loadPicked(i, videoId, input, label, live) {
  setTileVideo(i, videoId, input);
  state.tiles[i].label = label;
  updateTileName(i);
  updateFavButton(i);
  save();
  showToast(i, tr(live ? 'pickedLive' : 'pickedArchive', label));
}

/** 中身のある枠だけを今の並び順のまま残し、その件数に合ったレイアウトにする */
function compactToContent() {
  const filled = visibleIndexes().filter((i) => state.tiles[i].videoId);
  if (filled.length === 0) {
    layout();
    return;
  }
  state.layoutId = chooseLayoutFor(filled.length).id;
  state.order = [...filled, ...state.order.filter((j) => !filled.includes(j))];
  renderAll();
  save();
}

/** 1 回分の確認: 配信が始まったチャンネルの枠を足し、終わった配信の枠を消してレイアウトを組み替える */
async function autoTick() {
  if (!state.autoMode || autoBusy) return;
  autoBusy = true;
  try {
    await autoTickOnce();
  } finally {
    autoBusy = false;
  }
}

function autoTickOnce() {
  return withAutoLock(autoTickOnceInner);
}

async function autoTickOnceInner() {
  try {
    const collected = await collectLiveFavorites({ force: true, auto: true, target: state.settings.autoTarget });
    const { failedKeys } = collected;
    const auto = autoTargets(collected); // 配信中 + まもなく始まる予定 (配信中が無ければ近い予定)
    const lives = state.settings.autoArchive && auto.fallback ? auto.targets.filter(isSoonUpcoming) : auto.targets;
    const liveIds = new Set(lives.map((l) => l.st.videoId));
    const visible = visibleIndexes().filter((i) => state.tiles[i].videoId);

    // 終わった配信 (自動で入れた枠だけ。その配信のチャンネルの取得に失敗した回は消さない)
    const ended = [];
    for (const i of visible) {
      const t = state.tiles[i];
      if (liveIds.has(t.videoId)) {
        autoMissing.delete(t.videoId);
        continue;
      }
      // 自動で入れた枠だけ。その配信のチャンネルの取得に失敗した回は消さない
      if (!t.auto) continue;
      const m = views[i].meta;
      if ([t.input, m?.handle, m?.channelId].some((k) => k && failedKeys.has(favKey(k)))) continue;
      const n = (autoMissing.get(t.videoId) || 0) + 1;
      autoMissing.set(t.videoId, n);
      if (n >= AUTO_MISS_LIMIT) ended.push(i);
    }

    // 始まった配信 (まだ表示していないもの。自分で閉じたものは除く)
    const shownIds = new Set(visible.map((i) => state.tiles[i].videoId));
    let keep = visible.filter((i) => !ended.includes(i));
    // 別のタブで表示中の配信は足さない (複数のディスプレイで分けて見るときに、同じ配信が両方に入らないように)
    // 空きが足りないときに、ピックアップ (📌) のライブ配信が押し出されないよう先にする
    const isPickLive = (l) => !!l.f.star && l.st.state === 'live';
    const candidates = pickupFirst(
      lives.filter((l) => !shownIds.has(l.st.videoId) && !autoDismissed.has(l.st.videoId) && !shownInOtherTab(l.st.videoId)),
      isPickLive,
    );
    // メンバー限定の確認は、まだ表示していない配信だけ (表示中のものは枠のプレイヤーが知らせてくる)
    // 最近の配信で埋めた枠は、ライブが始まったら明け渡すので空きとして数える
    const room = Math.max(0, autoMaxTiles() - keep.filter((i) => !state.tiles[i].fill).length);
    const { ok: accessible, blocked } = await filterAccessible(candidates, { limit: room });
    if (!state.autoMode) return; // 確認している間に OFF にされた
    // 最大の枠数 (設定) を超えて足さない。設定を減らしても、表示中の枠は消さない (終わったものから減っていく)
    const started = accessible.slice(0, room);
    // ライブが始まる → 最近の配信の枠は片付けて、空いた枠にライブを入れる
    const fillTiles = keep.filter((i) => state.tiles[i].fill);
    if (started.length && fillTiles.length) {
      for (const i of fillTiles) {
        WatchHistory.removed(state.tiles[i].videoId, 'replaced');
        state.tiles[i] = newTileState();
        views[i].danmaku.clear();
      }
      keep = keep.filter((i) => !fillTiles.includes(i));
    }
    const blockedMsg = blocked.length ? tr('membersSkipped', blocked.join(tr('sep'))) : '';

    if (ended.length === 0 && started.length === 0) {
      if (blockedMsg) notify(blockedMsg);
      await refillArchives({ lock: false });
      return;
    }

    const audibleBefore = audibleTiles();
    // 外す枠のうち、まだ始まっていない配信予定の枠 (配信中のものが出てきたので片付ける) は「配信終了」と分けて知らせる
    const upcomingIds = new Set(collected.upcoming.map((u) => u.st.videoId));
    const nameOf = (i) => state.tiles[i].label || views[i].meta?.channel || state.tiles[i].input;
    const endedNames = ended.filter((i) => !upcomingIds.has(state.tiles[i].videoId)).map(nameOf);
    const clearedNames = ended.filter((i) => upcomingIds.has(state.tiles[i].videoId)).map(nameOf);
    for (const i of ended) {
      const vid = state.tiles[i].videoId;
      autoMissing.delete(vid);
      WatchHistory.removed(vid, upcomingIds.has(vid) ? 'replaced' : 'ended');
      state.tiles[i] = newTileState();
      views[i].danmaku.clear();
    }

    // 新しい配信は空いている枠に入れて、今の並びの後ろ (サブ側) に足す
    // (空の枠を優先。足りなければ、今のレイアウトで隠れている枠の中身を上書きする)
    const others = state.order.filter((j) => !keep.includes(j));
    const free = [...others.filter((j) => !state.tiles[j].videoId), ...others.filter((j) => state.tiles[j].videoId)];
    const added = started.map((l, k) => {
      const i = free[k];
      if (state.tiles[i].videoId) WatchHistory.removed(state.tiles[i].videoId, 'replaced');
      Object.assign(state.tiles[i], {
        ...newTileState(),
        input: l.f.handle || l.f.channelId,
        label: l.f.name,
        videoId: l.st.videoId,
        auto: true,
      });
      views[i].danmaku.clear();
      return i;
    });
    let nextVisible = [...keep, ...added];
    if (nextVisible.length > 0) {
      const next = chooseLayoutFor(nextVisible.length);
      // ピックアップ (📌) のライブ配信がサブ枠にあれば、メイン枠と入れ替える (今始まったもの・前から表示していたもの)
      const liveNow = new Set(collected.lives.map((l) => l.st.videoId));
      const pickAdded = new Set(added.filter((i, k) => isPickLive(started[k])));
      const isPick = (i) => pickAdded.has(i) || (keep.includes(i) && liveNow.has(state.tiles[i].videoId) && pickedChannelOf(i) != null);
      nextVisible = promotePickups(nextVisible, next.mains, isPick);
      state.layoutId = next.id;
      state.order = [...nextVisible, ...state.order.filter((j) => !nextVisible.includes(j))];
    }
    if (document.fullscreenElement && ended.some((i) => views[i].el === document.fullscreenElement)) {
      document.exitFullscreen().catch(() => {});
    }
    for (const i of added) renderTile(i, { reloadPlayer: true, reloadChat: true });

    // 音: 聞いていた枠が残っていればそのまま。聞いていた枠が終わった / 何も無かったところに来たら 1 番の枠
    const stillAudible = audibleBefore.filter((i) => nextVisible.includes(i) && state.tiles[i].videoId);
    if (stillAudible.length) setAudioSet(stillAudible);
    else if (nextVisible.length && (audibleBefore.length > 0 || keep.length === 0)) setAudioSet([nextVisible[0]]);
    else refreshAudio();
    renderAll();
    save();

    const msgs = [];
    const startedLive = started.filter((l) => l.st.state !== 'upcoming');
    const startedSoon = started.filter((l) => l.st.state === 'upcoming');
    if (startedLive.length) msgs.push(tr('started', startedLive.map((l) => l.f.name).join(tr('sep'))));
    if (startedSoon.length) msgs.push(tr('soonAdded', startedSoon.map(targetLabel).join(tr('sep'))));
    if (endedNames.length) msgs.push(tr('ended', endedNames.join(tr('sep'))));
    if (clearedNames.length) msgs.push(tr('upcomingCleared', clearedNames.join(tr('sep'))));
    if (blockedMsg) msgs.push(blockedMsg);
    notify(msgs.join(' / '));
    await refillArchives({ lock: false });
  } catch (e) {
    console.warn('hakomado: 自動再生の確認に失敗', e);
  }
}

// ---------------------------------------------------------------- 自動再生: 配信中が 1 本も無いときは、最近の配信を流す
// 設定「配信中が無いときは、最近の配信を流す」が ON のときだけ。深夜など、ライブが無い時間帯の代わりに
// 最近終わった配信を ARCHIVE_IDLE_TILES 枠流す。ライブが始まったら片付けて、ライブだけにする。
// ピックアップ (📌) のチャンネルを先に、1 チャンネル 1 枠、一度見たもの (視聴履歴にあるもの) は入れない
const ARCHIVE_IDLE_TILES = 4;
// 取得に失敗したチャンネルは、しばらく取りに行かない (何度も失敗を繰り返して YouTube に負担をかけないように)
const archiveFailedAt = new Map(); // channelId -> 失敗した時刻
const ARCHIVE_RETRY_MS = 5 * 60 * 1000;

/**
 * 最近の配信の候補 (新しい順)。毎回 Favorites.fetchArchives に聞く (30 分は覚えた結果を返すので、取りに行くのは古くなったときだけ)。
 * 自動再生を一晩つけっぱなしにしても、新しく終わった配信が候補に入る
 */
async function archiveCandidates(channels, { onProgress = null } = {}) {
  const since = Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  const queue = channels.filter((f) => Date.now() - (archiveFailedAt.get(f.channelId) || 0) > ARCHIVE_RETRY_MS);
  const total = queue.length;
  let done = 0;
  if (total) onProgress?.(0, total); // 全部取得に失敗したばかりで取りに行くものが無いときは出さない
  const out = [];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      let d;
      try {
        d = await Favorites.fetchArchives(f.channelId);
        archiveData.set(f.channelId, d);
        archiveFailedAt.delete(f.channelId);
      } catch {
        archiveFailedAt.set(f.channelId, Date.now());
        continue;
      } finally {
        onProgress?.(++done, total);
      }
      for (const v of d) if (v.at >= since && isFinishedArchive(v, f)) out.push({ v, f });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out.sort((a, b) => b.v.at - a.v.at);
}

/** 視聴履歴にある動画 ID (一度見たもの) */
async function watchedIds() {
  return new Set((await WatchHistory.list()).map((h) => h.videoId));
}

/** 今表示している枠を、ライブ (最近の配信以外) と最近の配信に分ける */
function splitArchiveTiles() {
  const visible = visibleIndexes().filter((i) => state.tiles[i].videoId);
  return { lives: visible.filter((i) => !state.tiles[i].fill), fills: visible.filter((i) => state.tiles[i].fill) };
}

/**
 * 最近の配信の枠を、あるべき数にそろえる。ライブが 1 本でもある・設定が OFF なら 0 枠、ライブが無ければ ARCHIVE_IDLE_TILES 枠。
 * 数が合っていれば何もしない (レイアウトにも触らない。自分で足した空き枠を消さないように)。
 * 候補を探す間 (フィードを取りに行くので時間がかかる) に枠の中身が変わることがあるので、入れる直前に今の状態を見直す
 * @returns {Promise<number>} 最近の配信の枠の数
 */
async function refillArchives({ lock = true } = {}) {
  if (!state.autoMode) return 0;
  const run = async () => {
    if (!state.autoMode) return 0; // 順番待ちの間に OFF にされた
    let { lives, fills } = splitArchiveTiles();
    const wantNow = () => (!state.settings.autoArchive || lives.length ? 0 : Math.min(ARCHIVE_IDLE_TILES, autoMaxTiles()));
    let want = wantNow();
    if (fills.length === want) return fills.length;

    if (fills.length > want) {
      // 多すぎる (ライブが来た・設定が OFF になった) → 後ろから外す
      for (const i of fills.slice(want)) {
        WatchHistory.removed(state.tiles[i].videoId, 'replaced');
        state.tiles[i] = newTileState();
        views[i].danmaku.clear();
      }
      fills = fills.slice(0, want);
    } else {
      // 足りない → 足す (ピックアップ → すべて)
      const favs = await Favorites.list();
      const watched = await watchedIds();
      const need = want - fills.length;
      const usable = ({ v }) => !watched.has(v.videoId) && !autoDismissed.has(v.videoId) && !shownInOtherTab(v.videoId);
      let picks = (await archiveCandidates(favs.filter((f) => f.star))).filter(usable);
      // 1 チャンネル 1 枠なので、ピックアップのチャンネル数で足りなければ、すべてのチャンネルからも探す
      if (new Set(picks.map((p) => p.f.channelId)).size < need) {
        picks = [...picks, ...(await archiveCandidates(favs.filter((f) => !f.star))).filter(usable)];
      }
      // 探している間に変わったかもしれないので、今の状態で数え直す
      if (!state.autoMode) return 0;
      ({ lives, fills } = splitArchiveTiles());
      want = wantNow();
      if (fills.length >= want) return fills.length; // 次の確認でそろえる
      const shown = new Set(state.tiles.map((t) => t.videoId).filter(Boolean));
      // 同じチャンネルの配信は同時に流さない (1 チャンネル 1 枠。ライブで表示中のチャンネルも除く)
      const busy = new Set([...lives, ...fills].map((i) => state.tiles[i].label).filter(Boolean));
      // 入れる先は空いている枠だけ (自分で読み込んだ枠を上書きしない)。隠れている枠を先に使う
      const empty = state.order.filter((j) => !state.tiles[j].videoId);
      const free = [...empty.filter((j) => !isVisible(j)), ...empty.filter((j) => isVisible(j))];
      let added = 0;
      for (const { v, f } of picks) {
        if (fills.length >= want) break;
        if (busy.has(f.name) || shown.has(v.videoId)) continue;
        const i = free.shift();
        if (i == null) break;
        busy.add(f.name);
        added++;
        Object.assign(state.tiles[i], { ...newTileState(), input: `${YT}/watch?v=${v.videoId}`, videoId: v.videoId, label: f.name, fill: true });
        views[i].danmaku.clear();
        renderTile(i, { reloadPlayer: true, reloadChat: true });
        fills.push(i);
      }
      if (!added) return fills.length;
    }
    // 並び: ライブ (メイン側) → 最近の配信。枠の数が変わったら、その数に合ったレイアウトに
    const next = [...lives, ...fills];
    if (next.length) {
      state.layoutId = chooseLayoutFor(next.length).id;
      state.order = [...next, ...state.order.filter((j) => !next.includes(j))];
      if (!audibleTiles().length) setAudioSet([next[0]]);
    }
    renderAll();
    save();
    return fills.length;
  };
  return lock ? withAutoLock(run) : run();
}

// ---------------------------------------------------------------- cruise
// クルーズ: 一定時間ごとに、表示中の配信の並びを 1 つずつ回す (サブ枠の先頭がメイン枠へ、メイン枠は最後尾へ)。
// 音声はメイン枠 (1 番) に付いていく。均等レイアウトでは並びはそのままで、音声だけ次の枠へ移る。
// 枠の要素は動かさず CSS の位置だけ変えるので、配信は読み込み直さない。

let cruiseTimer = 0;

function formatCruise(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return tr('sec', s);
  return s ? tr('minSec', m, s) : tr('min', m);
}

function setCruise(on) {
  state.cruise = on;
  setToggle(document.getElementById('cruise'), on);
  save();
  // ON にしただけではレイアウトは変えない (空き枠もそのまま。回すのは中身のある枠だけ)
  restartCruise();
  if (on) notify(tr('cruiseOn', formatCruise(state.settings.cruiseSec)));
}

/** 次に回すまでの時間を最初から数え直す (自分で音や並びを変えた直後に回さないため) */
function restartCruise() {
  clearTimeout(cruiseTimer);
  cruiseTimer = 0;
  const bar = document.querySelector('#cruise .cruise-progress');
  if (!state.cruise) return;
  const sec = Math.min(1800, Math.max(10, Number(state.settings.cruiseSec) || 120));
  cruiseTimer = setTimeout(cruiseStep, sec * 1000);
  // ボタン全体が左から満ちていく表示で、次に回すまでの時間を見せる
  if (bar) {
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
    bar.style.setProperty('--cruise-dur', `${sec}s`);
  }
}

function cruiseStep() {
  cruiseTimer = 0;
  if (!state.cruise) return;
  // 1 枠だけ全画面で見ている / ドラッグ中は回さない (待って次の回に)
  if (!isTileFullscreen() && !document.body.classList.contains('dragging')) rotateCruise();
  restartCruise();
}

function rotateCruise() {
  const vis = visibleIndexes();
  const pos = vis.map((_, k) => k).filter((k) => state.tiles[vis[k]].videoId); // 中身のある場所
  if (pos.length < 2) return;
  const tiles = pos.map((k) => vis[k]);
  const muted = audibleTiles().length === 0; // 全部ミュート中なら音は出さないまま
  let target;
  if (state.layout.mains > 0) {
    const rotated = [...tiles.slice(1), tiles[0]];
    pos.forEach((k, n) => (state.order[k] = rotated[n]));
    layout();
    target = rotated[0];
  } else {
    const cur = tiles.indexOf(audibleTiles()[0]);
    target = tiles[(cur + 1) % tiles.length];
  }
  if (!muted) {
    state.tiles.forEach((t, j) => (t.muted = j !== target));
    refreshAudio();
  }
  save();
}

// ---- 自動再生を始めるときの進み具合 (画面中央。大きさは固定で、文字や数が変わっても動かない)
function showAutoProgress(text, frac) {
  const box = document.getElementById('autoProgress');
  box.hidden = false;
  document.getElementById('autoProgressText').textContent = text;
  const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
  document.getElementById('autoProgressBar').style.width = `${pct}%`;
  document.getElementById('autoProgressPct').textContent = `${pct}%`;
}

function hideAutoProgress() {
  document.getElementById('autoProgress').hidden = true;
}

// ---------------------------------------------------------------- 通知 (チャンネルの配信開始)
// 画面を開いている間、通知の対象 (設定: チャンネル全部 / ピックアップだけ / 知らせない) の配信状況を 1 分ごとに確認し、
// 前の確認では配信していなかった配信が始まったら「配信開始」の通知を残す。開いた時点で配信中のものは知らせない。
// 通知は chrome.storage.local に新しい順で 50 件まで残し、すべてのタブで共有する (同じ配信は 1 件だけ)
const NOTICE_KEY = 'notices';
const NOTICE_MAX = 50;
const NOTICE_INTERVAL_MS = 60 * 1000;
let knownLive = null; // 前の確認で配信中だった videoId (null = まだ 1 回も確認していない)
let noticeTimer = 0;
let noticeBusy = false;

async function readNotices() {
  const { [NOTICE_KEY]: raw } = await chrome.storage.local.get(NOTICE_KEY);
  return Array.isArray(raw)
    ? raw.filter((n) => n && typeof n.videoId === 'string' && ID_RE.test(n.videoId)).map((n) => ({
        ...n,
        name: String(n.name ?? ''),
        title: String(n.title ?? ''),
        handle: String(n.handle ?? ''),
        channelId: String(n.channelId ?? ''),
      }))
    : [];
}

function mutateNotices(fn) {
  const run = async () => {
    const next = fn(await readNotices());
    if (next) await chrome.storage.local.set({ [NOTICE_KEY]: next.slice(0, NOTICE_MAX) });
  };
  return navigator.locks
    .request('hakomado-notices', run)
    .catch((e) => console.warn('hakomado: 通知の保存に失敗', e))
    .then(updateNoticeBadge);
}

/**
 * 確認の結果から、新しく始まった配信を見つけて通知に残す。
 * quiet = 画面下の短いお知らせは出さない (自動再生が別に知らせるとき) / baselineOnly = 今の状態を覚えるだけ
 */
function detectStarts(collected, { quiet = false, baselineOnly = false } = {}) {
  const lives = collected.lives || [];
  const now = new Set(lives.map((l) => l.st.videoId));
  const started = knownLive && !baselineOnly ? lives.filter((l) => !knownLive.has(l.st.videoId)) : [];
  // 取得に失敗したチャンネルは「配信していない」とは限らないので、前の状態を残す
  if (knownLive) {
    for (const id of knownLive) {
      const l = lives.find((x) => x.st.videoId === id);
      if (!l && collected.errors) now.add(id);
    }
  }
  knownLive = now;
  if (!started.length) return;
  // 自動再生が枠に入れる配信は、自動再生が「配信開始」と知らせるので、画面下のお知らせは出さない
  const byAuto = (l) => state.autoMode && (state.settings.autoTarget !== 'fav' || l.f.star);
  const announce = started.filter((l) => !byAuto(l));
  mutateNotices((list) => {
    const fresh = started.filter((l) => !list.some((n) => n.videoId === l.st.videoId));
    if (!fresh.length) return null;
    const add = fresh.map((l) => ({
      videoId: l.st.videoId,
      channelId: l.f.channelId,
      handle: l.f.handle || '',
      name: l.f.name,
      title: l.st.title || '',
      at: Date.now(),
      read: false,
    }));
    return [...add, ...list];
  });
  if (!quiet && announce.length) notify(tr('noticeStarted', announce.map((l) => l.f.name).join(tr('sep'))));
}

/** 通知のための確認 (取得結果はタブ間・自動再生の確認と共有されるので、取りに行く回数はほとんど増えない) */
async function noticeTick() {
  if (noticeBusy) return;
  if (state.settings.noticeTarget === 'off') {
    knownLive = null;
    return;
  }
  noticeBusy = true;
  try {
    detectStarts(await collectLiveFavorites({ auto: true, target: state.settings.noticeTarget }));
  } catch (e) {
    console.warn('hakomado: 通知の確認に失敗', e);
  } finally {
    noticeBusy = false;
  }
}

function startNoticeWatch() {
  clearInterval(noticeTimer);
  noticeTimer = setInterval(noticeTick, NOTICE_INTERVAL_MS);
  noticeTick();
}

/** 上部バーの「通知」の未読数 */
async function updateNoticeBadge() {
  const unread = (await readNotices()).filter((n) => !n.read).length;
  const badge = document.getElementById('noticeBadge');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.hidden = unread === 0;
}

const noticeDialog = document.getElementById('notices');

async function renderNotices() {
  const list = await readNotices();
  const ul = document.getElementById('noticeList');
  ul.replaceChildren(
    ...list.map((n) => {
      const li = document.createElement('li');
      li.className = 'notice-item' + (n.read ? '' : ' unread');
      li.title = tr('historyPick');
      const head = document.createElement('div');
      head.className = 'notice-head';
      const name = document.createElement('span');
      name.className = 'notice-name';
      name.textContent = n.name;
      const when = document.createElement('span');
      when.className = 'notice-when';
      when.textContent = [tr('noticeAt', formatStart(n.at)), whereShown(n.videoId)]
        .filter(Boolean)
        .join(' ・ ');
      head.append(name, when);
      const title = document.createElement('div');
      title.className = 'notice-title';
      title.textContent = n.title || '';
      li.append(head, title);
      li.addEventListener('click', () => {
        noticeDialog.close();
        if (visibleIndexes().some((i) => state.tiles[i].videoId === n.videoId)) return; // もう表示している
        favTarget = null;
        loadFromHistory({ videoId: n.videoId, input: n.handle || `https://www.youtube.com/channel/${n.channelId}`, label: n.name });
      });
      return li;
    }),
  );
  document.getElementById('noticeEmpty').hidden = list.length > 0;
  document.getElementById('noticeClear').hidden = list.length === 0;
}

function setupNotices() {
  document.getElementById('openNotices').addEventListener('click', async () => {
    await renderNotices();
    noticeDialog.showModal();
    // 開いたら全部既読にする (一覧の「未読」の印は開いている間は残す)
    mutateNotices((list) => (list.some((n) => !n.read) ? list.map((n) => ({ ...n, read: true })) : null));
  });
  document.getElementById('noticeClose').addEventListener('click', () => noticeDialog.close());
  document.getElementById('noticeClear').addEventListener('click', async () => {
    await mutateNotices(() => []);
    renderNotices();
  });
  closeOnBackdrop(noticeDialog);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[NOTICE_KEY]) return;
    updateNoticeBadge();
  });
  updateNoticeBadge();
}

/** 画面下中央に短いお知らせを出す */
function notify(text) {
  const el = document.getElementById('globalToast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3500);
}

function setupFavorites() {
  document.getElementById('openChannels').addEventListener('click', () => openFavorites(null, 'channels'));
  document.getElementById('queuePlay').addEventListener('click', () => startQueue());
  document.getElementById('plSelect').addEventListener('change', (e) => {
    selectPlaylist(e.target.value);
    renderVideoList();
  });
  document.getElementById('plNew').addEventListener('click', newPlaylist);
  document.getElementById('plFromTiles').addEventListener('click', () => playlistFromTiles());
  document.getElementById('plImport').addEventListener('click', () => openReadDialog({ primary: 'save' }));
  document.getElementById('openFavorites').addEventListener('click', () => openFavorites(null, 'library'));
  document.getElementById('favClose').addEventListener('click', () => favDialog.close());
  document.getElementById('favRefresh').addEventListener('click', () => {
    if (favMode === 'archive') renderArchiveTab({ force: true });
    else refreshFavorites(true);
  });
  for (const b of document.querySelectorAll('#libScope [data-scope]')) {
    b.addEventListener('click', () => setLibScope(b.dataset.scope));
  }
  document.getElementById('autoMode').addEventListener('click', () => setAutoMode(!state.autoMode));
  document.getElementById('cruise').addEventListener('click', (e) => {
    e.currentTarget.blur(); // 全画面中に上部バーを隠すため
    setCruise(!state.cruise);
  });
  // 背景クリックで閉じる
  closeOnBackdrop(favDialog);

  const form = document.getElementById('favAdd');
  const input = form.querySelector('input');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addFavorite(input.value, () => (input.value = ''));
  });

  // 名前・@ハンドル・グループで絞り込み
  const filter = document.getElementById('favFilter');
  filter.addEventListener('input', async () => {
    favFilter = filter.value;
    renderFavPane();
  });

  // ライブラリのタブ (最近の配信 / 視聴履歴 / あとで見る)
  for (const b of document.querySelectorAll('[data-favtab]')) b.addEventListener('click', () => setFavMode(b.dataset.favtab));
  setFavMode('all', { render: false });
  document.getElementById('historyClear').addEventListener('click', async () => {
    const n = (await WatchHistory.list()).length;
    if (!n || !confirm(tr('historyClearConfirm', n))) return;
    await WatchHistory.clear();
    renderVideoList();
  });

}

/** 枠の操作バーの 📌: この枠で見ている配信のチャンネルをピックアップに入れる / 外す */
async function addTileToFavorites(i) {
  // 枠のバーの 📌: ピックアップに入っていれば外す、入っていなければ入れる (チャンネル一覧にも登録)
  const t = state.tiles[i];
  if (!t.videoId) return;
  const btn = views[i].el.querySelector('[data-act="fav"]');
  btn.disabled = true;
  try {
    const picked = pickedChannelOf(i);
    if (picked) {
      const f = (await Favorites.list()).find((x) => x.channelId === picked);
      await Favorites.setStar(picked, false);
      showToast(i, tr('pickRemoved', f?.name || tileName(i)));
    } else {
      showToast(i, tr('favAdding'));
      const { info } = await Favorites.add(t.videoId, { star: true });
      favStatus.delete(info.channelId);
      showToast(i, tr('favAdded', info.name));
    }
    await refreshFavKeys();
  } catch (e) {
    showToast(i, tr('favAddFailed', e.message || e));
  } finally {
    btn.disabled = false;
  }
}

function showToast(i, text) {
  const el = views[i].el.querySelector('.toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2500);
}

async function addFavorite(raw, onSuccess) {
  favErrorEl.textContent = tr('adding');
  try {
    const { info, added } = await Favorites.add(raw, { star: libScope === 'star' }); // ピックアップで絞っているときはピックアップにも入れる
    favErrorEl.textContent = added ? '' : tr('favExists', info.name);
    onSuccess?.();
    favStatus.delete(info.channelId);
    await refreshFavorites(false);
  } catch (e) {
    favErrorEl.textContent = e.message || String(e);
  }
}

/** D キー: 全部の枠の弾幕を一時的に消す / 戻す */
function toggleDanmakuAll() {
  state.danmakuAll = !state.danmakuAll;
  renderAll();
  const first = visibleIndexes()[0];
  if (first != null) showToast(first, tr(state.danmakuAll ? 'danmakuAllOn' : 'danmakuAllOff'));
}

// ---------------------------------------------------------------- boot

async function registerTab() {
  // このタブだけに iframe 表示用のヘッダー書き換えルールを効かせる
  const res = await chrome.runtime.sendMessage({ type: 'register-grid-tab' });
  if (!res?.ok) console.warn('hakomado: ルールの登録に失敗しました', res);
  window.addEventListener('pagehide', () => {
    saveNow(); // 閉じる直前の状態 (音声の切り替えなど、まだ保存していない分) を残す
    chrome.runtime.sendMessage({ type: 'unregister-grid-tab' }).catch(() => {});
  });
  // ブラウザの「戻る」でこの画面に戻ってきた (ページが作り直されずに表示された) ときは、登録し直す
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    chrome.runtime.sendMessage({ type: 'register-grid-tab' }).catch(() => {});
    broadcastShown({ force: true });
  });
}

// ---------------------------------------------------------------- 起動 (視聴セッションの選択)
// タブ (ウィンドウ) ごとに別の視聴セッションを持つ。開いたときに、他のタブで使っていない
// 前回のセッションがあれば「続きから / 新しく / 自動再生で」を選ぶ。同じタブの再読み込みは確認なしで続ける

const sessionChannel = new BroadcastChannel('hakomado-sessions');
const SESSION_TAB_KEY = 'hakomado.sessionId'; // sessionStorage: このタブで使っていた視聴セッション (再読み込み用)

const SESSION_LOCK_PREFIX = 'hakomado-session:';
const START_CHOICE_KEY = 'hakomado.startChoice'; // sessionStorage: 開き直したときに始める内容 (ロゴのボタンで選んだもの)

let choosingStart = false;

/**
 * ロゴのボタン: 起動時と同じ選択画面 (ほかの保存内容で再開 / 新しく / 自動再生で) を出す。
 * キャンセル (Esc) なら何もしない。選んだら今の内容を保存してから開き直し、選んだ内容で始める
 * (今の内容は残るので、あとでまた選べる)
 */
async function backToStart() {
  if (choosingStart || !sessionId) return; // 起動の途中 (まだ視聴セッションが決まっていない) は受け付けない
  choosingStart = true;
  try {
    await saveNow(); // 今の内容も「この内容で再開」の候補と同じ形で比べられるように
    const inUse = await sessionsInUse();
    const resumable = (await listSessions())
      .filter((s) => s.id !== sessionId && !inUse.has(s.id) && describeSession(s.data).count > 0)
      .slice(0, 3);
    const choices = resumable.map((s) => ({ value: 'resume:' + s.id, label: tr('resumeThis'), note: describeSession(s.data).lines }));
    choices.push(
      { value: 'new', label: tr('startNew'), note: tr('startNewNote') },
      { value: 'auto', label: tr('startAuto'), note: tr('startAutoNote') },
    );
    const choice = await askChoice({ title: tr('chooseTitle'), body: [], choices, cancelValue: 'cancel' });
    if (!choice || choice === 'cancel') return;
    // 開き直す前に書き終えておく (閉じる直前の保存だけだと、次のページが読むまでに間に合わないことがある)
    try {
      await Promise.all([saveNow(), dirtySettings.size ? writeSettings() : null, savePlaylistResume()]);
    } catch (e) {
      console.warn('hakomado: 保存に失敗しました', e);
    }
    try {
      sessionStorage.removeItem(SESSION_TAB_KEY);
      sessionStorage.setItem(START_CHOICE_KEY, choice);
    } catch {
      return; // 選んだものを次のページに渡せないなら、開き直さない
    }
    location.replace(location.pathname); // 取り込み・追加のリンク (#…) は付けない
  } finally {
    choosingStart = false;
  }
}

/**
 * この視聴セッションを「このタブで使用中」として押さえる (タブを閉じるまで離さない)。
 * 他のタブがすでに押さえていれば false (2 つのタブが同時に開いて、同じセッションを選んだときなど)
 */
function claimSession(id) {
  return new Promise((resolve) => {
    navigator.locks
      .request(SESSION_LOCK_PREFIX + id, { ifAvailable: true }, async (lock) => {
        resolve(!!lock);
        if (lock) await new Promise(() => {}); // タブが閉じると自動で離れる
      })
      .catch(() => resolve(true));
  });
}

/** 他のタブで使用中の視聴セッション ID を集める (押さえているもの + 問い合わせに答えたもの) */
async function sessionsInUse() {
  const held = new Set();
  try {
    for (const l of (await navigator.locks.query()).held || []) {
      if (l.name?.startsWith(SESSION_LOCK_PREFIX)) held.add(l.name.slice(SESSION_LOCK_PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  const asked = await askSessionsInUse();
  return new Set([...held, ...asked]);
}

function askSessionsInUse() {
  return new Promise((resolve) => {
    const ids = new Set();
    const onMessage = (e) => e.data?.type === 'in-use' && e.data.sessionId && ids.add(e.data.sessionId);
    sessionChannel.addEventListener('message', onMessage);
    sessionChannel.postMessage({ type: 'who' });
    setTimeout(() => {
      sessionChannel.removeEventListener('message', onMessage);
      resolve(ids);
    }, 300);
  });
}

// ---- 別のタブ (hakomado を複数開いて複数のディスプレイで見るときなど) で表示中の配信
// 各タブは、表示中の配信が変わるたび (保存のたび) と 30 秒ごとに知らせ合う。90 秒知らせが無いタブは閉じたものとみなす
const OTHER_TAB_TTL_MS = 90 * 1000;
const otherTabs = new Map(); // sessionId -> {ids: Set<videoId>, at}
let lastShownSent = '';

function broadcastShown({ force = false } = {}) {
  if (!sessionId) return;
  const ids = [...new Set(visibleIndexes().map((i) => state.tiles[i].videoId).filter(Boolean))];
  const key = ids.join(',');
  if (!force && key === lastShownSent) return;
  lastShownSent = key;
  sessionChannel.postMessage({ type: 'shown', sessionId, ids });
}

/** 別のタブで表示中か */
function shownInOtherTab(videoId) {
  if (!videoId) return false;
  const now = Date.now();
  for (const [id, t] of otherTabs) {
    if (now - t.at > OTHER_TAB_TTL_MS) otherTabs.delete(id);
    else if (t.ids.has(videoId)) return true;
  }
  return false;
}

/** 一覧に出す「枠 2 で表示中」「別のタブで表示中」 */
function whereShown(videoId) {
  const shownIn = visibleIndexes().filter((i) => state.tiles[i].videoId === videoId);
  const parts = [];
  if (shownIn.length) parts.push(tr('shownIn', shownIn.map(displayNumber).join(', ')));
  if (shownInOtherTab(videoId)) parts.push(tr('shownInOtherTab'));
  return parts.join(' ・ ');
}

let otherTabsRenderQueued = false;
function onOtherTabsChanged() {
  if (otherTabsRenderQueued) return;
  otherTabsRenderQueued = true;
  // 画面が隠れている間も反映されるよう、描画のタイミングではなくタイマーでまとめる
  setTimeout(() => {
    otherTabsRenderQueued = false;
    for (let i = 0; i < MAX_TILES; i++) updateTileName(i);
    if (favDialog.open) {
      if (isVideoMode()) renderVideoList();
      else scheduleFavRender();
    }
    if (noticeDialog.open) renderNotices();
  }, 50);
}

setInterval(() => broadcastShown({ force: true }), 30 * 1000);
window.addEventListener('pagehide', () => sessionId && sessionChannel.postMessage({ type: 'bye', sessionId }));

sessionChannel.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.sessionId === sessionId) return;
  if (d.type === 'shown' && Array.isArray(d.ids)) {
    otherTabs.set(d.sessionId, { ids: new Set(d.ids.filter((x) => typeof x === 'string')), at: Date.now() });
    onOtherTabsChanged();
  } else if (d.type === 'bye') {
    if (otherTabs.delete(d.sessionId)) onOtherTabsChanged();
  }
});

// 後から開いたタブからの問い合わせに、このタブの視聴セッションと表示中の配信を答える
sessionChannel.addEventListener('message', (e) => {
  if (e.data?.type !== 'who' || !sessionId) return;
  sessionChannel.postMessage({ type: 'in-use', sessionId });
  broadcastShown({ force: true });
});

/** 選択肢を出して、選ばれたものの value を返す (Esc では閉じない) */
/** cancelValue を渡すと右上に ✕ を出し、✕ と Esc でその値を返して閉じる (渡さなければ Esc でも閉じない) */
function askChoice({ title, body, choices, cancelValue = null }) {
  const dialog = document.getElementById('startDialog');
  // 押したボタンで答えを返す (画面が隠れていると close イベントが遅れることがあるので、close は予備)
  let done;
  const answered = new Promise((resolve) => (done = resolve));
  document.getElementById('startTitle').textContent = title;
  document.getElementById('startBody').replaceChildren(...(Array.isArray(body) ? body : [body]));
  const wrap = document.getElementById('startChoices');
  wrap.replaceChildren(
    ...choices.map((c, n) => {
      const b = document.createElement('button');
      b.value = c.value;
      b.className = n === 0 ? 'primary' : '';
      b.addEventListener('click', () => done(c.value));
      const strong = document.createElement('strong');
      strong.textContent = c.label;
      b.append(strong);
      // note は文字列か、行ごとの配列 (長い行は 1 行ずつ「…」で省略)
      for (const line of [].concat(c.note || [])) {
        const small = document.createElement('small');
        small.textContent = line;
        small.title = line;
        b.append(small);
      }
      return b;
    }),
  );
  const cancelable = cancelValue != null;
  const cancel = () => {
    done(cancelValue);
    dialog.close(cancelValue);
  };
  const onCancel = (e) => {
    e.preventDefault();
    if (cancelable) cancel();
  };
  const closeBtn = document.getElementById('startClose');
  closeBtn.hidden = !cancelable;
  closeBtn.onclick = cancelable ? cancel : null;
  dialog.addEventListener('cancel', onCancel);
  dialog.showModal();
  // 閉じられるときは ✕ にフォーカス (Enter の押し間違いで新しく始めないように)
  (cancelable ? closeBtn : wrap.firstElementChild)?.focus();
  // 前の問いの close が遅れて届いても取り違えないよう、閉じている時だけ受け取る
  const onClose = () => {
    if (!dialog.open) done(dialog.returnValue);
  };
  dialog.addEventListener('close', onClose);
  answered.then(() => {
    dialog.removeEventListener('close', onClose);
    dialog.removeEventListener('cancel', onCancel);
  });
  return answered;
}

const SESSION_NAMES_SHOWN = 5; // 再開画面に名前を出す件数 (それ以上は「ほか N 件」)

/** 保存されたセッションの説明。lines = [「11/20 01:29・1 + 2・3 件」, 名前 (1 行 1 件、最大 5 件), 「ほか N 件」] */
function describeSession(data) {
  const layoutName = getLayout(savedLayoutId(data)).name;
  const order = isPermutation(data.order) ? data.order : Array.from({ length: MAX_TILES }, (_, i) => i);
  const audible = new Set(Array.isArray(data.audible) ? data.audible : []);
  const shownIdx = order.slice(0, savedVisibleCount(data)).filter((i) => data.tiles?.[i]?.videoId);
  const shown = shownIdx.map((i) => data.tiles[i]);
  // 音が出ていた配信には 🔊 を付ける
  const names = shownIdx.map((i) => (audible.has(i) ? '🔊 ' : '') + (data.tiles[i].label || data.tiles[i].input || data.tiles[i].videoId));
  const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString(LANG === 'ja' ? 'ja-JP' : undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const lines = [
    [when, layoutName, tr('streams', shown.length), data.autoMode ? tr('autoTag') : ''].filter(Boolean).join(' ・ '),
    ...names.slice(0, SESSION_NAMES_SHOWN).map((n) => `・${n}`),
  ];
  if (names.length > SESSION_NAMES_SHOWN) lines.push(tr('more', names.length - SESSION_NAMES_SHOWN));
  return { count: shown.length, lines };
}

/** 以前の版 (セッションに分ける前) の保存内容を、視聴セッション 1 つに移す */
async function migrateLegacyStorage() {
  const old = await chrome.storage.local.get(['layoutId', 'order', 'fit', 'autoMode', 'danmakuAll', 'tiles']);
  if (!Object.keys(old).length) return;
  await chrome.storage.local.set({ [SESSION_PREFIX + newSessionId()]: { ...old, updatedAt: Date.now() - 1 } });
  await chrome.storage.local.remove(Object.keys(old));
}

/** このタブで使う視聴セッションを決めて読み込む。戻り値: 自動再生を最初から始めるか */
async function chooseSession() {
  await migrateLegacyStorage();
  const inUse = await sessionsInUse();
  const allSessions = await listSessions();
  const sessions = allSessions.filter((s) => !inUse.has(s.id));

  // 同じタブの再読み込みなら、確認なしで続ける
  let remembered = null;
  let picked = null; // ロゴのボタンで選んで開き直したときの内容
  try {
    remembered = sessionStorage.getItem(SESSION_TAB_KEY);
    picked = sessionStorage.getItem(START_CHOICE_KEY);
    sessionStorage.removeItem(START_CHOICE_KEY);
  } catch {
    /* ignore */
  }
  const same = sessions.find((s) => s.id === remembered);
  if (same) {
    sessionId = same.id;
    applySession(same.data);
    return false;
  }

  // 新しく始めるときも、表示方法 (標準 / ストレッチ) は直近のもの (使用中のタブを含む) を引き継ぐ
  const latest = allSessions[0]?.data;
  const startNew = () => {
    sessionId = newSessionId();
    applySession({ fit: latest?.fit, danmakuAll: latest?.danmakuAll });
  };

  // ロゴのボタンで選んだもの (再開するものが別のタブで使われ始めていたら、いつもの選択画面へ)
  const pickedSession = picked?.startsWith('resume:') && sessions.find((s) => 'resume:' + s.id === picked);
  if (pickedSession) {
    sessionId = pickedSession.id;
    applySession(pickedSession.data);
    return false;
  }
  if (picked === 'new' || picked === 'auto') {
    startNew();
    return picked === 'auto';
  }

  const resumable = sessions.filter((s) => describeSession(s.data).count > 0).slice(0, 3);
  if (resumable.length === 0) {
    startNew();
    return false;
  }
  const choices = resumable.map((s, n) => ({
    value: 'resume:' + s.id,
    label: n === 0 ? tr('resumeLatest') : tr('resumeThis'),
    note: describeSession(s.data).lines,
  }));
  choices.push(
    { value: 'new', label: tr('startNew'), note: tr('startNewNote') },
    { value: 'auto', label: tr('startAuto'), note: tr('startAutoNote') },
  );
  const body = document.createElement('p');
  body.textContent = inUse.size > 0 ? tr('inUse', inUse.size) : tr('leftover');
  const choice = await askChoice({ title: tr('chooseTitle'), body, choices });
  if (choice.startsWith('resume:')) {
    const s = resumable.find((x) => 'resume:' + x.id === choice);
    sessionId = s.id;
    applySession(s.data);
    return false;
  }
  startNew();
  return choice === 'auto';
}

(async function main() {
  // 再生リスト: 以前の版の形 (全部で 1 つの項目) なら 1 つずつに分けて移す。1 つも無ければ既定の「新規マイリスト」を作る
  await Promise.all([loadSettings(), Favorites.seedPresets(), SyncOffsets.load(), MovieAnchors.load(), Playlists.setup(tr('plSeedName'))]);
  buildTiles();
  refreshFavKeys().catch(() => {});
  refreshSavedIds().catch(() => {});
  refreshPlaylistIds().catch(() => {});
  setupDragSwap();
  setupToolbar();
  layout();

  let startAuto = await chooseSession();
  // 選んだ視聴セッションを押さえる。ほぼ同時に開いた別のタブが先に同じものを選んでいたら、新しく始める
  if (!(await claimSession(sessionId))) {
    const { fit, danmakuAll } = state;
    sessionId = newSessionId();
    applySession({ fit, danmakuAll });
    await claimSession(sessionId);
    startAuto = false;
    setTimeout(() => notify(tr('sessionTaken')), 500);
  }
  try {
    sessionStorage.setItem(SESSION_TAB_KEY, sessionId);
  } catch {
    /* ignore */
  }
  await registerTab();
  pruneSessions(await sessionsInUse());

  renderAll();
  save();
  setToggle(document.getElementById('cruise'), state.cruise);
  restartCruise();
  if (startAuto) setAutoMode(true);
  // 自動再生 ON のまま閉じたセッションを続けるときは、今の枠のまま確認を再開
  else if (state.autoMode) setAutoMode(true, { resume: true });
  startNoticeWatch();
  handleImportLink();
  handleAddLink();
  // 右クリックのメニューからの追加を受け取る (起動し終えてから。それまでに押されたものは新しいタブで開く)
  chrome.tabs
    .getCurrent()
    .then((tab) => tab && listenAddVideo(tab.id))
    .catch(() => {});

  // インストール直後の 1 回だけ、使い方ツアーを出す (先に印を消して、他のタブでは出さない)
  const { tourPending } = await chrome.storage.local.get('tourPending');
  if (tourPending) {
    await chrome.storage.local.remove('tourPending');
    startTour();
  }
})();
