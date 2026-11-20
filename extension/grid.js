/* global Danmaku, LAYOUTS, DEFAULT_LAYOUT_ID, MAX_SLOTS, getLayout, solveTracks, LANG, LANG_PREF, tr, setLangPref */
'use strict';

const MAX_TILES = MAX_SLOTS;
const YT = 'https://www.youtube.com';

const DEFAULT_SETTINGS = {
  duration: 7, // 画面を横切る秒数
  fontScale: 1,
  opacity: 0.9,
  area: 0.75, // 弾幕を流す高さ (枠の高さに対する割合)
  areaPos: 'top', // 弾幕を流す位置: 'top' | 'middle' | 'bottom'
  maxOnScreen: 60,
  showAuthor: false,
  showPaid: true,
  // 音が出ている枠の表示
  hlStyle: 'sky',
  hlWidth: 2,
  hlGlow: 0.3,
  hlAnimate: false,
  // チャット欄
  chatZoom: 0.8,
  chatWidth: 0.28,
  chatHideAvatars: false,
  // 自動再生
  skipMembersOnly: true, // メンバーになっていないメンバー限定配信は入れない
  cruiseSec: 120, // クルーズでメイン枠 (と音声) を次の配信に回す間隔 (秒)
  prestartMin: 30, // 開始の何分前から、配信予定の枠を用意しておくか (0 = しない)
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
  // 'fit' = 各枠を 16:9 に合わせる (余白は外側にまとめる) / 'fill' = 画面いっぱい (映像の端を切る)
  fit: 'fit',
  // 自動再生: 配信中のお気に入りを全部再生し、配信開始で枠を足し、配信終了で枠を消す
  autoMode: false,
  // クルーズ: 一定時間ごとにメイン枠と音声を次の配信へ回す (いろいろな配信を少しずつ見る)
  cruise: false,
  danmakuAll: true,
  settings: { ...DEFAULT_SETTINGS },
  // 枠ごとの保存内容。枠数を減らしても全枠分保持しておき、増やしたときに復元する
  tiles: Array.from({ length: MAX_TILES }, () => newTileState()),
};

// auto = 自動再生で入れた枠 (配信が終わったら自動再生が消してよい枠) / label = その配信のお気に入りでの表示名
function newTileState() {
  return { input: '', videoId: null, chat: false, danmaku: true, muted: true, auto: false, label: '' };
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
}

/** 保存されている視聴セッションを state に読み込む (無ければ初期状態) */
function applySession(saved = {}) {
  state.tiles = Array.from({ length: MAX_TILES }, () => newTileState());
  state.order = Array.from({ length: MAX_TILES }, (_, i) => i);
  state.layoutId = DEFAULT_LAYOUT_ID;
  state.danmakuAll = typeof saved.danmakuAll === 'boolean' ? saved.danmakuAll : true;
  state.autoMode = saved.autoMode === true;
  state.cruise = saved.cruise === true;
  if (saved.fit === 'fit' || saved.fit === 'fill') state.fit = saved.fit;
  if (Array.isArray(saved.tiles)) {
    // 知っている項目だけ取り込む (古い版の項目や壊れた値を持ち込まない)
    const keys = Object.keys(newTileState());
    saved.tiles.slice(0, MAX_TILES).forEach((t, i) => {
      if (!t || typeof t !== 'object') return;
      const picked = Object.fromEntries(keys.filter((k) => k in t).map((k) => [k, t[k]]));
      state.tiles[i] = { ...newTileState(), ...picked, muted: true };
    });
  }
  // どのチャンネルがどの枠だったか (並び順) も戻す。今は無いレイアウトなら、同じ枠数に合うものに置き換える
  const layoutId = savedLayoutId(saved);
  if (layoutId) {
    state.layoutId = layoutId;
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

// 以前の版にあって今は無いレイアウト → その枠数。開き直したときは、同じ枠数に合うレイアウトに置き換える
const RETIRED_LAYOUT_SLOTS = { m3s4: 7, m3s9: 12 };

/** 保存されているレイアウト (今は無いものは置き換え先)。分からなければ null */
function savedLayoutId(saved) {
  if (typeof saved.layoutId !== 'string') return null;
  if (LAYOUTS.some((l) => l.id === saved.layoutId)) return saved.layoutId;
  const n = RETIRED_LAYOUT_SLOTS[saved.layoutId];
  return n ? chooseLayoutFor(n).id : null;
}

/** 保存されているセッションで表示されていた枠の数 */
function savedVisibleCount(saved) {
  return RETIRED_LAYOUT_SLOTS[saved.layoutId] || getLayout(saved.layoutId).slots.length;
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
  return chrome.storage.local.set({
    [SESSION_PREFIX + sessionId]: {
      layoutId: state.layoutId,
      order: state.order,
      fit: state.fit,
      autoMode: state.autoMode,
      cruise: state.cruise,
      danmakuAll: state.danmakuAll,
      tiles: state.tiles.map(({ muted, ...rest }) => rest),
      audible: audibleTiles(), // 音が出ている枠 (開き直したときに戻す。[] = 全部ミュート)
      updatedAt: Date.now(),
    },
  });
}

let settingsTimer = 0;
/** 共通設定を保存 (他のタブには storage.onChanged で伝わる) */
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => chrome.storage.local.set({ settings: state.settings }), 200);
}

