// 表示言語 (日本語 / 英語)
// - 既定はブラウザの表示言語。日本語なら日本語、それ以外 (中国語・韓国語なども) は英語
// - 設定画面で「日本語」「English」に固定もできる (localStorage に保存。全タブ共通)
// - HTML の文言は grid.html に日本語で書いておき、data-i18n* 属性の付いた要素だけを英語に差し替える
// - スクリプトの文言は tr('key', 引数...) で取る ({0} {1} … に引数が入る)
/* exported LANG, LANG_PREF, tr, setLangPref, applyI18n */
'use strict';

const LANG_KEY = 'hakomado.lang';

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
  // 不具合の報告 (エラーの記録)
  errSrc_grid: ['マルチビュー画面', 'Multiview page'],
  errSrc_background: ['バックグラウンド', 'Background'],
  errSrc_watch: ['枠の動画', 'Video in a tile'],
  errSrc_chat: ['枠のチャット', 'Chat in a tile'],
  errTimes: ['×{0} 回', '×{0}'],
  errCopied: ['報告の内容をクリップボードにコピーしました', 'Copied the report to the clipboard'],
  errCleared: ['エラーの記録を削除しました', 'Deleted the error record'],
  errClearConfirm: ['エラーの記録をすべて削除します。よろしいですか？', 'All entries in the error record will be deleted. Continue?'],
  errIssueTitle: ['不具合の報告: ', 'Problem report: '],
  errBodyWhat: ['## 発生した問題\n(操作内容と、発生した現象を記入してください)', '## Problem\n(Describe what you did and what happened)'],
  errBodyEnv: ['## 環境', '## Environment'],
  errBodyLog: ['## エラーの記録 (新しい順、{0} / {1} 件)', '## Error record (newest first, {0} of {1})'],
  errBodyNone: ['(記録はありません)', '(nothing recorded)'],

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
  andMore: [' ほか {0} 個', ' and {0} more'],
  autoReplaceConfirm: [
    '自動再生を ON にすると、自分で入れた枠 {0} 個 ({1}) が配信中の配信に置き換わります。続けますか？\n(キャンセルすると、枠はそのままで自動再生は OFF に戻ります)',
    'Turning on auto play replaces {0} tiles you set yourself ({1}) with live streams. Continue?\n(Cancel keeps the tiles as they are and turns auto play back off)',
  ],
  autoReplaceCanceled: ['自動再生を OFF に戻しました (枠はそのままです)', 'Auto play is off again (the tiles were left as they were)'],

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
  secLive: ['● 配信中', '● Live'],
  secUpcoming: ['予定', 'Upcoming'],
  secOther: ['その他', 'Others'],
  secAll: ['すべて', 'All'],
  favNoMatch: ['「{0}」に一致するチャンネルはありません。', 'No channels match "{0}".'],
  backupConfirm: [
    'このファイルの内容で置き換えますか？\nチャンネル {0} 件 (ピックアップ {1} 件)・視聴履歴 {2} 件・あとで見る {3} 件・再生リスト {4} 件\n(今の設定・チャンネル・視聴履歴・あとで見る・再生リストは消えます)',
    'Replace your data with this file?\n{0} channels ({1} in pickup), {2} in watch history, {3} in Watch later, {4} playlists\n(Your current settings, channels, watch history, Watch later and playlists will be replaced.)',
  ],
  backupNotFile: ['Hakomado のバックアップファイルではないため、読み込めませんでした', "This isn't a Hakomado backup file, so it was not imported"],
  backupTooNew: [
    'このファイルは新しい版の Hakomado で書き出されたため、読み込めません。拡張機能を更新してから読み込んでください',
    'This file was exported by a newer version of Hakomado. Update the extension, then import it again',
  ],
  backupFail: ['書き出し / 読み込みに失敗しました: {0}', 'Export / import failed: {0}'],
  backupImported: ['読み込みました。画面を読み込み直します', 'Imported. Reloading the page'],
  updateLink: ['新しいバージョン {0} があります', 'Version {0} is available'],
  updateNotice: ['Hakomado の新しいバージョン {0} が出ています (設定画面の下から開けます)', 'Hakomado {0} is available (open it from the bottom of Settings)'],
  settingsResetConfirm: ['設定をすべて初期値に戻しますか？ (表示言語とチャンネルはそのまま)', 'Reset all settings to their defaults? (The display language and channels are kept.)'],
  rateLimited: ['YouTube から取得を制限されたため、しばらく取りに行きません', 'YouTube is limiting requests; pausing for a while'],
  progressStatus: ['チャンネルの配信状況を確認しています ({0} / {1})', 'Checking live status of channels ({0} / {1})'],
  progressAccess: ['見られる配信か確認しています ({0} / {1})', 'Checking which streams you can watch ({0} / {1})'],
  shareEmpty: ['表示中の枠に配信がありません', 'No streams in the shown tiles'],
  shareCopied: ['コードをコピーしました', 'Copied the code'],
  shareImageMaking: ['画像を作っています…', 'Making the image…'],
  shareImageCopied: ['画像をコピーしました。X などの投稿欄に貼り付けられます', 'Copied the image. You can paste it into a post on X or elsewhere'],
  shareImageFail: ['画像を作れませんでした: {0}', 'Could not make the image: {0}'],
  shareImageReading: ['画像の QR を読んでいます…', 'Reading the QR in the image…'],
  shareImageNoQr: ['画像から Hakomado の QR を読み取れませんでした (投稿の画像を開いて、大きい画像をコピーしてみてください)', 'Could not read a Hakomado QR from the image (try opening the image in the post and copying the large version)'],
  shareImageTitle: ['視聴セット', 'viewing set'],
  shareImageCount: ['{0} 本 · {1}', '{0} streams · {1}'],
  shareImageBy: ['作: {0}', 'by {0}'],
  shareXAttaching: ['X の投稿画面に画像を入れています…', 'Adding the image to the X post screen…'],
  shareXAttached: ['X の投稿画面に画像を入れました。内容を確かめて投稿してください', 'Added the image to the X post screen. Check it and post'],
  shareXPaste: ['画像をコピーしました。X の投稿画面で Ctrl+V で貼り付けてください', 'Copied the image. Paste it into the X post screen with Ctrl+V'],
  shareXNoImage: ['X の投稿画面を開きました。画像は「画像を保存」してから添付してください', 'Opened the X post screen. Save the image and attach it there'],
  shareNothing: ['YouTube の URL が見つかりませんでした', 'No YouTube URLs were found'],
  shareLoading: ['読み込んでいます ({0} / {1})', 'Loading ({0} / {1})'],
  shareBadLines: ['{0} 行は読み取れなかったので飛ばしました', 'Skipped {0} lines that could not be read'],
  shareTooMany: ['枠に並べたのは先頭 16 本です', 'Only the first 16 were laid out in tiles'],
  shareLoaded: ['▦ 枠に並べました ({0} 本)', '▦ Laid out {0} streams in tiles'],
  shareXCount: ['X の文字数: {0} / {1}', 'Length on X: {0} / {1}'],
  shareXOver: [
    'X の文字数: {0} / {1}。本文には入らないので、画像で共有してください (画像の QR と ALT には入ります)',
    'Length on X: {0} / {1}. Too long for a post, so share the image instead (the QR and ALT text hold it)',
  ],
  shareAltHead: ['{0} — Hakomado の視聴セット ({1} 本 · {2})', '{0} — a Hakomado viewing set ({1} streams · {2})'],
  shareAltSep: ['、', ', '],
  shareAltCode: ['Hakomado の「📥 読み込む」に貼ると開けるコード: {0}', 'Code to paste into “📥 Import” in Hakomado: {0}'],
  shareAltCopied: ['ALT 用の文をコピーしました。X の投稿で画像の「説明を追加」に貼ってください', 'Copied the ALT text. Paste it into “Add description” on the image in your X post'],
  shareEmptyPl: ['この再生リストは空です', 'This playlist is empty'],
  shareSourceTiles: ['今の枠 ({0} 本)', 'Current tiles ({0})'],
  shareSourceTilesEmpty: ['今の枠 (配信なし)', 'Current tiles (no streams)'],
  shareSourcePlaylists: ['再生リスト', 'Playlists'],
  shareSourcePl: ['{0} ({1} 本)', '{0} ({1})'],
  shareAllN: ['{0} 本', '{0} streams'],
  shareFirstN: ['全 {1} 本のうち先頭 {0} 本', 'the first {0} of {1} streams'],
  shareNoteImage: [
    '入るもの: {0}・レイアウト・同期のずれ・名前 (画像に描き、QR にも入れます) / 入らないもの: 枠の名前。X などに添えて投稿すると、受け取った人は画像を Hakomado に貼るだけで同じ並びを開けます',
    'Includes: {0}, the layout, sync offsets and the name (drawn on the image and kept in the QR) / Not included: tile names. Attach it to a post on X or elsewhere, and others can open the same arrangement just by pasting the image into Hakomado',
  ],
  shareNoteCode: [
    '入るもの: {0}・レイアウト・同期のずれ・名前 / 入らないもの: 枠の名前。X などの本文に貼りやすい 1 行です。Hakomado に貼ると開けます',
    'Includes: {0}, the layout, sync offsets and the name / Not included: tile names. One line, easy to put in a post on X. Paste it into Hakomado to open it',
  ],
  shareNoteText: [
    '入るもの: 全部 ({0}・名前・同期再生・レイアウト・ずれ・枠の名前)。Hakomado に貼ると元どおりに戻ります。AI チャットに渡して直してもらうこともできます',
    'Includes: everything ({0}, the name, sync setting, layout, offsets and tile names). Pasting it into Hakomado restores it as it was. You can also hand it to an AI chat to edit',
  ],
  shareNoteLink: [
    '入るもの: {0}・名前 / 入らないもの: 同期のずれ・レイアウト・枠の名前。Hakomado が入っていれば開くだけで読み込めます。入っていない人も YouTube の再生リストとして見られます (YouTube の制限で 50 本まで)',
    'Includes: {0} and the name / Not included: sync offsets, layout and tile names. With Hakomado, opening it imports them. Without it, it still opens as a YouTube playlist (up to 50 because of a YouTube limit)',
  ],
  readNothing: [
    '読み込めるもの (共有のコード・テキスト・取り込み用リンク・YouTube の URL) が見つかりませんでした',
    'Nothing to import was found (a shared code, text, import link or YouTube URLs)',
  ],
  readName: ['「{0}」', '“{0}”'],
  readCount: ['{0} 本', '{0} streams'],
  readLayout: ['レイアウト {0}', 'layout {0}'],
  readSync: ['同期再生', 'sync'],
  readSyncOffsets: ['同期再生 (ずれあり)', 'sync (with offsets)'],
  readOverTiles: ['枠に並べるのは先頭 {0} 本です', 'Only the first {0} are laid out in tiles'],
  readOverSync: ['同期再生は {0} 本までなので、枠に並べるのも保存するのも先頭 {0} 本です', 'Sync holds up to {0}, so only the first {0} are laid out or saved'],
  readReplace: ['同じ名前の再生リスト「{0}」があるので、保存すると置き換えます', 'A playlist named “{0}” exists; saving replaces it'],
  shareLoadedSync: [
    '▦ 枠に並べました ({0} 本)。同期のずれが入っているので、読み込めたら同期を始めます',
    '▦ Laid out {0} streams in tiles. They have sync offsets, so syncing starts once the archives load',
  ],
  diagNotice: [
    '⚠ YouTube 側の変更などで、動いていない機能があるかもしれません: {0} (枠のバーの ⚠ に詳しく出ます)',
    '⚠ Some features may have stopped working, possibly due to a YouTube change: {0} (see ⚠ on the tile bar)',
  ],
  diagTitle: [
    'この枠で動いていない機能:\n・{0}\n(YouTube 側の変更などが考えられます。読み込み直しても直らなければ、拡張機能の更新を待ってください)',
    'Features not working in this tile:\n・{0}\n(Possibly a YouTube change. If reloading does not help, wait for an extension update)',
  ],
  diag_frame: ['枠の中のスクリプト全体 (音の切り替え・チャンネル名など)', 'Scripts inside the tile (audio switching, channel name, etc.)'],
  diag_player: ['プレイヤーの操作 (ミュート・一時停止・終了の検知)', 'Player control (mute, pause, end detection)'],
  diag_meta: ['チャンネル名の取得 (枠の名前・📌)', 'Reading the channel name (tile name, 📌)'],
  diag_chat: ['チャットの取得 (弾幕・チャット欄)', 'Reading the chat (danmaku, chat panel)'],
  syncOn: ['{0} 本のアーカイブを、配信していた時刻でそろえて再生しています', 'Playing {0} archives aligned to the time they were streamed'],
  syncStopped: ['同期できるアーカイブが 2 本未満になったので、同期をやめました', 'Stopped syncing: fewer than 2 archives can be synced'],
  syncStartsIn: ['この配信は、あと {0} で始まります', 'This stream starts in {0}'],
  syncEnded: ['この配信は、この時刻にはもう終わっています', 'This stream has already ended at this time'],
  syncNoOverlap: ['時間帯が重ならないため、同期していません', 'Not synced: the time ranges do not overlap'],
  syncRefOpt: ['基準: {0}', 'Ref: {0}'],
  syncTitle: [
    'アーカイブ同期: 配信のアーカイブを、配信していた実際の時刻でそろえて再生する',
    'Archive sync: play stream archives aligned to when they were actually streamed',
  ],
  syncWhyNeed: [
    '配信の時間帯が重なるアーカイブを 2 本以上並べると使えます',
    'Available when 2 or more stream archives with overlapping times are shown',
  ],
  syncWhyEmpty: ['今は枠に何も読み込んでいません', 'Nothing is loaded in the tiles yet'],
  syncWhyNoOverlap: ['今のアーカイブは、配信の時間帯が重なっていません', 'The archives shown were not streamed at overlapping times'],
  syncWhyArchives: ['今の枠のアーカイブ: {0} 本', 'Archives in the tiles: {0}'],
  syncWhyLive: ['ライブ配信中: {0} 本 (配信が終わってアーカイブになると使えます)', 'Live now: {0} (usable once the stream ends and becomes an archive)'],
  syncWhyUpcoming: ['配信前: {0} 本', 'Not started yet: {0}'],
  syncWhyVideo: ['ふつうの動画: {0} 本 (配信の時刻が無いので同期できません)', 'Regular videos: {0} (they have no stream times, so they cannot be synced)'],
  syncWhyBlocked: ['見られない動画: {0} 本', 'Not viewable: {0}'],
  syncWhyLoading: ['確認中: {0} 本 (アーカイブだと分かりしだい使えます)', 'Checking: {0} (usable once recognized as archives)'],
  infoKind_live: ['ライブ', 'Live'],
  infoKind_upcoming: ['配信前', 'Upcoming'],
  infoKind_archive: ['アーカイブ', 'Archive'],
  infoKind_video: ['動画', 'Video'],
  infoKind_blocked: ['見られない', 'Unavailable'],
  infoKind_loading: ['確認中', 'Checking'],
  infoSync_live: ['ライブ中 (終わると使えます)', 'Live (usable after it ends)'],
  infoSync_upcoming: ['配信前', 'Not started yet'],
  infoSync_video: ['動画は同期できません', 'Videos cannot be synced'],
  infoSync_blocked: ['見られない', 'Unavailable'],
  infoSync_loading: ['確認中', 'Checking'],
  infoSyncRef: ['同期中 (基準)', 'Syncing (reference)'],
  infoSyncOn: ['同期中', 'Syncing'],
  infoSyncCan: ['同期できます', 'Can sync'],
  infoSyncNoOverlap: ['時間帯が重なるアーカイブがありません', 'No archive overlaps in time'],
  infoSyncAlone: ['ほかにアーカイブがありません', 'No other archive'],
  infoLiveNow: ['配信中', 'Live now'],
  infoPlanned: ['{0} (予定)', '{0} (planned)'],
  syncRefMoved: ['基準の枠が無くなったので、{0} を基準にしました', 'The reference tile is gone, so {0} is now the reference'],
  syncOffset: ['ずれ {0}秒', 'Offset {0}s'],
  syncDriftAhead: ['追いつき中: 設定の位置より {0} 秒進んでいます', 'Catching up: {0}s ahead of the set position'],
  syncDriftBehind: ['追いつき中: 設定の位置より {0} 秒遅れています', 'Catching up: {0}s behind the set position'],
  syncDriftOk: ['追いついています (設定の位置との差 {0} 秒)', 'Caught up ({0}s from the set position)'],
  syncDriftRef: ['この枠が基準です (ほかの枠がこの枠に合わせます)', 'This is the reference tile (the other tiles follow it)'],
  syncTrimmed: [
    'アーカイブが配信より約 {0} 短くなっています (冒頭か末尾が切られている可能性)',
    'This archive is about {0} shorter than the stream (the start or end may have been cut)',
  ],
  syncTrimHead: ['冒頭が切られた場合: {0} 秒にする', 'If the start was cut: set to {0}s'],
  syncWait: ['⏸ 止めて待つ', '⏸ Pause and wait'],
  syncWaitResume: ['▶ ここで合わせる', '▶ Match here'],
  syncWaitStart: [
    'この枠だけ止めています。ほかが追いついたら再生すると、そこでずれが決まります',
    'Only this tile is paused. Play it when the others catch up, and the offset is set there',
  ],
  syncOffsetSet: ['ずれを {0} 秒にしました', 'Offset set to {0}s'],
  syncAudioStart: [
    '🎧 音を {0} 秒聞いて、ずれを測ります。そのまま再生しておいてください',
    '🎧 Listening for {0}s to measure the offsets. Keep it playing',
  ],
  syncAudioMeasuring: ['🎧 {0}/{1}秒', '🎧 {0}/{1}s'],
  syncAudioAnalyzing: ['🎧 計算中…', '🎧 Working…'],
  syncAudioNeedPlay: ['🎧 再生しながら測ります。再生してから押してください', '🎧 It measures while playing. Start playback first'],
  syncAudioCancelled: ['🎧 音で合わせるのをやめました', '🎧 Stopped measuring by sound'],
  syncAudioBlocked: [
    '🎧 枠の音を処理できなかったので、やめました (ブラウザが音の処理を止めています)。枠をクリックしてから、もう一度試してください',
    "🎧 Stopped: couldn't process the tiles' sound (the browser is holding back audio processing). Click a tile and try again",
  ],
  syncAudioShort: ['🎧 測れた時間が短すぎました。もう一度試してください', '🎧 Not enough was recorded. Try again'],
  syncAudioWeak: [
    '🎧 ずれを決められませんでした。声が少ない区間かもしれません。話している場面で、もう一度測ってください',
    "🎧 Couldn't determine the offsets. There may be too little talking here. Try again where people are talking",
  ],
  syncAudioResultTitle: ['🎧 音で測ったずれ (基準: {0})', '🎧 Offsets measured by sound (reference: {0})'],
  syncAudioRow: ['{0}: {1} 秒 → {2} 秒 (確かさ {3})', '{0}: {1}s → {2}s (confidence {3})'],
  syncAudioRowNone: ['{0}: 決められませんでした', "{0}: couldn't determine"],
  syncAudioMid: ['中間 (映像がそろう)', 'Midpoint (video lines up)'],
  syncAudioVoice: ['{0} の声に合わせる', "Match {0}'s voice"],
  syncAudioApply: ['反映', 'Apply'],
  syncAudioClose: ['閉じる', 'Close'],
  syncAudioApplied: ['🎧 音で測ったずれを {0} 枠に反映しました', '🎧 Applied the measured offsets to {0} tile(s)'],
  approxMin: ['{0} 分', '{0} min'],
  approxSec: ['{0} 秒', '{0} s'],
  packConfirm: [
    'チャンネルパック「{0}」を読み込みますか？\n{1} 件を追加します (登録済みの {2} 件はそのまま)',
    'Import the channel pack “{0}”?\n{1} channels will be added ({2} you already have stay as they are)',
  ],
  packNothing: ['チャンネルパック「{0}」のチャンネルは、すべて登録済みです', 'You already have every channel in the pack “{0}”'],
  packAdded: ['チャンネルパック「{0}」から {1} 件を追加しました', 'Added {1} channels from the pack “{0}”'],
  packNotPack: ['チャンネルパックとして読めませんでした', 'This could not be read as a channel pack'],
  packEmpty: ['チャンネルパックに、読み込めるチャンネルがありません', 'The channel pack has no channels that can be imported'],
  packTooLarge: ['チャンネルパックが大きすぎます (2MB まで)', 'The channel pack is too large (up to 2 MB)'],
  packBadUrl: ['https の URL を入れてください', 'Enter an https URL'],
  packFetchFail: ['チャンネルパックを取得できませんでした: {0}', 'Could not get the channel pack: {0}'],
  packLoading: ['読み込んでいます…', 'Loading…'],
  packRemove: ['外す', 'Remove'],
  mixBlocked: [
    'この枠では左右・音量・遅延を変えられませんでした (ブラウザが音の処理を止めています)。枠をクリックしてから、もう一度試してください',
    "Couldn't change left/right, volume or delay in this tile (the browser is holding back audio processing). Click the tile and try again",
  ],
  mixNeed2: ['音の出ている枠を 2 つにしてから押してください (いま {0} 枠)', 'Make exactly 2 tiles play audio first (now {0})'],
  mixLeft: ['左から聞こえます', 'Heard from the left'],
  mixRight: ['右から聞こえます', 'Heard from the right'],
  catalogEmpty: ['一覧にパックがありません', 'There are no packs in the list'],
  catalogBad: ['パックの一覧として読めませんでした', 'This could not be read as a pack list'],
  catalogBy: ['作成: {0}', 'By {0}'],
  catalogUpdated: ['更新: {0}', 'Updated {0}'],
  catalogChannels: ['{0} チャンネル', '{0} channels'],
  catalogImport: ['読み込む', 'Import'],
  catalogImported: ['読み込み済み', 'Imported'],
  catalogUpdate: ['更新を取り込む', 'Get the update'],
  catalogUpdateNote: ['更新があります (増えたチャンネルを足します)', 'Updated (new channels will be added)'],
  packRemoveConfirm: [
    'チャンネルパック「{0}」から足したチャンネル ({1} 件) をまとめて外しますか？ (ピックアップ (📌) に入れたものは残します)',
    'Remove the {1} channels added from the pack “{0}”? (Channels in pickup (📌) are kept)',
  ],
  packRemoved: ['チャンネルパック「{0}」のチャンネルを {1} 件外しました', 'Removed {1} channels from the pack “{0}”'],
  packBuiltin: ['ホロライブ (同梱版)', 'Hololive (bundled)'],
  packBuiltinExport: ['ホロライブ', 'Hololive'],
  packMine: ['自分で追加したチャンネル', 'Channels you added'],
  packRestore: ['戻す ({0})', 'Restore ({0})'],
  packCount: ['{0} ({1} 件)', '{0} ({1})'],
  packAllGroups: ['すべてのチャンネル', 'All channels'],
  progressArchive: ['最近の配信を探しています ({0} / {1})', 'Looking for recent streams ({0} / {1})'],
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
  tourName: ['使い方ツアー', 'Tour'],
  tourWelcomeS: ['ようこそ', 'Welcome'],
  tourPickS: ['配信を入れる', 'Add a stream'],
  tourTileS: ['枠の操作', 'Tile controls'],
  tourLayoutS: ['レイアウト', 'Layouts'],
  tourChannelsS: ['チャンネル', 'Channels'],
  tourLibraryS: ['ライブラリ', 'Library'],
  tourAutoS: ['自動再生', 'Auto play'],
  tourWelcomeT: ['Hakomado へようこそ', 'Welcome to Hakomado'],
  tourWelcome: ['YouTube の配信を最大 16 枠、並べて同時に見られます。たとえば、こんな見方ができます。', 'Watch up to 16 YouTube streams side by side. For example:'],
  tourUseLiveT: ['📺 ライブをまとめて見る', '📺 Many live streams at once'],
  tourUseLive: ['いくつもの配信を 1 画面に並べ、音を出す枠を切り替えながら見られます。', 'Line up several streams on one screen and switch which one you hear.'],
  tourUseSyncT: ['⏱ コラボを同時視聴', '⏱ Collab archives in sync'],
  tourUseSync: ['それぞれの視点のアーカイブを、配信していた時刻にそろえて再生します。', 'Play each member’s archive lined up to the moment it was streamed.'],
  tourUseLeaveT: ['🌙 つけっぱなしで流し見', '🌙 Leave it running'],
  tourUseLeave: ['自動再生なら、始まった配信を足し、終わった配信を片付けて、見続けられます。', 'Auto play adds streams as they start and clears them when they end, so you can keep watching.'],
  tourPickT: ['見たい配信を入れる', 'Add a stream'],
  tourPick: [
    'URL を貼るか、今の配信は「📺 チャンネルから選ぶ」、終わった配信は「📚 ライブラリから選ぶ」で入れます。「🎲 おまかせ」なら 1 本選んで入れます。YouTube のリンクを右クリックしても追加できます。',
    'Paste a URL, or pick live streams with “📺 Pick from channels” and past ones with “📚 Pick from library”. “🎲 Surprise me” picks one for you. You can also right-click a YouTube link to add it.',
  ],
  tourTileT: ['枠の操作', 'Tile controls'],
  tourTile: [
    '配信の入った枠にマウスを乗せると、このバーが出ます。🔊 で音を出す枠を切り替え、🎚 で音の左右と音量、💬 でチャット欄、≋ で弾幕。左端の ⠿ をドラッグすると枠を入れ替えます。',
    'Hover over a tile with a stream to show this bar. 🔊 chooses which tile plays audio, 🎚 sets left/right and volume, 💬 opens chat and ≋ toggles danmaku. Drag ⠿ at the left to swap tiles.',
  ],
  tourLayoutT: ['レイアウト', 'Layouts'],
  tourLayout: ['▦ で並べ方を選び、＋ − で枠を増やしたり減らしたりします。', 'Choose an arrangement with ▦, and add or remove tiles with + and −.'],
  tourMockName: ['チャンネル名', 'Channel name'],
  tourChannelsT: ['📺 チャンネル', '📺 Channels'],
  tourChannels: [
    '右上の「📺 チャンネル」で開く画面です。登録したチャンネルの配信中・配信予定が並び、押すと空いている枠に入ります。チャンネルの追加や 📌 ピックアップもここで。',
    'This opens from “📺 Channels” at the top right. See which of your channels are live or coming up, and press one to put it in a free tile. Add channels and 📌 pick up favorites here.',
  ],
  tourLibraryT: ['📚 ライブラリ', '📚 Library'],
  tourLibrary: [
    '右上の「📚 ライブラリ」で開く画面です。最近終わった配信・視聴履歴・あとで見る・再生リストがまとまっています。再生リストの「⏱ まとめて同期再生」で、コラボのアーカイブを同じ瞬間にそろえて見られます。',
    'This opens from “📚 Library” at the top right. Recent streams, watch history, Watch later and playlists are here. “⏱ All at once, in sync” on a playlist lines up collab archives to the same moment.',
  ],
  tourAutoT: ['自動再生ではじめましょう', 'Start with auto play'],
  tourAuto: ['押すと、配信中のチャンネルが並びます。ほかの場所を押すと、押さずにツアーを終えます。このツアーは、右上の ? (使い方) からいつでも見直せます。', 'Press it to lay out the channels that are live. Click anywhere else to finish the tour without it. You can replay this tour any time from ? (Help) at the top right.'],
  resumeAll: ['再開', 'Resume'],
  pauseLabel: ['一時停止', 'Pause'],
  archiveBtn: ['最近 ⌄', 'Recent ⌄'],
  archiveBtnOpen: ['最近 ⌃', 'Recent ⌃'],
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
  savedPlayTitle: [
    'あとで見るを、今ある枠で入れた順に再生する。最後まで見た枠には次が入る (枠は増やさない。自動再生は止める)',
    'Play Watch later in order using the current tiles. When a tile finishes, the next one goes in (no tiles are added; auto play stops)',
  ],
  // 📃 再生リスト
  plPlayTitle: [
    'この再生リストを、今ある枠で上から順に再生する。最後まで見た枠には次が入る (枠は増やさない。自動再生は止める。再生リストからは消えない)',
    'Play this playlist from the top using the current tiles. When a tile finishes, the next one goes in (no tiles are added; auto play stops; nothing is removed from the playlist)',
  ],
  plDefaultName: ['再生リスト {0}', 'Playlist {0}'],
  plSeedName: ['新規マイリスト', 'My list'],
  plSaved: ['📃 再生リスト「{0}」を保存しました ({1} 本)', '📃 Saved playlist "{0}" ({1})'],
  plReplaced: ['📃 再生リスト「{0}」を新しい内容で置き換えました ({1} 本)', '📃 Replaced playlist "{0}" with the new list ({1})'],
  plFull: ['再生リストは {0} 個までです。ライブラリの「📃 再生リスト」から不要なものを削除してください', 'You can have up to {0} playlists. Delete some in "📃 Playlists" in the library'],
  plSaveFailed: ['再生リストを保存できませんでした', 'Could not save the playlist'],
  plStorageFull: [
    '再生リストを保存できませんでした。拡張機能の保存できる量がいっぱいです。使っていない再生リストを削除してください',
    'Could not save the playlist: the extension’s storage is full. Delete playlists you no longer use',
  ],
  plWriteFailed: ['再生リストを保存できませんでした ({0})', 'Could not save the playlist ({0})'],
  plTooMany: ['{0} 本を超えた分は保存しません', 'Only the first {0} are saved'],
  plTooManySync: ['同期再生の再生リストは {0} 本までなので、それを超えた分は保存しません', 'Sync playlists hold up to {0}, so only the first {0} are saved'],
  plSyncCutConfirm: [
    '同期再生の再生リストは {0} 本までです。17 本目以降の {1} 本を外して同期再生にしますか？',
    'Sync playlists hold up to {0}. Remove the {1} after the first {0} and switch to sync?',
  ],
  plSyncCut: ['{0} 本を外して同期再生にしました', 'Removed {0} and switched to sync'],
  plEmpty: [
    '再生リストはまだありません。上の「＋ 新規」で空の再生リストを作るか、「▦ 今の枠から作る」で表示中の枠をそのまま再生リストにできます。枠のバーや、最近の配信・視聴履歴・あとで見るの 📃 からも作れます。',
    'No playlists yet. Use "+ New" above to make an empty one, or "▦ From current tiles" to turn the shown tiles into a playlist. You can also make one with 📃 on a tile bar or in recent streams, watch history and Watch later.',
  ],
  plNoItems: [
    'この再生リストは空です。下の欄に URL を入れるか、「▦ 今の枠を追加」、枠のバーや最近の配信・視聴履歴・あとで見るの 📃 で入れられます。',
    'This playlist is empty. Enter a URL in the box below, use "▦ Add current tiles", or 📃 on a tile bar or in recent streams, watch history and Watch later.',
  ],
  plAddTitle: ['再生リストに入れる / 外す', 'Add to or remove from a playlist'],
  tilePlaylist: ['この配信を再生リストに入れる / 外す', 'Add this stream to a playlist, or remove it'],
  plItemDrag: ['ドラッグで並べ替え', 'Drag to reorder'],
  plNameExists: ['「{0}」という再生リストがもうあります', 'A playlist named "{0}" already exists'],
  plPickNone: ['再生リストはまだありません。下に名前を入れて作ってください。', 'No playlists yet. Enter a name below to make one.'],
  plPickAdd: ['この再生リストの最後に入れる', 'Add to the end of this playlist'],
  plPickRemove: ['入っています。押すとこの再生リストから外す', 'Already in it. Press to remove it from this playlist'],
  plPickAdded: ['📃 「{0}」に入れました', '📃 Added to "{0}"'],
  plPickRemoved: ['📃 「{0}」から外しました', '📃 Removed from "{0}"'],
  plPickNeedName: ['新しい再生リストの名前を入れてください', 'Enter a name for the new playlist'],
  plItemsFull: ['「{0}」はいっぱい ({1} 本) です', '"{0}" is full ({1})'],
  plItemsFullSync: [
    '「{0}」はいっぱいです (同期再生の再生リストは {1} 本まで。もっと入れるときは「▶ 順に再生」にしてください)',
    '"{0}" is full (sync playlists hold up to {1}. Switch to "▶ In order" to add more)',
  ],
  plItemRemove: ['この再生リストから外す', 'Remove from this playlist'],
  plDeleteConfirm: ['再生リスト「{0}」({1} 本) を削除しますか？', 'Delete playlist "{0}" ({1})?'],
  plQueueEmpty: ['この再生リストには何もありません', 'This playlist is empty'],
  plStarted: ['📃 再生リスト「{0}」を順に再生します ({1} 本)', '📃 Playing playlist "{0}" in order ({1})'],
  plNext: ['▶ 再生リストの次: {0}', '▶ Next in playlist: {0}'],
  plDone: ['再生リストを最後まで再生しました', 'Finished the playlist'],
  savedPlay: ['▶ 今の枠で順に再生', '▶ Play in current tiles'],
  plPlayQueue: ['▶ 順に再生', '▶ Play in order'],
  plPlaySync: ['⏱ 同期再生', '⏱ Play in sync'],
  plPlaySyncTitle: [
    'この再生リストを全部枠に並べ、アーカイブを同じ瞬間にそろえて再生する (今の枠は置き換わる。自動再生は止める)',
    'Lay out this whole playlist in tiles and play the archives in step (replaces the current tiles; auto play stops)',
  ],
  plNameTitle: ['再生リストの名前 (書き換えると変わる)', 'Playlist name (edit to rename)'],
  plShareBtn: ['🔗 共有', '🔗 Share'],
  plShareBtnTitle: ['この再生リストを画像・コード・テキスト・リンクにして人に渡す', 'Share this playlist as an image, a code, text or a link'],
  plDeleteTitle: ['この再生リストを削除する', 'Delete this playlist'],
  plModeLabel: ['再生のしかた', 'Play'],
  plModeQueue: ['▶ 順に再生', '▶ In order'],
  plModeQueueTitle: [
    '今ある枠に上から順に入れ、最後まで見た枠に次を入れる (別々の配信を続けて見るとき)',
    'Fill the current tiles from the top, and put the next one in each tile that finishes (for watching separate streams one after another)',
  ],
  plModeSync: ['⏱ まとめて同期再生', '⏱ All at once, in sync'],
  plModeSyncTitle: [
    '全部を一度に枠に並べ、アーカイブを同じ瞬間にそろえる (コラボ配信を参加者それぞれの視点で見るとき)。枠の数と同じ 16 本まで。ずれと基準も保存する',
    'Lay out all of them at once and play the archives in step (for watching a collab from each participant’s view). Up to 16, the number of tiles. Offsets and the reference are saved too',
  ],
  plLayoutLabel: ['レイアウト', 'Layout'],
  plLayoutTitle: ['同期再生で並べるときのレイアウト', 'Layout used when playing in sync'],
  plLayoutAuto: ['自動 (本数に合わせる: {0})', 'Auto (fits the count: {0})'],
  plLayoutShort: ['本数に足りないので自動', 'too few tiles, so auto'],
  plLayoutCurrent: ['今のレイアウト: {0}', 'Current layout: {0}'],
  plSyncNote: [
    '{0} 本まで。基準の動画とずれを決めておくと、開いたときからそろった状態で同期します。再生中に ⏱ で直したずれもここに保存されます',
    'Up to {0}. Set the reference and offsets to start in step. Offsets you fix with ⏱ while playing are saved here too',
  ],
  plQueueNote: [
    '見た {0} / {1} 本。「▶ 順に再生」はまだ見ていないものから続けます。最後まで見ると ✓ が付きます (再生リストからは消えません)',
    'Watched {0} of {1}. "▶ Play in order" continues from the ones not watched yet. Each gets a ✓ once played to the end (nothing is removed)',
  ],
  plPlayQueueResume: ['▶ 続きから順に再生', '▶ Continue in order'],
  plPlaySyncResume: ['⏱ 続きから同期再生 ({0})', '⏱ Continue in sync ({0})'],
  plSyncFromStart: ['⏮ 最初から', '⏮ From the start'],
  plSyncFromStartTitle: ['前回は基準の動画の {0} まで見ました。最初から同期再生する', 'Last time you watched up to {0} of the reference video. Play in sync from the start'],
  plSyncResumed: ['⏱ 再生リスト「{0}」を前回の続き ({2}) から同期再生します ({1} 本)', '⏱ Continuing playlist "{0}" in sync from {2} ({1})'],
  plClearWatched: ['見た印を消す ({0})', 'Clear watched ({0})'],
  plClearWatchedTitle: ['見た印を全部消して、次は最初から順に再生する', 'Clear all watched marks so the next play starts from the top'],
  plAllWatched: ['「{0}」は全部見ました。見た印を消して最初から再生しますか？', 'You have watched all of "{0}". Clear the watched marks and play from the start?'],
  plWatched: ['✓ 見た', '✓ Watched'],
  queueSkipped: ['⚠ 見られないので飛ばしました: {0}', '⚠ Skipped because it cannot be played: {0}'],
  plWatchedTitle: ['最後まで見ました。押すと見た印を外す', 'Played to the end. Press to clear the mark'],
  plFromHere: ['▶ ここから', '▶ From here'],
  plFromHereTitle: ['この行から下を、今の枠で順に再生する (見た印のあるものも再生する)', 'Play from this row down in the current tiles (including ones already watched)'],
  plStGone: ['⚠ 見られません', '⚠ Unavailable'],
  plStGoneTitle: ['削除・非公開などで見られない動画です', 'Deleted, private or otherwise unavailable'],
  plStMembers: ['🔒 メンバー限定', '🔒 Members only'],
  plStBlocked: ['⚠ 見られない可能性', '⚠ May not play'],
  plStLive: ['🔴 配信中', '🔴 Live'],
  plStUpcoming: ['📅 配信予定', '📅 Upcoming'],
  plStUpcomingAt: ['📅 {0} 配信予定', '📅 Starts {0}'],
  plRemoved: ['「{0}」を外しました', 'Removed "{0}"'],
  plUndo: ['元に戻す', 'Undo'],
  plDuplicate: ['⧉ 複製', '⧉ Duplicate'],
  plDuplicateTitle: ['この再生リストを複製する (中身・同期の設定・ずれはそのまま。見た印と続きの位置は持たない)', 'Duplicate this playlist (items, sync settings and offsets are kept; watched marks and the resume point are not)'],
  plCopyName: ['{0} のコピー', 'Copy of {0}'],
  plDuplicated: ['📃 「{0}」を作りました', '📃 Made "{0}"'],
  plAddPlaceholder: ['追加: YouTube の URL / 動画 ID / @チャンネル名 / YouTube の再生リストの URL (何行でも貼れます)', 'Add: YouTube URL / video ID / @handle / YouTube playlist URL (paste several lines at once)'],
  plAddBtn: ['追加', 'Add'],
  plAddTiles: ['▦ 今の枠を追加', '▦ Add current tiles'],
  plAddTilesTitle: ['表示中の枠の配信を、並び順のまま最後に足す (合わせた同期のずれも入れる)', 'Add the streams in the shown tiles to the end, in order (with their sync offsets)'],
  plLabelTitle: ['枠に出す名前 (空ならチャンネル名)', 'Name shown on the tile (channel name if empty)'],
  plRef: ['基準', 'Ref'],
  plRefTitle: ['同期の基準にする動画 (ほかの動画をこの動画に合わせる)', 'Reference video for sync (others follow this one)'],
  plOffsetTitle: ['同期のずれ (秒。+ で先へ進める)。⏱ で合わせると自動で入る', 'Sync offset (seconds; + moves ahead). Filled in automatically when you adjust with ⏱'],
  secUnit: ['秒', 's'],
  plLoadOne: ['この配信を空いている枠に読み込む (再生リストの再生とは別に 1 本だけ)', 'Load just this one into a free tile (separately from playing the playlist)'],
  plAdded: ['{0} 本追加しました', 'Added {0}'],
  plAlready: ['{0} 本はもう入っています', '{0} already in it'],
  plAddFailed: ['YouTube の URL・動画 ID・@チャンネル名として読めませんでした', 'Could not read it as a YouTube URL, video ID or @handle'],
  plSyncStarted: ['⏱ 再生リスト「{0}」を同期再生します ({1} 本)。アーカイブだと分かりしだい同期を始めます', '⏱ Playing playlist "{0}" in sync ({1}). Sync starts once the archives are recognized'],
  plShareCopiedText: ['テキストをコピーしました', 'Copied the text'],
  plShareCopiedLink: ['リンクをコピーしました', 'Copied the link'],
  shortMaking: ['短縮リンクを作っています…', 'Making a short link…'],
  shortMade: ['短縮リンクを作りました', 'Made a short link'],
  shortCopied: ['短縮リンクをコピーしました', 'Copied the short link'],
  shortFail: ['短縮リンクを作れませんでした ({0})', 'Could not make a short link ({0})'],
  shortQrOn: ['QR は短縮リンクです', 'The QR code is the short link'],
  shortResolving: ['短縮リンクを読んでいます…', 'Reading the short link…'],
  shortResolveFail: ['短縮リンクを読めませんでした ({0})', 'Could not read the short link ({0})'],
  shareAiCopied: ['コピーしました。AI チャットに貼って送ってください', 'Copied. Paste it into an AI chat and send it'],
  shareAiCopiedEmpty: [
    'コピーしました。AI チャットに貼り、「見たいもの」を書き足して送ってください',
    'Copied. Paste it into an AI chat, fill in what you want to watch and send it',
  ],
  shareAiFailed: ['コピーできませんでした', 'Could not copy'],
  importReceived: [
    'リンクから {0} 本を受け取りました。名前を確かめて「📃 再生リストとして保存」を押してください (枠に並べることもできます)',
    'Received {0} from the link. Check the name and press “📃 Save as playlist” (you can also lay them out in tiles)',
  ],
  importNothing: ['リンクに YouTube の動画が見つかりませんでした', 'No YouTube videos were found in the link'],
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
  removePresetsConfirm: [
    '初期データのチャンネル {0} 件を、チャンネル一覧から外しますか？ (自分で追加したものと、ピックアップ (📌) に入れたものは残します。「外したものを戻す」でいつでも戻せます)',
    'Remove {0} default channels from your channels? (Channels you added and channels in pickup (📌) stay. You can bring them back any time with "Restore removed")',
  ],
  noEmptyTile: [
    '空いている枠がありません。枠の「📺 チャンネルから選ぶ」「📚 ライブラリから選ぶ」から開くと、その枠に読み込めます。',
    "There's no empty tile. Open it from a tile's “📺 Pick from channels” or “📚 Pick from library” to load into that tile.",
  ],
  menuAdded: ['右クリックから追加しました', 'Added from the right-click menu'],
  menuAlready: ['この配信はもう枠に入っています', 'This stream is already in a tile'],
  menuFull: ['{0} 枠がすべて埋まっているので追加できませんでした。どれかの枠を ✕ で空けてから、もう一度追加してください', "All {0} tiles are in use, so it couldn't be added. Clear a tile with ✕ and try again"],
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
  'brand.title': 'Show the start screen (resume another saved session / start fresh / start with auto play). Cancel to keep watching',
  'auto.title': 'Auto play (L): lay out live channels and add or remove tiles as streams start and end',
  'auto.label': 'Auto play',
  'cruise.title': 'Cruise (C): move the main tile and audio to the next stream at a set interval',
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
  'pack.exportH': 'Export a channel pack',
  'pack.exportNote': 'Save your channel list as a pack (JSON) to give to others',
  'pack.export': '⬇ Export',
  'pack.h': 'Import a channel pack',
  'pack.note': 'Add someone else’s pack from a URL, its contents or a file (channels you have stay as they are)',
  'pack.placeholder': 'https://… (pack URL) / { "app": "hakomado", … }',
  'pack.load': 'Import',
  'pack.file': 'Choose a file',
  'catalog.h': 'Find packs',
  'catalog.note': 'Unofficial packs posted by users (not affiliated with any agency or streamer)',
  'catalog.load': 'Get the list',
  'pack.listH': 'Channel packs',
  'pack.listNote': 'Packs in your channel list. Remove or bring back a whole pack',
  'tab.backup': 'Backup',
  'backup.h': 'Back up your settings',
  'backup.note': 'Saves settings, channels, history, Watch later and playlists to one file. Export before reinstalling',
  'backup.export': '⬇ Export to a file',
  'backup.import': '⬆ Import from a file',
  'backup.importNote': 'Importing replaces your settings, channels, history and Watch later with the file',
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
  'auto.skipNote': 'Streams your signed-in account cannot watch are not added',
  'auto.archive': 'Play recent streams when nothing is live',
  'auto.archiveNote': 'Plays 4 recent streams when nothing is live',
  'auto.maxTiles': 'Max tiles in auto play',
  'auto.maxTilesNote': 'Lower it if things get slow',
  'auto.prestart': 'Prepare tiles for upcoming streams',
  'auto.prestartNote': 'Makes tiles for upcoming streams before they start',
  'auto.cruise': 'Cruise interval',
  'auto.cruiseNote': 'How often cruise moves on to the next stream',

  // 使い方
  'help.h': '? Help',
  'sync.title': 'Archive sync: play stream archives aligned to when they were actually streamed',
  'sync.label': 'Archive sync',
  'info.title': 'Tile info (I): the type (live, archive, video), stream times, viewers, views and more for each tile',
  'info.h': 'ℹ️ Tile info',
  'info.colTile': 'Tile',
  'info.colKind': 'Type',
  'info.colVideo': 'Channel / title',
  'info.colStart': 'Start / published',
  'info.colEnd': 'End',
  'info.colLen': 'Length',
  'info.colViewers': 'Watching',
  'info.colViews': 'Views',
  'info.colPos': 'Position',
  'info.colSync': 'Archive sync',
  'info.empty': 'No streams are loaded in the tiles yet.',
  'info.note': 'Refreshes every few seconds while open. Watching counts are shown only for live streams; view counts are as of when the tile was opened.',
  'sync.seekTitle': 'Move all synced archives to this time',
  'sync.reset': 'Reset to 0',
  'sync.refTitle': 'The reference tile for sync (other tiles follow it). It does not change when you switch the sound',
  'sync.audioTitle':
    '🎧 Match by sound: listens to the synced tiles (the shared call voices in a collab) for 90 seconds and measures the offsets. It measures from the current position while playing, and you can check the result before applying it. Press again to stop',
  'sync.setRef': 'Use as reference',
  'sync.waitTitle': 'Pause only this tile and wait for the others to catch up. Play it when they match, and the offset is set there (for a tile that is not the reference, you can also just pause it in its player)',
  'sync.driftTitle': 'How far playback is from where the set offset says it should be (+ = ahead). A guide to whether sync has caught up, not the offset itself',
  'sync.inputTitle': 'Type the offset in seconds (+ = move ahead, − = move back). Press Enter to apply',
  'sync.refBadge': 'Ref',
  'sync.refBadgeTitle': 'The reference tile for sync (other tiles follow it)',
  'sync.adjTitle': 'Fine-tune the sync offset (match it to the other tiles by voice or on-screen events)',
  'share.title': 'Share: turn the current tiles or a playlist into an image, a code, text or a link to give to others',
  'share.h': '🔗 Share',
  'share.sourceLabel': 'What to share',
  'share.nameLabel': 'Name',
  'share.namePlaceholder': 'Optional (the image shows “Hakomado viewing set”)',
  'share.tabImage': '🖼 Image',
  'share.tabCode': '# Code',
  'share.tabText': '📝 Text',
  'share.tabLink': '🌐 Link',
  'share.toX': '𝕏 Post',
  'share.toXTitle': 'Open the X post screen with the image, the name and the link filled in (you press Post yourself)',
  'share.imgCopy': '🖼 Copy image',
  'share.imgSave': '⬇ Save image',
  'share.authorLabel': 'Author',
  'share.authorPlaceholder': 'Optional (shown as “by …” after the stream count on the image)',
  'share.imgLabels': 'Draw the channel and title on each tile',
  'share.altCopy': '📋 Copy ALT text',
  'share.altCopyTitle': 'Copy ALT text for the image on X and elsewhere (includes the code to import it)',
  'share.copyCode': '📋 Copy code',
  'share.copyText': '📋 Copy text',
  'share.copyLink': '📋 Copy link',
  'share.imgShort': '✂ Use a short link in the QR code',
  'share.imgShortTitle': 'Send this set (videos, layout, sync offsets and name) to the Hakomado website to make a short link, and put that link in the QR code (a smaller QR code that is easier to scan)',
  'share.shortNote': 'Press "Make a short link" to send this set (videos, layout, sync offsets and name) to the Hakomado website and get a short link. Only people with the link can see it (it is not listed on the website)',
  'share.shortMake': '✂ Make a short link',
  'share.shortCopy': '📋 Copy',
  'read.title': 'Import: lay out a shared image, code, text, link or URLs in tiles, or save them as a playlist',
  'read.h': '📥 Import',
  'read.note': 'Paste a shared image (Ctrl+V, or drop it), a code (#Hakomado …), text or an import link, or YouTube URLs (one per line) or a playlist URL. Pasting a whole post works too',
  'read.placeholder': 'Image / #Hakomado … / https://www.youtube.com/watch?v=...',
  'read.nameLabel': 'Name',
  'read.namePlaceholder': 'If empty: the name that was read, or the current date and time',
  'read.apply': '▦ Lay out in tiles',
  'read.applyTitle': 'Replace the current tiles with these (first 16; auto play is turned off)',
  'read.save': '📃 Save as playlist',
  'read.saveTitle': 'Save as a playlist with this name and open it in the library (up to 200; a playlist with the same name is replaced)',
  'read.aiH': '🤖 Ask an AI chat to make one',
  'read.aiNote': 'Write what you want to watch, copy the request (what you want, how to write the list, and the channels you follow), then paste it into an AI chat that can search the web, such as Claude, and send it. Paste the list you get back above, or open the import link',
  'read.aiWantLabel': 'What you want to watch',
  'read.aiWantPlaceholder': 'e.g. 10 of yesterday’s streams people were talking about / this week’s collab from every participant’s view / karaoke streams I can watch tomorrow night',
  'read.ai': '📋 Copy request',
  'helpNav.start': 'Getting started',
  'helpNav.tiles': '▦ Tiles and layouts',
  'helpNav.auto': 'Auto play',
  'helpNav.cruise': 'Cruise',
  'helpNav.channels': '📺 Channels and notifications',
  'helpNav.library': '📚 Library and playlists',
  'helpNav.sync': '⏱ Archive sync',
  'helpNav.share': '🔗 Share · 📥 Import',
  'helpNav.look': 'Danmaku, chat and outlines',
  'helpNav.backup': 'Backup',
  'helpNav.keys': 'Keyboard',
  'helpPage.start': `<p>Watch up to 16 YouTube streams side by side.</p>
<ul>
<li>Paste a URL / video ID / <code>@handle</code> into an empty tile and press Load. Pick a live stream with “📺 Pick from channels”, a past one with “📚 Pick from library”, or let “🎲 Surprise me” add one not shown yet</li>
<li>You can also right-click a link to a YouTube video or stream and choose “Add to an empty Hakomado tile”</li>
<li>Audio normally plays from one tile. Switch it with the audio button on a tile bar or <kbd>1</kbd>–<kbd>9</kbd>. Use the speaker in a tile’s player to hear several tiles at once</li>
<li>For a quick look around the screen, try “▶ Replay the tour” below</li>
</ul>`,
  'helpPage.tiles': `<ul>
<li>Choose a layout with “▦” on the top bar. The darker tile is the main one, and loaded streams fill tiles from 1 (main) on. “+” / “−” add or remove a tile</li>
<li>Hover over a tile with a stream to show its control bar. Drag ⠿ at the left to swap tiles</li>
<li>Tile bar: audio button (play audio from this tile) / 🎚 left/right, volume and delay / 💬 chat / ≋ danmaku / 📌 pickup / 🔖 watch later / 📃 add to a playlist / ⏱ sync offset (for archives) / ⟳ reload / ⛶ fullscreen this tile / ✕ close</li>
<li>🎚 makes that tile heard from the left, center or right and changes its volume (0–200%). “⇆ Split 2 tiles left/right” sends the 2 tiles playing audio left and right by their position on screen. On a live stream, “Audio delay” delays only that tile’s audio (the picture stays as it is; for a collab whose voices come earlier than the other tiles)</li>
<li>“⛶” (<kbd>Shift</kbd> + <kbd>F</kbd>) goes fullscreen with all tiles. Move the mouse to the top edge to show the bar</li>
<li>“ℹ️” (<kbd>I</kbd>) lists each tile’s type (live, archive, video), stream times, current viewers, views and whether it can be archive-synced</li>
</ul>`,
  'helpPage.auto': `<p>Turn on “Auto play” (<kbd>L</kbd>) to lay out every live channel. After that, every minute, tiles are added for streams that start and removed for streams that end.</p>
<ul>
<li>When turning it on would replace tiles you set yourself, it asks first</li>
<li>Streams you close with ✕ while it is on are not put back (turn it off and on to reset). Tiles you loaded yourself are never removed</li>
</ul>
<h3>Settings → Auto play</h3>
<ul>
<li><b>Auto play plays</b>: all channels, or pickup (📌) only</li>
<li><b>Skip members-only streams you're not a member of</b>: checks whether your signed-in account can watch a stream before adding it</li>
<li><b>Max tiles in auto play</b>: never plays more than this many, however many are live. Lower it on a slow connection or a busy computer</li>
<li><b>Put pickup (📌) streams in the main tiles first</b>: puts pickup live streams in the big main tile and others in sub tiles. Pickup also goes first when the limit is reached. Not rearranged in uniform layouts (no main tile) or while cruising</li>
<li><b>Prepare tiles for upcoming streams</b>: makes tiles before streams start, so you see them from the beginning. When nothing is live, shows the next upcoming stream and any starting within an hour after it</li>
<li><b>Play recent streams when nothing is live</b>: when nothing is live (late at night, for example), plays 4 recently ended streams from your channels (pickup first, already watched ones skipped). They are cleared when a live stream starts</li>
</ul>`,
  'helpPage.cruise': `<p>Turn on “Cruise” (<kbd>C</kbd>) to move the main tile and audio to the next stream at a set interval, so you can sample many streams. It works without auto play, with tiles you arranged yourself.</p>
<ul>
<li>Change the interval in Settings → Auto play → “Cruise interval”</li>
<li>In uniform layouts the order stays and only the audio moves on. Empty tiles are skipped and the layout is not changed</li>
<li>When auto play rearranges tiles, it prefers a “main + sub” layout</li>
</ul>`,
  'helpPage.channels': `<ul>
<li>“📺 Channels” (<kbd>F</kbd>) lists your channels: live, upcoming and the rest. Press a live or upcoming row to put it in an empty tile</li>
<li>“Recent ⌄” on a row opens that channel’s recent streams, and 📌 adds it to pickup</li>
<li><b>Pickup</b>: the channels you are following right now (e.g. the members of a group event). Filter the list with “📺 All / 📌 Pickup” at the top, and use it as the target of auto play and notifications</li>
<li>Add a channel by entering an <code>@handle</code>, a channel URL or a video URL in the box at the bottom</li>
<li><b>🔔 Notifications</b>: tell you when a channel goes live. Choose the target in Settings → Auto play → “Notifications for”</li>
</ul>
<h3>Settings → Channels (channel packs)</h3>
<ul>
<li>A channel pack is a ready-made list of channels. Hololive (bundled) is there from the start. You can remove or bring back a whole pack. Channels you added yourself and pickup channels are never removed</li>
<li><b>Find packs</b>: choose from the packs collected in the Hakomado repository (GitHub). They are unofficial, made by users, and not affiliated with any agency or streamer. Report mistakes or requests on GitHub</li>
<li><b>Import a channel pack</b>: paste the URL or contents of a pack made by someone else, or choose a file. Channels you already have stay as they are</li>
<li><b>Export a channel pack</b>: save the bundled Hololive pack, an imported pack, the channels you added, or all of them as a pack (JSON) to give to others or publish</li>
</ul>`,
  'helpPage.library': `<ul>
<li>“📚 Library” (<kbd>B</kbd>): 🎞 Recent streams (ended in the last 7 days) / 🕘 Watch history (100) / 🔖 Watch later (100) / 📃 Playlists</li>
<li><b>Watch later</b>: add with 🔖 on tile bars and lists. “▶ Play in current tiles” fills the tiles you have in order and puts the next one in each tile that finishes. Items watched to the end are removed</li>
<li><b>Playlists</b>: named lists (up to 30, 200 items each). Make one with “+ New”, “▦ From current tiles” or “📥 Import”, and add with the URL box or 📃 on tile bars and lists. Drag ⠿ to reorder; a row’s name is what its tile shows</li>
<li>“▶ In order” fills the current tiles from the top and puts the next one in each tile that finishes (items watched to the end get ✓ and it continues from there next time). “⏱ All at once, in sync” lays out all of them and plays the archives in step (up to 16)</li>
</ul>`,
  'helpPage.sync': `<ul>
<li>Press “⏱ Archive sync” on the top bar to play stream archives that overlap in time, aligned to when they were actually streamed. Until 2 such archives are shown it is dimmed, and pressing it tells you why (live now, a regular video, and so on)</li>
<li>Other tiles follow the “reference” tile (the one playing audio when you started). Choose another on the top bar or with ⏱ on a tile</li>
<li>If voices or on-screen events do not line up, adjust the offset with ⏱ on the tile. Offsets are remembered per video and go into playlists and share codes</li>
<li>The slider on the top bar moves all synced archives to the same time</li>
</ul>`,
  'helpPage.share': `<p>“🔗 Share” turns the current tiles or a playlist into one of four forms.</p>
<ul>
<li><b>Image</b>: attach it to a post on X or elsewhere. Scanning the QR opens it on YouTube, and Hakomado opens the same arrangement. You can also copy ALT text for the image. “𝕏 Post” opens the X post screen with the image, the name and the link filled in (you press Post yourself; the first time, it asks for access to x.com)</li>
<li><b>Code</b>: one line, <code>#Hakomado …</code> (up to 16). Shows its length on X</li>
<li><b>Text</b>: one per line, with the name, sync, layout, offsets and tile names. You can hand it to an AI chat to edit</li>
<li><b>Import link</b>: people without Hakomado can watch it as a YouTube playlist (up to 50)</li>
</ul>
<p>Paste what you receive into “📥 Import” (drop images too, or press <kbd>Ctrl</kbd> + <kbd>V</kbd> outside any input box). Check what was read, then “▦ Lay out in tiles” or “📃 Save as playlist”. Opening an import link lands here too.</p>`,
  'helpPage.look': `<ul>
<li><b>Danmaku</b>: scrolls each tile’s live chat across it. Turn it on/off per tile with ≋ (by default only on the main tile). <kbd>D</kbd> hides it on all tiles for now. Size, speed, rows and more are in Settings → Danmaku</li>
<li><b>Chat panel</b>: open it with 💬 on a tile. Width, text size and hiding icons are in Settings → Chat (applied to open panels right away)</li>
<li><b>Outlines</b>: how the tile playing audio and live tiles are outlined (the audio outline wins when both apply). Settings → Outlines</li>
</ul>`,
  'helpPage.backup': `<ul>
<li>Saves your settings, channels (including pickup), watch history, Watch later, playlists and display language to one file</li>
<li>Removing and reinstalling the extension, or switching to another copy (a development folder or a version from before the ID was fixed), does not carry over what is saved. Export before that, and import it afterwards</li>
<li>Importing replaces your current settings, channels, watch history and Watch later with the file. Streams in the tiles now stay as they are</li>
</ul>`,
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
  'key.info': 'Open the tile info',
  'key.danmaku': 'Hide / show danmaku on all tiles for now (unless set with ≋ on a tile, danmaku shows only on main tiles)',
  'tour.replay': '▶ Replay the tour',
  'helpNav.report': 'Report a problem',
  'helpPage.report': `<p>A record of errors in this extension and features that did not work. Use it to report problems.</p>
<ul>
<li>The record is stored only on this computer and is not sent anywhere. Up to 100 entries are kept, newest first, and entries older than 7 days are deleted. Identical entries are combined and shown with a count</li>
<li><b>Report on GitHub</b>: opens a new GitHub issue form with the record and environment details (version, browser, OS) filled in. You can review and edit it before submitting. Issues are public, so remove any information you do not want to make public (video IDs, channel names, etc.) before submitting. A GitHub account is required</li>
<li><b>Copy</b>: copies the same content to the clipboard. Use this to report by email or other means</li>
</ul>`,
  'errlog.report': 'Report on GitHub',
  'errlog.copy': 'Copy',
  'errlog.clear': 'Delete the record',
  'errlog.empty': 'Nothing recorded',
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
  'auto.pickupMain': 'Put pickup (📌) streams in the main tiles first',
  'auto.pickupMainNote': 'Puts pickup live streams in the big main tile',
  'notice.target': 'Notifications for',
  'target.all': 'All channels',
  'target.fav': 'Pickup (📌) only',
  'target.off': 'Off',
  'settings.help': '? More help',
  'settings.helpTitle': 'Open the detailed help for this tab in “? Help”',
  'settings.reset': 'Reset all to defaults',
  'settings.resetTitle': 'Reset all danmaku, outline, chat and auto play settings (the display language and channels are kept)',
  'fav.history': '🕘 Watch history',
  'fav.archive': '🎞 Recent streams',
  'fav.archiveTitle': 'Streams from your channels that ended in the last 7 days (newest first)',
  'scope.star': '📌 Pickup',
  'scope.all': '📺 All',
  'fav.playlists': '📃 Playlists',
  'fav.playlistsTitle': 'Named lists of streams and videos. Play them in order in the current tiles, or all at once in sync. Nothing is removed when played (shared by all tabs)',
  'pl.selectTitle': 'Playlist to show',
  'pl.new': '+ New',
  'pl.newTitle': 'Make an empty playlist. Fill it from the box below or with 📃 on tiles and lists',
  'pl.fromTiles': '▦ From current tiles',
  'pl.fromTilesTitle': 'Make a new playlist from the shown tiles, with their order, layout and sync offsets',
  'pl.import': '📥 Import',
  'pl.importTitle': 'Paste a shared image, code, text or link, or a list of URLs, and save it as a playlist. You can also ask an AI chat to make one',
  'plPick.h': '📃 Add to a playlist',
  'plPick.namePlaceholder': 'New playlist name',
  'plPick.new': '+ Make and add',
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
  'tile.pickAnyTitle': 'Add one stream not shown yet (pickup live streams first)',
  'tile.grip': 'Drag to swap with another tile',
  'tile.mix': 'Left/right (L / C / R), volume and delay (live streams) of this tile',
  'mix.pan': 'L/R',
  'mix.left': 'Hear it from the left',
  'mix.center': 'Center (as it is)',
  'mix.right': 'Hear it from the right',
  'mix.gain': 'Volume',
  'mix.gainTitle': 'Volume of this tile (100% = as it is). Use it to even out loud and quiet streams',
  'mix.delay': 'Audio delay',
  'mix.delayTitle': 'Delay only the audio of this tile by this many seconds (the picture stays as it is). For a live stream whose voices come earlier than the other tiles. Enter to apply',
  'mix.split': '⇆ Split 2 tiles left/right',
  'mix.splitTitle': 'Of the 2 tiles playing audio, the one on the left of the screen is heard from the left and the other from the right (to tell two views of a collab apart; for headphones)',
  'mix.reset': 'Reset',
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
