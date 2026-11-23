// 画面の言語 (日本語 / 英語) と機能フラグ。/config.js (window.SETS_CONFIG) の後、ほかのスクリプトより先に読み込む。
// - HTML の文言は日本語で書いておき、data-i18n* の付いた要素だけを英語に差し替える (data-i18n = 中身、
//   data-i18n-placeholder・data-i18n-aria-label = その属性)
// - スクリプトの文言は t('key', 引数...) ({0} {1} … に引数が入る)
// - data-feature="tags" のような要素は、その機能フラグがオフなら隠す
// - 英語の画面 (機能フラグ en) がオフなら、いつも日本語
/* exported CONFIG, FEAT, LANG, t, setLang */
'use strict';

const CONFIG = window.SETS_CONFIG || { features: {}, turnstileSiteKey: '' };
const FEAT = CONFIG.features || {};
const LANG_KEY = 'hakomado-feed:lang';

const LANG = (() => {
  if (!FEAT.en) return 'ja';
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'ja' || v === 'en') return v;
  } catch {
    // 保存できない環境ではブラウザの言語に合わせる
  }
  return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
})();

function setLang(v) {
  try {
    localStorage.setItem(LANG_KEY, v);
  } catch {
    // 何もしない (このページを開いている間だけ切り替わる)
  }
  location.reload();
}