// 他のタブで共通設定が変わったら、このタブにも反映する
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;
  const cruiseBefore = state.settings.cruiseSec;
  state.settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  applyHighlight();
  applyChatLook();
  syncSettingsInputs();
  if (state.settings.cruiseSec !== cruiseBefore) restartCruise();
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
  const res = await fetch(liveUrl, { credentials: 'include' });
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

/** 今の画面サイズでの「映像が画面を使っている割合」(16:9 に合わせる表示のとき) */
function screenUse(l) {
  const a = solveTracks(l).aspect;
  const s = Math.max(1, gridEl.clientWidth) / Math.max(1, gridEl.clientHeight);
  return Math.min(a, s) / Math.max(a, s);
}

/** レイアウト l の先頭 n 枠に映像を入れたとき、映像が画面を占める割合 (16:9 に合わせる表示で) */
function filledArea(l, n) {
  const { colW, rowH } = solveTracks(l);
  const W = Math.max(1, gridEl.clientWidth - GRID_GAP * (l.cols + 1));
  const H = Math.max(1, gridEl.clientHeight - GRID_GAP * (l.rows + 1));
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const scale = Math.min(W / sum(colW), H / sum(rowH));
  let area = 0;
  for (const [x, y, w, h] of l.slots.slice(0, n)) {
    area += sum(colW.slice(x, x + w)) * scale * sum(rowH.slice(y, y + h)) * scale;
  }
  return area / (W * H);
}

/**
 * n 本の配信を並べるのに向いたレイアウトを選ぶ。
 * 枠数がちょうど n のレイアウトがあればその中で映像が一番大きくなるもの、
 * 無ければ n より多い中で一番少ない枠数のものから選ぶ (空き枠をなるべく出さない)。
 * クルーズ中は、メイン枠を回して見られるよう「メイン + サブ」のレイアウトを優先する (合うものが無ければ均等)。
 * 使うのは自動再生が枠を組み替えるときだけ (クルーズを ON にしただけではレイアウトを変えない)
 */
function chooseLayoutFor(n) {
  let pool = LAYOUTS;
  if (state.cruise && n >= 3) {
    const withMain = LAYOUTS.filter((l) => l.mains > 0 && l.slots.length >= n);
    if (withMain.length) pool = withMain;
  }
  // 枠数がちょうど n のものが無ければ、n より多い中で一番少ない枠数のもの (空き枠をなるべく出さない)
  const enough = pool.filter((l) => l.slots.length >= n);
  const fewest = Math.min(...enough.map((l) => l.slots.length));
  const candidates = enough.filter((l) => l.slots.length === fewest);
  let best = null;
  for (const l of candidates) {
    const score = filledArea(l, n);
    if (!best || score > best.score + 0.01 || (Math.abs(score - best.score) <= 0.01 && l.slots.length < best.l.slots.length)) {
      best = { l, score };
    }
  }
  return best?.l ?? getLayout(DEFAULT_LAYOUT_ID);
}

function layout() {
  const l = state.layout;
  gridEl.classList.toggle('fill', state.fit === 'fill');
  if (state.fit === 'fill') {
    // 画面いっぱい: 格子を均等に割り、映像は枠に合わせて拡大 (端が切れる)
    gridEl.style.gridTemplateColumns = `repeat(${l.cols}, minmax(0, 1fr))`;
    gridEl.style.gridTemplateRows = `repeat(${l.rows}, minmax(0, 1fr))`;
  } else {
    // 16:9 に合わせる: どの枠もちょうど 16:9 になる列幅・行高を、画面に収まる最大の大きさで
    const { colW, rowH } = solveTracks(l);
    const availW = gridEl.clientWidth - GRID_GAP * (l.cols + 1);
    const availH = gridEl.clientHeight - GRID_GAP * (l.rows + 1);
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    const scale = Math.max(0, Math.min(availW / sum(colW), availH / sum(rowH)));
    gridEl.style.gridTemplateColumns = colW.map((v) => `${(v * scale).toFixed(2)}px`).join(' ');
    gridEl.style.gridTemplateRows = rowH.map((v) => `${(v * scale).toFixed(2)}px`).join(' ');
  }
  visibleIndexes().forEach((i, k) => {
    const [x, y, w, h] = l.slots[k];
    const el = views[i].el;
    el.style.gridColumn = `${x + 1} / span ${w}`;
    el.style.gridRow = `${y + 1} / span ${h}`;
    el.classList.toggle('main', k < l.mains);
    el.querySelector('.index').textContent = String(k + 1);
    el.querySelector('.empty-title').textContent = k < l.mains ? tr('slotMain', k + 1) : tr('slot', k + 1);
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
    postToFrame(v.player, { hukumado: 'fill', on: mode === 'fill' });
  }
  layout();
  save();
}

function setLayout(id) {
  // 隠れていた枠が再び表示されても勝手に音が出ないよう、今音が出ている枠以外はミュートにする
  const keep = audibleTiles();
  state.layoutId = getLayout(id).id;
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
    el.querySelector('.pick-fav').addEventListener('click', () => openFavorites(i));
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
  Object.assign(state.tiles[i], { input, videoId, auto: false, label: '' });
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
    hukumado: '1',
    hukumado_muted: t.muted ? '1' : '0',
    hukumado_fill: state.fit === 'fill' ? '1' : '0',
  });
  return `${YT}/watch?${p}`;
}

