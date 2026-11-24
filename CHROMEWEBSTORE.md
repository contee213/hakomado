# Chrome Web Store 掲載情報

Chrome ウェブストアのデベロッパー ダッシュボードに入れる内容の控えです。
**限定公開 (Unlisted) で 0.2.0 を公開しました** (2026-11-22)。掲載ページ: https://chromewebstore.google.com/detail/bhmbchggpdficakjfllkmfkpbdpddomp
(README の「インストール」から案内している)。GitHub のリリースの ZIP (開発者モードで読み込む) の配布も続けます。拡張機能を変えたらここも合わせて直します。

- 最終更新: 2026-11-22
- 対象バージョン: 0.2.0 (`extension/manifest.json`)
- 最低 Chrome バージョン: 128 (Manifest V3)

## 公開の設定

- 公開範囲: **限定公開 (Unlisted)**。ストアの検索・一覧には出ず、掲載ページの URL を知っている人だけが入れられる。
  URL は README・GitHub のリリースに載せる。審査は一般公開と同じように受ける
- 地域: すべての地域
- 一般公開に切り替えるのは、限定公開で審査が通り、数回の更新でも問題が無いと分かってから考える (下の「審査で指摘されそうな点」)

## 拡張機能の ID

- GitHub のリリースの ZIP は、`manifest.json` に `"key"` (公開鍵 `tools/release-key.pub`) を入れて ID を `lhafnnpnfpgogdbapeepkgohemnnifpp` に固定している
  (`.github/workflows/release.yml` が ZIP を作るときに `tools/release-key.js` で差し込む。リポジトリの `extension/manifest.json` には入れない)
- ストア版の ID: `bhmbchggpdficakjfllkmfkpbdpddomp` (ストアが決めたもの。掲載ページの URL もこの ID になる)
- ストアに上げるパッケージには `"key"` を入れない (ストアが自分の鍵で ID を決める)。リリースの workflow が、`"key"` を差し込む前に
  `hakomado-x.y.z-chrome-web-store.zip` を作ってリリースに添える
- **ストア版と ZIP 版は別の ID のままにする**。ZIP 版の ID をストアの鍵に入れ替えると、ZIP 版を使っている人の ID がまた変わり、
  設定やチャンネルが引き継がれなくなるため。両方を同じプロファイルに入れると別の拡張機能として 2 つ動く
  (右クリックのメニューも 2 つ出る) ので、乗り換える人には「⚙ 設定 →『バックアップ』で書き出し → ストア版で読み込み → ZIP 版を削除」を案内する

## ストアに上げる手順

初回 (デベロッパー登録とアイテムの作成):

