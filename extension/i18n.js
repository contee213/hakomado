// 表示言語 (日本語 / 英語)
// - 既定はブラウザの表示言語。日本語なら日本語、それ以外 (中国語・韓国語なども) は英語
// - 設定画面で「日本語」「English」に固定もできる (localStorage に保存。全タブ共通)
// - HTML の文言は grid.html に日本語で書いておき、data-i18n* 属性の付いた要素だけを英語に差し替える
// - スクリプトの文言は tr('key', 引数...) で取る ({0} {1} … に引数が入る)
/* exported LANG, LANG_PREF, tr, setLangPref, applyI18n */
'use strict';

const LANG_KEY = 'hukumado.lang';

const LANG_PREF = (() => {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'ja' || v === 'en' ? v : 'auto';
  } catch {
    return 'auto';
  }
})();

const LANG = (() => {
  if (LANG_PREF !== 'auto') return LANG_PREF;
  const ui = (globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language || 'en').toLowerCase();
  return ui.startsWith('ja') ? 'ja' : 'en';
})();

function setLangPref(v) {
  try {
    if (v === 'ja' || v === 'en') localStorage.setItem(LANG_KEY, v);
    else localStorage.removeItem(LANG_KEY);
  } catch {
    /* ignore */
  }
}

// スクリプトから出す文言 (両方の言語)
const MESSAGES = {
  // 入力
  inputEmpty: ['URL か動画IDを入力してください', 'Enter a URL or video ID'],
  notUrl: ['URL として読み取れませんでした', 'Could not read this as a URL'],
  notYouTube: ['YouTube の動画・配信・チャンネルの URL ではないようです', "This doesn't look like a YouTube video, stream or channel URL"],
  channelOpenFail: ['チャンネルを開けませんでした ({0})', 'Could not open the channel ({0})'],
  channelNotLive: ['このチャンネルは今配信していないようです', "This channel doesn't seem to be live right now"],
  enterChannel: ['@チャンネル名 か URL を入力してください', 'Enter an @handle or a URL'],
  channelNotFound: ['YouTube のチャンネルが見つかりませんでした', 'YouTube channel not found'],
  channelReadFail: ['チャンネルの情報を読み取れませんでした', 'Could not read the channel info'],
  fetchFail: ['取得できませんでした ({0})', 'Could not fetch ({0})'],
  loading: ['読み込み中…', 'Loading…'],

  // 枠
  slotMain: ['メイン {0}', 'Main {0}'],
  slot: ['枠 {0}', 'Tile {0}'],
  sep: ['、', ', '],

  // 音が出ている枠の色
  colorSky: ['水色', 'Sky'],
  colorPink: ['ピンク', 'Pink'],
  colorOrange: ['オレンジ', 'Orange'],
  colorGreen: ['グリーン', 'Green'],
  colorPurple: ['パープル', 'Purple'],
  colorWhite: ['ホワイト', 'White'],

  // 上部バーの音声表示
  muted: ['🔇 ミュート中', '🔇 Muted'],
  mutedTitle: ['クリック (M) で直前の枠の音に戻す', 'Click (M) to restore the previous audio'],
  multiAudio: ['{0} 枠を同時再生', '{0} tiles playing'],
  loadingName: ['(読み込み中)', '(loading)'],
  clickToMute: ['クリック (M) でミュート', 'Click (M) to mute'],

  // レイアウト
  groupUniform: ['均等', 'Uniform'],
  groupMain: ['メイン + サブ', 'Main + sub'],
  layoutTitle: ['{0} ({1} 枠)', '{0} ({1} tiles)'],

  // 設定の値
  sec: ['{0} 秒', '{0} s'],
  min: ['{0} 分', '{0} min'],
  minSec: ['{0} 分 {1} 秒', '{0} min {1} s'],
  items: ['{0} 件', '{0}'],
  off: ['なし', 'Off'],

  // お気に入り
  favTarget: ['→ 枠 {0} に読み込みます', '→ Loads into tile {0}'],
  favTargetAny: ['→ クリックで空いている枠に読み込みます', '→ Click to load into an empty tile'],
  secLive: ['● 配信中', '● Live'],
  fillEmpty: ['空いている枠に入れる', 'Fill empty tiles'],
  fillEmptyTitle: [
    'まだ表示していない配信中のチャンネルを、空いている枠に順に入れる (今の枠はそのまま)',
    'Put live channels that are not shown yet into empty tiles, in order (current tiles stay)',
  ],
  secUpcoming: ['予定', 'Upcoming'],
  secOther: ['その他', 'Others'],
  secAll: ['すべて', 'All'],
  favNoMatch: ['「{0}」に一致するお気に入りはありません。', 'No favorites match "{0}".'],
  favEmpty: ['まだ登録がありません。下の欄にチャンネルを入力して追加してください。', 'No favorites yet. Enter a channel below to add one.'],
  liveCount: ['配信中 {0}', '{0} live'],
  checking: ['確認中…', 'Checking…'],
  unavailable: ['取得できませんでした', 'Unavailable'],
  upcomingAt: ['予定 {0}', 'Upcoming {0}'],
  shownIn: ['枠 {0} で表示中', 'In tile {0}'],
  confirmRemove: ['「{0}」をお気に入りから外しますか?', 'Remove "{0}" from favorites?'],
  restorePresets: ['外したホロライブのチャンネルを戻す ({0})', 'Restore removed hololive channels ({0})'],
  noEmptyTile: [
    '空いている枠がありません。枠の ★ ボタンから開くと、その枠に読み込めます。',
    "There's no empty tile. Open favorites from a tile's ★ button to load into that tile.",
  ],
  stillChecking: ['配信状況を確認中です。終わってからもう一度押してください。', 'Still checking live status. Try again when it finishes.'],
  noUnshownLive: ['まだ表示していない配信中のチャンネルはありません。', 'Every live channel is already shown.'],
  notEnoughTiles: [
    '空き枠が足りず、{0} 件は入りませんでした。分割数を増やしてください。',
    'Not enough empty tiles: {0} could not be added. Choose a layout with more tiles.',
  ],
  favAdding: ['お気に入りに登録中…', 'Adding to favorites…'],
  favAdded: ['★ 「{0}」をお気に入りに登録しました', '★ Added "{0}" to favorites'],
  favExists: ['「{0}」は登録済みです', '"{0}" is already in favorites'],
  favAddFailed: ['登録できませんでした: {0}', 'Could not add: {0}'],
  adding: ['追加中…', 'Adding…'],

  // 自動再生・クルーズ
  membersRemoved: ['🔒 メンバー限定のため外しました: {0}', '🔒 Removed (members-only): {0}'],
  membersSkipped: ['🔒 メンバー限定のため除外: {0}', '🔒 Skipped (members-only): {0}'],
  onlyMembers: [
    '配信中は メンバー限定 ({0}) だけでした。配信が始まったら自動で追加します',
    'Only members-only streams are live ({0}). Streams will be added when they start',
  ],
  noneLive: [
    'いま配信中のお気に入りはありません。配信が始まったら自動で追加します',
    'None of your favorites are live right now. Streams will be added when they start',
  ],
  skippedCount: [' (メンバー限定 {0} 件を除外)', ' ({0} members-only skipped)'],
  playingSome: ['配信中 {0} 件のうち {1} 件を「{2}」で再生しています', 'Playing {1} of {0} live streams in "{2}"'],
  playingAll: ['配信中 {0} 件を「{1}」で再生しています', 'Playing {0} live streams in "{1}"'],
  statusFailed: ['配信状況を取得できませんでした: {0}', 'Could not get live status: {0}'],
  started: ['▶ 配信開始: {0}', '▶ Started: {0}'],
  ended: ['■ 配信終了: {0}', '■ Ended: {0}'],
  cruiseOn: ['クルーズ ON: {0}ごとにメイン枠と音声を次の配信へ回します', 'Cruise ON: the main tile and audio move to the next stream every {0}'],

  // 視聴セッション
  streams: ['{0} 件', '{0} streams'],
  autoTag: ['自動再生', 'Auto play'],
  more: ['ほか {0} 件', '{0} more'],
  resumeLatest: ['▶ 前回の続きから', '▶ Continue where you left off'],
  resumeThis: ['▶ この内容で再開', '▶ Resume this'],
  startNew: ['新しく始める', 'Start fresh'],
  startNewNote: ['空の枠から始めます', 'Start with empty tiles'],
  startAuto: ['▶ 自動再生で始める', '▶ Start with auto play'],
  startAutoNote: ['配信中のお気に入りを全部再生します', 'Play all your live favorites'],
  inUse: [
    'ほかのタブ (ウィンドウ) で {0} つ使用中です。そちらとは別に、このタブで視聴します。',
    '{0} other tab(s) are in use. This tab will be a separate viewing session.',
  ],
  leftover: ['前回の視聴内容が残っています。', 'Your previous viewing session is saved.'],
  chooseTitle: ['どの内容で視聴しますか?', 'What would you like to watch?'],
};

