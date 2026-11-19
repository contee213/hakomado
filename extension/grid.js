/* global Danmaku, LAYOUTS, DEFAULT_LAYOUT_ID, MAX_SLOTS, getLayout, solveTracks */
'use strict';

const MAX_TILES = MAX_SLOTS;
const YT = 'https://www.youtube.com';

const DEFAULT_SETTINGS = {
  duration: 7, // 画面を横切る秒数
  fontScale: 1,
  opacity: 0.9,
  area: 0.75,
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
  if (typeof saved.layoutId === 'string' && LAYOUTS.some((l) => l.id === saved.layoutId)) {
    state.layoutId = saved.layoutId;
    if (isPermutation(saved.order)) state.order = saved.order;
  }
  // 起動時は最初の 1 枠だけ音を出す
  const first = state.tiles.findIndex((t, i) => isVisible(i) && t.videoId);
  if (first >= 0) state.tiles[first].muted = false;
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
      danmakuAll: state.danmakuAll,
      tiles: state.tiles.map(({ muted, ...rest }) => rest),
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
  state.settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  applyHighlight();
  applyChatLook();
  syncSettingsInputs();
});

// ---------------------------------------------------------------- input parsing

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** URL / 動画ID / @handle / チャンネルURL から動画IDを得る */
async function resolveVideoId(raw) {
  const input = raw.trim();
  if (!input) throw new Error('URL か動画IDを入力してください');
  if (ID_RE.test(input)) return input;

  if (/^@[\w.\-]+$/.test(input)) return resolveLive(`${YT}/${input}/live`);

  let url;
  try {
    url = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input);
  } catch {
    throw new Error('URL として読み取れませんでした');
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
  throw new Error('YouTube の動画・配信・チャンネルの URL ではないようです');
}

/** チャンネルの /live ページから、現在配信中 (または待機所) の動画IDを取り出す */
async function resolveLive(liveUrl) {
  const res = await fetch(liveUrl, { credentials: 'include' });
  if (!res.ok) throw new Error(`チャンネルを開けませんでした (${res.status})`);
  const html = await res.text();
  const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);
  if (m) return m[1];
  throw new Error('このチャンネルは今配信していないようです');
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
 * 無ければ (空き枠が出ても) 映像が一番大きくなるもの。同じくらいなら枠数の少ない方
 */
function chooseLayoutFor(n) {
  const exact = LAYOUTS.filter((l) => l.slots.length === n);
  const candidates = exact.length ? exact : LAYOUTS.filter((l) => l.slots.length >= n);
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
    el.querySelector('.empty-title').textContent = k < l.mains ? `メイン ${k + 1}` : `枠 ${k + 1}`;
  });
  document.getElementById('layoutName').textContent = l.name;
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
}

// ---------------------------------------------------------------- tiles

function buildTiles() {
  for (let i = 0; i < MAX_TILES; i++) {
    const el = template.content.firstElementChild.cloneNode(true);
    el.dataset.index = String(i);
    el.querySelector('.index').textContent = String(i + 1);
    el.querySelector('.empty-title').textContent = `枠 ${i + 1}`;
    const danmaku = new Danmaku(el.querySelector('.danmaku-layer'), () => state.settings);
    const view = { el, danmaku, player: null, chatFrame: null };
    views.push(view);

    el.querySelector('.empty').addEventListener('submit', (e) => {
      e.preventDefault();
      loadInput(i, el.querySelector('.url-input').value);
    });
    el.querySelector('.pick-fav').addEventListener('click', () => openFavorites(i));
    el.querySelector('.bar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (btn) onBarAction(i, btn.dataset.act, e);
    });
    gridEl.appendChild(el);
  }
}

async function loadInput(i, raw) {
  const errEl = views[i].el.querySelector('.error');
  errEl.textContent = '読み込み中…';
  try {
    const id = await resolveVideoId(raw);
    errEl.textContent = '';
    setTileVideo(i, id, raw.trim());
  } catch (e) {
    errEl.textContent = e.message || String(e);
  }
}