1. [デベロッパー ダッシュボード](https://chrome.google.com/webstore/devconsole) で登録する (登録料 5 ドル・1 回だけ)。
   2 段階認証が要る。連絡先メールアドレスはストアに公開されるので、公開してよいアドレスを使う
2. 「取引業者 (Trader) かどうか」の申告: 無料の趣味のツールで収益も無いので「取引業者ではない」を選ぶ (取引業者を選ぶと住所・電話番号が EU の利用者に公開される)
3. タグ `vX.Y.Z` で作られた GitHub のリリースから `hakomado-X.Y.Z-chrome-web-store.zip` をダウンロードし、「新しいアイテム」でアップロードする
4. 「ストアの掲載情報」「プライバシー」「配布」の各タブを、このファイルの内容で埋める (下の各節)
5. 「審査のために送信」。公開のタイミングは「審査が通ったら自動で公開」でかまわない (限定公開なので人目に付かない)
6. 公開されたら、掲載ページの URL を README / README.en.md の「インストール」に足す

更新のとき:

1. いつもどおり `manifest.json` の version を上げてタグを打つ (ストアは前に上げた版以下の version を受け付けない)
2. リリースの `-chrome-web-store.zip` を「パッケージ」→「新しいパッケージをアップロード」で上げて、審査に送る
3. 権限・通信先・保存する情報が変わったときは、送る前にこのファイルとダッシュボードの「プライバシー」タブ・[プライバシーポリシー](docs/privacy.md) を合わせて直す

版を上げるたびにストアに出す必要は無い。審査に数日かかることもあるので、まとまった区切りで出す。

### GitHub 版とストア版の進め方

GitHub のリリースが先に出て、ストアは同じ版を後から追いかける (ストア版は少し古いことがある) 前提で開発する。

- **版の番号は 1 本**: ストア用に別の番号や別の中身を作らない。同じ番号なら GitHub 版もストア版も中身は同じ
  (違いはリリースの workflow が入れる `"key"` の有無だけ)。ストアには必ずリリースの `-chrome-web-store.zip` をそのまま上げる
- **ストアに出さない版があってよい**: 審査中に GitHub で次の版が出たら、審査が通るのを待つか、審査中の版を取り下げて新しい版を出し直す。
  間の版は飛ばしてかまわない。ただし YouTube 側の変更で動かなくなったのを直した版は、なるべく早くストアにも出す
- **権限を変える版はまとめる**: 権限・ホスト権限を増やすと審査が長くなりやすく、ストア版の利用者には更新のときに拡張機能が止まって
  権限を許可し直す画面が出る。権限の変更はたまに・まとめて行い、上の手順 3 のとおりこのファイルの「権限と理由」なども同じ版で直す
- **古い版と新しい版の間でデータが行き来する**: GitHub 版の人が作った視聴セット・パック・書き出した設定を、ストア版 (古い版) の人が開くことがある。
  形式を変えるときは、古い版が知らない項目を読み飛ばしても壊れないようにする。どうしても無理なら形式に版を入れて「新しい版が必要です」と出す
- **ストア版だけ急いで直したいとき**: `main` に未公開の変更が溜まっていてストア版の不具合だけ先に直したいときに限り、ストアに出ているタグ
  (例: `v0.2.0`) からブランチを切って修正だけを cherry-pick し、`v0.2.1` としてタグを打つ。直した内容は `main` にも入れる。
  ふだんは `main` からそのまま出すだけでよく、リリース用のブランチは常には持たない
- **新しい版のお知らせはストア版には出ない**: `update-check.js` は `update_url` のある版 (ストア版) では GitHub を確かめない
  (ストア版はブラウザが更新する)。ストア版の人に GitHub の新しい版を案内しないこと
- **どちらの版かを見分ける**: 不具合の報告を受けたら、使い方 (?) か設定 (⚙) の画面の下の版 (例: `0.2.0 · build 120 (2026-11-22)`。ビルド番号と日付は `extension/build.js`) と、ストア版か ZIP 版か (拡張機能の ID) を聞く。
  不具合の報告 (エラーの記録) の本文にも同じ版とストア版かどうかが入る。`chrome://extensions` やストアに出る版は `version` (例: `0.2.0`) だけで、ビルド番号は入らない
- ストアに出したら、下の「版の履歴」に版・日付・状態を書き足す

## ストアの掲載情報

- 名前: `manifest.json` の `extName` がそのまま使われる (ja: `Hakomado – YouTube配信の複窓・マルチビュー(最大16枠)` / en: `Hakomado – Multiview for YouTube (up to 16 streams)`)
- 概要 (short description): `manifest.json` の `extDescription` がそのまま使われる (ja 41 文字 / en 88 文字。上限 132 文字)
- カテゴリ: エンターテイメント
- 言語: 日本語 / 英語 (既定は英語 `default_locale: en`)。ダッシュボードで言語ごとに詳しい説明を入れる
- ホームページの URL: https://github.com/contee213/hakomado
- サポートの URL: https://github.com/contee213/hakomado/issues

### 詳しい説明 (日本語)

ストアは Markdown を使えないので、そのまま貼る。

```text
YouTube の配信・動画を 1 つの画面に最大 16 枠並べて、同時に視聴できます。

コラボ配信の各視点や、同じ時間に重なった推しの配信を、タブを切り替えずにまとめて見るための拡張機能です。ブラウザでログインしている YouTube アカウントがそのまま使われるので、メンバー限定配信も見られます。

■ 主な機能
・分割表示: 均等・メイン + サブ・小窓 (PinP) のレイアウト。どの枠も 16:9 に自動で合わせます
・弾幕 / チャット欄: 各枠のライブチャットを画面に流したり、横に出して書き込んだりできます
・チャンネル: 追加したチャンネルの配信中・予定と、最近終わった配信を一覧で表示
・自動再生: 配信中のチャンネルを自動で並べ、始まった / 終わった配信に合わせて枠を増減
・アーカイブ同期: コラボ配信の各視点のアーカイブを、配信していた実際の時刻でそろえて再生
・音の左右と音量: 枠ごとに音を左 / 右から聞こえるようにしたり、音量を変えたりできます (2 視点の聞き分けに)
・再生リスト / 視聴履歴 / あとで見る / 配信開始の通知
・共有: 今の枠や再生リストを、画像・リンク・テキストにして人に渡せます
・スクリーンショット: Alt+Shift+S で枠の並び全体を PNG で保存 (クリップボードにもコピー)
・右クリックで追加: YouTube のリンクを右クリック →「Hakomado の空き枠に追加」

■ 使い方
1. ツールバーの Hakomado のアイコンを押すと、マルチビュー画面が開きます
2. 上の「自動再生」を押すと、配信中のチャンネルが自動で並びます
3. 自分で選ぶときは、空いている枠に URL・動画 ID・@チャンネル名を貼るか、「チャンネルから選ぶ」「ライブラリから選ぶ」で選びます
4. 音を出す枠は、枠のバーのスピーカーか数字キー (1〜9) で切り替えます
細かい操作は、画面右上の「?」(使い方) で見られます。

■ プライバシー
開発者は利用者の情報を一切集めません (アクセス解析・広告もありません)。設定・チャンネル・視聴履歴などは、すべてお使いのブラウザの中にだけ保存されます。

■ 権限について
「www.youtube.com のデータの読み取りと変更」は、YouTube のプレイヤーとライブチャットをマルチビュー画面の枠の中に表示し、再生・音量・同期を操作するためと、配信の一覧を取得するために使います。マルチビュー画面を開いているタブの中でだけ働きます。
「schedule.hololive.tv のデータの読み取りと変更」は、初期データのチャンネルの配信予定をまとめて取得するために使います (設定の「アドオン」で OFF にすると取得しません)。
「www.nijisanji.jp のデータの読み取りと変更」は、設定の「アドオン」で「にじさんじ」を ON にしたときだけ求めます。にじさんじ公式サイトのライブスケジュールを取得するために使います (初期値は OFF)。
「www.vspo-schedule.com のデータの読み取りと変更」は、設定の「アドオン」で「ぶいすぽっ!」を ON にしたときだけ求めます。ぶいすぽっ!の配信スケジュール (有志による非公式のサイト) を取得するために使います (初期値は OFF)。
「schedule-share-json.s3.ap-northeast-1.amazonaws.com のデータの読み取りと変更」は、設定の「アドオン」で「STPR (すとぷり)」を ON にしたときだけ求めます。STPR の公式の配信予定 (schedule.stpr.com のデータ) を取得するために使います (初期値は OFF)。
「x.com のデータの読み取りと変更」は、共有画面の「𝕏 に投稿」を初めて押したときだけ求めます。開いた X の投稿画面に共有画像を入れるために使い、投稿はしません。

■ ご注意
個人が作った非公式のツールです。YouTube / Google や、初期データとして入っているチャンネルの運営元とは関係ありません。YouTube のページの構成が変わると、一部の機能が動かなくなることがあります。

■ 不具合・要望
画面右上の「?」→「不具合の報告」から、エラーの記録を確かめて GitHub で報告できます。
https://github.com/contee213/hakomado/issues
```

### 詳しい説明 (英語)

```text
Watch up to 16 YouTube streams and videos side by side on one screen.

Built for watching every point of view of a collab stream, or several overlapping streams, without switching tabs. It uses the YouTube account you are already signed in to in your browser, so members-only streams work too.

FEATURES
• Layouts: equal grid, main + sub tiles, or picture-in-picture. Every tile keeps a 16:9 shape
• Danmaku / chat panel: scroll each tile's live chat across the video, or open the chat beside it and post
• Channels: see live, upcoming and recently finished streams from the channels you add
• Auto play: automatically fills tiles with live channels and adds or removes tiles as streams start and end
• Archive sync: play the archives of a collab's different points of view aligned to the real time they were streamed
• Per-tile audio: pan each tile's sound left or right and change its volume (handy for telling two voices apart)
• Playlists, watch history, Watch later and go-live notifications
• Sharing: turn your current tiles or a playlist into an image, a link or text
• Screenshots: press Alt+Shift+S to save all the tiles as a PNG (also copied to the clipboard)
• Right-click to add: right-click a YouTube link and choose "Add to an empty Hakomado tile"

HOW TO USE
1. Click the Hakomado icon in the toolbar to open the multiview screen
2. Press "Auto play" at the top to fill tiles with live channels
3. To choose yourself, paste a URL, video ID or @handle into an empty tile, or use "Pick from channels" / "Pick from library"
4. Pick the tile you hear with the speaker button on its bar or the number keys (1–9)
Press "?" (Help) at the top right for all controls and shortcuts.

PRIVACY
The developer collects no information about you (no analytics, no ads). Your settings, channels, watch history and so on are stored only in your own browser.

PERMISSIONS
"Read and change your data on www.youtube.com" is used to show the YouTube player and live chat inside the tiles of the multiview screen, to control playback, volume and sync, and to load stream lists. It only takes effect in tabs where the multiview screen is open.
"Read and change your data on schedule.hololive.tv" is used to load the stream schedule of the bundled channels in one request (not loaded when turned off under Settings > Add-ons).
"Read and change your data on www.nijisanji.jp" is only requested when you turn on the NIJISANJI add-on under Settings > Add-ons. It is used to load the live schedule from the NIJISANJI website (off by default).
"Read and change your data on www.vspo-schedule.com" is only requested when you turn on the VSPO! add-on under Settings > Add-ons. It is used to load the VSPO! stream schedule from that unofficial fan site (off by default).
"Read and change your data on schedule-share-json.s3.ap-northeast-1.amazonaws.com" is only requested when you turn on the STPR add-on under Settings > Add-ons. It is used to load the official STPR stream schedule (the data behind schedule.stpr.com; off by default).

NOTE
This is an unofficial tool made by an individual. It is not affiliated with YouTube / Google or with the operators of the bundled channels. Some features may stop working when YouTube changes its pages.

BUGS AND REQUESTS
Open "?" → "Report a problem" at the top right to review the error record and report it on GitHub.
https://github.com/contee213/hakomado/issues
```

### 画像

| 画像 | 大きさ | 状態 | メモ |
| --- | --- | --- | --- |
| ストアのアイコン | 128×128 PNG | ✅ | `extension/icons/icon-128.png` をそのまま使う |
| スクリーンショット 1 (必須) | 1280×800 | ✅ | `1-grid-danmaku.png`: 2×2 で 4 枠を並べた画面。弾幕を流している |
| スクリーンショット 2 | 1280×800 | ✅ | `2-main-sub-chat.png`: メイン + サブのレイアウトで、横にチャット欄を出した画面 |
| スクリーンショット 3 | 1280×800 | ✅ | `3-channels.png`: 「📺 チャンネル」の一覧 (配信中・予定) |
| スクリーンショット 4 | 1280×800 | ✅ | `4-audio-mix.png`: 「🎚 音の左右と音量」の画面 (2 枠を左右に分けた) |
| スクリーンショット 5 | 1280×800 | ✅ | `5-share.png`: 「🔗 共有」の画像 |
| 小さいプロモーション タイル | 440×280 | ✅ | `store-assets/promo/ja/`・`en/` の `small-promo-tile-440x280.png`: ロゴ・名前・「配信を最大 16 枠で同時視聴」と、16 枠 (4×4) の絵 |

スクリーンショットは `tools/store-screenshots.js` で撮る (`store-assets/screenshots/ja/`・`en/` に出る。ダッシュボードの言語ごとに上げる)。
まっさらなプロファイルの Chromium に拡張機能を読み込み、YouTube への通信をすべてダミー (架空のチャンネル・配信、絵で描いた映像、ダミーのチャット) で返すので、
他人の配信・アイコンやログイン中のアカウントは写らない。見た目を変えたら撮り直す:

```text
node tools/store-screenshots.js --lang=ja
node tools/store-screenshots.js --lang=en
node tools/store-screenshots.js --promo --lang=ja
node tools/store-screenshots.js --promo --lang=en
```

同梱の Chromium が起動できない環境 (Windows で `spawn UNKNOWN` など) では、先に環境変数 `E2E_CHANNEL=msedge` を設定して Edge で撮る。

スクリーンショットの決まり (他人の権利と商標を写さないため):

- 枠に映す動画は、自分で権利を持っているもの (自分のチャンネルの動画)、またはクリエイティブ・コモンズ (CC BY) の動画にする。ホロライブなど他人の配信・サムネイル・チャンネルのアイコンは写さない
- 写すしかないところ (チャンネルの一覧のアイコンなど) はぼかすか、無地の画像に置き換える
- YouTube のロゴを大きく見せない。説明文や画像の文字で「公式」「YouTube 公認」のように見せない
- ブラウザのアドレスバー・ブックマーク・ログイン中のアカウント名とアイコンは写さない (マルチビュー画面だけを切り取る)
- 画面は今の版のものにする。見た目を大きく変えたら撮り直す

## 審査向けのメモ (テストの手順)

ダッシュボードの「テストの手順」欄に入れる (英語)。ログインは要らない (公開の配信は未ログインでも見られる)。

```text
No account is needed; public streams can be watched without signing in to YouTube.

1. Click the Hakomado toolbar icon. The multiview screen opens in a new tab (a short tour is shown on first run; it can be skipped).
2. Paste https://www.youtube.com/watch?v=jfKfPfyJRdk into an empty tile and press Enter. The YouTube player appears in the tile.
3. Add a second video the same way (any public video or live stream). Hover over a tile to show its bar, and use the 🔊 button on each tile's bar or the number keys 1-9 to switch which tile you hear.
4. "▦ Layout" at the top changes the arrangement. Hover over a tile to show its bar; for a live stream, the 💬 button opens the live chat beside the video.
5. Right-click any YouTube video link on youtube.com and choose "Add to an empty Hakomado tile".

About declarativeNetRequest: YouTube watch and live chat pages send X-Frame-Options, which blocks them from appearing inside the extension's multiview page. The extension removes only that header, only for youtube.com/watch and youtube.com/live_chat sub-frame responses, and only in tabs where the multiview screen is open (session rules scoped by tabIds). No other headers or sites are touched.
```

## 審査で指摘されそうな点

- **`X-Frame-Options` を外していること**: 拡張機能の作りそのものなので外せない。対象を「マルチビュー画面のタブ・`watch` / `live_chat` の iframe・このヘッダーだけ」に絞っていることを、権限の理由と審査向けのメモに書いてある。
  同じ仕組みのマルチビュー拡張機能はストアにほかにもあるが、通らなかったり、掲載後に取り下げられたりすることもありうる。その場合は ZIP の配布だけに戻す
- **名前の「YouTube」**: 「〜 for YouTube」の形は、提供元と誤解させない書き方として一般に使われている。ロゴは使っていない。指摘されたら `extName` から外す
- **ホロライブの初期データ**: チャンネル名・アイコンの URL と、配信予定の取得先 (`schedule.hololive.tv`)。説明文では「初期データのチャンネル」とだけ書き、事務所の名前は出していない。スクリーンショットにも写さない
- **ユーザーの操作で読み込むデータ**: チャンネルパック・取り込み用リンクは JSON / テキストのデータとして読むだけで、スクリプトは読み込まない (リモートコードではない)

## 単一用途 (Single purpose)

YouTube の複数の配信・動画を 1 つの画面に並べて同時に視聴し、各枠のライブチャットを表示・書き込みできるようにする。ダッシュボードには下の「プライバシー」タブの節の英語の文を入れる。

## 権限と理由

| 権限 | 理由 |
| --- | --- |
| `storage` | 枠の並び・レイアウト・チャンネル一覧・視聴履歴・再生リスト・設定を `chrome.storage.local` に保存する。マルチビュー画面を開いているタブの一覧を `chrome.storage.session` に一時保存する。この拡張機能のエラーの記録 (新しい順に最大 100 件・7 日で消える。「? 使い方」→「不具合の報告」で見る) を `chrome.storage.local` に保存する。外部のサーバーには送らない |
| `declarativeNetRequestWithHostAccess` | (1) マルチビュー画面のタブの中だけで、`www.youtube.com/watch` と `www.youtube.com/live_chat` の iframe 応答から `X-Frame-Options` ヘッダーを外し、拡張機能のページに YouTube のプレイヤーとチャットを埋め込めるようにする (セッションルール。`tabIds` で対象タブを限定し、CSP など他のヘッダーは触らない)。(2) `hakomado=` 付きの `https://www.youtube.com/watch_videos?…` (再生リストの共有リンク) だけを拡張機能内の取り込み画面へ転送する (動的ルール) |
| `contextMenus` | 右クリックのメニュー「Hakomado の空き枠に追加」を出す。YouTube の動画・配信へのリンク (`targetUrlPatterns` で watch / live / shorts / youtu.be に限定) と、YouTube の視聴ページ (`documentUrlPatterns`) でだけ表示する。押したときにリンクの URL から動画 ID を取り出し、開いているマルチビュー画面に渡す (画面が無ければ新しいタブで開く)。`tabs` 権限は使わず、タブの URL・タイトルは読まない |
| ホスト権限 `https://www.youtube.com/*` | 上の declarativeNetRequest ルールの適用先。視聴ページ / ライブチャットに content script を入れて、プレイヤーの操作・弾幕用のチャット取得・同期再生を行う。ログイン中のアカウントで配信中 / 予定 / アーカイブの一覧、動画・再生リストの情報を取得する (メンバー限定配信も見られるようにするため Cookie 付き) |
| ホスト権限 `https://schedule.hololive.tv/*` | 初期データのホロライブのチャンネルについて、配信予定 (ホロジュール) をまとめて 1 回で取得し、YouTube への問い合わせ回数を減らす。アドオン `addons/holodule.js` が使う (設定 → アドオンで OFF にすると取得しない。初期値は ON なので、インストール時から使えるよう必須の権限のままにしている) |
| `activeTab` | 利用者がマルチビュー画面のタブで、この拡張機能のショートカットキー (既定 Alt+Shift+S。`commands` で登録し、chrome://extensions/shortcuts で変えられる) を押したときだけ、そのタブの表示中の画面を `chrome.tabs.captureVisibleTab` で撮る (マルチビュー画面のスクリーンショット)。撮った画像は枠の並びに切り抜いて、利用者のパソコンに PNG で保存し、クリップボードに入れるだけで、外部へは送らない。ほかのタブ (YouTube など) では何もしない |
| `scripting` | 共有画面の「𝕏 に投稿」を押したときだけ、そのボタンが開いた X の投稿画面のタブ 1 つにスクリプトを入れ、投稿欄の画像の入力欄に共有画像を入れる (人が画像を選んだのと同じ)。投稿ボタンは押さない。ほかのタブ・ページには入れない |
| 任意のホスト権限 `https://x.com/*` (`optional_host_permissions`) | 上の `scripting` で X の投稿画面に画像を入れるため。インストール時には求めず、利用者が初めて「𝕏 に投稿」を押したときに `chrome.permissions.request` で聞く。許可しなくても、投稿画面を開いて画像をクリップボードに入れるところまでは動く (利用者が Ctrl+V で貼る) |
| 任意のホスト権限 `https://www.nijisanji.jp/*` (`optional_host_permissions`) | アドオン「にじさんじ」(`addons/nijisanji.js`。初期値は OFF) が、にじさんじ公式サイトのライブスケジュール (サイトが使っている JSON `https://www.nijisanji.jp/api/streams?…`) を読み、名前に「にじさんじ」が入るチャンネルパックから足したチャンネルの配信状況を YouTube に問い合わせる回数を減らす。このサイトは CORS で読めないので権限が要る。インストール時には求めず、利用者が設定 → アドオンで ON にしたときに `chrome.permissions.request` で聞き、OFF にすると手放す。読み取りだけで、Cookie は送らない |
| 任意のホスト権限 `https://www.vspo-schedule.com/*` (`optional_host_permissions`) | アドオン「ぶいすぽっ!」(`addons/vspo.js`。初期値は OFF) が、ぶいすぽっ!の配信スケジュールのサイト (有志による非公式のサイト) のページ `https://www.vspo-schedule.com/schedule/live`・`/schedule/upcoming` に埋め込まれた枠のデータを読み、名前に「ぶいすぽ」が入るチャンネルパックから足したチャンネルの配信状況を YouTube に問い合わせる回数を減らす。このサイトは CORS で読めないので権限が要る。インストール時には求めず、利用者が設定 → アドオンで ON にしたときに `chrome.permissions.request` で聞き、OFF にすると手放す。読み取りだけで、Cookie は送らない |
| 任意のホスト権限 `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/*` (`optional_host_permissions`) | アドオン「STPR (すとぷり)」(`addons/stpr.js`。初期値は OFF) が、STPR の公式の配信予定のサイト (schedule.stpr.com) が読んでいる JSON `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/schedule/schedule_v2.json` を読み、名前に「STPR」か「すとぷり」が入るチャンネルパックから足したチャンネルの配信状況を YouTube に問い合わせる回数を減らす。この JSON の CORS は schedule.stpr.com にだけ開いているので権限が要る。読むのはこの 1 ファイルだけ。インストール時には求めず、利用者が設定 → アドオンで ON にしたときに `chrome.permissions.request` で聞き、OFF にすると手放す。読み取りだけで、Cookie は送らない |

### content scripts

| 対象 | ファイル | 用途 |
| --- | --- | --- |
| `https://www.youtube.com/live_chat*` (全フレーム) | `errlog.js`, `content/chat.js` | チャットのメッセージを読み取り、弾幕として親ページに渡す。マルチビュー画面の枠の中でだけ、この拡張機能のスクリプトで起きたエラーを記録する (`errlog.js`。YouTube 自身のエラーは記録しない) |
| `https://www.youtube.com/watch*` (全フレーム) | `errlog.js`, `content/watch.js`, `content/watch.css` | 枠の中のプレイヤーの見た目を整え、再生状態をマルチビュー画面とやり取りする。利用者が枠の音の左右・音量を変えたときだけ、その枠の中で Web Audio (StereoPanner・Gain) に通す (音声はブラウザの中で処理するだけで、録音・送信はしない)。枠の中でだけ、この拡張機能のスクリプトで起きたエラーを記録する (`errlog.js`) |
| `https://www.youtube.com/watch*` (全フレーム, MAIN world) | `content/watch-main.js` | ページ側のプレイヤー API (再生位置・音量など) を呼ぶ。「ℹ️ 枠の情報」・アーカイブ同期・ストレッチ表示で縦長の映像を切らずに収めるために、すでに読み込まれているページの情報 (配信か動画か・配信の時刻・公開日・視聴者数・再生数・映像が縦長か) を読み、マルチビュー画面に渡す (新しい通信はしない) |
| `https://www.youtube.com/hakomado_import*` | `content/import.js` | 取り込み用リンクから転送されたときに、マルチビュー画面の「📥 読み込む」へ切り替える |

## リモートコード

使っていない。読み込むスクリプトはすべてパッケージ内 (`extension/vendor/` の jsQR・qrcode-generator も同梱)。共有画像のタイトルのフォント (M PLUS Rounded 1c。SIL Open Font License 1.1) も `extension/fonts/` に同梱し、外からは読み込まない。

## 外部への通信

| 宛先 | 内容 |
| --- | --- |
| `www.youtube.com` / `i.ytimg.com` / `yt3.googleusercontent.com` | 配信・動画の情報とサムネイル (上記)、チャンネルのアイコン (画像の読み込みだけ) |
| `schedule.hololive.tv` | ホロライブの配信予定 (アドオン「ホロジュール」が ON のときだけ。初期値は ON)。Cookie は送らない |
| `www.nijisanji.jp` | にじさんじのライブスケジュール (アドオン「にじさんじ」が ON のときだけ。初期値は OFF)。配信中・今日・明日の分を、マルチビュー画面を開いている間 1 分に 1 回まで取得する (タブが複数あっても 1 回)。Cookie は送らない |
| `www.vspo-schedule.com` | ぶいすぽっ!の配信スケジュール (アドオン「ぶいすぽっ!」が ON のときだけ。初期値は OFF。有志による非公式のサイト)。配信中・これからの枠の 2 ページを、マルチビュー画面を開いている間 1 分に 1 回まで取得する (タブが複数あっても 1 回)。Cookie は送らない |
| `schedule-share-json.s3.ap-northeast-1.amazonaws.com` | STPR の公式の配信予定 (schedule.stpr.com が使っている JSON 1 つ。アドオン「STPR (すとぷり)」が ON のときだけ。初期値は OFF)。マルチビュー画面を開いている間 1 分に 1 回まで取得する (タブが複数あっても 1 回)。Cookie は送らない |
| `api.github.com` | 新しい版が出ていないかの確認 (1 日 1 回まで。ストア版 = `update_url` がある場合は行わない)。Cookie は送らない |
| `raw.githubusercontent.com` | 「パックを探す」を押したときだけ、リポジトリの `packs/index.json` (パックの一覧) と、選んだパックを取得する。CORS で読めるので host 権限は使わない。Cookie は送らない |
| `x.com` | 共有画面で利用者が「𝕏 に投稿」を押したときだけ、名前と取り込み用リンクを入れた投稿画面 (`https://x.com/intent/post?…`) を新しいタブで開き、許可があれば共有画像をその投稿欄に入れる。拡張機能からは投稿しない (投稿するかどうか・何を投稿するかは、利用者が X の画面で確かめて決める) |
| `github.com` | 「不具合の報告」で利用者が「GitHub で報告」を押したときだけ、エラーの記録と環境 (版・ブラウザ・OS) を書き込んだ Issue の作成画面を新しいタブで開く。拡張機能からは送信しない (送るかどうか・何を送るかは、利用者が GitHub の画面で確かめて決める) |
| 利用者が指定した https の URL | チャンネルパックの読み込み、ドラッグした画像 (QR コード読み取り) の取得。Cookie は送らない |

開発者が運営するサーバー (Hakomado Feed `hakomado.contee.net`) とは通信しない。共有画面の「📮 サイトに投稿」は、
Feed の投稿画面 (`https://hakomado.contee.net/post#text=<コード>`) を新しいタブで開くだけ (`x.com` の投稿画面と同じ形。コードは URL の `#` の後ろなのでサーバーに送られない)。
投稿するかどうかは、利用者が Feed の画面で X でログインして「投稿する」を押して決める。拡張機能からは送らない。
以前あった短縮リンク (`sets-link.js`) は、Feed に Turnstile を通らずに入れられて悪用されると溜まるため、2026-11-24 にやめた

## データの取り扱い (プライバシー)

- 収集する利用者データ: なし。開発者のサーバーとは通信しない
- 保存はすべてブラウザ内 (`chrome.storage`)。バックアップは利用者が自分でファイルに書き出す
- 「ウェブ履歴」に当たるもの: 視聴履歴をローカルにのみ保存。外部へ送信・販売・譲渡しない
- スクリーンショット: 利用者がマルチビュー画面のタブでショートカットキー (既定 Alt+Shift+S) を押したときだけ、`activeTab` + `captureVisibleTab` でそのタブを撮り、枠の並びに切り抜いて PNG をダウンロード・クリップボードに入れる。画像は外部へ送らない
- エラーの記録: ローカルにのみ保存 (最大 100 件・7 日)。自動では送らない。利用者が「GitHub で報告」「コピー」を押したときだけ、利用者自身が中身を確かめてから送る

### ダッシュボードの「プライバシー」タブに入れる内容

- プライバシーポリシーの URL: https://github.com/contee213/hakomado/blob/main/docs/privacy.md
  (中身は [docs/privacy.md](docs/privacy.md)。main にマージされてから URL が開くことを確かめて提出する)
- 単一用途の説明: 下の英語の文を入れる
- 権限ごとの理由: 上の「権限と理由」を英語にして入れる (下の英語の表)
- リモートコードを使っているか: **いいえ**
- データの使用 (収集するデータの種類): **どれにもチェックを入れない**。
  「収集」は開発者や第三者に送ることを指し、ブラウザの中にだけ保存する視聴履歴・設定はこれに当たらない。
  YouTube への問い合わせは、利用者が見る配信の情報を YouTube から取ってくるだけで、利用者のデータを渡してはいない
- 3 つの宣誓 (第三者に販売・譲渡しない / 単一用途と関係ない目的に使わない / 信用力の判断に使わない): すべてチェックする

単一用途 (英語):

```text
Lets the user watch several YouTube streams and videos side by side on one screen, with each tile's live chat shown as scrolling comments or in a chat panel.
```

権限ごとの理由 (英語):

| 権限 | 理由 |
| --- | --- |
| `storage` | Saves the user's tile arrangement, layout, channel list, watch history, playlists and settings locally. Keeps the list of tabs showing the multiview screen for the current browser session. Keeps a local record of errors raised by the extension's own scripts (up to 100 entries, deleted after 7 days), shown in "Report a problem". Nothing is sent to any server. |
| `declarativeNetRequestWithHostAccess` | (1) YouTube watch and live chat pages send X-Frame-Options, which blocks them from appearing in the extension's multiview page. A session rule removes only that header, only from www.youtube.com/watch and www.youtube.com/live_chat sub-frame responses, and only in tabs where the multiview screen is open (limited by tabIds). No other headers are changed. (2) A dynamic rule redirects only shared playlist links (https://www.youtube.com/watch_videos?... with a "hakomado=" parameter) to the extension's import screen. |
| `contextMenus` | Adds "Add to an empty Hakomado tile" to the right-click menu, shown only on links to YouTube videos/streams and on YouTube watch pages. It takes the video ID from the clicked link and passes it to the open multiview screen. The extension does not use the tabs permission and does not read tab URLs or titles. |
| `https://www.youtube.com/*` | Target of the rules above. Content scripts in the embedded watch and live chat frames control playback, volume, audio panning and archive sync, and read chat messages to show them as scrolling comments. Loads live / upcoming / archived stream lists and video and playlist details with the user's signed-in session, so members-only streams the user can access also work. |
| `https://schedule.hololive.tv/*` | Loads the stream schedule for the bundled default channels in a single request, which reduces the number of requests made to YouTube. Used by the Holodule add-on, which is on by default and can be turned off under Settings > Add-ons (nothing is loaded from this site while it is off). |
| `activeTab` | Only when the user presses the extension's keyboard shortcut (Alt+Shift+S by default, registered with `commands` and changeable at chrome://extensions/shortcuts) on the extension's own multiview tab: captures that tab with chrome.tabs.captureVisibleTab to take a screenshot of the tiles. The image is cropped to the tiles, saved as a PNG on the user's computer and copied to the clipboard; it is never sent anywhere. Nothing happens on other tabs (such as YouTube pages). |
| `scripting` | Only when the user presses "𝕏 Post" on the share screen: injects a script into the single X post tab that button just opened, and puts the share image into the post box's image input (the same as choosing the image by hand). It never presses Post and is not injected into any other tab or page. |
| `https://x.com/*` (optional host permission) | Needed for the `scripting` use above. Not requested at install; asked with chrome.permissions.request the first time the user presses "𝕏 Post". Without it, the extension still opens the post screen and copies the image to the clipboard for the user to paste. |
| `https://www.nijisanji.jp/*` (optional host permission) | Used only by the NIJISANJI add-on (`addons/nijisanji.js`, off by default) to read the live schedule from the NIJISANJI website (the JSON the site itself uses, `https://www.nijisanji.jp/api/streams?…`), which reduces requests to YouTube for channels added from a NIJISANJI channel pack. The site does not allow CORS, so host access is needed. Not requested at install; asked with chrome.permissions.request when the user turns the add-on on under Settings > Add-ons, and released when it is turned off. Read only; no cookies are sent. |
| `https://www.vspo-schedule.com/*` (optional host permission) | Used only by the VSPO! add-on (`addons/vspo.js`, off by default) to read the stream data embedded in the pages `https://www.vspo-schedule.com/schedule/live` and `/schedule/upcoming` of the VSPO! schedule site (an unofficial fan site), which reduces requests to YouTube for channels added from a VSPO! channel pack. The site does not allow CORS, so host access is needed. Not requested at install; asked with chrome.permissions.request when the user turns the add-on on under Settings > Add-ons, and released when it is turned off. Read only; no cookies are sent. |
| `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/*` (optional host permission) | Used only by the STPR add-on (`addons/stpr.js`, off by default) to read the JSON that the official STPR schedule site (schedule.stpr.com) loads, `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/schedule/schedule_v2.json`, which reduces requests to YouTube for channels added from an STPR channel pack. Its CORS only allows schedule.stpr.com, so host access is needed. Only that one file is read. Not requested at install; asked with chrome.permissions.request when the user turns the add-on on under Settings > Add-ons, and released when it is turned off. Read only; no cookies are sent. |

## 版の履歴 (ストアに出したもの)

| 版 | 日付 | 内容 | 状態 |
| --- | --- | --- | --- |
| 0.2.0 | 2026-11-22 | 初めての提出 (限定公開)。リリース `v0.2.0` の `hakomado-0.2.0-chrome-web-store.zip`。審査に合格したら自動で公開する設定 | 審査中 |