/** スクリプト用の文言。{0} {1} … に引数を入れる */
function tr(key, ...args) {
  const m = MESSAGES[key];
  const s = m ? m[LANG === 'ja' ? 0 : 1] : key;
  return s.replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)] ?? ''));
}

// 画面 (grid.html) の英語。キーは data-i18n* 属性の値。日本語は grid.html に書いてあるものを使う
const HTML_EN = {
  // 上部バー
  'auto.title':
    'Auto play (L): when ON, plays all your live favorites (up to 16), then checks every minute, adding a tile when a stream starts and removing it when the stream ends. Streams you close with ✕ while ON are not added back (turn it OFF → ON to bring them back)',
  'auto.label': 'Auto play',
  'cruise.title':
    'Cruise (C): at a set interval, moves the main tile and audio to the next stream so you can watch many streams a little at a time. Works with any tiles, with or without auto play. Change the interval in ⚙ Settings → Auto play',
  'cruise.label': 'Cruise',
  'fav.title': 'Favorites (F)',
  'fav.label': 'Favorites',
  'nowPlaying': '🔇 Muted',
  'layout.title': 'Choose a layout',
  'danmakuAll.title': 'Scrolling chat (danmaku) on all tiles (D)',
  'danmakuAll.label': 'Danmaku',
  'gridFs.title': 'Fullscreen with all tiles (Shift+F). Move the mouse to the top edge to show this bar',
  'settings.title': 'Settings',
  'help.title': 'Help and keyboard shortcuts (?)',
  'close': 'Close (Esc)',

  // 設定
  'settings.h': '⚙ Settings',
  'lang.title': 'Display language',
  'lang.auto': 'Auto (browser language)',
  'tab.danmaku': 'Danmaku',
  'tab.audio': 'Audio outline',
  'tab.chat': 'Chat',
  'tab.auto': 'Auto play',
  'dm.duration': 'Scroll time',
  'dm.fontScale': 'Text size',
  'dm.opacity': 'Opacity',
  'dm.area': 'Area',
  'dm.pos': 'Position',
  'dm.top': 'Top',
  'dm.middle': 'Middle',
  'dm.bottom': 'Bottom',
  'dm.height': 'Height',
  'dm.max': 'Max on screen (per tile)',
  'dm.author': 'Show author names',
  'dm.paid': 'Highlight Super Chats',
  'hl.note': 'Outline drawn around the tile whose audio is on',
  'hl.width': 'Line width',
  'hl.glow': 'Glow',
  'hl.animate': 'Slowly animate the gradient',
  'chat.note': 'Look of the chat panel opened with 💬 (applies to open panels right away)',
  'chat.zoom': 'Text size',
  'chat.width': 'Width (relative to the tile)',
  'chat.noav': 'Hide author icons',
  'auto.skip': "Skip members-only streams you're not a member of",
  'auto.skipNote':
    'Before ▶ Auto play adds a stream, it checks whether the signed-in account can watch it. Tiles you load yourself are always shown',
  'auto.cruise': 'Cruise interval',
  'auto.cruiseNote':
    'While Cruise is ON, the main tile and audio move to the next stream at this interval. It also works with tiles you arranged yourself, without auto play. In uniform layouts the order stays and only the audio moves. Empty tiles are skipped and the layout is not changed. When auto play rearranges tiles, main + sub layouts are preferred',

  // 使い方
  'help.h': '? Help',
  'help.tip1': 'Paste a URL / video ID / <code>@handle</code> into an empty tile, or load a stream with “★ Pick from favorites”',
  'help.tip2': 'Hover a tile to show its control bar. Drag ⠿ at the left to swap tiles',
  'help.tip3': 'Turn on “▶ Auto play” to show all your live favorites; tiles are added and removed as streams start and end',
  'help.tip4': 'Turn on “Cruise” to move the main tile and audio to the next stream at a set interval, so you can watch many streams a little at a time (also with tiles you arranged yourself, without auto play)',
  'help.tip5': 'Use the speaker in a tile’s player to listen to several tiles at once without muting the others',
  'help.keys': 'Keyboard',
  'key.audio': 'Play audio only from that tile',
  'key.tileFs': 'Fullscreen that tile (<kbd>Esc</kbd> to return)',
  'key.gridFs': 'Fullscreen with all tiles (move the mouse to the top edge to show the bar)',
  'key.mute': 'Mute ⇄ restore the previous audio',
  'key.auto': 'Auto play ON / OFF',
  'key.cruise': 'Cruise ON / OFF',
  'key.fav': 'Open favorites',
  'key.danmaku': 'Danmaku on all tiles ON / OFF',
  'key.help': 'Open this screen',

  // レイアウト
  'layout.h': '▦ Layout',
  'fit.fit': 'Fit 16:9',
  'fit.fitTitle': 'Make every tile exactly 16:9. If the screen ratio differs, the leftover space goes to the outer margins',
  'fit.fill': 'Fill screen',
  'fit.fillTitle': 'Fill the screen with no margins. Videos are zoomed to fit their tiles and the edges are cropped',
  'layout.note': 'Darker tiles are main tiles. Streams fill tile 1 (main) first. Drag ⠿ on a tile to swap.',
  'layout.use': '% = share of the screen used by video at the current size (with Fit 16:9)',

  // お気に入り
  'fav.h': '★ Favorites',
  'fav.refresh': '⟳ Refresh',
  'fav.refreshTitle': 'Check live status again',
  'fav.filter': 'Filter by name or @handle',
  'fav.empty': 'No favorites yet. Enter a channel below to add one.',
  'fav.addInput': 'Add: @handle / channel URL / video URL',
  'fav.add': 'Add',
  'fav.del': 'Remove from favorites',

  // 枠
  'tile.input': 'Paste a URL / video ID / @channel',
  'tile.load': 'Load',
  'tile.pickFav': '★ Pick from favorites',
  'tile.grip': 'Drag to swap with another tile',
  'tile.audio': 'Play audio only from this tile (others are muted). To listen to several tiles at once, use the speaker in each player',
  'tile.chat': 'Show the chat panel',
  'tile.danmaku': 'Danmaku on this tile',
  'tile.fav': "Add this tile's channel to favorites",
  'tile.reload': 'Reload (if the video or chat misbehaves)',
  'tile.max': 'Watch this tile in fullscreen (also Shift+number. Esc to return)',
  'tile.clear': 'Close this tile',
};

