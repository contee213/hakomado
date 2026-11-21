/* global Danmaku, LAYOUTS, ANCHORS, DEFAULT_LAYOUT_ID, MAX_SLOTS, getLayout, layoutFor, solveTracks, LANG, LANG_PREF, tr, setLangPref, Backup, UpdateCheck, qrcode, jsQR, ChannelPack, SyncOffsets */
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
  return { input: '', videoId: null, chat: false, danmaku: null, muted: true, auto: false, queue: false, fill: false, label: '' };
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
  const res = await fetch(liveUrl, { credentials: 'include', signal: AbortSignal.timeout(20000) });
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
    Sync.setupTile(i, el);
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
  Object.assign(state.tiles[i], { input, videoId, auto: false, queue: false, fill: false, label: '' });
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
    v.ss = null;
    Diagnose.clear(i);
    v.meta = null;
    v.social = null;
  } else if (!v.player || reloadPlayer) {
    v.player?.remove();
    const f = document.createElement('iframe');
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
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
  updateSocialButtons(i);
  updateFavButton(i);
  updateTileName(i);
  updateNowPlaying();
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
  postToFrame(views[i].player, { hakomado: 'audio', muted: state.tiles[i].muted });
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
      Sync.togglePanel(i);
      break;
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
//   ずれ (配信の遅延の違いなど) は、枠のバーの ⏱ で直せる (±0.01〜1 秒の微調整のボタンか、0.01 秒単位で秒数を直接入れる)。
//   ずれは動画ごとに記録する (SyncOffsets)。別の枠に入れても、次に開いても、視聴セットで人に渡しても同じ値を使う
// - アーカイブは冒頭 (開始前の待機画面など) が切られていることがあり、そのときは「0 秒 = 開始時刻」がずれる。
//   配信していた時間 (end − start) よりアーカイブが短ければ ⏱ に知らせ、冒頭が切られた場合の値を候補として出す
// - 全体で 1 つの「同期の時計」(実際の時刻) を持つ。時計は基準の枠の再生位置に合わせて進む (基準の枠の中で
//   一時停止・シークすると、ほかの枠もついてくる)。ほかの枠は時計に合わせて
//   シーク・一時停止・再生・速度の微調整 (少しのずれは速度で吸収し、大きくずれたときだけシーク) を受ける
// - 基準の枠と配信の時間帯 (開始〜終了) が重ならないアーカイブは同期しない (同じ瞬間が無いため)。重なっていれば、
//   開始の差に上限は無い。まだ始まっていない / もう終わっている時刻の枠は止めて、そのことを枠に出す
// - 広告中の枠は待たずに進め、広告が終わったら追いつかせる
// - 上部バーのシークバーで、同期している全部のアーカイブを同じ時刻に動かせる
// - 基準の枠は、同期を始めたときに音を出している枠 (複数ならレイアウトで一番前、無ければ先頭のアーカイブ)。
//   その後は音を切り替えても変わらない (音を聞き比べるたびに基準が黙って変わらないように)。基準の枠には「基準」の印を付け、
//   上部バーの「基準: …」や、枠の ⏱ の「この枠を基準にする」で選び直せる。基準の枠を閉じたら、同じ決め方で選び直して知らせる
// - 「止めて待つ」: 先に進んでいる枠を止めて、ほかが追いつくのを待ってから再生すると、そこでずれが決まる。
//   基準でない枠は、枠の中のプレイヤーで一時停止するだけでよい (同期が再生し直さず待つ)。基準の枠を含め、⏱ の「止めて待つ」でもできる
//   (基準の枠をプレイヤーで一時停止したときは、これまでどおり全部止まる)。待っている間は、時計は基準の枠に合わせず進む
// - 基準でない枠を、枠の中のプレイヤーでシーク (シークバー・← → キー) すると、引き戻さずに、その位置でずれを決める
//   (進みすぎた枠をシークバーで戻す、など)。基準の枠をシークしたときは、これまでどおりほかの枠がついてくる
// ON / OFF は保存しない (開き直したら OFF。視聴セットを開いたときは、ずれが入っていれば自動で ON にする)
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
  let clock = { R0: 0, at: 0, playing: true }; // R = 実際の時刻 (ミリ秒)
  let holdUntil = 0; // シークバーで動かした直後は、基準の枠が追いつくまで時計を基準に合わせない
  let dragging = false;
  let refTile = null; // 基準の枠 (同期中だけ)
  const sent = new Map(); // i -> {seekAt, cmd, cmdAt, rate}
  const forceSeek = new Set(); // ずれを微調整した枠 (速度で詰めず、すぐシークする)
  const waiting = new Map(); // i -> {paused} 「止めて待つ」中の枠 (paused = 止まったのを確かめた)
  const seenSeeks = new Map(); // i -> 最後に見た、枠の中でユーザーがシークした回数

  const now = () => performance.now();
  const nowR = () => (clock.playing ? clock.R0 + (now() - clock.at) : clock.R0);
  const setClock = (R, playing) => (clock = { R0: R, at: now(), playing });
  const off = (i) => SyncOffsets.get(state.tiles[i].videoId);
  const archived = (i) => isVisible(i) && !!state.tiles[i].videoId && !!views[i].archive;
  const rangeOf = (i) => [views[i].archive.start, views[i].archive.start + views[i].archive.dur * 1000];
  const overlaps = (i, j) => {
    const [a, b] = rangeOf(i);
    const [c, d] = rangeOf(j);
    return a < d && c < b;
  };
  /** 今の再生位置 (秒)。最後に届いた位置から、再生中なら経った分を足す */
  const posOf = (i) => {
    const ss = views[i].ss;
    if (!ss) return null;
    const moving = ss.ps === 1 && !ss.ad;
    return ss.t + (moving ? ((now() - ss.at) / 1000) * (ss.r || 1) : 0);
  };
  const realOf = (i, t) => views[i].archive.start + (t - off(i)) * 1000;
  const targetOf = (i, R) => (R - views[i].archive.start) / 1000 + off(i);

  /** 基準にする枠の初期値: 音を出しているアーカイブ (複数ならレイアウトで一番前)。無ければ先頭のアーカイブ */
  function initialReference() {
    const list = visibleIndexes().filter(archived);
    return list.find((i) => !state.tiles[i].muted) ?? list[0] ?? null;
  }
  /** 基準の枠 (同期中は選んだ枠。閉じられていたら選び直して知らせる) */
  function reference() {
    if (!on) return initialReference();
    if (refTile == null || !archived(refTile)) {
      const prev = refTile;
      refTile = initialReference();
      if (prev != null && refTile != null) notify(tr('syncRefMoved', refLabel(refTile)));
    }
    return refTile;
  }
  const refLabel = (i) => `${visibleIndexes().indexOf(i) + 1} ${tileName(i) || ''}`.trim();

  /** 基準の枠を選び直す (時計はそのまま。新しい基準の枠も、今の時刻に合っているので飛ばない) */
  function setReference(i) {
    if (!on || !archived(i) || i === refTile) return;
    refTile = i;
    playlistRefChanged(state.tiles[i].videoId);
    holdUntil = 0;
    forceSeek.delete(i);
    rate(i, 1);
    refresh();
    tick();
  }
  /** 同期する枠 (基準の枠と時間帯が重なるアーカイブ) */
  function members(ref) {
    return visibleIndexes().filter((i) => archived(i) && (i === ref || overlaps(i, ref)));
  }
  const available = () => {
    const ref = reference();
    return ref != null && members(ref).length >= 2;
  };

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

  function overlay(i, text) {
    const el = views[i].el.querySelector('.sync-overlay');
    el.hidden = !text;
    if (text && el.textContent !== text) el.textContent = text;
  }

  function tick() {
    if (!on) return;
    const ref = reference();
    if (ref == null || !available()) {
      stop();
      notify(tr('syncStopped'));
      return;
    }
    const list = members(ref);
    // 時計を基準の枠に合わせる (基準の枠が配信の時間帯の中で、知らせが新しく、広告中でないとき)
    const rs = views[ref].ss;
    let playing = !pausedAll;
    let R = nowR();
    if (now() > holdUntil && !waiting.has(ref) && rs && !rs.ad && now() - rs.at < 2000) {
      const [s, e] = rangeOf(ref);
      const Rref = realOf(ref, posOf(ref));
      if (Rref >= s && Rref < e - 1000) {
        R = Rref;
        if (rs.ps === 2) playing = false; // 基準の枠の中で一時停止した → 全部止める
      }
    }
    setClock(R, playing);

    for (const i of visibleIndexes()) {
      if (!archived(i)) continue;
      const userSeek = sawUserSeek(i);
      if (waiting.has(i) && list.includes(i)) {
        tickWaiting(i, R);
        continue;
      }
      if (!list.includes(i)) {
        // 時間帯が重ならない: 同期しない (ふつうに再生させる)
        overlay(i, tr('syncNoOverlap'));
        rate(i, 1);
        continue;
      }
      // 基準の枠は動かさない (シークバーで動かした直後だけ、ほかと同じように合わせる)
      if (i === ref && now() > holdUntil) {
        overlay(i, '');
        showDrift(i, null);
        rate(i, 1);
        continue;
      }
      const ss = views[i].ss;
      const [s, e] = rangeOf(i);
      if (R < s) {
        overlay(i, tr('syncStartsIn', spanText((s - R) / 1000)));
        cmd(i, 'pause');
        if (ss && ss.t > 1) seek(i, 0);
        continue;
      }
      if (R >= e) {
        overlay(i, tr('syncEnded'));
        cmd(i, 'pause');
        continue;
      }
      overlay(i, '');
      if (!ss || ss.ad) continue; // 広告中は待たずに進める (終わったら追いつかせる)
      // 枠の中のプレイヤーでシークした → 引き戻さず、その位置でずれを決める
      if (userSeek) {
        adoptOffset(i, R);
        continue;
      }
      // 枠の中のプレイヤーで一時停止した → 再生し直さず、ほかが追いつくのを待つ
      if (playing && ss.ps === 2 && ss.up && now() - ss.at < 2000) {
        beginWait(i, true);
        continue;
      }
      const target = targetOf(i, R);
      const drift = posOf(i) - target;
      if (!playing) {
        rate(i, 1);
        if (ss.ps === 1 || ss.ps === 3) cmd(i, 'pause');
        if (Math.abs(drift) > 0.5) seek(i, target);
        continue;
      }
      if (ss.ps !== 1 && ss.ps !== 3) cmd(i, 'play');
      const ad = Math.abs(drift);
      const correcting = (sent.get(i)?.rate ?? 1) !== 1;
      if (ad > SEEK_DRIFT || (forceSeek.has(i) && ad > FORCE_SEEK_DRIFT)) {
        forceSeek.delete(i);
        rate(i, 1);
        seek(i, target + 0.2); // 読み込みに掛かる分、少し先へ (速度で詰め始めるずれより小さく)
        showDrift(i, drift, false);
      } else if (ad > RATE_DRIFT || (correcting && ad > RATE_STOP)) {
        // 3 秒ほどで詰め終わる速さ (1〜10% 速く / 遅く。0.5% 単位で丸めて、指示を送り直しすぎないように)
        forceSeek.delete(i);
        const k = Math.round(Math.min(0.1, Math.max(0.01, ad / 3)) * 200) / 200;
        rate(i, drift > 0 ? 1 - k : 1 + k);
        showDrift(i, drift, false);
      } else {
        forceSeek.delete(i);
        rate(i, 1);
        showDrift(i, drift, true);
      }
    }
    updateBar(list);
    updateMarks(ref, list);
  }

  /** 上部バーのシークバー: 同期している枠の時間帯を全部まとめた範囲 */
  function updateBar(list) {
    const seekEl = document.getElementById('syncSeek');
    const lo = Math.min(...list.map((i) => rangeOf(i)[0]));
    const hi = Math.max(...list.map((i) => rangeOf(i)[1]));
    seekEl.dataset.lo = String(lo);
    seekEl.max = String(Math.max(1, Math.round((hi - lo) / 1000)));
    if (!dragging) {
      seekEl.value = String(Math.round((nowR() - lo) / 1000));
      document.getElementById('syncNow').textContent = clockText(nowR());
    }
    document.getElementById('syncEnd').textContent = clockText(hi);
  }

  function start() {
    const ref = initialReference();
    if (ref == null) return;
    refTile = ref;
    const p = posOf(ref);
    setClock(p != null ? realOf(ref, p) : rangeOf(ref)[0], !pausedAll);
    holdUntil = 0;
    sent.clear();
    on = true;
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    tick();
    notify(tr('syncOn', members(ref).length));
    refresh();
  }

  function stop() {
    on = false;
    refTile = null;
    waiting.clear();
    seenSeeks.clear();
    clearInterval(timer);
    timer = 0;
    for (let i = 0; i < MAX_TILES; i++) {
      if (!views[i]) continue;
      if (views[i].archive) send(i, { op: 'rate', r: 1 });
      overlay(i, '');
      views[i].el.querySelector('.sync-panel').hidden = true;
    }
    sent.clear();
    refresh();
  }

  /** ボタン・シークバー・枠の ⏱ の表示を今の状態に合わせる (枠の中身が変わったとき・アーカイブだと分かったとき) */
  function refresh() {
    if (views.length < MAX_TILES) return;
    if (pending) checkPending();
    const can = available();
    if (on && !can) {
      stop();
      notify(tr('syncStopped'));
      return;
    }
    for (const i of [...waiting.keys()]) if (!archived(i)) waiting.delete(i); // 閉じた・別の動画にした枠は待つのをやめる
    const btn = document.getElementById('syncToggle');
    btn.hidden = !can && !on;
    setToggle(btn, on);
    document.getElementById('syncBar').hidden = !on;
    const ref = on ? reference() : null;
    updateMarks(ref, ref != null ? members(ref) : []);
  }

  let marksKey = '';
  /** 枠の「基準」の印・⏱・「この枠を基準にする」と、上部バーの「基準: …」(同期の処理のたびにも呼ぶ。変わったときだけ書き換える) */
  function updateMarks(ref, list) {
    const key = JSON.stringify([on, ref, list, visibleIndexes().filter(archived)]);
    if (key === marksKey) return;
    marksKey = key;
    updateRefSelect(ref);
    for (let i = 0; i < MAX_TILES; i++) {
      const inSync = on && list.includes(i);
      views[i].el.querySelector('.sync-adj').hidden = !inSync;
      views[i].el.querySelector('.sync-ref-badge').hidden = !(on && i === ref);
      views[i].el.querySelector('.sync-set-ref').hidden = !inSync || i === ref;
      if (!inSync) views[i].el.querySelector('.sync-panel').hidden = true;
      if (!archived(i) || !on) overlay(i, '');
      updateAdj(i);
    }
  }

  /** 上部バーの「基準: …」(同期できるアーカイブから選ぶ) */
  function updateRefSelect(ref) {
    const sel = document.getElementById('syncRef');
    if (!on || ref == null) return;
    const options = visibleIndexes()
      .filter(archived)
      .map((i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = tr('syncRefOpt', refLabel(i));
        return o;
      });
    sel.replaceChildren(...options);
    sel.value = String(ref);
  }

  /** 「止めて待つ」を始める (paused = もう止まっている。⏱ のボタンからなら、止める指示を送る) */
  function beginWait(i, paused) {
    if (!on || waiting.has(i)) return;
    waiting.set(i, { paused });
    rate(i, 1);
    if (!paused) cmd(i, 'pause');
    overlay(i, '');
    showToast(i, tr('syncWaitStart'));
    updateAdj(i);
  }
  /** 「止めて待つ」を終える: 今の再生位置が今の時刻に合うように、ずれを決める */
  function endWait(i) {
    if (!waiting.delete(i)) return;
    adoptOffset(i, nowR());
  }
  /** 今の再生位置が時刻 R に合うずれ (秒、0.01 秒単位)。位置が分からなければ null */
  function offsetAt(i, R) {
    const p = posOf(i);
    return p == null ? null : Math.round((p - (R - views[i].archive.start) / 1000) * 100) / 100;
  }
  /** 今の再生位置のまま合うように、ずれを決める (「止めて待つ」の再生・枠の中でのシーク) */
  function adoptOffset(i, R) {
    const v = offsetAt(i, R);
    if (v == null) return updateAdj(i);
    SyncOffsets.set(state.tiles[i].videoId, v);
    playlistOffsetChanged(state.tiles[i].videoId, v);
    sent.delete(i);
    forceSeek.delete(i);
    rate(i, 1);
    updateAdj(i);
    showToast(i, tr('syncOffsetSet', signedSec(v)));
  }
  /** 前の確認のあとで、枠の中でユーザーがシークしたか (同期を始めて最初に見たときは、数を覚えるだけ) */
  function sawUserSeek(i) {
    const sk = views[i].ss?.sk;
    if (sk == null) return false;
    const prev = seenSeeks.get(i);
    seenSeeks.set(i, sk);
    return prev != null && sk !== prev;
  }
  /** 待っている枠: 止まったのを確かめたあと、再生されたら (枠の中のプレイヤーでも ⏱ でも) そこでずれを決める */
  function tickWaiting(i, R) {
    const w = waiting.get(i);
    const ss = views[i].ss;
    if (!ss) return;
    if (ss.ps === 2) w.paused = true;
    else if (w.paused && ss.ps === 1 && now() - ss.at < 2000) {
      endWait(i);
      return;
    }
    if (!w.paused) cmd(i, 'pause');
    updateAdj(i, R);
  }
  /** ⏱ の「止めて待つ / ここで合わせる」 */
  function toggleWait(i) {
    if (!waiting.has(i)) return beginWait(i, false);
    const w = waiting.get(i);
    if (!w.paused) {
      waiting.delete(i); // まだ止まっていない: 取りやめる
      updateAdj(i);
      return;
    }
    send(i, { op: 'play' }); // 再生が始まったら tickWaiting がずれを決める
    w.paused = true;
  }

  // 視聴セットを開いたあと、アーカイブだと分かりしだい同期を始める ({tiles, ref, until, at})
  let pending = null;
  let pendingTimer = 0;
  /**
   * tiles の枠がアーカイブだと分かったら (最長 30 秒待って、分かった分だけで)、ref の枠を基準にして同期を始める。
   * at (同期の時計。実際の時刻のミリ秒) を渡すと、始めたあとにその時刻へ動かす (再生リストの続きから)
   */
  function startWhenReady(tiles, ref, { at = null } = {}) {
    pending = { tiles, ref, until: now() + 30000, at };
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(refresh, 30500);
    setTimeout(refresh, 0); // もう読み込んである動画だけなら、すぐ始める
  }
  function checkPending() {
    const { tiles, ref, until, at } = pending;
    const ready = tiles.every((i) => archived(i) || !state.tiles[i].videoId);
    if (!ready && now() < until) return;
    pending = null;
    clearTimeout(pendingTimer);
    setTimeout(() => {
      // 基準にしたい枠に音を出しておく (同期を始めたときの基準は、音を出している枠)
      if (!on && available()) start();
      if (on && archived(ref)) setReference(ref);
      if (on && at) seekReal(at);
    }, 0);
  }
  /** 同期している全部の枠を、時計の時刻 R へ動かす (上部バーのシークバーと同じ) */
  function seekReal(R) {
    setClock(R, !pausedAll);
    holdUntil = now() + 4000;
    sent.clear();
    tick();
  }
  /** 今どこを見ているか ({at: 時計, pos: 基準の動画の再生位置 (秒)})。同期していなければ null */
  function resumePoint() {
    if (!on) return null;
    const ref = reference();
    if (ref == null) return null;
    const R = nowR();
    return { at: Math.round(R), pos: Math.max(0, targetOf(ref, R)) };
  }
  /** ほかのタブなどで動画のずれが変わった */
  function offsetsChanged(ids) {
    for (const i of visibleIndexes()) {
      if (!ids.includes(state.tiles[i].videoId)) continue;
      sent.delete(i);
      forceSeek.add(i);
      updateAdj(i);
    }
  }

  /** +1.25 / -300.00 のような符号付きの秒 (0.01 秒単位) */
  const signedSec = (v) => (v > 0 ? '+' : '') + v.toFixed(2);
  const signedSec3 = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(3);
  /**
   * ⏱ パネルを開いている枠に、追いつき具合 (設定したずれどおりの位置と、実際の再生位置の差。+ = 進んでいる) を出す。
   * d = null なら基準の枠。ok = 同期が詰める必要が無いと見ている (詰めている途中・シークしたときは false)
   */
  function showDrift(i, d, ok) {
    const el = views[i].el.querySelector('.sync-drift');
    if (views[i].el.querySelector('.sync-panel').hidden) return;
    const ms = (v) => (Math.ceil(Math.abs(v) * 1000) / 1000).toFixed(3);
    const text =
      d == null
        ? tr('syncDriftRef')
        : ok
          ? tr('syncDriftOk', signedSec3(d))
          : tr(d > 0 ? 'syncDriftAhead' : 'syncDriftBehind', ms(d));
    if (el.textContent !== text) el.textContent = text;
  }

  const TRIM_MIN = 30; // アーカイブが配信よりこれ以上 (秒) 短ければ、切られていると知らせる
  /** アーカイブが配信していた時間より何秒短いか (冒頭か末尾が切られたぶん。どちらかはわからない) */
  function trimmedOf(i) {
    const a = views[i].archive;
    if (!a || !(a.end > a.start)) return 0;
    return Math.round((a.end - a.start) / 1000 - a.dur);
  }
  const approxText = (sec) => (sec >= 120 ? tr('approxMin', Math.round(sec / 60)) : tr('approxSec', sec));

  function updateAdj(i, R = nowR()) {
    const el = views[i].el;
    const wait = waiting.get(i);
    // 待っている間は、今再生したら決まるずれを出す
    const v = (wait && views[i].archive ? offsetAt(i, R) : null) ?? off(i);
    const signed = signedSec(v);
    el.querySelector('.sync-panel-label').textContent = tr('syncOffset', signed);
    const adj = el.querySelector('.sync-adj');
    adj.textContent = wait ? `⏸ ${signed}` : v ? `⏱ ${signed}` : '⏱';
    adj.classList.toggle('is-waiting', !!wait);
    const waitBtn = el.querySelector('.sync-wait');
    waitBtn.textContent = tr(wait ? 'syncWaitResume' : 'syncWait');
    waitBtn.classList.toggle('is-waiting', !!wait);
    const input = el.querySelector('.sync-input');
    if (document.activeElement !== input) input.value = String(v);
    // 切られたアーカイブ: 自動では直さず (冒頭か末尾かわからないため)、冒頭が切られた場合の値をワンクリックで出す
    const trimmed = trimmedOf(i);
    const trimEl = el.querySelector('.sync-trim');
    trimEl.hidden = trimmed < TRIM_MIN;
    adj.classList.toggle('has-trim', !trimEl.hidden && v === 0); // まだずらしていなければ、⏱ を目立たせて知らせる
    if (!trimEl.hidden) {
      el.querySelector('.sync-trim-text').textContent = tr('syncTrimmed', approxText(trimmed));
      const b = el.querySelector('.sync-trim-head');
      b.textContent = tr('syncTrimHead', -trimmed);
      b.disabled = v === -trimmed;
    }
  }

  function togglePanel(i) {
    const panel = views[i].el.querySelector('.sync-panel');
    panel.hidden = !panel.hidden;
    views[i].el.querySelector('.sync-drift').textContent = '';
    updateAdj(i);
  }

  /** この枠のずれを v 秒にして、すぐ合わせ直す */
  function setOffset(i, v) {
    SyncOffsets.set(state.tiles[i].videoId, v);
    playlistOffsetChanged(state.tiles[i].videoId, v);
    sent.delete(i);
    forceSeek.add(i); // 速度で詰めず、すぐ合わせ直す
    updateAdj(i);
    tick();
  }

  function setupTile(i, el) {
    el.querySelector('.sync-panel').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('sync-trim-head')) {
        setOffset(i, -trimmedOf(i));
        return;
      }
      if (b.dataset.sync == null) return;
      if (b.dataset.sync === 'ref') {
        setReference(i);
        return;
      }
      if (b.dataset.sync === 'wait') {
        toggleWait(i);
        return;
      }
      const d = Number(b.dataset.sync);
      setOffset(i, d === 0 ? 0 : off(i) + d);
    });
    const input = el.querySelector('.sync-input');
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value.trim() !== '' && Number.isFinite(v)) setOffset(i, v);
      else updateAdj(i);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur(); // blur で change が走る
      else if (e.key === 'Escape') {
        input.value = String(off(i));
        input.blur();
      }
    });
  }

  function setup() {
    SyncOffsets.onChange(offsetsChanged);
    document.getElementById('syncToggle').addEventListener('click', (e) => {
      e.currentTarget.blur(); // Space キーでボタンが押し直されないように
      if (on) stop();
      else start();
    });
    const refSel = document.getElementById('syncRef');
    refSel.addEventListener('change', () => {
      refSel.blur();
      setReference(Number(refSel.value));
    });
    const seekEl = document.getElementById('syncSeek');
    seekEl.addEventListener('input', () => {
      dragging = true;
      document.getElementById('syncNow').textContent = clockText(Number(seekEl.dataset.lo) + Number(seekEl.value) * 1000);
    });
    seekEl.addEventListener('change', () => {
      dragging = false;
      seekEl.blur();
      // 時計を動かし、基準の枠も含めて全部その時刻へ (基準の枠が追いつくまで、時計は基準の枠に合わせない)
      setClock(Number(seekEl.dataset.lo) + Number(seekEl.value) * 1000, !pausedAll);
      holdUntil = now() + 4000;
      sent.clear();
      tick();
    });
  }

  return {
    setup,
    setupTile,
    refresh,
    togglePanel,
    startWhenReady,
    offsetsChanged,
    isOn: () => on,
    resumePoint,
    isWaiting: (i) => on && waiting.has(i),
    refIfOn: () => (on ? reference() : null),
  };
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

  function playerLoaded(i, f) {
    const d = get(i);
    Object.assign(d, { frame: f, seen: new Set() });
    d.problems.clear();
    show(i);
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

  function chatLoaded(i, f) {
    const d = get(i);
    Object.assign(d, { chatFrame: f, chatOk: false });
    d.problems.delete('chat');
    show(i);
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

  return { playerLoaded, chatLoaded, seen, chatSeen, clear };
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
  if (data.hakomado === 'archive') {
    const [start, end, dur] = [Number(data.start), Number(data.end), Number(data.dur)];
    if ([start, end, dur].every(Number.isFinite) && dur > 0) views[i].archive = { start, end, dur };
    Sync.refresh();
    return;
  }
  if (data.hakomado === 'userAudio') {
    // 枠内のプレイヤーのスピーカーで切り替え → この枠だけ切り替える (他の枠はそのまま。複数枠の同時再生用)
    setAudio(i, { on: !data.muted });
  } else if (data.hakomado === 'live') {
    views[i].el.classList.toggle('is-live', !!data.on);
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
    WatchHistory.update(state.tiles[i].videoId, { ...views[i].meta, label: state.tiles[i].label });
    if (savedIds.has(state.tiles[i].videoId)) SavedVideos.update(state.tiles[i].videoId, views[i].meta);
    if (playlistIds.has(state.tiles[i].videoId)) Playlists.update(state.tiles[i].videoId, views[i].meta);
    updateNowPlaying();
  } else if (data.hakomado === 'playability') {
    onPlayability(i, String(data.status || ''), String(data.text || ''));
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

function openHelp() {
  const d = document.getElementById('help');
  if (!d.open) d.showModal();
}

// ---------------------------------------------------------------- 🔗 視聴セットの共有
// 表示中の枠の配信とレイアウトを、短いコード (と、それを QR にした画像) にする / コードや画像から同じ並びを作る。
// - コードは「#Hakomado <レイアウト>.<動画 ID をつなげたもの>」の 1 行。動画 ID は必ず 11 文字なので区切らない。
//   X に貼っても 16 本で約 200 文字に収まる (拡張機能の画面の URL は入れた環境ごとに ID が違うので、共有には使えない)
// - 画像は、今のレイアウトの形にサムネイルとチャンネル名を並べ、コードを入れた QR を添えたもの。X は画像を文字数に
//   数えず、見ただけで何を並べているか分かる。読み込むときは、画像を貼り付ける (Ctrl+V) かドロップすると QR を読む
// - 読み込むときは、投稿の本文をまるごと貼ってもコードの部分だけを拾う。YouTube の URL を 1 行に 1 つ並べたものも読める
const SHARE_MAX = MAX_TILES;
const SHARE_TAG = 'Hakomado';
// 末尾の「~…」はアーカイブの同期のずれ (動画の並び順に「,」区切りの秒。「*」の付いた動画が同期の基準)。
// 以前の版はこの部分を読み飛ばすので、動画とレイアウトだけが再現される
const SHARE_CODE_RE = /#?Hakomado\s+([a-z0-9-]{1,24})\.((?:[A-Za-z0-9_-]{11}){1,16})(?:~([-+*\d.,]{1,240}))?(?![A-Za-z0-9_-])/i;

/** 表示中の枠のうち、配信の入っている枠 (並び順。空き枠は詰める) */
const shareTiles = () => visibleIndexes().filter((i) => state.tiles[i].videoId);

/**
 * 視聴セットのコードを作る。ids = 動画 (並び順)、offs = 動画ごとのずれ (秒)、refK = 同期の基準の番号。
 * ずれのある動画があるか、同期の基準が先頭以外のときだけ「~…」を付ける (先頭が基準なら印は省く)
 */
function formatShareCode(layoutId, ids, offs = [], refK = 0) {
  const o = ids.map((_, k) => offs[k] || 0);
  const tail = o.some(Boolean) || refK > 0 ? '~' + o.map((v, k) => (k === refK && k > 0 ? '*' : '') + String(v)).join(',') : '';
  return `#${SHARE_TAG} ${layoutId}.${ids.join('')}${tail}`;
}

/** 今の視聴セットのコード (配信が無ければ '') */
function viewingSetCode() {
  const filled = shareTiles();
  if (!filled.length) return '';
  const ids = filled.map((i) => state.tiles[i].videoId);
  return formatShareCode(state.layoutId, ids, ids.map((id) => SyncOffsets.get(id)), filled.indexOf(Sync.refIfOn()));
}

// ---- 貼られたテキストの読み取り (視聴セットの共有と、再生リストで共通)

/**
 * テキストの中の視聴セットのコード (#Hakomado …) を読む。無ければ null。
 * 同じ動画が 2 回あれば 1 回目だけ使う。offsets = 動画ごとの同期のずれ (コードに入っていなければ null)、
 * ref = 同期の基準にする動画の番号
 * @returns {{ids: string[], layoutId: string, offsets: number[]|null, ref: number}|null}
 */
function parseShareCode(text) {
  const code = text.match(SHARE_CODE_RE);
  if (!code) return null;
  const tail = code[3] ? code[3].split(',') : null;
  const ids = [];
  const offsets = [];
  let ref = 0;
  code[2].match(/.{11}/g).forEach((id, k) => {
    if (ids.includes(id)) return;
    const t = tail?.[k] ?? '';
    if (t.startsWith('*')) ref = ids.length;
    ids.push(id);
    offsets.push(Number(t.replace('*', '')) || 0);
  });
  return { ids, layoutId: code[1], offsets: tail ? offsets : null, ref };
}

/**
 * 取り込み用リンク (YouTube の https://www.youtube.com/watch_videos?video_ids=ID,ID,…&hakomado=名前) を読む。
 * YouTube はこの URL を名前の無い一時的な再生リストとして開くので、Hakomado を入れていない人にもそのまま見られる
 * (hakomado= は YouTube には無視される)。違う URL なら null
 * @returns {{ids: string[], name: string}|null}
 */
function parseWatchVideosLink(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^((www|m)\.)?youtube\.com$/.test(url.hostname) || url.pathname !== '/watch_videos') return null;
  const ids = (url.searchParams.get('video_ids') || '').split(',').map((s) => s.trim()).filter((id) => ID_RE.test(id));
  return { ids: [...new Set(ids)], name: (url.searchParams.get('hakomado') || '').trim() };
}

/** 取り込み用リンクに入れる動画の数 (YouTube の一時的な再生リストが開ける数) */
const IMPORT_LINK_MAX = 50;

/** YouTube の再生リストの URL (https://www.youtube.com/playlist?list=…) なら、その ID。違えば null */
function youtubePlaylistId(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^((www|m|music)\.)?youtube\.com$/.test(url.hostname) || url.pathname !== '/playlist') return null;
  const id = url.searchParams.get('list') || '';
  return /^[\w-]{10,64}$/.test(id) ? id : null;
}


/**
 * 1 行に 1 本のテキストを読む (再生リストのテキスト形式。playlistText で書き出したものもそのまま読める)。
 *   # playlist=名前        … meta.playlist (再生リストの名前)
 *   # sync=on              … meta.sync (同期再生する)
 *   # layout=2x2           … meta.layout (レイアウト)
 *   https://www.youtube.com/watch?v=ID  ~*1.5  # 名前
 * - 各行の最初の語を URL / 動画 ID / @チャンネル名 として読む。続く「~秒」は同期のずれ (「~*秒」なら同期の基準)、
 *   行の後ろの「# …」はその配信の名前 (label)
 * - 取り込み用リンク・YouTube の再生リストの URL の行は、中の動画をすべて読む
 *   (リンクや再生リストの名前は meta.playlist に入れる。先に書いたものが優先)
 * - # で始まる行は説明。「# 名前=値」の形なら meta に入れる
 * 同じ動画は 1 回だけ。max 本読んだところでやめ、まだ残っていれば tooMany
 * @returns {Promise<{items: {videoId: string, label?: string, offset?: number}[], ref: string|null,
 *   hasOffsets: boolean, meta: Record<string, string>, bad: number, tooMany: boolean}>}
 */
async function parseVideoLines(text, max, onProgress) {
  const meta = {};
  const setMeta = (k, v) => {
    if (v && !(k in meta)) meta[k] = v;
  };
  const tokens = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith('#')) {
      const m = s.match(/^#\s*(\w+)\s*=\s*(.+)$/);
      if (m) setMeta(m[1].toLowerCase(), m[2].trim());
      continue;
    }
    const t = s.split(/\s+/)[0];
    const link = parseWatchVideosLink(t);
    if (link) {
      tokens.push(...link.ids.map((id) => ({ t: id, label: '', offset: null, ref: false })));
      setMeta('playlist', link.name);
      continue;
    }
    const listId = youtubePlaylistId(t);
    if (listId) {
      try {
        const yl = await Favorites.fetchYouTubePlaylist(listId);
        if (!yl.ids.length) throw new Error('empty');
        tokens.push(...yl.ids.map((id) => ({ t: id, label: '', offset: null, ref: false })));
        setMeta('playlist', yl.name);
      } catch {
        tokens.push({ t, label: '', offset: null, ref: false }); // 読めなかった行として数える
      }
      continue;
    }
    let rest = s.slice(t.length);
    const off = rest.match(/^\s+~(\*?)([-+]?\d+(?:\.\d+)?)?(?=\s|$)/);
    if (off) rest = rest.slice(off[0].length);
    const label = (rest.match(/^\s+#\s*(.*)$/)?.[1] || '').replace(/\s+/g, ' ').trim();
    tokens.push({ t, label, offset: off ? Number(off[2]) || 0 : null, ref: !!off?.[1] });
  }
  const items = [];
  let ref = null;
  let hasOffsets = false;
  let bad = 0;
  let k = 0;
  for (; k < tokens.length && items.length < max; k++) {
    onProgress?.(k + 1, tokens.length);
    try {
      const id = await resolveVideoId(tokens[k].t);
      const { label, offset } = tokens[k];
      if (items.some((h) => h.videoId === id)) continue;
      const h = { videoId: id };
      if (label) h.label = label;
      if (offset != null) {
        hasOffsets = true;
        h.offset = offset;
      }
      if (tokens[k].ref && !ref) ref = id;
      items.push(h);
    } catch {
      bad++;
    }
  }
  return { items, ref, hasOffsets, meta, bad, tooMany: k < tokens.length };
}

/** 「# sync=…」の値が ON か */
const metaOn = (v) => /^(on|1|true|yes)$/i.test(String(v ?? '').trim());

/**
 * テキストから視聴セットを読み取る。コード (#Hakomado …) があればそれを、無ければ 1 行に 1 本として読む
 * (「# layout=…」があればレイアウト。「~秒」があれば同期のずれ。行の後ろの「# …」は枠の名前にする)
 * @returns {Promise<{ids: string[], labels: string[], layoutId: string|null, bad: number, tooMany: boolean, offsets: number[]|null, ref: number}>}
 */
async function parseViewingSet(text, onProgress) {
  const code = parseShareCode(text);
  if (code) return { ...code, labels: [], bad: 0, tooMany: false };
  const { items, ref, hasOffsets, meta, bad, tooMany } = await parseVideoLines(text, SHARE_MAX, onProgress);
  const ids = items.map((h) => h.videoId);
  const synced = hasOffsets || !!ref || metaOn(meta.sync);
  return {
    ids,
    labels: items.map((h) => h.label || ''),
    layoutId: meta.layout || null,
    bad,
    tooMany,
    offsets: synced ? items.map((h) => h.offset || 0) : null,
    ref: Math.max(0, ids.indexOf(ref)),
  };
}

/**
 * 貼られたテキストから再生リストを読む。
 * - 視聴セットのコード (#Hakomado …) があれば、その配信を並び順のまま (ずれが入っていれば同期再生にする)
 * - それ以外は 1 行に 1 本として読む (parseVideoLines。「# playlist=…」か取り込み用リンクの名前が再生リストの名前)
 * @returns {Promise<{items: {videoId: string, label?: string, offset?: number}[], name: string,
 *   opts: {sync: boolean, layoutId: string|null, ref: string|null}, bad: number, tooMany: boolean}>}
 */
async function parsePlaylistText(text, onProgress) {
  const code = parseShareCode(text);
  if (code) {
    const items = code.ids.map((videoId, k) => (code.offsets ? { videoId, offset: code.offsets[k] } : { videoId }));
    const opts = { sync: !!code.offsets, layoutId: code.layoutId, ref: code.offsets ? code.ids[code.ref] : null };
    return { items, name: '', opts, bad: 0, tooMany: false };
  }
  const { items, ref, hasOffsets, meta, bad, tooMany } = await parseVideoLines(text, Playlists.MAX_ITEMS, onProgress);
  const sync = hasOffsets || !!ref || metaOn(meta.sync);
  return { items, name: meta.playlist || '', opts: { sync, layoutId: meta.layout || null, ref }, bad, tooMany };
}

// ---- 再生リストの書き出し (共有用)

/** 行の後ろに付ける名前 (# や改行は入れない) */
const lineLabel = (h) => String(h.label || h.channel || '').replace(/[\r\n#]/g, ' ').replace(/\s+/g, ' ').trim();

/** 再生リストのテキスト形式 (parseVideoLines で読める。名前・同期再生の設定・ずれ・各行の名前もそのまま戻る) */
function playlistText(pl) {
  const lines = [`# playlist=${pl.name}`];
  if (pl.sync) {
    lines.push('# sync=on');
    if (pl.layoutId) lines.push(`# layout=${pl.layoutId}`);
  }
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

/** 再生リストの取り込み用リンク (先頭から 50 本。ずれは入らない) */
function playlistImportLink(pl) {
  const ids = pl.items.slice(0, IMPORT_LINK_MAX).map((h) => h.videoId);
  return `${YT}/watch_videos?video_ids=${ids.join(',')}&hakomado=${encodeURIComponent(pl.name)}`;
}

/** 同期再生で一度に並べる分 (同期再生の再生リストは 16 本までなので全部。順に再生の再生リストをコードにするときは先頭から 16 本) */
const syncItems = (pl) => pl.items.slice(0, SHARE_MAX);

/** 同期再生のレイアウト (決めていないか本数に足りなければ、本数に合わせて選ぶ) */
function playlistLayoutId(pl) {
  const n = Math.max(1, syncItems(pl).length);
  return LAYOUTS.find((l) => l.id === pl.layoutId && l.slots.length >= n)?.id || chooseLayoutFor(n).id;
}

/** 再生リストを視聴セットのコードにする (先頭から 16 本。同期再生ならずれと基準も入れる) */
function playlistShareCode(pl) {
  const items = syncItems(pl);
  if (!items.length) return '';
  const ids = items.map((h) => h.videoId);
  return formatShareCode(
    playlistLayoutId(pl),
    ids,
    pl.sync ? items.map((h) => h.offset ?? SyncOffsets.get(h.videoId)) : [],
    pl.sync ? Math.max(0, ids.indexOf(pl.ref)) : 0,
  );
}

/**
 * 視聴セットで今の枠を置き換える (同じ配信を表示中の枠はそのまま使い、読み込み直さない)。
 * offsets (動画ごとの同期のずれ) があれば記録し、アーカイブだと分かりしだい ref 番目の動画を基準に同期を始める
 */
async function applyViewingSet(ids, layoutId, { offsets = null, ref = 0, labels = [], resumeAt = null } = {}) {
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
  const refK = offsets && ref < ids.length ? ref : 0;
  setAudioSet([assigned[refK]]); // 音は先頭 (メイン) の枠。同期のずれ付きなら基準の枠
  if (offsets) offsets.forEach((o, k) => SyncOffsets.set(ids[k], o));
  renderAll();
  save();
  if (offsets) Sync.startWhenReady(assigned, assigned[refK], { at: resumeAt });
}

// ---- 共有画像
const SHARE_W = 1600;
const SHARE_H = 900;
const SHARE_FONT = '"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", sans-serif';

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

/** QR を描く (白い四角の中に、周りの余白 4 マスを取って) */
function drawQr(ctx, text, x, y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(size / (n + 8));
  const off = Math.floor((size - cell * n) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x + off + c * cell, y + off + r * cell, cell, cell);
  }
}

/** 共有画像 (PNG の Blob) を作る。title = 左下に大きく出す名前 (空なら「Hakomado 視聴セット」) */
async function renderShareImage(title = '') {
  const filled = shareTiles();
  const code = viewingSetCode();
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  // 左上: 今のレイアウトの形に、サムネイルとチャンネル名を並べる (枠の形は画面と同じ計算で 16:9 にそろえる)
  const area = { x: 48, y: 48, w: 1040, h: 585 };
  const l = state.layout;
  const { colW, rowH } = solveTracks(l);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const scale = Math.min(area.w / sum(colW), area.h / sum(rowH));
  const ox = area.x + (area.w - sum(colW) * scale) / 2;
  const oy = area.y + (area.h - sum(rowH) * scale) / 2;
  const thumbs = await Promise.all(filled.map((i) => loadThumb(state.tiles[i].videoId)));
  const GAP = 6;
  l.slots.forEach(([cx, cy, cw, chh], k) => {
    const x = ox + sum(colW.slice(0, cx)) * scale + GAP / 2;
    const y = oy + sum(rowH.slice(0, cy)) * scale + GAP / 2;
    const w = sum(colW.slice(cx, cx + cw)) * scale - GAP;
    const h = sum(rowH.slice(cy, cy + chh)) * scale - GAP;
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(x, y, w, h);
    if (k >= filled.length) return;
    const i = filled[k];
    if (thumbs[k]) drawCover(ctx, thumbs[k], x, y, w, h);
    // チャンネル名 (下に暗いぼかしを敷いて読めるように)
    const fs = Math.max(14, Math.min(30, Math.round(h / 9)));
    const grad = ctx.createLinearGradient(0, y + h - fs * 2.4, 0, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + h - fs * 2.4, w, fs * 2.4);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${fs}px ${SHARE_FONT}`;
    ctx.textBaseline = 'alphabetic';
    fillTextFit(ctx, tileName(i) || state.tiles[i].videoId, x + fs * 0.5, y + h - fs * 0.55, w - fs);
  });
  // 左下: 説明
  ctx.fillStyle = '#fff';
  ctx.font = `700 44px ${SHARE_FONT}`;
  fillTextFit(ctx, title.trim() || `${SHARE_TAG} ${tr('shareImageTitle')}`, 48, 706, 1040);
  ctx.fillStyle = '#a0a0ad';
  ctx.font = `400 28px ${SHARE_FONT}`;
  ctx.fillText(tr('shareImageCount', filled.length, l.name), 48, 760);
  ctx.font = `400 24px ${SHARE_FONT}`;
  fillTextFit(ctx, tr('shareImageHow'), 48, 830, 1040);

  // 右: QR (コード入り) とハッシュタグ
  drawQr(ctx, code, 1124, 48, 428);
  ctx.fillStyle = '#fff';
  ctx.font = `700 34px ${SHARE_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`#${SHARE_TAG}`, 1124 + 214, 532);
  ctx.fillStyle = '#a0a0ad';
  ctx.font = `400 22px ${SHARE_FONT}`;
  ctx.fillText(tr('shareImageQr'), 1124 + 214, 572);
  ctx.textAlign = 'start';

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}

/** 画像 (Blob) の中の QR を読む。読めなければ null */
async function readQrFromImage(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    // 大きすぎる画像は縮めて読む (読み取りが遅くなるため)。読めなければ元の大きさでも試す
    for (const max of [1600, Infinity]) {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * k);
      const h = Math.round(bmp.height * k);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, w, h);
      const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (hit?.data) return hit.data;
      if (k === 1) break;
    }
    return null;
  } finally {
    bmp.close();
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

function setupShare() {
  const dialog = document.getElementById('shareDialog');
  const out = document.getElementById('shareOut');
  const input = document.getElementById('shareIn');
  const copied = document.getElementById('shareCopied');
  const error = document.getElementById('shareError');
  const loadBtn = document.getElementById('shareLoad');
  const imgEl = document.getElementById('shareImg');
  const nameEl = document.getElementById('shareName');
  const imgBtns = ['shareImgCopy', 'shareImgSave', 'shareCopy', 'shareToPlaylist'].map((id) => document.getElementById(id));
  let imageBlob = null;
  let imageUrl = '';
  let renderSeq = 0;
  let nameTimer = 0;
  closeOnBackdrop(dialog);

  const setStatus = (el, text, isError = false) => {
    el.textContent = text;
    el.classList.toggle('share-error', isError);
  };

  /** 共有画像を作り直す (名前を打っている途中に作り直したときは、最後のものだけ使う) */
  const makeImage = async () => {
    const seq = ++renderSeq;
    setStatus(copied, tr('shareImageMaking'));
    for (const id of ['shareImgCopy', 'shareImgSave']) document.getElementById(id).disabled = true;
    try {
      const blob = await renderShareImage(nameEl.value);
      if (seq !== renderSeq) return;
      imageBlob = blob;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(blob);
      imgEl.src = imageUrl;
      setStatus(copied, '');
      for (const id of ['shareImgCopy', 'shareImgSave']) document.getElementById(id).disabled = false;
    } catch (e) {
      if (seq === renderSeq) setStatus(copied, tr('shareImageFail', e.message || e), true);
    }
  };
  // 名前は、このタブで最後に付けたものを次に開いたときも出しておく (同じ並びを何度か共有するとき用)
  // Enter で共有画面 (form method="dialog") が閉じないように
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  nameEl.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => viewingSetCode() && makeImage(), 300);
  });

  document.getElementById('openShare').addEventListener('click', async () => {
    const code = viewingSetCode();
    out.value = code;
    out.placeholder = code ? '' : tr('shareEmpty');
    for (const b of imgBtns) b.disabled = !code;
    setStatus(copied, '');
    setStatus(error, '');
    imageBlob = null;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = '';
    imgEl.removeAttribute('src');
    imgEl.classList.toggle('empty', !code);
    nameEl.disabled = !code;
    dialog.showModal();
    if (code) await makeImage();
  });

  document.getElementById('shareCopy').addEventListener('click', async () => {
    await copyField(out);
    setStatus(copied, tr('shareCopied'));
  });
  document.getElementById('shareToPlaylist').addEventListener('click', async () => {
    if (await playlistFromTiles({ notifyOnly: true })) dialog.close();
  });
  document.getElementById('shareImgCopy').addEventListener('click', async () => {
    if (!imageBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
      setStatus(copied, tr('shareImageCopied'));
    } catch (e) {
      setStatus(copied, tr('shareImageFail', e.message || e), true);
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

  /** テキストを読み込んで、今の枠を置き換える */
  const loadText = async (text) => {
    loadBtn.disabled = true;
    try {
      const { ids, labels, layoutId, bad, tooMany, offsets, ref } = await parseViewingSet(text, (done, total) => {
        setStatus(error, tr('shareLoading', done, total));
      });
      if (!ids.length) {
        setStatus(error, tr('shareNothing'), true);
        return;
      }
      await applyViewingSet(ids, layoutId, { offsets, ref, labels });
      setStatus(error, '');
      input.value = '';
      dialog.close();
      const notes = [bad ? tr('shareBadLines', bad) : '', tooMany ? tr('shareTooMany') : ''].filter(Boolean);
      notify([tr(offsets ? 'shareLoadedSync' : 'shareLoaded', ids.length), ...notes].join(' / '));
    } finally {
      loadBtn.disabled = false;
    }
  };
  /** 画像の QR を読んで、読めたら読み込む */
  const loadImage = async (blob) => {
    setStatus(error, tr('shareImageReading'));
    let text = null;
    try {
      text = await readQrFromImage(blob);
    } catch {
      /* 画像として読めない */
    }
    if (!text || !SHARE_CODE_RE.test(text)) {
      setStatus(error, tr('shareImageNoQr'), true);
      return;
    }
    input.value = text;
    await loadText(text);
  };
  loadBtn.addEventListener('click', () => loadText(input.value));

  // 画像の貼り付け (X の画像を「画像をコピー」したものなど)
  input.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    loadImage(file);
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
    if (file) {
      loadImage(file);
      return;
    }
    // ほかのタブからドラッグした画像は URL で届くので、取りに行く (X の画像は CORS で読める)
    try {
      const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(20000) });
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) loadImage(blob);
      else setStatus(error, tr('shareImageNoQr'), true);
    } catch {
      setStatus(error, tr('shareImageNoQr'), true);
    }
  });
}

