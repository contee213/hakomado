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
  inputEmpty: ['URL か動画 ID を入力してください', 'Enter a URL or video ID'],
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
  layoutTab_recommend: ['おすすめ', 'Recommended'],
  layoutTab_uniform: ['均等', 'Uniform'],
  layoutTab_main1: ['メイン + サブ①', 'Main + sub 1'],
  layoutTab_main2: ['メイン + サブ②', 'Main + sub 2'],
  layoutTab_pip: ['PinP', 'PinP'],
  anchor_tl: ['左上', 'Top left'],
  anchor_bl: ['左下', 'Bottom left'],
  anchor_tr: ['右上', 'Top right'],
  anchor_br: ['右下', 'Bottom right'],
  kindFocus: ['メイン重視', 'Main focus'],
  kindBalance: ['バランス', 'Balanced'],
  layoutTitle: ['{0} ({1} 枠)', '{0} ({1} tiles)'],
  tileClear: ['この枠を閉じる', 'Close this tile'],
  tileRemove: ['この空き枠を消す (枠の数に合ったレイアウトに変わります)', 'Remove this empty tile (the layout changes to fit the number of tiles)'],
  ytLogin: ['YouTube にログインすると使えます', 'Sign in to YouTube to use this'],
  ytChecking: ['YouTube の状態を確認中…', 'Checking YouTube…'],
  ytSubscribe: ['YouTube でチャンネル登録する', 'Subscribe on YouTube'],
  ytLike: ['YouTube で高評価する', 'Like on YouTube'],
  ytFailed: ['YouTube の操作に失敗しました。YouTube で直接操作してください: {0}', 'The YouTube action failed. Please do it on YouTube directly: {0}'],
  tileRemoveNo: ['これ以上枠を減らせません (読み込んだ配信が入りきらなくなるため)', 'Cannot remove more tiles (the loaded streams would not fit)'],

  // 設定の値
  sec: ['{0} 秒', '{0} s'],
  min: ['{0} 分', '{0} min'],
  minSec: ['{0} 分 {1} 秒', '{0} min {1} s'],
  items: ['{0} 件', '{0}'],
  tilesCount: ['{0} 枠', '{0} tiles'],
  off: ['なし', 'Off'],
  never: ['しない', 'Off'],
  minBefore: ['{0} 分前から', '{0} min before'],

  // チャンネル・ピックアップ
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
  favNoMatch: ['「{0}」に一致するチャンネルはありません。', 'No channels match "{0}".'],
  backupConfirm: [
    'このファイルの内容で置き換えますか？\nチャンネル {0} 件 (ピックアップ {1} 件)・視聴履歴 {2} 件・あとで見る {3} 件\n(今の設定・チャンネル・視聴履歴・あとで見るは消えます)',
    'Replace your data with this file?\n{0} channels ({1} in pickup), {2} in watch history, {3} in Watch later\n(Your current settings, channels, watch history and Watch later will be replaced.)',
  ],
  backupNotFile: ['hukumado のバックアップファイルではないため、読み込めませんでした', "This isn't a hukumado backup file, so it was not imported"],
  backupTooNew: [
    'このファイルは新しい版の hukumado で書き出されたため、読み込めません。拡張機能を更新してから読み込んでください',
    'This file was exported by a newer version of hukumado. Update the extension, then import it again',
  ],
  backupFail: ['書き出し / 読み込みに失敗しました: {0}', 'Export / import failed: {0}'],
  backupImported: ['読み込みました。画面を読み込み直します', 'Imported. Reloading the page'],
  updateLink: ['新しいバージョン {0} があります', 'Version {0} is available'],
  updateNotice: ['hukumado の新しいバージョン {0} が出ています (設定画面の下から開けます)', 'hukumado {0} is available (open it from the bottom of Settings)'],
  settingsResetConfirm: ['設定をすべて初期値に戻しますか？ (表示言語とチャンネルはそのまま)', 'Reset all settings to their defaults? (The display language and channels are kept.)'],
  rateLimited: ['YouTube から取得を制限されたため、しばらく取りに行きません', 'YouTube is limiting requests; pausing for a while'],
  progressStatus: ['チャンネルの配信状況を確認しています ({0} / {1})', 'Checking live status of channels ({0} / {1})'],
  progressAccess: ['見られる配信か確認しています ({0} / {1})', 'Checking which streams you can watch ({0} / {1})'],
  progressTiles: ['枠を準備しています', 'Preparing tiles'],
  noticeStarted: ['▶ 配信開始: {0}', '▶ Now live: {0}'],
  noticeAt: ['{0} に開始', 'Started {0}'],
  historyEmpty: ['まだ視聴履歴がありません。枠で配信や動画を読み込むと、ここに残ります。', 'No history yet. Streams and videos you load into tiles will show up here.'],
  historyNoMatch: ['「{0}」に一致する視聴履歴はありません。', 'No watch history matches "{0}".'],
  historyDel: ['視聴履歴から消す', 'Remove from watch history'],
  historyClearConfirm: ['視聴履歴を全部 ({0} 件) 消しますか？', 'Clear all watch history ({0} items)?'],
  historyPick: ['クリックで枠に読み込む', 'Click to load into a tile'],
  savedEmpty: ['あとで見るはまだありません。枠のバーや視聴履歴の 🔖 を押すと、ここに入ります (100 件まで。最後まで再生すると消えます)。', 'Nothing to watch later yet. Press 🔖 on a tile bar or in watch history to add it here (up to 100. Removed once played to the end).'],
  savedNoMatch: ['「{0}」に一致するものはありません。', 'Nothing matches "{0}".'],
  savedCount: ['{0} / {1} 件', '{0} / {1}'],
  savedOn: ['あとで見る', 'Watch later'],
  savedOff: ['あとで見るから外す', 'Remove from Watch later'],
  savedAdded: ['🔖 あとで見るに入れました', '🔖 Added to Watch later'],
  savedRemoved: ['あとで見るから外しました', 'Removed from Watch later'],
  savedFull: ['あとで見るがいっぱい ({0} 件) です。ライブラリの「あとで見る」から不要なものを外してください', 'Watch later is full ({0}). Remove some from "Watch later" in the library'],
  tileSaveOn: ['この配信をあとで見る', 'Watch this stream later'],
  tileSaveOff: ['この配信をあとで見るから外す', 'Remove this stream from Watch later'],
  danmakuAllOff: ['弾幕: 全部の枠で非表示 (D で戻す)', 'Danmaku hidden on all tiles (D to show)'],
  danmakuAllOn: ['弾幕: 表示に戻しました', 'Danmaku shown again'],
  tourNext: ['次へ', 'Next'],
  tourBack: ['戻る', 'Back'],
  tourSkip: ['スキップ', 'Skip'],
  tourDone: ['はじめる', 'Get started'],
  tourStart: ['自動再生をはじめる', 'Start auto play'],
  tourLater: ['あとで (自分で選ぶ)', 'Later (pick myself)'],
  tourWelcomeT: ['hukumado へようこそ', 'Welcome to hukumado'],
  tourWelcome: ['YouTube の配信を最大 16 枠、並べて同時に見られます。', 'Watch up to 16 YouTube streams side by side.'],
  tourPickT: ['見たい配信を入れる', 'Add a stream'],
  tourPick: ['URL を貼るか、今の配信は「📺 チャンネル」、終わった配信は「📚 ライブラリ」から選びます。', 'Paste a URL, or pick live streams from "📺 Channels" and past ones from "📚 Library".'],
  tourTileT: ['枠の操作', 'Tile controls'],
  tourTile: ['配信の入った枠にマウスを乗せると、このバーが出ます。🔊 で音を出す枠を切り替えます。', 'Hover over a tile with a stream to show this bar. Use 🔊 to choose which tile plays audio.'],
  tourMockName: ['チャンネル名', 'Channel name'],
  tourMoreT: ['そのほかの機能', 'More features'],
  tourMore: ['通知・チャンネル・ライブラリ・設定はここから。? でツアーをもう一度見られます。', 'Notifications, channels, library and settings are here. Press ? to replay this tour.'],
  tourAutoT: ['自動再生ではじめましょう', 'Start with auto play'],
  tourAuto: ['押すと、配信中のチャンネルが並びます。', 'Press it to lay out the channels that are live.'],
  resumeAll: ['再開', 'Resume'],
  pauseLabel: ['一時停止', 'Pause'],
  archiveOpen: ['最近の配信を見る', 'Show recent streams'],
  archiveClose: ['最近の配信を閉じる', 'Hide recent streams'],
  archiveLoading: ['最近の配信を取得しています…', 'Getting recent streams…'],
  archiveError: ['最近の配信を取得できませんでした', 'Could not get recent streams'],
  archiveNone: ['終わった配信はありません', 'No past streams'],
  archiveProgress: ['取得中 {0} / {1}', 'Loading {0} / {1}'],
  archiveEmpty: ['最近 {0} 日に終わった配信はありません。', 'No streams ended in the last {0} days.'],
  archiveNoMatch: ['「{0}」に一致する配信はありません。', 'No streams match "{0}".'],
  archiveNoPick: ['ピックアップ (📌) のチャンネルがありません。「すべて」に切り替えるか、チャンネルを 📌 でピックアップに入れてください。', 'No channels in pickup (📌). Switch to "All", or pick up channels with 📌.'],
  scopeNoPicked: ['ピックアップ (📌) のチャンネルのものはありません。「📺 すべて」に切り替えると、全部見られます。', 'Nothing from your pickup (📌) channels. Switch to "📺 All" to see everything.'],
  chTitle: ['📺 チャンネル', '📺 Channels'],
  libTitle: ['📚 ライブラリ', '📚 Library'],
  queueEmpty: ['あとで見るに何もありません', 'Nothing in Watch later'],
  queueStarted: ['あとで見るを順に再生します ({0} 件)', 'Playing Watch later in order ({0})'],
  queueDone: ['あとで見るを全部再生しました', 'Finished everything in Watch later'],
  queueNext: ['▶ 次のあとで見る: {0}', '▶ Next in Watch later: {0}'],
  fillOnly: ['いま配信中のチャンネルはありません。最近の配信 {0} 件を流しています', 'None of your channels are live. Playing {0} recent streams'],
  pickSearching: ['🎲 探しています…', '🎲 Looking…'],
  pickNothing: ['ほかに入れられる配信が見つかりませんでした', 'No other stream to add'],
  pickedLive: ['🎲 ライブ: {0}', '🎲 Live: {0}'],
  pickedArchive: ['🎲 最近の配信: {0}', '🎲 Recent stream: {0}'],
  reasonEnded: ['配信終了', 'Ended'],
  reasonClosed: ['✕ で閉じた', 'Closed'],
  reasonMembers: ['メンバー限定', 'Members-only'],
  reasonReplaced: ['入れ替え', 'Replaced'],
  starEmpty: ['ピックアップはまだありません。「📺 すべて」に切り替えてチャンネルの 📌 を押すか、枠のバーの 📌 を押すと入ります。箱企画などで注目したいチャンネルを入れて、自動再生の対象を「ピックアップ (📌) だけ」にすると、その配信だけを並べられます。', 'Nothing picked up yet. Switch to "📺 All" and press 📌 on a channel, or press 📌 on a tile bar. Pick the channels you want to follow (e.g. a group event) and set auto play to "Pickup (📌) only" to show just those streams.'],
  starOn: ['ピックアップに入れる', 'Pick up'],
  starOff: ['ピックアップから外す (チャンネル一覧には残ります)', 'Remove from pickup (stays in channels)'],
  tilePickOn: ['この枠のチャンネルをピックアップに入れる', "Pick up this tile's channel"],
  tilePickOff: ['この枠のチャンネルをピックアップから外す', "Remove this tile's channel from pickup"],
  pickRemoved: ['「{0}」をピックアップから外しました', 'Removed "{0}" from pickup'],
  favEmpty: ['まだチャンネルがありません。下の欄にチャンネルを入力して追加してください。', 'No channels yet. Enter a channel below to add one.'],
  liveCount: ['配信中 {0}', '{0} live'],
  checking: ['確認中…', 'Checking…'],
  unavailable: ['取得できませんでした', 'Unavailable'],
  upcomingAt: ['予定 {0}', 'Upcoming {0}'],
  shownIn: ['枠 {0} で表示中', 'In tile {0}'],
  shownInOtherTab: ['別のタブで表示中', 'Shown in another tab'],
  sessionTaken: ['選んだ視聴内容は別のタブで使われ始めたので、新しく始めました', 'That session was just opened in another tab, so a new one was started'],
  allInOtherTabs: ['配信中のものは、どれも別のタブで表示中です。新しく始まった配信はこのタブに入れます', 'Every live stream is already shown in another tab. New streams will be added to this tab'],
  restorePresets: ['外したものを戻す ({0})', 'Restore removed ({0})'],
  removePresets: ['全部外す ({0})', 'Remove all ({0})'],
  removePresetsConfirm: [
    '初期データのチャンネル {0} 件を、チャンネル一覧から外しますか？ (自分で追加したものと、ピックアップ (📌) に入れたものは残します。「外したものを戻す」でいつでも戻せます)',
    'Remove {0} default channels from your channels? (Channels you added and channels in pickup (📌) stay. You can bring them back any time with "Restore removed")',
  ],
  noEmptyTile: [
    '空いている枠がありません。枠の「📺 チャンネルから選ぶ」「📚 ライブラリから選ぶ」から開くと、その枠に読み込めます。',
    "There's no empty tile. Open it from a tile's “📺 Pick from channels” or “📚 Pick from library” to load into that tile.",
  ],
  stillChecking: ['配信状況を確認中です。終わってからもう一度押してください。', 'Still checking live status. Try again when it finishes.'],
  noUnshownLive: ['まだ表示していない配信中のチャンネルはありません。', 'Every live channel is already shown.'],
  notEnoughTiles: [
    '空き枠が足りず、{0} 件は入りませんでした。枠の多いレイアウトにしてください。',
    'Not enough empty tiles: {0} could not be added. Choose a layout with more tiles.',
  ],
  favAdding: ['ピックアップに入れています…', 'Picking up…'],
  favAdded: ['📌 「{0}」をピックアップに入れました', '📌 Picked up "{0}"'],
  favExists: ['「{0}」は追加済みです', '"{0}" is already in channels'],
  favAddFailed: ['ピックアップに入れられませんでした: {0}', 'Could not pick up: {0}'],
  adding: ['追加中…', 'Adding…'],

  // 自動再生・クルーズ
  membersRemoved: ['🔒 メンバー限定のため外しました: {0}', '🔒 Removed (members-only): {0}'],
  membersSkipped: ['🔒 メンバー限定のため除外: {0}', '🔒 Skipped (members-only): {0}'],
  onlyMembers: [
    '配信中なのはメンバー限定の配信 ({0}) だけでした。配信が始まったら自動で追加します',
    'Only members-only streams are live ({0}). Streams will be added when they start',
  ],
  noneLive: [
    'いま配信中のチャンネルはありません。配信が始まったら自動で追加します',
    'None of your channels are live right now. Streams will be added when they start',
  ],
  skippedCount: [' (メンバー限定 {0} 件を除外)', ' ({0} members-only skipped)'],
  playingSome: ['配信中 {0} 件のうち {1} 件を「{2}」で再生しています', 'Playing {1} of {0} live streams in "{2}"'],
  playingAll: ['配信中 {0} 件を「{1}」で再生しています', 'Playing {0} live streams in "{1}"'],
  statusFailed: ['配信状況を取得できませんでした: {0}', 'Could not get live status: {0}'],
  started: ['▶ 配信開始: {0}', '▶ Started: {0}'],
  soonAdded: ['⏰ まもなく開始: {0}', '⏰ Starting soon: {0}'],
  playingWithSoon: ['配信中 {0} 件・まもなく開始 {1} 件を「{2}」で再生しています', 'Playing {0} live and {1} starting soon in "{2}"'],
  upcomingCleared: ['配信予定の枠を外しました: {0}', 'Removed upcoming: {0}'],
  upcomingShown: [
    'いま配信中のチャンネルはありません。配信予定 {0} を「{1}」で表示しています',
    'None of your channels are live. Showing upcoming {0} in "{1}"',
  ],
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
  startAuto: ['自動再生で始める', 'Start with auto play'],
  startAutoNote: ['配信中のチャンネルを全部再生します', 'Play all your live channels'],
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
    'Auto play (L): when ON, plays all your live channels (up to the max tiles in settings), then checks every minute, adding a tile when a stream starts and removing it when the stream ends. Streams starting soon get a tile before they start (⚙ Settings → Auto play), and when nothing is live, upcoming streams are shown. Streams you close with ✕ while ON are not added back (turn it OFF → ON to bring them back)',
  'auto.label': 'Auto play',
  'cruise.title':
    'Cruise (C): at a set interval, moves the main tile and audio to the next stream so you can watch many streams a little at a time. Works with any tiles, with or without auto play. Change the interval in ⚙ Settings → Auto play',
  'cruise.label': 'Cruise',
  'fav.title': 'Library (B): recent streams, watch history and watch later',
  'ch.title': 'Channels (F): live and upcoming streams, and adding or picking up channels',
  'ch.label': 'Channels',
  'fav.label': 'Library',
  'nowPlaying': '🔇 Muted',
  'layout.title': 'Choose a layout',
  'addTile.title': 'Add a tile (the layout changes to fit the number of tiles)',
  'removeTile.title': 'Remove an empty tile (the layout changes to fit the number of tiles). Tiles with a stream are not removed',
  'gridFs.title': 'Fullscreen with all tiles (Shift+F). Move the mouse to the top edge to show this bar',
  'settings.title': 'Settings',
  'help.title': 'Help and keyboard shortcuts (?)',
  'close': 'Close (Esc)',

  // 設定
  'settings.h': '⚙ Settings',
  'lang.title': 'Display language',
  'lang.auto': 'Auto (browser language)',
  'tab.danmaku': 'Danmaku',
  'tab.audio': 'Outlines',
  'tab.chat': 'Chat',
  'tab.auto': 'Auto play',
  'tab.channels': 'Channels',
  'presets.h': 'Default channels',
  'presets.note': 'Channels included when you installed the extension. You can remove them all at once or bring back the removed ones. Channels you added and channels in pickup (📌) are never removed',
  'tab.backup': 'Backup',
  'backup.h': 'Back up your settings',
  'backup.note': 'Saves your settings, channels (including pickup 📌), watch history, Watch later and display language to one file. Moving or reinstalling the extension folder erases what is saved, so export first and import the file afterwards',
  'backup.export': '⬇ Export to a file',
  'backup.import': '⬆ Import from a file',
  'backup.importNote': 'Importing replaces your current settings, channels, watch history and Watch later with the contents of the file. Streams in the tiles now stay as they are',
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
  'dm.author': 'Author names',
  'dm.author.off': 'Hide',
  'dm.author.staff': 'Streamer and moderators only',
  'dm.author.all': 'Everyone',
  'dm.paid': 'Highlight Super Chats',
  'dm.font': 'Font',
  'dm.font.standard': 'Standard (sans-serif)',
  'dm.font.round': 'Rounded',
  'dm.font.mincho': 'Serif (Mincho)',
  'dm.font.ud': 'UD Gothic',
  'dm.weight': 'Weight',
  'dm.weight.normal': 'Normal',
  'dm.weight.bold': 'Bold',
  'dm.sample': 'Hello! こんにちは lol',
  'dm.sampleMember': 'A comment from a member',
  'dm.sampleViewer': 'Viewer',
  'dm.sampleMemberName': 'Member',
  'dm.sampleModName': 'Moderator',
  'dm.sampleOwnerName': 'Streamer',
  'dm.sampleMod': 'A comment from a moderator',
  'dm.sampleOwner': 'A comment from the streamer',
  'hl.note': 'Outline drawn around the tile whose audio is on',
  'hl.liveNote': 'Outline color for tiles showing a live stream (the audio outline wins on the tile whose audio is on)',
  'hl.width': 'Line width',
  'hl.glow': 'Glow',
  'hl.animate': 'Slowly animate the gradient',
  'chat.note': 'Look of the chat panel opened with 💬 (applies to open panels right away)',
  'chat.zoom': 'Text size',
  'chat.width': 'Width (relative to the tile)',
  'chat.noav': 'Hide author icons',
  'auto.skip': "Skip members-only streams you're not a member of",
  'auto.skipNote':
    'Before Auto play adds a stream, it checks whether the signed-in account can watch it. Tiles you load yourself are always shown',
  'auto.archive': 'Play recent streams when nothing is live',
  'auto.archiveNote': 'When no stream is live (late at night, for example), 4 recently ended streams from your channels play (pickup (📌) channels first, already watched ones skipped). They are cleared when a live stream starts',
  'auto.maxTiles': 'Max tiles in auto play',
  'auto.maxTilesNote': 'Auto play never plays more streams than this, even if more are live. Lower it on a slow connection or a slow computer',
  'auto.prestart': 'Prepare tiles for upcoming streams',
  'auto.prestartNote':
    'Adds a tile this long before an upcoming stream starts, so you can watch from the very beginning. When nothing is live, the next upcoming stream and those starting within an hour after it are shown instead',
  'auto.cruise': 'Cruise interval',
  'auto.cruiseNote':
    'While Cruise is ON, the main tile and audio move to the next stream at this interval. It also works with tiles you arranged yourself, without auto play. In uniform layouts the order stays and only the audio moves. Empty tiles are skipped and the layout is not changed. When auto play rearranges tiles, main + sub layouts are preferred',

  // 使い方
  'help.h': '? Help',
  'help.tip1': 'Paste a URL / video ID / <code>@handle</code> into an empty tile, or pick a live stream with “📺 Pick from channels” or a past one with “📚 Pick from library”',
  'help.tip2': 'Hover over a tile with a stream to show its control bar. Drag ⠿ at the left to swap tiles',
  'help.tip3': 'Turn on “Auto play” to show all your live channels; tiles are added and removed as streams start and end. Streams starting soon get a tile before they start, and when nothing is live, upcoming streams are shown',
  'help.tip4': 'Turn on “Cruise” to move the main tile and audio to the next stream at a set interval, so you can watch many streams a little at a time (also with tiles you arranged yourself, without auto play)',
  'help.tip5': 'Use the speaker in a tile’s player to listen to several tiles at once without muting the others',
  'help.keys': 'Keyboard',
  'key.audio': 'Play audio only from that tile',
  'key.arrows': 'Play audio only from the next tile in that direction',
  'key.tileFs': 'Fullscreen that tile (<kbd>Esc</kbd> to return)',
  'key.gridFs': 'Fullscreen with all tiles (move the mouse to the top edge to show the bar)',
  'key.mute': 'Mute ⇄ restore the previous audio',
  'key.pause': 'Pause ⇄ resume all tiles (live streams resume from the latest point)',
  'pauseAll.title': 'Pause / resume all tiles (Space). Live streams resume from the latest point',
  'pauseAll.label': 'Pause',
  'key.auto': 'Auto play ON / OFF',
  'key.cruise': 'Cruise ON / OFF',
  'key.fav': 'Open channels',
  'key.lib': 'Open the library',
  'key.danmaku': 'Hide / show danmaku on all tiles for now (unless set with ≋ on a tile, danmaku shows only on main tiles)',
  'tour.replay': '▶ Replay the tour',
  'key.help': 'Open this screen',

  // レイアウト
  'layout.h': '▦ Layout',
  'notice.title': 'Notifications (channels going live)',
  'notice.label': 'Notifications',
  'notice.h': '🔔 Notifications',
  'notice.clear': 'Clear all',
  'notice.empty': 'No notifications yet. When a channel goes live, it shows up here (checked while this page is open).',
  'progress.title': 'Preparing auto play',
  'layout.anchor': 'Placement',
  'fit.fit': 'Standard',
  'fit.fitTitle': 'Make every tile exactly 16:9. If the screen ratio differs, the leftover space goes to the outer margins',
  'fit.fill': 'Stretch',
  'fit.fillTitle': 'Fill the screen with no margins. Videos are zoomed to fit their tiles and the edges are cropped',
  'layout.note': 'Darker tiles are main tiles. Streams fill tile 1 (main) first. Drag ⠿ on a tile to swap.',

  // チャンネル・ピックアップ
  'scope.title': 'Which channels to show: only pickup (📌) / all (shared by every tab)',
  'auto.target': 'Auto play plays',
  'notice.target': 'Notifications for',
  'target.all': 'All channels',
  'target.fav': 'Pickup (📌) only',
  'target.off': 'Off',
  'settings.reset': 'Reset all to defaults',
  'settings.resetTitle': 'Reset all danmaku, outline, chat and auto play settings (the display language and channels are kept)',
  'fav.history': '🕘 Watch history',
  'fav.archive': '🎞 Recent streams',
  'fav.archiveTitle': 'Streams from your channels that ended in the last 7 days (newest first)',
  'scope.star': '📌 Pickup',
  'scope.all': '📺 All',
  'fav.saved': '🔖 Watch later',
  'fav.savedTitle': 'Streams and videos to watch later (🔖). Up to 100. Removed once played to the end or when you remove 🔖 (shared by all tabs)',
  'queue.play': '▶ Play in current tiles',
  'queue.playTitle': 'Play Watch later in order using the current tiles. When a tile finishes, the next one goes in (no tiles are added; auto play stops)',
  'fav.historyTitle': 'Streams and videos watched in this extension (latest 100, shared by all tabs)',
  'fav.historyClear': 'Clear all watch history',
  'fav.refresh': '⟳ Refresh',
  'fav.refreshTitle': 'Check live status again',
  'fav.filter': 'Filter by name or @handle',
  'fav.empty': 'No channels yet. Enter a channel below to add one.',
  'fav.addInput': 'Add: @handle / channel URL / video URL',
  'fav.add': 'Add',
  'fav.del': 'Remove from channels',

  // 枠
  'tile.input': 'Paste a URL / video ID / @handle',
  'tile.load': 'Load',
  'tile.pickCh': '📺 Pick from channels',
  'tile.pickFav': '📚 Pick from library',
  'tile.pickAny': '🎲 Surprise me',
  'tile.pickAnyTitle': 'Add one stream not shown yet: live streams from pickup (📌) → other live streams → recent streams from pickup → other recent streams, picked at random within each',
  'tile.grip': 'Drag to swap with another tile',
  'tile.audio': 'Play audio only from this tile (others are muted). To listen to several tiles at once, use the speaker in each player',
  'tile.chat': 'Show the chat panel',
  'tile.danmaku': 'Danmaku on this tile',
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