/**
 * data-i18n (文字) / data-i18n-html (<kbd> などを含む文字) / data-i18n-title / data-i18n-placeholder /
 * data-i18n-aria の付いた要素を英語に差し替える。日本語のときは何もしない (HTML の日本語のまま)
 */
function applyI18n(root = document) {
  if (root === document) document.documentElement.lang = LANG;
  if (LANG === 'ja') return;
  const pick = (key) => HTML_EN[key];
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const s = pick(el.dataset.i18n);
    if (s != null) el.textContent = s;
  }
  // 自分で書いた固定の文言だけ (外から来た文字は入らない)
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    const s = pick(el.dataset.i18nHtml);
    if (s != null) el.innerHTML = s;
  }
  for (const [attr, prop] of [['i18nTitle', 'title'], ['i18nPlaceholder', 'placeholder'], ['i18nAria', 'aria-label']]) {
    const sel = '[data-' + attr.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + ']';
    for (const el of root.querySelectorAll(sel)) {
      const s = pick(el.dataset[attr]);
      if (s != null) el.setAttribute(prop, s);
    }
  }
  for (const tpl of root.querySelectorAll('template')) applyI18n(tpl.content);
}

// grid.html の最後で読み込むので、この時点で画面の要素はそろっている (枠の template も複製前に訳しておく)
applyI18n();