function chatUrl(t) {
  const p = new URLSearchParams({
    v: t.videoId,
    embed_domain: location.hostname,
    hukumado: '1',
    hukumado_zoom: String(state.settings.chatZoom),
    hukumado_noav: state.settings.chatHideAvatars ? '1' : '0',
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
}

/** チャット欄の見た目 (文字サイズ・アイコン) を開いているチャットへ反映 */
function applyChatLook() {
  const s = state.settings;
  document.documentElement.style.setProperty('--chat-width', `${Math.round(s.chatWidth * 100)}%`);
  for (const v of views) {
    postToFrame(v.chatFrame, { hukumado: 'chatLook', zoom: s.chatZoom, hideAvatars: s.chatHideAvatars });
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

  const danmakuOn = state.danmakuAll && t.danmaku;
  const needChat = visible && !!t.videoId && (t.chat || danmakuOn);

  // --- player
  if (!visible || !t.videoId) {
    v.player?.remove();
    v.player = null;
    v.meta = null;
    v.social = null;
  } else if (!v.player || reloadPlayer) {
    v.player?.remove();
    const f = document.createElement('iframe');
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.src = playerUrl(t);
    f.addEventListener('load', () => {
      f.dataset.loaded = '1';
      setTimeout(() => {
        applyAudio(i);
        postToFrame(f, { hukumado: 'away', on: !el.matches(':hover') });
      }, 800);
    });
    el.querySelector('.player-slot').appendChild(f);
    v.player = f;
    WatchHistory.opened(t.videoId, { label: t.label, input: t.input });
    v.meta = null;
    v.social = null;
  }

  // --- chat (チャット欄 表示中 or 弾幕 ON のときだけ読み込む)
  if (!needChat) {
    v.chatFrame?.remove();
    v.chatFrame = null;
  } else if (!v.chatFrame || reloadChat) {
    v.chatFrame?.remove();
    const f = document.createElement('iframe');
    f.src = chatUrl(t);
    f.addEventListener('load', () => (f.dataset.loaded = '1'));
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
  setToggle(el.querySelector('.bar [data-act="danmaku"]'), t.danmaku);
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
  postToFrame(v.player, { hukumado: 'social', act });
  // 返事が来なければ (プレイヤーの読み込み直しなど) 押せる状態に戻す
  setTimeout(() => {
    if (!v.socialBusy) return;
    v.socialBusy = false;
    updateSocialButtons(i);
  }, 12000);
}

// ---- 枠の ★ (お気に入りに登録): もうお気に入りに入っているチャンネルなら隠す
let favKeys = new Set(); // お気に入りのチャンネル ID と @ハンドル (小文字)
const favKey = (s) => {
  try {
    return decodeURIComponent(s).toLowerCase();
  } catch {
    return String(s).toLowerCase();
  }
};

async function refreshFavKeys() {
  const list = await Favorites.list();
  favKeys = new Set(list.flatMap((f) => [f.channelId, f.handle].filter(Boolean).map(favKey)));
  for (let i = 0; i < MAX_TILES; i++) updateFavButton(i);
}

function updateFavButton(i) {
  const t = state.tiles[i];
  const m = views[i].meta;
  // 自動再生で入れた枠などは入力 (@ハンドル / チャンネル ID) で、それ以外は枠のプレイヤーが知らせてきたチャンネルで判定
  const keys = [t.input, m?.handle, m?.channelId].filter(Boolean).map(favKey);
  views[i].el.querySelector('[data-act="fav"]').hidden = !!t.videoId && keys.some((k) => favKeys.has(k));
}

// お気に入りが変わったら (このタブでも他のタブでも) ★ の表示を直す
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
  postToFrame(v.player, { hukumado: 'away', on: away });
  if (away && v.player && document.activeElement === v.player) v.player.blur();
}

/** 操作バーに出すその枠の名前 (お気に入りの名前 → 配信のチャンネル名 → 入力した内容) */
function tileName(i) {
  const t = state.tiles[i];
  return t.label || views[i].meta?.channel || t.input || '';
}

function updateTileName(i) {
  const el = views[i].el.querySelector('.tile-name');
  const name = state.tiles[i].videoId ? tileName(i) : '';
  el.textContent = name;
  el.title = name;
}

function renderAll() {
  for (let i = 0; i < MAX_TILES; i++) renderTile(i);
  setToggle(document.getElementById('danmakuAll'), state.danmakuAll);
  layout();
}

/** 上部バーの ON / OFF ボタン (文字は変えず、見た目と aria-pressed で状態を出す) */
function setToggle(btn, on) {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

// ---------------------------------------------------------------- audio

function applyAudio(i) {
  postToFrame(views[i].player, { hukumado: 'audio', muted: state.tiles[i].muted });
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
      t.danmaku = !t.danmaku;
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
    console.warn('hukumado: 全画面にできませんでした', e);
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
    console.warn('hukumado: 全画面にできませんでした', e);
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
  if (!data || data.hukumado !== 'chat' || !Array.isArray(data.messages)) return;
  const i = views.findIndex((v) => v.chatFrame && v.chatFrame.contentWindow === e.source);
  if (i < 0) return;
  for (const msg of data.messages.slice(0, 50)) views[i].danmaku.add(msg);
});

// プレイヤー (watch ページ) からの連絡
window.addEventListener('message', (e) => {
  if (e.origin !== YT) return;
  const data = e.data;
  if (!data || typeof data.hukumado !== 'string') return;
  const i = views.findIndex((v) => v.player && v.player.contentWindow === e.source);
  if (i < 0) return;
  if (data.hukumado === 'userAudio') {
    // 枠内のプレイヤーのスピーカーで切り替え → この枠だけ切り替える (他の枠はそのまま。複数枠の同時再生用)
    setAudio(i, { on: !data.muted });
  } else if (data.hukumado === 'meta') {
    views[i].meta = {
      title: String(data.title || ''),
      channel: String(data.channel || ''),
      handle: String(data.handle || ''),
      channelId: String(data.channelId || ''),
    };
    updateTileName(i);
    updateFavButton(i);
    WatchHistory.update(state.tiles[i].videoId, { ...views[i].meta, label: state.tiles[i].label });
    updateNowPlaying();
  } else if (data.hukumado === 'playability') {
    onPlayability(i, String(data.status || ''), String(data.text || ''));
  } else if (data.hukumado === 'ended') {
    onEnded(i, data.reason === 'played' ? 'played' : 'already');
  } else if (data.hukumado === 'social') {
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
  if (!t.videoId || status === 'OK' || status === 'LIVE_STREAM_OFFLINE' || !Favorites.isMembersBlock(text)) return;
  Favorites.rememberMembersOnly(t.videoId);
  membersBlocked.add(t.videoId);
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

function layoutThumb(l) {
  const box = document.createElement('div');
  box.className = 'layout-thumb';
  box.style.gridTemplateColumns = `repeat(${l.cols}, 1fr)`;
  box.style.gridTemplateRows = `repeat(${l.rows}, 1fr)`;
  l.slots.forEach(([x, y, w, h], k) => {
    const cell = document.createElement('div');
    cell.className = k < l.mains ? 'cell main' : 'cell';
    cell.style.gridColumn = `${x + 1} / span ${w}`;
    cell.style.gridRow = `${y + 1} / span ${h}`;
    box.appendChild(cell);
  });
  return box;
}

/**
 * 上部バーのレイアウト名の幅を、いちばん長い名前に合わせて固定する
 * (自動再生でレイアウトが変わるたびに、後ろのボタンが左右に動かないように)。
 * 狭い画面で名前を隠しているときも測れるよう、canvas で文字の幅を測る
 */
function fixLayoutLabelWidth() {
  const label = document.getElementById('layoutName');
  const ctx = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(label);
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const w = Math.max(...LAYOUTS.map((l) => ctx.measureText(l.name).width));
  label.style.width = `${Math.ceil(w) + 2}px`;
}

function setupLayoutPicker() {
  fixLayoutLabelWidth();
  const dialog = document.getElementById('layoutPicker');
  const body = document.getElementById('layoutGroups');
  const groups = [...new Set(LAYOUTS.map((l) => l.group))];
  for (const g of groups) {
    const section = document.createElement('section');
    section.className = 'layout-group';
    const h = document.createElement('h3');
    h.textContent = g === 'uniform' ? tr('groupUniform') : tr('groupMain');
    const list = document.createElement('div');
    list.className = g === 'uniform' ? 'layout-list uniform' : 'layout-list';
    for (const l of LAYOUTS.filter((x) => x.group === g)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'layout-option';
      btn.dataset.id = l.id;
      btn.title = tr('layoutTitle', l.name, l.slots.length);
      const label = document.createElement('span');
      label.className = 'layout-name';
      label.textContent = l.name;
      const use = document.createElement('span');
      use.className = 'layout-use';
      btn.append(layoutThumb(l), label, use);
      btn.addEventListener('click', () => {
        setLayout(l.id);
        dialog.close();
      });
      list.appendChild(btn);
    }
    section.append(h, list);
    body.appendChild(section);
  }

  const fitButtons = dialog.querySelectorAll('[data-fit]');
  const refresh = () => {
    for (const b of fitButtons) b.classList.toggle('selected', b.dataset.fit === state.fit);
    for (const b of body.querySelectorAll('.layout-option')) {
      b.classList.toggle('current', b.dataset.id === state.layoutId);
      const pct = Math.round(screenUse(getLayout(b.dataset.id)) * 100);
      const use = b.querySelector('.layout-use');
      use.textContent = `${pct}%`;
      use.classList.toggle('good', pct >= 90);
    }
    body.classList.toggle('show-use', state.fit === 'fit');
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

const SETTING_CHECKBOXES = ['showAuthor', 'showPaid', 'chatHideAvatars', 'hlAnimate', 'skipMembersOnly'];

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
  for (const b of document.querySelectorAll('.hl-swatch')) b.classList.toggle('selected', b.dataset.id === normalizeHlStyle(state.settings.hlStyle));
  for (const b of document.querySelectorAll('.dm-pos-seg [data-pos]')) {
    const on = b.dataset.pos === (state.settings.areaPos || 'top');
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  }
  applyDanmakuArea();
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

function setupToolbar() {
  setupLayoutPicker();

  document.getElementById('nowPlaying').addEventListener('click', toggleMuteAll);
  document.getElementById('danmakuAll').addEventListener('click', toggleDanmakuAll);

  const dialog = document.getElementById('settings');
  document.getElementById('openSettings').addEventListener('click', () => dialog.showModal());
  document.getElementById('openHelp').addEventListener('click', openHelp);
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
      localStorage.setItem('hukumado.settingsTab', name);
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
    initialTab = localStorage.getItem('hukumado.settingsTab') || initialTab;
  } catch {
    /* ignore */
  }
  showTab([...tabs].some((t) => t.dataset.tab === initialTab) ? initialTab : 'danmaku');

  const chatKeys = new Set(['chatZoom', 'chatWidth', 'chatHideAvatars']);
  const hlKeys = new Set(['hlWidth', 'hlGlow', 'hlAnimate']);
  const onSettingChanged = (key) => {
    if (chatKeys.has(key)) applyChatLook();
    if (hlKeys.has(key)) applyHighlight();
    if (key === 'area' || key === 'areaPos') {
      applyDanmakuArea();
      flashDanmakuArea();
    }
    if (key === 'cruiseSec') restartCruise();
    saveSettings();
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

  // 音が出ている枠の色 (見本をクリックで選択)
  const swatches = document.getElementById('hlSwatches');
  for (const [id, p] of Object.entries(HL_PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hl-swatch';
    b.dataset.id = id;
    const chip = document.createElement('i');
    chip.style.background = hlGradient(p);
    const label = document.createElement('span');
    label.textContent = p.name;
    b.title = p.name;
    b.append(chip, label);
    b.addEventListener('click', () => {
      state.settings.hlStyle = id;
      syncSettingsInputs();
      applyHighlight();
      saveSettings();
    });
    swatches.appendChild(b);
  }
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
    // Shift+F: 分割したまま全画面 (F だけならお気に入り)
    if (e.shiftKey && e.code === 'KeyF') {
      toggleGridFullscreen();
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      toggleMuteAll();
    } else if (e.key === 'd' || e.key === 'D') {
      toggleDanmakuAll();
    } else if (e.key === '?') {
      openHelp();
    } else if (e.key === 'f' || e.key === 'F') {
      openFavorites(null);
    } else if (e.key === 'l' || e.key === 'L') {
      setAutoMode(!state.autoMode);
    } else if (e.key === 'c' || e.key === 'C') {
      setCruise(!state.cruise);
    } else if (/^[1-9]$/.test(e.key)) {
      const i = visibleIndexes()[parseInt(e.key, 10) - 1];
      if (i != null) setAudio(i, { solo: true });
    }
  });

  new ResizeObserver(() => layout()).observe(gridEl);
  setupFavorites();
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

function openFavorites(target) {
  favTarget = target;
  favErrorEl.textContent = '';
  document.querySelector('.fav-target').textContent =
    target != null ? tr('favTarget', displayNumber(target)) : tr('favTargetAny');
  if (!favDialog.open) favDialog.showModal();
  refreshFavorites(false);
  if (favMode === 'history') renderHistory();
  else updateRestoreLink();
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
      console.warn('hukumado: 配信状況の取得に失敗', q.f.name, e);
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
  ul.append(...items);
  const sec = document.createElement('section');
  sec.className = `fav-section ${cls}`;
  const h = document.createElement('h3');
  const label = document.createElement('span');
  label.textContent = `${title} (${items.length})`;
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
  if (favMode === 'history') return; // 履歴を表示中 (配信状況の取得が終わって描き直すときなど)
  const q = favFilter.trim().toLowerCase();
  const shown = q
    ? favs.filter((f) => [f.name, f.nameJa, f.handle, f.group].some((s) => (s || '').toLowerCase().includes(q)))
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
  if (upcoming.length) sections.push(favSection(tr('secUpcoming'), upcoming.map(favItem)));
  // それ以外はまとめて 1 つの一覧 (自分で追加したチャンネル → 既定のチャンネルの順)
  rest.sort((a, b) => Number(!!a.f.preset) - Number(!!b.f.preset));
  if (rest.length) sections.push(favSection(live.length || upcoming.length ? tr('secOther') : tr('secAll'), rest.map(favItem), { cls: 'rest-sec' }));
  favListEl.replaceChildren(...sections);
  document.getElementById('favEmpty').textContent = q
    ? tr('favNoMatch', favFilter)
    : tr('favEmpty');
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
    const shownIn = visibleIndexes().filter((i) => state.tiles[i].videoId === st.videoId);
    if (shownIn.length) li.querySelector('.fav-where').textContent = tr('shownIn', shownIn.map(displayNumber).join(', '));
    li.addEventListener('click', () => pickFavorite(f, st));
  }

  li.querySelector('.fav-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(tr('confirmRemove', f.name))) return;
    await Favorites.remove(f.channelId);
    favStatus.delete(f.channelId);
    renderFavorites(await Favorites.list());
    updateRestoreLink();
  });
  return li;
}

// ---------------------------------------------------------------- 視聴履歴 (お気に入り画面の「履歴」タブ)

let favMode = 'fav'; // 'fav' | 'history'

/** お気に入り / 履歴 を切り替える。履歴ではチャンネルの追加欄・更新ボタンを隠す */
function setFavMode(mode, { render = true } = {}) {
  favMode = mode === 'history' ? 'history' : 'fav';
  try {
    localStorage.setItem('hukumado.favTab', favMode);
  } catch {
    /* ignore */
  }
  const isHistory = favMode === 'history';
  for (const b of document.querySelectorAll('[data-favtab]')) {
    const on = b.dataset.favtab === favMode;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-selected', String(on));
  }
  document.getElementById('favRefresh').hidden = isHistory;
  document.getElementById('favLiveCount').hidden = isHistory;
  document.getElementById('favAdd').hidden = isHistory;
  if (isHistory) document.getElementById('favRestore').hidden = true;
  else updateRestoreLink();
  document.getElementById('historyClear').hidden = !isHistory;
  favErrorEl.textContent = '';
  if (render) renderFavPane();
}

async function renderFavPane() {
  if (favMode === 'history') await renderHistory();
  else renderFavorites(await Favorites.list());
}

const REASON_KEYS = { ended: 'reasonEnded', closed: 'reasonClosed', members: 'reasonMembers', replaced: 'reasonReplaced' };

async function renderHistory() {
  if (favMode !== 'history') return;
  const all = await WatchHistory.list();
  const q = favFilter.trim().toLowerCase();
  const shown = q
    ? all.filter((h) => [h.title, h.channel, h.handle, h.label, h.input].some((s) => (s || '').toLowerCase().includes(q)))
    : all;
  if (favMode !== 'history') return; // 読み込んでいる間に切り替えられた
  const ul = document.createElement('ul');
  ul.className = 'fav-sub';
  ul.append(...shown.map(historyItem));
  favListEl.replaceChildren(...(shown.length ? [ul] : []));
  document.getElementById('favEmpty').textContent = q ? tr('historyNoMatch', favFilter) : tr('historyEmpty');
  document.getElementById('historyClear').hidden = all.length === 0;
}

function historyItem(h) {
  const li = document.getElementById('favItemTemplate').content.firstElementChild.cloneNode(true);
  li.classList.add('history');
  li.title = tr('historyPick');
  li.querySelector('.fav-name').textContent = h.label || h.channel || h.handle || h.videoId;
  li.querySelector('.fav-title').textContent = h.title || '';
  li.querySelector('.badge').textContent = h.reason ? tr(REASON_KEYS[h.reason] || 'reasonReplaced') : '';
  const where = [formatStart(h.at)];
  const shownIn = visibleIndexes().filter((i) => state.tiles[i].videoId === h.videoId);
  if (shownIn.length) where.push(tr('shownIn', shownIn.map(displayNumber).join(', ')));
  li.querySelector('.fav-where').textContent = where.filter(Boolean).join(' ・ ');
  const thumb = li.querySelector('.fav-thumb');
  thumb.addEventListener('error', () => thumb.removeAttribute('src'), { once: true });
  thumb.loading = 'lazy';
  thumb.src = `https://i.ytimg.com/vi/${h.videoId}/mqdefault.jpg`;
  li.addEventListener('click', () => loadFromHistory(h));
  const del = li.querySelector('.fav-del');
  del.title = tr('historyDel');
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    await WatchHistory.remove(h.videoId);
    renderHistory();
  });
  return li;
}

/**
 * 履歴から枠に読み込む。空いている枠が無ければ (16 枠未満なら) 枠を 1 つ足す。
 * 誤判定や誤操作から戻せるように、自動再生の「終わった」「✕ で閉じた」「メンバー限定」の記録はこの配信について消す。
 * 自動再生中で、いま配信中・配信予定のお気に入りの配信なら自動再生の枠として扱う (終わったら片付ける)
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
  if (area === 'local' && changes[WatchHistory.KEY] && favDialog.open && favMode === 'history') renderHistory();
});

async function updateRestoreLink() {
  const n = await Favorites.removedPresetCount();
  const btn = document.getElementById('favRestore');
  btn.hidden = n === 0 || favMode === 'history';
  btn.textContent = tr('restorePresets', n);
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
 * お気に入り全部の配信状況を (待って) 取り、配信中のものと配信予定を返す。
 * lives = 配信中 (お気に入りの並び順)、upcoming = 配信予定 (開始が早い順。配信中と同じ配信は除く)
 * errors = 取得に失敗した件数 (失敗があった回は、自動再生は枠を消さない)
 */
async function collectLiveFavorites({ force = false } = {}) {
  const favs = await Favorites.list();
  const results = [];
  let errors = 0;
  let next = 0;
  const worker = async () => {
    while (next < favs.length) {
      const f = favs[next++];
      try {
        const st = await Favorites.fetchStatus(f, { force });
        favStatus.set(f.channelId, st);
        results.push({ f, st });
      } catch (e) {
        console.warn('hukumado: 配信状況の取得に失敗', f.name, e);
        favStatus.set(f.channelId, 'error');
        errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // 同じ配信 (コラボ等) は 1 つにまとめ、お気に入りの並び順 (自分で追加したもの → 既定) にそろえる
  const seen = new Set();
  const order = new Map(favs.map((f, n) => [f.channelId, (f.preset ? 1e6 : 0) + n]));
  const lives = results
    .filter(({ st }) => st?.state === 'live' && !seen.has(st.videoId) && seen.add(st.videoId))
    .sort((a, b) => order.get(a.f.channelId) - order.get(b.f.channelId));
  const upcoming = results
    .filter(({ st }) => st?.state === 'upcoming' && st.startAt && !seen.has(st.videoId) && seen.add(st.videoId))
    .sort((a, b) => a.st.startAt - b.st.startAt || order.get(a.f.channelId) - order.get(b.f.channelId));
  return { lives, upcoming, errors };
}

const FALLBACK_WINDOW_MS = 60 * 60 * 1000; // 配信中が無いときに載せる配信予定の範囲 (1 時間以内)

/**
 * 自動再生で枠に載せる配信を決める。
 * - 配信中のもの + 開始まで prestartMin 分以内の配信予定 (始まる前から枠を用意して、最初から見られるように)
 * - 配信中が 1 つも無いときは、1 時間以内に始まる配信予定を全部。それも無ければ一番近い配信予定
 *   (同じ時刻に始まるものは全部)
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
  const within = upcoming.filter((u) => u.st.startAt - now <= Math.max(preMs, FALLBACK_WINDOW_MS));
  if (within.length) return { targets: within, fallback: true };
  if (!upcoming.length) return { targets: [], fallback: false };
  const first = upcoming[0].st.startAt;
  return { targets: upcoming.filter((u) => u.st.startAt === first), fallback: true };
}

/** 配信予定なら「名前 (開始時刻)」、配信中なら名前だけ */
function targetLabel({ f, st }) {
  return st.state === 'upcoming' ? `${f.name} (${formatStart(st.startAt)})` : f.name;
}

/**
 * 自動再生を ON にしたときの最初の 1 回: 配信中のお気に入りを全部 (最大 16) 、件数に合ったレイアウトで再生する。
 * 表示中の配信は読み込み直さずに残し、配信中でない枠は空にする
 */
async function startAllLive() {
  const collected = await collectLiveFavorites({ force: true });
  const { targets, fallback } = autoTargets(collected);
  const { ok, blocked } = await filterAccessible(targets);
  let lives = ok;
  if (lives.length === 0) {
    notify(
      blocked.length
        ? tr('onlyMembers', blocked.join(tr('sep')))
        : tr('noneLive'),
    );
    return;
  }
  const total = lives.length;
  // すでに表示している配信は先頭に (メイン枠に残す)、それ以外はお気に入りの並び順
  const shownBefore = visibleIndexes().map((i) => state.tiles[i].videoId);
  lives.sort((a, b) => {
    const ia = shownBefore.indexOf(a.st.videoId);
    const ib = shownBefore.indexOf(b.st.videoId);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  lives = lives.slice(0, MAX_TILES);

  const audibleBefore = audibleTiles().map((i) => state.tiles[i].videoId);
  const layout = chooseLayoutFor(lives.length);

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
  state.order = [...assigned, ...state.order.filter((j) => !assigned.includes(j))];
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
  setAudioSet(keep.length ? keep : [assigned[0]]);
  renderAll();
  save();
  if (favDialog.open) favDialog.close();
  restartCruise();
  const skipped = blocked.length ? tr('skippedCount', blocked.length) : '';
  const soonCount = lives.filter((l) => l.st.state === 'upcoming').length;
  const head = fallback
    ? tr('upcomingShown', lives.map(targetLabel).join(tr('sep')), layout.name)
    : total > MAX_TILES
      ? tr('playingSome', total, MAX_TILES, layout.name)
      : soonCount
        ? tr('playingWithSoon', total - soonCount, soonCount, layout.name)
        : tr('playingAll', total, layout.name);
  notify(head + skipped);
}

// ---- メンバー限定の除外
const membersBlocked = new Set(); // 枠のプレイヤーが「メンバー限定で見られない」と知らせてきた配信
const membersAnnounced = new Set(); // 除外したことを知らせた配信 (同じ配信を何度も知らせない)

/**
 * 設定が ON なら、メンバー限定でメンバーではない配信を除く。
 * @returns {Promise<{ok: Array, blocked: string[]}>} blocked = 今回初めて除外した配信の名前
 */
async function filterAccessible(lives) {
  if (!state.settings.skipMembersOnly || lives.length === 0) return { ok: lives, blocked: [] };
  const results = new Array(lives.length);
  let next = 0;
  const worker = async () => {
    while (next < lives.length) {
      const k = next++;
      const id = lives[k].st.videoId;
      results[k] = membersBlocked.has(id) ? 'members' : await Favorites.checkAccess(id);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const ok = lives.filter((_, k) => results[k] !== 'members');
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
  if (autoBusy && on) return;
  state.autoMode = on;
  clearInterval(autoTimer);
  autoTimer = 0;
  save();
  const btn = document.getElementById('autoMode');
  setToggle(btn, on);
  if (!on) return; // OFF: 今の枠はそのまま、増減だけ止める

  autoDismissed.clear();
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

/** 1 回分の確認: 配信が始まったお気に入りの枠を足し、終わった配信の枠を消してレイアウトを組み替える */
async function autoTick() {
  if (!state.autoMode || autoBusy) return;
  autoBusy = true;
  try {
    await autoTickOnce();
  } finally {
    autoBusy = false;
  }
}

async function autoTickOnce() {
  try {
    const collected = await collectLiveFavorites({ force: true });
    const { errors } = collected;
    const { targets: lives } = autoTargets(collected); // 配信中 + まもなく始まる予定 (配信中が無ければ近い予定)
    const liveIds = new Set(lives.map((l) => l.st.videoId));
    const visible = visibleIndexes().filter((i) => state.tiles[i].videoId);

    // 終わった配信 (自動で入れた枠だけ。取得に失敗した回は消さない)
    const ended = [];
    for (const i of visible) {
      const t = state.tiles[i];
      if (liveIds.has(t.videoId)) {
        autoMissing.delete(t.videoId);
        continue;
      }
      if (!t.auto || errors > 0) continue;
      const n = (autoMissing.get(t.videoId) || 0) + 1;
      autoMissing.set(t.videoId, n);
      if (n >= AUTO_MISS_LIMIT) ended.push(i);
    }

    // 始まった配信 (まだ表示していないもの。自分で閉じたものは除く)
    const shownIds = new Set(visible.map((i) => state.tiles[i].videoId));
    const keep = visible.filter((i) => !ended.includes(i));
    const candidates = lives.filter((l) => !shownIds.has(l.st.videoId) && !autoDismissed.has(l.st.videoId));
    // メンバー限定の確認は、まだ表示していない配信だけ (表示中のものは枠のプレイヤーが知らせてくる)
    const { ok: accessible, blocked } = await filterAccessible(candidates);
    if (!state.autoMode) return; // 確認している間に OFF にされた
    const started = accessible.slice(0, Math.max(0, MAX_TILES - keep.length));
    const blockedMsg = blocked.length ? tr('membersSkipped', blocked.join(tr('sep'))) : '';

    if (ended.length === 0 && started.length === 0) {
      if (blockedMsg) notify(blockedMsg);
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
    const nextVisible = [...keep, ...added];
    if (nextVisible.length > 0) {
      state.layoutId = chooseLayoutFor(nextVisible.length).id;
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
  } catch (e) {
    console.warn('hukumado: 自動再生の確認に失敗', e);
  }
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

/** 画面下中央に短いお知らせを出す */
function notify(text) {
  const el = document.getElementById('globalToast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3500);
}

function setupFavorites() {
  document.getElementById('openFavorites').addEventListener('click', () => openFavorites(null));
  document.getElementById('favClose').addEventListener('click', () => favDialog.close());
  document.getElementById('favRefresh').addEventListener('click', () => refreshFavorites(true));
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

  // お気に入り / 履歴 の切り替え (前回見ていた方を覚えておく)
  for (const b of document.querySelectorAll('[data-favtab]')) b.addEventListener('click', () => setFavMode(b.dataset.favtab));
  let savedMode = 'fav';
  try {
    savedMode = localStorage.getItem('hukumado.favTab') === 'history' ? 'history' : 'fav';
  } catch {
    /* ignore */
  }
  setFavMode(savedMode, { render: false });
  document.getElementById('historyClear').addEventListener('click', async () => {
    const n = (await WatchHistory.list()).length;
    if (!n || !confirm(tr('historyClearConfirm', n))) return;
    await WatchHistory.clear();
    renderHistory();
  });

  document.getElementById('favRestore').addEventListener('click', async () => {
    await Favorites.restorePresets();
    await updateRestoreLink();
    await refreshFavorites(false);
  });
}

/** 枠の操作バーの ★: この枠で見ている配信のチャンネルをお気に入りに登録 */
async function addTileToFavorites(i) {
  const t = state.tiles[i];
  if (!t.videoId) return;
  const btn = views[i].el.querySelector('[data-act="fav"]');
  btn.disabled = true;
  showToast(i, tr('favAdding'));
  try {
    const { info, added } = await Favorites.add(t.videoId);
    favStatus.delete(info.channelId);
    showToast(i, added ? tr('favAdded', info.name) : tr('favExists', info.name));
    // 入れたチャンネルの ID も覚えておく (枠のプレイヤーが知らせてくるのが @ハンドルだけでないときのため)
    favKeys.add(favKey(info.channelId));
    updateFavButton(i);
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
    const { info, added } = await Favorites.add(raw);
    favErrorEl.textContent = added ? '' : tr('favExists', info.name);
    onSuccess?.();
    favStatus.delete(info.channelId);
    await refreshFavorites(false);
  } catch (e) {
    favErrorEl.textContent = e.message || String(e);
  }
}

function toggleDanmakuAll() {
  state.danmakuAll = !state.danmakuAll;
  renderAll();
  save();
}

// ---------------------------------------------------------------- boot

async function registerTab() {
  // このタブだけに iframe 表示用のヘッダー書き換えルールを効かせる
  const res = await chrome.runtime.sendMessage({ type: 'register-grid-tab' });
  if (!res?.ok) console.warn('hukumado: ルールの登録に失敗しました', res);
  window.addEventListener('pagehide', () => {
    saveNow(); // 閉じる直前の状態 (音声の切り替えなど、まだ保存していない分) を残す
    chrome.runtime.sendMessage({ type: 'unregister-grid-tab' }).catch(() => {});
  });
}

// ---------------------------------------------------------------- 起動 (視聴セッションの選択)
// タブ (ウィンドウ) ごとに別の視聴セッションを持つ。開いたときに、他のタブで使っていない
// 前回のセッションがあれば「続きから / 新しく / 自動再生で」を選ぶ。同じタブの再読み込みは確認なしで続ける

const sessionChannel = new BroadcastChannel('hukumado-sessions');
const SESSION_TAB_KEY = 'hukumado.sessionId'; // sessionStorage: このタブで使っていた視聴セッション (再読み込み用)

/** 他のタブで使用中の視聴セッション ID を集める */
function sessionsInUse() {
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

// 後から開いたタブからの問い合わせに、このタブの視聴セッションを答える
sessionChannel.addEventListener('message', (e) => {
  if (e.data?.type === 'who' && sessionId) sessionChannel.postMessage({ type: 'in-use', sessionId });
});

/** 選択肢を出して、選ばれたものの value を返す (Esc では閉じない) */
function askChoice({ title, body, choices }) {
  const dialog = document.getElementById('startDialog');
  document.getElementById('startTitle').textContent = title;
  document.getElementById('startBody').replaceChildren(...(Array.isArray(body) ? body : [body]));
  const wrap = document.getElementById('startChoices');
  wrap.replaceChildren(
    ...choices.map((c, n) => {
      const b = document.createElement('button');
      b.value = c.value;
      b.className = n === 0 ? 'primary' : '';
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
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
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

  // 新しく始めるときも、表示方法 (16:9 / 画面いっぱい) は直近のもの (使用中のタブを含む) を引き継ぐ
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
  await Promise.all([loadSettings(), Favorites.seedPresets()]);
  buildTiles();
  refreshFavKeys().catch(() => {});
  setupDragSwap();
  setupToolbar();
  layout();

  const startAuto = await chooseSession();
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
})();