// [日本語, 英語]
const STR = {
  // どの画面にもあるもの
  navPostLabel: ['投稿', 'Post'],
  footExt: ['Hakomado (Chrome 拡張機能)', 'Hakomado (Chrome extension)'],
  footNote: [' · 個人が作った非公式のツールです', ' · An unofficial tool made by an individual'],
  footPrivacy: ['プライバシー', 'Privacy'],
  // X でログイン (js/account.js・js/me.js)
  loginX: ['X でログイン', 'Sign in with X'],
  loginFailed: ['X でログインできませんでした。もう一度試してください。', 'Could not sign in with X. Please try again.'],
  meH: ['自分の投稿', 'My posts'],
  meEmpty: ['まだ投稿がありません。ログインして投稿すると、ここに出ます。', 'No posts yet. Sets you post while signed in appear here.'],
  logout: ['ログアウト', 'Sign out'],
  badgeUnlisted: ['リンクを知っている人だけ', 'Link only'],
  badgeHidden: ['通報により非公開', 'Hidden by reports'],
  unlinkH: ['X との連携を消す', 'Disconnect X'],
  unlinkNote: [
    'ログインの記録と、投稿に付いている X の情報 (@ユーザー名) を消します。投稿は残り、投稿者は空になります (消したい投稿は先に消してください)。もう一度ログインすると、新しく連携されます。',
    'Deletes your sign-in records and the X information (@username) on your posts. Your posts stay, with no author (delete any posts you want removed first). Signing in again links your account anew.',
  ],
  unlinkBtn: ['X との連携を消す', 'Disconnect X'],
  confirmUnlink: ['X との連携を消しますか？ 投稿から @ユーザー名 が外れ、ログアウトします。', 'Disconnect X? Your @username is removed from your posts and you are signed out.'],
  unlinked: ['X との連携を消しました。', 'X has been disconnected.'],
  authorX: ['@{0} として投稿します', 'Posting as @{0}'],
  ownNoteX: ['X でログインして投稿したセットです。', 'You posted this set while signed in with X.'],
  err_login: ['ログインが切れました。もう一度ログインしてください', 'Your sign-in expired. Please sign in again'],
  err_login_required: ['投稿するには X でログインしてください', 'Sign in with X to post'],
  postLoginNeeded: ['セットを投稿するには、X でログインしてください。投稿者として X の @ユーザー名 が出ます。', 'Sign in with X to post a set. Your X @username is shown as the poster.'],
  postClosed: ['今は投稿を受け付けていません。', 'Posting is not available right now.'],
  langToggle: ['English', '日本語'],
  count: ['{0} 本', '{0} videos'],
  unnamed: ['名前なし', 'Untitled'],
  loading: ['読み込み中…', 'Loading…'],
  copyFail: ['コピーできませんでした', 'Could not copy'],
  goneBadge: ['⚠ 消えた動画 {0} 本', '⚠ {0} unavailable'],

  // 一覧
  titleIndex: ['Hakomado', 'Hakomado'],
  leadIndex: [
    'Hakomado で共有された視聴セットの一覧です。セットを開いて「Hakomado で開く」を押すと、同じ並びで同時視聴できます。',
    'Viewing sets shared from Hakomado. Open a set and press "Open in Hakomado" to watch them side by side in the same layout.',
  ],
  sortLabel: ['並び順', 'Sort'],
  sortNew: ['新着', 'New'],
  sortPopular: ['人気', 'Popular'],
  searchPlaceholder: ['名前・チャンネル・タグで探す', 'Search by name, channel or tag'],
  searchLabel: ['探す', 'Search'],
  tagsLabel: ['タグ', 'Tags'],
  tagsAll: ['すべてのタグ', 'All tags'],
  backToList: ['一覧に戻る (絞り込みはそのまま)', 'Back to the list (keeps your filters)'],
  filterClear: ['絞り込みを解除', 'Clear filters'],
  more: ['もっと見る', 'Load more'],
  empty: ['まだ投稿がありません。共有したセットを投稿してみてください', 'No sets yet. Try posting one you shared.'],
  noResults: ['見つかりませんでした', 'No matching sets'],

  // セットのページ
  titleSet: ['Hakomado', 'Hakomado'],
  openBtn: ['▶ Hakomado で開く', '▶ Open in Hakomado'],
  copyCode: ['コードをコピー', 'Copy code'],
  copyPage: ['ページの URL をコピー', 'Copy page URL'],
  openHint: [
    'Hakomado (Chrome 拡張機能) を入れていると、マルチビュー画面で同じ並びのまま開きます。入れていなければ YouTube の再生リストとして開きます。',
    'With Hakomado (a Chrome extension) installed, the set opens in its multiview page in the same layout. Without it, it opens as a YouTube playlist.',
  ],
  getHakomado: ['Hakomado を入れる', 'Get Hakomado'],
  videosH: ['動画', 'Videos'],
  manageH: ['削除・通報', 'Delete / report'],
  ownNote: ['このブラウザから投稿したセットです。', 'You posted this set from this browser.'],
  deleteOwn: ['このセットを削除', 'Delete this set'],
  deleteKeyLabel: ['削除用の合言葉', 'Delete key'],
  deleteBtn: ['削除', 'Delete'],
  reportBtn: ['問題のある投稿として通報', 'Report this set'],
  notFound: ['セットが見つかりません', 'Set not found'],
  notFoundGone: ['セットが見つかりません (削除されたか、非公開になっています)', 'Set not found (it was deleted or hidden)'],
  syncPlay: ['同期再生', 'Synced'],
  syncRef: ['同期の基準', 'Sync reference'],
  syncOffset: ['補正 {0} 秒', 'offset {0}s'],
  moviePlay: ['🎬 本編でそろえる', '🎬 Aligned on the movie'],
  movieAt: ['本編 0:00 = {0}', 'Movie 0:00 at {0}'],
  goneVideo: ['見つからない動画 (削除・非公開)', 'Unavailable (removed or private)'],
  deadNote: ['{0} 本の動画が見つからなくなっています (削除・非公開)', '{0} video(s) are no longer available (removed or private)'],
  unlistedNote: ['このセットは一覧・検索に載っていません。リンクを知っている人だけが見られます。', 'This set is not shown in the list or search. Only people with the link can see it.'],
  confirmDelete: ['このセットを削除します。元に戻せません。よろしいですか?', 'Delete this set? This cannot be undone.'],
  deleted: ['削除しました。', 'Deleted.'],
  confirmReport: ['このセットを問題のある投稿として通報しますか? 通報が集まると非公開になります。', 'Report this set? It will be hidden when enough reports come in.'],
  reported: ['通報しました', 'Reported'],
  copiedCode: ['コードをコピーしました。Hakomado の「📥 読み込む」に貼れます', 'Copied the code. Paste it into "📥 Import" in Hakomado'],
  copiedPage: ['ページの URL をコピーしました', 'Copied the page URL'],
  existedToast: ['同じセットがもう投稿されていたので、そちらを開きました', 'The same set was already posted, so it was opened instead'],

  // 投稿
  titlePost: ['投稿 | Hakomado', 'Post | Hakomado'],
  postH: ['セットを投稿', 'Post a set'],
  leadPost: [
    'Hakomado の「🔗 共有」で作ったコード (#Hakomado …) かリンクを貼るか、共有画像を選んでください。',
    'Paste a code (#Hakomado …) or link made with "🔗 Share" in Hakomado, or choose a share image.',
  ],
  codeLabel: ['コード・リンク', 'Code or link'],
  dropText: ['共有画像をここにドロップ、または', 'Drop a share image here, or'],
  chooseImage: ['画像を選ぶ', 'Choose image'],
  tagsInputLabel: ['タグ (任意・空白で区切って 5 個まで)', 'Tags (optional, up to 5, separated by spaces)'],
  tagsPlaceholder: ['例: 歌枠 コラボ', 'e.g. karaoke collab'],
  unlistedLabel: ['リンクを知っている人だけに見せる (一覧・検索に載せない)', 'Only people with the link can see it (not shown in the list or search)'],
  postHint: [
    '投稿したセット (動画・レイアウト・名前・X の @ユーザー名など) は、誰でも見られるページになります。',
    'A posted set (videos, layout, name, your X @username, etc.) becomes a page anyone can see.',
  ],
  submit: ['投稿する', 'Post'],
  doneH: ['投稿しました', 'Posted'],
  doneLink: ['セットのページを見る', 'View the set'],
  doneNote: ['消したいときは「自分の投稿」から、いつでも消せます。', 'You can delete it any time from "My posts".'],
  readingQr: ['画像の QR を読んでいます…', 'Reading the QR code in the image…'],
  qrFail: ['画像から Hakomado の QR を読めませんでした。コードかリンクを貼ってください', 'Could not read a Hakomado QR code in the image. Paste a code or link instead'],
  sending: ['送っています…', 'Sending…'],

  // 見つかりません
  title404: ['見つかりません | Hakomado', 'Not found | Hakomado'],
  h404: ['見つかりません', 'Not found'],
  lead404: ['ページが見つかりません。セットは削除されたか、非公開になっているかもしれません。', 'Page not found. The set may have been deleted or hidden.'],
  toList: ['一覧へ', 'Back to the list'],

  // エラー (API の error)
  err_not_found: ['コード (#Hakomado …) か、Hakomado の取り込み用リンクが見つかりません', 'No Hakomado code (#Hakomado …) or import link found'],
  err_bad_layout: [
    'このレイアウトにはまだ対応していません。Hakomado を新しい版にしてから共有し直してください',
    'This layout is not supported yet. Update Hakomado and share again',
  ],
  err_missing_video: ['見つからない動画 (削除・非公開) が入っています', 'It contains a video that is unavailable (removed or private)'],
  err_turnstile: ['確認が済んでいません。もう一度試してください', 'The check did not complete. Try again'],
  err_too_many: ['投稿が多すぎます。しばらくしてから試してください', 'Too many posts. Try again later'],
  err_hidden: ['このセットは通報により非公開になっています', 'This set was hidden after reports'],
  err_bad_key: ['削除用の合言葉が違います', 'Wrong delete key'],
  err_bad_tags: ['タグは 5 個まで、1 つ 20 文字までです', 'Up to 5 tags, 20 characters each'],
  err_bad_request: ['送った内容を読めませんでした', 'Could not read what was sent'],
  err_server: ['サーバーで問題が起きました。しばらくしてから試してください', 'Something went wrong on the server. Try again later'],
  err_network: ['つながりませんでした。通信の状態を確かめてください', 'Could not connect. Check your connection'],
};

function t(key, ...args) {
  const pair = STR[key];
  const s = pair ? pair[LANG === 'en' ? 1 : 0] : key;
  return s.replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)] ?? ''));
}

/** 文言の差し替えと、オフの機能の要素を隠す */
function applyI18n() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll('[data-feature]')) {
    if (!FEAT[el.dataset.feature]) el.hidden = true;
  }
  if (LANG === 'ja') return;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

applyI18n();
document.getElementById('langToggle')?.addEventListener('click', () => setLang(LANG === 'en' ? 'ja' : 'en'));