// ---------------------------------------------------------------- 📥 再生リストを貼り付けて作る
// URL のリスト・共有された再生リストのテキスト・取り込み用リンク・視聴セットのコードを貼って保存する
// (再生リストは主にライブラリの画面で作る。こちらは人からもらったものや、AI チャットに作ってもらったものを入れる補助)。
// AI チャットへの頼み文のコピーもここ (折りたたみの中)。取り込み用リンクを開いたときもこの画面に入れて開く

/** 再生リストを作る画面を開く。text / name を渡すと貼り付け欄と名前を埋めておき、message を知らせ欄に出す (setupPlaylistDialog で中身が入る) */
let openPlaylistDialog = () => {};

function setupPlaylistDialog() {
  const dialog = document.getElementById('plDialog');
  const input = document.getElementById('plIn');
  const nameEl = document.getElementById('plName');
  const saveBtn = document.getElementById('plSave');
  const status = document.getElementById('plStatus');
  const aiCopied = document.getElementById('plAiCopied');
  closeOnBackdrop(dialog);
  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('share-error', isError);
  };
  // Enter で画面 (form method="dialog") が閉じないように
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  openPlaylistDialog = ({ text, name, message } = {}) => {
    aiCopied.textContent = '';
    setStatus(message || '');
    if (text != null) input.value = text;
    if (name != null) nameEl.value = name;
    if (!dialog.open) dialog.showModal();
    (text != null ? saveBtn : input).focus();
  };

  document.getElementById('plAi').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(await aiPromptText());
      aiCopied.textContent = tr('shareAiCopied');
    } catch {
      aiCopied.textContent = tr('shareAiFailed');
    }
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const { items, name, opts, bad, tooMany } = await parsePlaylistText(input.value, (done, total) => {
        setStatus(tr('shareLoading', done, total));
      });
      if (!items.length) {
        setStatus(tr('shareNothing'), true);
        return;
      }
      const r = await Playlists.save(nameEl.value.trim() || name || defaultPlaylistName(), items, opts);
      if (!r?.playlist) {
        setStatus(r?.full ? tr('plFull', Playlists.MAX_LISTS) : tr('plSaveFailed'), true);
        return;
      }
      setStatus('');
      input.value = '';
      nameEl.value = '';
      dialog.close();
      const saved = r.playlist.items.length;
      const cut = tooMany || saved < items.length;
      const tooManyNote = r.playlist.sync ? tr('plTooManySync', Playlists.SYNC_MAX) : tr('plTooMany', Playlists.MAX_ITEMS);
      const notes = [bad ? tr('shareBadLines', bad) : '', cut ? tooManyNote : ''].filter(Boolean);
      notify([tr(r.replaced ? 'plReplaced' : 'plSaved', r.playlist.name, saved), ...notes].join(' / '));
      // 保存した再生リストをライブラリで開く (そのまま「▶ 今の枠で順に再生」を押せるように)
      selectPlaylist(r.playlist.id);
      rememberLibraryTab('playlists');
      openFavorites(null, 'library');
    } finally {
      saveBtn.disabled = false;
    }
  });
}