function setTileVideo(i, videoId, input) {
  views[i].el.querySelector('.error').textContent = '';
  views[i].danmaku.clear();
  views[i].el.querySelector('[data-act="fav"]').classList.remove('on');
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
const HL_PRESETS = {
  sky: { name: '水色', colors: ['#8fe9ff', '#29a9ff', '#5b8cff'], glow: [41, 169, 255] },
  sakura: { name: 'ピンク', colors: ['#ffd1e8', '#ff8cc6', '#ff5fa2'], glow: [255, 120, 180] },
  sunset: { name: 'オレンジ', colors: ['#ffe08a', '#ffad5c', '#ff6f61'], glow: [255, 150, 80] },
  lavender: { name: '紫', colors: ['#e3d4ff', '#b28dff', '#7c6cff'], glow: [160, 120, 255] },
  aurora: { name: '虹', colors: ['#6ee7ff', '#a78bfa', '#ff8cc6', '#ffd36e'], glow: [170, 150, 255] },
  red: { name: '赤', colors: ['#ff8a80', '#ff4e45', '#e53935'], glow: [255, 78, 69] },
  white: { name: '白', colors: ['#ffffff', '#dfe6ee', '#ffffff'], glow: [255, 255, 255] },
};

function hlGradient(p) {
  return `linear-gradient(135deg, ${p.colors.join(', ')})`;
}

/** 音が出ている枠の線・上部バー・バッジの見た目を設定に合わせる */
function applyHighlight() {
  const s = state.settings;
  const p = HL_PRESETS[s.hlStyle] || HL_PRESETS.sky;
  const root = document.documentElement.style;
  root.setProperty('--hl-gradient', hlGradient(p));
  root.setProperty('--hl-width', `${s.hlWidth}px`);
  const blur = Math.round(4 + s.hlGlow * 16);
  root.setProperty('--hl-glow', s.hlGlow > 0 ? `0 0 ${blur}px rgba(${p.glow.join(', ')}, ${(s.hlGlow * 0.9).toFixed(2)})` : 'none');
  root.setProperty('--hl-text', s.hlStyle === 'white' ? '#111' : '#fff');
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

  const danmakuOn = state.danmakuAll && t.danmaku;
  const needChat = visible && !!t.videoId && (t.chat || danmakuOn);

  // --- player
  if (!visible || !t.videoId) {
    v.player?.remove();
    v.player = null;
    v.meta = null;
  } else if (!v.player || reloadPlayer) {
    v.player?.remove();
    const f = document.createElement('iframe');
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.src = playerUrl(t);
    f.addEventListener('load', () => {
      f.dataset.loaded = '1';
      setTimeout(() => applyAudio(i), 800);
    });
    el.querySelector('.player-slot').appendChild(f);
    v.player = f;
    if (reloadPlayer) v.meta = null;
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
  const audio = el.querySelector('[data-act="audio"]');
  audio.textContent = t.muted ? '🔇' : '🔊';
  audio.classList.toggle('on', !t.muted);
  el.classList.toggle('audible', visible && !!t.videoId && !t.muted && state.count > 1);
  el.querySelector('[data-act="danmaku"]').classList.toggle('on', danmakuOn);
  el.querySelector('[data-act="chat"]').classList.toggle('on', t.chat);
  updateNowPlaying();
}

function renderAll() {
  for (let i = 0; i < MAX_TILES; i++) renderTile(i);
  document.getElementById('danmakuAll').textContent = state.danmakuAll ? '弾幕 ON' : '弾幕 OFF';
  document.getElementById('danmakuAll').classList.toggle('on', state.danmakuAll);
  layout();
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
    btn.replaceChildren('🔇 ミュート中');
    btn.title = 'クリック (M) で直前の枠の音に戻す';
    return;
  }
  const order = visibleIndexes();
  const parts = now.map((i) => {
    const meta = views[i].meta || {};
    return { n: order.indexOf(i) + 1, name: meta.channel || state.tiles[i].input || '' };
  });
  const num = document.createElement('b');
  num.className = 'np-num';
  num.textContent = parts.map((p) => p.n).join('・');
  const name = document.createElement('span');
  name.className = 'np-name';
  name.textContent = parts.length === 1 ? parts[0].name : `${parts.length} 枠を同時再生`;
  btn.replaceChildren('🔊 ', num, name);
  const list = parts.map((p) => `${p.n}: ${p.name || '(読み込み中)'}`).join('\n');
  btn.title = `${list}\nクリック (M) でミュート`;
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
    case 'max':
      toggleFullscreen(i);
      return;
    case 'clear':
      // 自動再生 ON の間に自分で閉じた配信は入れ直さない
      if (t.videoId) autoDismissed.add(t.videoId);
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

async function toggleFullscreen(i) {
  const el = views[i].el;
  if (document.fullscreenElement === el) {
    await document.exitFullscreen().catch(() => {});
    return;
  }
  if (!state.tiles[i].videoId) return;
  // 別の枠が全画面中なら、その状態 (音声の復元先) を引き継いだまま切り替える
  if (!document.fullscreenElement) fullscreenAudioBefore = audibleTiles();
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
  if (document.fullscreenElement) return;
  // 全画面を終えたら、その前に音が出ていた枠に戻す
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
    views[i].meta = { title: String(data.title || ''), channel: String(data.channel || '') };
    views[i].el.querySelector('.audio-badge').title = views[i].meta.channel;
    updateNowPlaying();
  }
});

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