/** 名前を付けずに保存したときの再生リストの名前 (例: 再生リスト 11/21 20:05) */
function defaultPlaylistName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return tr('plDefaultName', `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`);
}

/**
 * AI チャットに貼る頼み文。書き方 (Hakomado が読める形式) と、登録しているチャンネルの一覧を入れる。
 * 「見たいもの」は利用者が書き足す
 */
async function aiPromptText() {
  const favs = await Favorites.list();
  const ja = LANG === 'ja';
  const channels = favs.map((f) => `- ${f.star ? '📌 ' : ''}${f.name}${f.handle ? ` (${f.handle})` : ''} channel_id=${f.channelId}`);
  const today = new Date().toLocaleString(ja ? 'ja-JP' : 'en-US', { dateStyle: 'full', timeStyle: 'short' });
  if (ja) {
    return [
      'Hakomado (YouTube の配信を並べて見る Chrome 拡張機能) に登録する再生リストを作ってください。',
      `今は ${today} です。`,
      '',
      '## 見たいもの',
      '(ここに書いてください。例: 今週の箱企画のコラボ配信を、参加した全員の視点で / 明日の夜に見られる歌枠)',
      '',
      '## 出力してほしいもの',
      '1. 再生リストのテキスト (コードブロックで。1 行に 1 本、見る順に。最大 200 本):',
      '```',
      '# playlist=再生リストの名前',
      'https://www.youtube.com/watch?v=動画ID  # チャンネル名 / 配信タイトル',
      '```',
      '2. 取り込み用リンク (50 本まで。名前は URL エンコード):',
      'https://www.youtube.com/watch_videos?video_ids=動画ID,動画ID,...&hakomado=再生リストの名前',
      '',
      '## 調べ方のヒント',
      '- チャンネルのライブ配信 (予定を含む) の RSS: https://www.youtube.com/feeds/videos.xml?playlist_id=UULV + channel_id の 3 文字目以降',
      '- チャンネルの動画の RSS: https://www.youtube.com/feeds/videos.xml?channel_id=チャンネルID',
      '- ホロライブの配信予定 (ホロジュール): https://schedule.hololive.tv/',
      '- 動画 ID は実際に確認できたものだけを使い、推測で作らないでください。見つからなかったものは、リストの外に書いてください',
      '- 同じ企画を複数の視点で配信している場合は、まとめて並べてください',
      '',
      '## 私が登録しているチャンネル (📌 = 特によく見る)',
      ...channels,
    ].join('\n');
  }
  return [
    'Please make a playlist for Hakomado (a Chrome extension for watching several YouTube streams side by side).',
    `It is now ${today}.`,
    '',
    '## What I want to watch',
    '(Write here. e.g. this week’s group collab streams from every participant’s view / karaoke streams I can watch tomorrow night)',
    '',
    '## Output',
    '1. Playlist text (in a code block, one per line in watching order, up to 200):',
    '```',
    '# playlist=Playlist name',
    'https://www.youtube.com/watch?v=VIDEO_ID  # Channel name / stream title',
    '```',
    '2. Import link (up to 50 videos; URL-encode the name):',
    'https://www.youtube.com/watch_videos?video_ids=VIDEO_ID,VIDEO_ID,...&hakomado=Playlist%20name',
    '',
    '## Hints',
    '- RSS of a channel’s live streams (including upcoming): https://www.youtube.com/feeds/videos.xml?playlist_id=UULV + channel_id without its first 2 characters',
    '- RSS of a channel’s videos: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID',
    '- hololive schedule: https://schedule.hololive.tv/',
    '- Only use video IDs you actually confirmed; never guess them. List anything you could not find outside the playlist',
    '- When several people stream the same event from their own view, put them together',
    '',
    '## Channels I follow (📌 = watch most)',
    ...channels,
  ].join('\n');
}

/**
 * 取り込み用リンクから開いたとき (#import=…)。リンクの中身を「再生リストを作る」画面の貼り付け欄に入れて開き、名前を確かめて保存してもらう。
 * (YouTube の watch_videos の URL を、background.js がこの画面に付け替えて開く)
 */
function handleImportLink() {
  const PREFIX = '#import=';
  if (!location.hash.startsWith(PREFIX)) return;
  const raw = location.hash.slice(PREFIX.length);
  // 再読み込みでもう一度出さないよう、先に URL から外す
  history.replaceState(null, '', location.pathname + location.search);
  let link = null;
  try {
    link = parseWatchVideosLink(`${YT}/watch_videos?${decodeURIComponent(raw)}`);
  } catch {
    /* 壊れたリンク */
  }
  if (!link?.ids.length) {
    notify(tr('importNothing'));
    return;
  }
  openPlaylistDialog({
    text: link.ids.map((id) => `${YT}/watch?v=${id}`).join('\n'),
    name: link.name.slice(0, Playlists.NAME_MAX),
    message: tr('importReceived', link.ids.length),
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
 * 使い方・設定の画面の下にバージョンを出す。
 * version = リリースバージョン、version_name = コミット時にフックが書き込むビルド番号付きの表示 (無ければ version だけ)
 */
function showAppVersion() {
  const m = chrome.runtime.getManifest();
  const text = `Hakomado ${m.version_name || m.version}`;
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
  setupShare();
  setupPlaylistDialog();
  setupPlaylistPicker();
  setupPlaylistShare();
  setupPacks();
  Sync.setup();
  showAppVersion();
  document.getElementById('openHelp').addEventListener('click', openHelp);
  document.getElementById('tourReplay').addEventListener('click', () => {
    document.getElementById('help').close();
    Tour.start();
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

/**
 * チャンネル / ライブラリの画面を開く (同じ画面を入り口で使い分ける)。
 * view: 'channels' = 📺 チャンネル (配信中・配信予定と、チャンネルの追加・ピックアップ) /
 *       'library'  = 📚 ライブラリ (最近の配信・視聴履歴・あとで見る。前回見ていたタブを開く)
 */
function openFavorites(target, view) {
  favTarget = target;
  const favView = view === 'channels' ? 'channels' : 'library';
  favErrorEl.textContent = '';
  document.querySelector('.fav-target').textContent =
    target != null ? tr('favTarget', displayNumber(target)) : tr('favTargetAny');
  document.getElementById('favTitle').textContent = tr(favView === 'channels' ? 'chTitle' : 'libTitle');
  document.querySelector('.fav-tabs').hidden = favView === 'channels';
  setFavMode(favView === 'channels' ? 'all' : savedLibraryTab(), { render: false });
  if (!favDialog.open) favDialog.showModal();
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
  for (const f of favs) {
    const st = favStatus.get(f.channelId);
    if (!force && st && st !== 'error' && st !== 'loading') continue;
    if (st === 'loading' && favQueue.some((q) => q.f.channelId === f.channelId)) continue;
    if (st === 'loading' && !force) continue; // 取得中
    favStatus.set(f.channelId, 'loading');
    favQueue.push({ f, force });
  }
  renderFavorites(favs);
  while (favWorkers < 4 && favQueue.length) {
    favWorkers++;
    favWorker().finally(() => favWorkers--);
  }
}

async function favWorker() {
  for (let q = favQueue.shift(); q; q = favQueue.shift()) {
    try {
      favStatus.set(q.f.channelId, await Favorites.fetchStatus(q.f, { force: q.force }));
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

/** 見出し付きの一覧。action を渡すと見出しの右にボタンを出す */
function favSection(title, items, { cls = '', action = null } = {}) {
  const ul = document.createElement('ul');
  ul.className = 'fav-sub';
  ul.append(...items.flat());
  const sec = document.createElement('section');
  sec.className = `fav-section ${cls}`;
  const h = document.createElement('h3');
  const label = document.createElement('span');
  label.textContent = `${title} (${items.length})`; // 開いたアーカイブは数えない (items は行ごと)
  h.append(label);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'section-action';
    b.textContent = action.label;
    b.title = action.title || '';
    b.addEventListener('click', action.onClick);
    h.append(b);
  }
  sec.append(h, ul);
  return sec;
}

function renderFavorites(favs) {
  if (isVideoMode()) return; // 保存・履歴を表示中 (配信状況の取得が終わって描き直すときなど)
  const scope = libScopeNow(favs);
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
      favSection(tr('secLive'), live.map(favItem), {
        cls: 'live-sec',
        action: {
          label: tr('fillEmpty'),
          title: tr('fillEmptyTitle'),
          onClick: fillLiveIntoEmptyTiles,
        },
      }),
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

  // ▸: このチャンネルの最近の配信アーカイブを、行の下に開く
  const arch = li.querySelector('.fav-arch');
  const open = archiveOpen.has(f.channelId);
  arch.textContent = open ? '▾' : '▸';
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

// ---------------------------------------------------------------- 最近の配信 (ライブラリの「🎞 最近の配信」タブと、チャンネルの行の ▸)

const archiveData = new Map(); // channelId -> 'loading' | 'error' | [{videoId, title, at}]
const archiveOpen = new Set(); // ▸ で開いているチャンネル
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
  document.querySelector('.fav-target').hidden = isPl;
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
  let target = favTarget ?? firstEmptyTile();
  if (target == null && state.count < MAX_TILES) {
    addTileSlot();
    target = firstEmptyTile();
  }
  if (target == null) {
    favErrorEl.textContent = tr('noEmptyTile');
    return;
  }
  for (const set of [finishedIds, autoDismissed, membersBlocked]) set.delete(h.videoId);
  autoMissing.delete(h.videoId);
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
    mk('button', { type: 'button', textContent: tr('plShareBtn'), title: tr('plShareBtnTitle'), disabled: !pl.items.length, onclick: () => openPlaylistShare(pl.id) }),
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
async function playlistFromTiles({ notifyOnly = false } = {}) {
  const say = (text) => (notifyOnly ? notify(text) : (favErrorEl.textContent = text));
  const items = tileEntries();
  if (!items.length) {
    say(tr('shareEmpty'));
    return null;
  }
  const refTile = Sync.refIfOn();
  const sync = Sync.isOn() || items.some((x) => x.offset);
  const opts = { sync, layoutId: sync ? state.layoutId : null, ref: sync && refTile != null ? state.tiles[refTile].videoId : null };
  const r = await Playlists.create(defaultPlaylistName(), items, opts, { unique: true });
  if (!r.playlist) {
    say(tr(r.full ? 'plFull' : 'plSaveFailed', Playlists.MAX_LISTS));
    return null;
  }
  notify(tr('plSaved', r.playlist.name, items.length));
  showNewPlaylist(r.playlist);
  return r.playlist;
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
  if (r) Playlists.setResume(s.id, { ...r, savedAt: Date.now() });
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

// ---- 🔗 再生リストの共有
let plShareId = null;

async function openPlaylistShare(id) {
  const pl = await Playlists.get(id);
  if (!pl) return;
  plShareId = id;
  document.getElementById('plShareTitle').textContent = tr('plShareH', pl.name);
  document.getElementById('plShareText').value = playlistText(pl);
  document.getElementById('plShareLink').value = playlistImportLink(pl);
  document.getElementById('plShareCode').value = playlistShareCode(pl);
  document.getElementById('plShareLinkNote').textContent =
    pl.items.length > IMPORT_LINK_MAX ? tr('plShareLinkOver', IMPORT_LINK_MAX) : tr('plShareLinkNote', IMPORT_LINK_MAX);
  document.getElementById('plShareStatus').textContent = '';
  const d = document.getElementById('plShareDialog');
  if (!d.open) d.showModal();
}

function setupPlaylistShare() {
  const dialog = document.getElementById('plShareDialog');
  const status = document.getElementById('plShareStatus');
  closeOnBackdrop(dialog);
  const copy = async (el, msg) => {
    await copyField(el);
    status.textContent = tr(msg);
  };
  document.getElementById('plShareCopyText').addEventListener('click', (e) => copy(document.getElementById('plShareText'), 'plShareCopiedText'));
  document.getElementById('plShareCopyLink').addEventListener('click', () => copy(document.getElementById('plShareLink'), 'plShareCopiedLink'));
  document.getElementById('plShareCopyCode').addEventListener('click', () => copy(document.getElementById('plShareCode'), 'shareCopied'));
  // 開いている間に編集されたら作り直す
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[Playlists.KEY] && dialog.open && plShareId) openPlaylistShare(plShareId);
  });
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

// 他のタブで保存・削除したときも、表示中の一覧と 📃 の表示を直す
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes[Playlists.KEY]) return;
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

  /** パックの中身 (JSON) を確かめて、確認してから足す */
  const importText = async (text) => {
    let pack;
    try {
      pack = ChannelPack.parse(text);
    } catch (e) {
      setStatus(errorText(e), true);
      return;
    }
    const { added, existing } = await Favorites.previewPack(pack);
    if (!added) {
      setStatus(tr('packNothing', pack.name));
      return;
    }
    if (!confirm(tr('packConfirm', pack.name, added, existing))) {
      setStatus('');
      return;
    }
    const n = await Favorites.importPack(pack);
    input.value = '';
    setStatus(tr('packAdded', pack.name, n));
    await afterPresetsChanged();
  };

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

async function fillLiveIntoEmptyTiles() {
  const favs = await Favorites.list();
  if (favs.some((f) => favStatus.get(f.channelId) === 'loading')) {
    favErrorEl.textContent = tr('stillChecking');
    return;
  }
  const shown = new Set(state.tiles.filter((_, i) => isVisible(i)).map((t) => t.videoId));
  const lives = favs
    .map((f) => ({ f, st: favStatus.get(f.channelId) }))
    .filter(({ st }) => st?.state === 'live' && !shown.has(st.videoId));
  let placed = 0;
  for (const { f, st } of lives) {
    const i = firstEmptyTile();
    if (i == null) break;
    setTileVideo(i, st.videoId, f.handle || f.channelId);
    placed++;
  }
  if (lives.length === 0) favErrorEl.textContent = tr('noUnshownLive');
  else if (placed < lives.length) favErrorEl.textContent = tr('notEnoughTiles', lives.length - placed);
  else favDialog.close();
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
  document.getElementById('plImport').addEventListener('click', () => openPlaylistDialog());
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
function askChoice({ title, body, choices }) {
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
  dialog.addEventListener('cancel', (e) => e.preventDefault());
  dialog.showModal();
  wrap.firstElementChild?.focus();
  // 前の問いの close が遅れて届いても取り違えないよう、閉じている時だけ受け取る
  const onClose = () => {
    if (!dialog.open) done(dialog.returnValue);
  };
  dialog.addEventListener('close', onClose);
  answered.then(() => dialog.removeEventListener('close', onClose));
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
  try {
    remembered = sessionStorage.getItem(SESSION_TAB_KEY);
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
  body.textContent =
    inUse.size > 0
      ? tr('inUse', inUse.size)
      : tr('leftover');
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
  await Promise.all([loadSettings(), Favorites.seedPresets(), SyncOffsets.load()]);
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

  // インストール直後の 1 回だけ、使い方ツアーを出す (先に印を消して、他のタブでは出さない)
  const { tourPending } = await chrome.storage.local.get('tourPending');
  if (tourPending) {
    await chrome.storage.local.remove('tourPending');
    Tour.start();
  }
})();