function setupLayoutPicker() {
  const dialog = document.getElementById('layoutPicker');
  const body = document.getElementById('layoutGroups');
  const groups = [...new Set(LAYOUTS.map((l) => l.group))];
  for (const g of groups) {
    const section = document.createElement('section');
    section.className = 'layout-group';
    const h = document.createElement('h3');
    h.textContent = g;
    const list = document.createElement('div');
    list.className = g === '均等' ? 'layout-list uniform' : 'layout-list';
    for (const l of LAYOUTS.filter((x) => x.group === g)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'layout-option';
      btn.dataset.id = l.id;
      btn.title = `${l.name} (${l.slots.length} 枠)`;
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
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// ---------------------------------------------------------------- drag to swap

function setupDragSwap() {
  let dragFrom = null;
  for (const [i, v] of views.entries()) {
    const grip = v.el.querySelector('.grip');
    grip.addEventListener('dragstart', (e) => {
      dragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.setDragImage(v.el, 20, 20);
      // iframe の上ではドラッグのイベントが取れないので、ドラッグ中は iframe を無視させる
      document.body.classList.add('dragging');
      v.el.classList.add('drag-source');
    });
    grip.addEventListener('dragend', () => {
      dragFrom = null;
      document.body.classList.remove('dragging');
      views.forEach((x) => x.el.classList.remove('drag-source', 'drag-over'));
    });
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
}

// ---------------------------------------------------------------- toolbar & settings

// 設定画面のスライダーの表示形式
const SETTING_FORMATS = {
  duration: (v) => `${v} 秒`,
  fontScale: (v) => `${Math.round(v * 100)}%`,
  opacity: (v) => `${Math.round(v * 100)}%`,
  area: (v) => `${Math.round(v * 100)}%`,
  maxOnScreen: (v) => `${v} 件`,
  chatZoom: (v) => `${Math.round(v * 100)}%`,
  chatWidth: (v) => `${Math.round(v * 100)}%`,
  hlWidth: (v) => `${v} px`,
  hlGlow: (v) => (v === 0 ? 'なし' : `${Math.round(v * 100)}%`),
};
const SETTING_CHECKBOXES = ['showAuthor', 'showPaid', 'chatHideAvatars', 'hlAnimate'];

/** 設定画面の入力欄を state.settings に合わせる (他のタブで設定が変わったときも呼ぶ) */
function syncSettingsInputs() {
  for (const [key, fmt] of Object.entries(SETTING_FORMATS)) {
    document.getElementById(key).value = String(state.settings[key]);
    document.getElementById(key + 'Out').textContent = fmt(state.settings[key]);
  }
  for (const key of SETTING_CHECKBOXES) document.getElementById(key).checked = !!state.settings[key];
  for (const b of document.querySelectorAll('.hl-swatch')) b.classList.toggle('selected', b.dataset.id === state.settings.hlStyle);
}

function setupToolbar() {
  setupLayoutPicker();

  document.getElementById('nowPlaying').addEventListener('click', toggleMuteAll);
  document.getElementById('danmakuAll').addEventListener('click', toggleDanmakuAll);

  const dialog = document.getElementById('settings');
  document.getElementById('openSettings').addEventListener('click', () => dialog.showModal());

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
    saveSettings();
  };
  for (const key of Object.keys(SETTING_FORMATS)) {
    const input = document.getElementById(key);
    input.addEventListener('input', () => {
      state.settings[key] = parseFloat(input.value);
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
    b.append(chip, p.name);
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
    if (e.key === 'm' || e.key === 'M') {
      toggleMuteAll();
    } else if (e.key === 'd' || e.key === 'D') {
      toggleDanmakuAll();
    } else if (e.key === 'f' || e.key === 'F') {
      openFavorites(null);
    } else if (e.key === 'l' || e.key === 'L') {
      setAutoMode(!state.autoMode);
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
    target != null ? `→ 枠 ${displayNumber(target)} に読み込みます` : '→ クリックで空いている枠に読み込みます';
  if (!favDialog.open) favDialog.showModal();
  refreshFavorites(false);
  updateRestoreLink();
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
  const hm = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

let favFilter = '';

function favSection(title, items, { cls = '' } = {}) {
  const ul = document.createElement('ul');
  ul.className = 'fav-sub';
  ul.append(...items);
  const sec = document.createElement('section');
  sec.className = `fav-section ${cls}`;
  const h = document.createElement('h3');
  h.textContent = `${title} (${items.length})`;
  sec.append(h, ul);
  return sec;
}

function renderFavorites(favs) {
  const q = favFilter.trim().toLowerCase();
  const shown = q
    ? favs.filter((f) => [f.name, f.handle, f.group].some((s) => (s || '').toLowerCase().includes(q)))
    : favs;
  const entries = shown.map((f) => ({ f, st: favStatus.get(f.channelId) }));
  const live = entries.filter((e) => e.st?.state === 'live').sort((a, b) => (a.st.startAt || 0) - (b.st.startAt || 0));
  const upcoming = entries
    .filter((e) => e.st?.state === 'upcoming')
    .sort((a, b) => (a.st.startAt || Infinity) - (b.st.startAt || Infinity));
  const rest = entries.filter((e) => e.st?.state !== 'live' && e.st?.state !== 'upcoming');

  const sections = [];
  if (live.length) sections.push(favSection('● 配信中', live.map(favItem), { cls: 'live-sec' }));
  if (upcoming.length) sections.push(favSection('予定', upcoming.map(favItem)));
  // それ以外はまとめて 1 つの一覧 (自分で追加したチャンネル → 既定のチャンネルの順)
  rest.sort((a, b) => Number(!!a.f.preset) - Number(!!b.f.preset));
  if (rest.length) sections.push(favSection(live.length || upcoming.length ? 'その他' : 'すべて', rest.map(favItem), { cls: 'rest-sec' }));
  favListEl.replaceChildren(...sections);
  document.getElementById('favEmpty').textContent = q
    ? `「${favFilter}」に一致するお気に入りはありません。`
    : 'まだ登録がありません。下の欄にチャンネルを入力して追加してください。';
  document.getElementById('favLiveCount').textContent = live.length ? `配信中 ${live.length}` : '';
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
    badge.textContent = '確認中…';
  } else if (st === 'error' || !st) {
    li.classList.add('error');
    badge.textContent = '取得できませんでした';
  } else if (st.state === 'offline') {
    li.classList.add('offline');
    badge.textContent = '';
  } else {
    li.classList.add(st.state);
    badge.textContent = st.state === 'live' ? '● LIVE' : `予定 ${formatStart(st.startAt)}`.trim();
    title.textContent = st.title || '';
    thumb.src = `https://i.ytimg.com/vi/${st.videoId}/mqdefault.jpg`;
    const shownIn = visibleIndexes().filter((i) => state.tiles[i].videoId === st.videoId);
    if (shownIn.length) li.querySelector('.fav-where').textContent = `枠 ${shownIn.map(displayNumber).join(', ')} で表示中`;
    li.addEventListener('click', () => pickFavorite(f, st));
  }

  li.querySelector('.fav-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`「${f.name}」をお気に入りから外しますか?`)) return;
    await Favorites.remove(f.channelId);
    favStatus.delete(f.channelId);
    renderFavorites(await Favorites.list());
    updateRestoreLink();
  });
  return li;
}

async function updateRestoreLink() {
  const n = await Favorites.removedPresetCount();
  const btn = document.getElementById('favRestore');
  btn.hidden = n === 0;
  btn.textContent = `外したホロライブのチャンネルを戻す (${n})`;
}

function pickFavorite(f, st) {
  const target = favTarget ?? firstEmptyTile();
  if (target == null) {
    favErrorEl.textContent = '空いている枠がありません。枠の ★ ボタンから開くと、その枠に読み込めます。';
    return;
  }
  setTileVideo(target, st.videoId, f.handle || `https://www.youtube.com/channel/${f.channelId}`);
  favDialog.close();
}

async function fillLiveIntoEmptyTiles() {
  const favs = await Favorites.list();
  if (favs.some((f) => favStatus.get(f.channelId) === 'loading')) {
    favErrorEl.textContent = '配信状況を確認中です。終わってからもう一度押してください。';
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
  if (lives.length === 0) favErrorEl.textContent = 'まだ表示していない配信中のチャンネルはありません。';
  else if (placed < lives.length) favErrorEl.textContent = `空き枠が足りず、${lives.length - placed} 件は入りませんでした。分割数を増やしてください。`;
  else favDialog.close();
}

// ---------------------------------------------------------------- 自動再生

/**
 * お気に入り全部の配信状況を (待って) 取り、配信中のものを返す。
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
  return { lives, errors };
}

/**
 * 自動再生を ON にしたときの最初の 1 回: 配信中のお気に入りを全部 (最大 16) 、件数に合ったレイアウトで再生する。
 * 表示中の配信は読み込み直さずに残し、配信中でない枠は空にする
 */
async function startAllLive() {
  let { lives } = await collectLiveFavorites({ force: true });
  if (lives.length === 0) {
    notify('いま配信中のお気に入りはありません。配信が始まったら自動で追加します');
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
  notify(
    total > MAX_TILES
      ? `配信中 ${total} 件のうち ${MAX_TILES} 件を「${layout.name}」で再生しています`
      : `配信中 ${total} 件を「${layout.name}」で再生しています`,
  );
}

const AUTO_INTERVAL_MS = 60 * 1000;
const AUTO_MISS_LIMIT = 2; // 何回続けて「配信中に無い」なら枠を消すか (一時的な取りこぼしで消さないため)
const autoMissing = new Map(); // videoId -> 続けて見つからなかった回数
const autoDismissed = new Set(); // 自分で ✕ で閉じた配信 (自動で入れ直さない)
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
  btn.classList.toggle('on', on);
  btn.textContent = on ? '▶ 自動再生 ON' : '▶ 自動再生 OFF';
  if (!on) return; // OFF: 今の枠はそのまま、増減だけ止める

  autoDismissed.clear();
  autoMissing.clear();
  autoBusy = true;
  btn.disabled = true;
  btn.textContent = '確認中…';
  try {
    if (resume) await autoTickOnce();
    else await startAllLive();
  } catch (e) {
    notify(`配信状況を取得できませんでした: ${e.message || e}`);
  } finally {
    autoBusy = false;
    btn.disabled = false;
    btn.textContent = state.autoMode ? '▶ 自動再生 ON' : '▶ 自動再生 OFF';
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
    const { lives, errors } = await collectLiveFavorites({ force: true });
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
    const started = lives
      .filter((l) => !shownIds.has(l.st.videoId) && !autoDismissed.has(l.st.videoId))
      .slice(0, Math.max(0, MAX_TILES - keep.length));

    if (ended.length === 0 && started.length === 0) return;

    const audibleBefore = audibleTiles();
    const endedNames = ended.map((i) => state.tiles[i].label || views[i].meta?.channel || state.tiles[i].input);
    for (const i of ended) {
      autoMissing.delete(state.tiles[i].videoId);
      state.tiles[i] = newTileState();
      views[i].danmaku.clear();
    }

    // 新しい配信は空いている枠に入れて、今の並びの後ろ (サブ側) に足す
    // (空の枠を優先。足りなければ、今のレイアウトで隠れている枠の中身を上書きする)
    const others = state.order.filter((j) => !keep.includes(j));
    const free = [...others.filter((j) => !state.tiles[j].videoId), ...others.filter((j) => state.tiles[j].videoId)];
    const added = started.map((l, k) => {
      const i = free[k];
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
    if (started.length) msgs.push(`▶ 配信開始: ${started.map((l) => l.f.name).join('、')}`);
    if (endedNames.length) msgs.push(`■ 配信終了: ${endedNames.join('、')}`);
    notify(msgs.join(' / '));
  } catch (e) {
    console.warn('hukumado: 自動再生の確認に失敗', e);
  }
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
  document.getElementById('favFillLive').addEventListener('click', fillLiveIntoEmptyTiles);
  document.getElementById('autoMode').addEventListener('click', () => setAutoMode(!state.autoMode));
  // 背景クリックで閉じる
  favDialog.addEventListener('click', (e) => {
    if (e.target === favDialog) favDialog.close();
  });

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
    renderFavorites(await Favorites.list());
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
  showToast(i, 'お気に入りに登録中…');
  try {
    const { info, added } = await Favorites.add(t.videoId);
    favStatus.delete(info.channelId);
    showToast(i, added ? `★ 「${info.name}」をお気に入りに登録しました` : `「${info.name}」は登録済みです`);
    btn.classList.add('on');
  } catch (e) {
    showToast(i, `登録できませんでした: ${e.message || e}`);
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
  favErrorEl.textContent = '追加中…';
  try {
    const { info, added } = await Favorites.add(raw);
    favErrorEl.textContent = added ? '' : `「${info.name}」は登録済みです`;
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
      if (c.note) {
        const small = document.createElement('small');
        small.textContent = c.note;
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

/** 保存されたセッションの説明 (「2×2・3 件: 兎田ぺこら、大神ミオ…」) */
function describeSession(data) {
  const layoutName = getLayout(data.layoutId).name;
  const order = isPermutation(data.order) ? data.order : Array.from({ length: MAX_TILES }, (_, i) => i);
  const shown = order
    .slice(0, getLayout(data.layoutId).slots.length)
    .map((i) => data.tiles?.[i])
    .filter((t) => t?.videoId);
  const names = shown.map((t) => t.label || t.input || t.videoId);
  const head = names.slice(0, 4).join('、') + (names.length > 4 ? ` ほか ${names.length - 4} 件` : '');
  const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return { count: shown.length, text: `${when} ・ ${layoutName} ・ ${shown.length} 件${data.autoMode ? ' ・ 自動再生' : ''}: ${head}` };
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
    label: n === 0 ? '▶ 前回の続きから' : '▶ この内容で再開',
    note: describeSession(s.data).text,
  }));
  choices.push(
    { value: 'new', label: '新しく始める', note: '空の枠から始めます' },
    { value: 'auto', label: '▶ 自動再生で始める', note: '配信中のお気に入りを全部再生します' },
  );
  const body = document.createElement('p');
  body.textContent =
    inUse.size > 0
      ? `ほかのタブ (ウィンドウ) で ${inUse.size} つ使用中です。そちらとは別に、このタブで視聴します。`
      : '前回の視聴内容が残っています。';
  const choice = await askChoice({ title: 'どの内容で視聴しますか?', body, choices });
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
  if (startAuto) setAutoMode(true);
  // 自動再生 ON のまま閉じたセッションを続けるときは、今の枠のまま確認を再開
  else if (state.autoMode) setAutoMode(true, { resume: true });
})();
