# Chrome Web Store 掲載情報

Chrome ウェブストアのデベロッパー ダッシュボードに入れる内容の控えです。
**限定公開 (Unlisted) で 0.2.0 を公開しました** (2026-11-22)。掲載ページ: https://chromewebstore.google.com/detail/bhmbchggpdficakjfllkmfkpbdpddomp
(README の「インストール」から案内している)。GitHub のリリースの ZIP (開発者モードで読み込む) の配布も続けます。拡張機能を変えたらここも合わせて直します。

- 最終更新: 2026-11-24
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
- ストア版・リリースの ZIP は、どちらもリリース版のビルド (`node tools/build.js`) から作る。⏱ アーカイブ同期 (実験的な機能) のコードは入れない
  (HAKO-51。同期入りは `node tools/build.js --experimental` か `extension/` をそのまま読み込んだときだけ)
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
  (違いはリリースの workflow が入れる `"key"` の有無だけ。どちらも `extension/` から同期のコードを抜いたもの)。ストアには必ずリリースの `-chrome-web-store.zip` をそのまま上げる
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
- **どちらの版かを見分ける**: 不具合の報告を受けたら、使い方 (📖) か設定 (⚙) の画面の下の版 (例: `0.2.0 · build 120 (2026-11-22)`。ビルド番号と日付は `extension/build.js`) と、ストア版か ZIP 版か (拡張機能の ID) を聞く。
  不具合の報告 (エラーの記録) の本文にも同じ版とストア版かどうかが入る。`chrome://extensions` やストアに出る版は `version` (例: `0.2.0`) だけで、ビルド番号は入らない
- ストアに出したら、下の「版の履歴」に版・日付・状態を書き足す

## ストアの掲載情報

- 名前: `manifest.json` の `extName` がそのまま使われる (ja: `Hakomado – YouTube配信の複窓・マルチビュー(最大16枠)` / en: `Hakomado – Multiview for YouTube (up to 16 streams)`)
- 概要 (short description): `manifest.json` の `extDescription` がそのまま使われる (ja 48 文字 / en 99 文字。上限 132 文字)
- カテゴリ: エンターテイメント
- 言語: 日本語 / 英語 (既定は英語 `default_locale: en`)。ダッシュボードで言語ごとに詳しい説明を入れる
- ホームページの URL: https://github.com/contee213/hakomado
- サポートの URL: https://github.com/contee213/hakomado/issues

### 詳しい説明 (日本語)

ストアは Markdown を使えないので、そのまま貼る。

```text
YouTube・Twitch の配信・動画を 1 つの画面に最大 16 枠並べて、同時に視聴できます。

コラボ配信の各視点や、同じ時間に重なった推しの配信を、タブを切り替えずにまとめて見るための拡張機能です。ブラウザでログインしている YouTube アカウントがそのまま使われるので、メンバー限定配信も見られます。

■ 主な機能
・分割表示: 均等・メイン + サブ・小窓 (PinP) のレイアウト。どの枠も 16:9 に自動で合わせます
・弾幕 / チャット欄: 各枠のライブチャットを画面に流したり、横に出して書き込んだりできます
・チャンネル: 追加したチャンネルの配信中・予定と、最近終わった配信を一覧で表示
・自動再生: 配信中のチャンネルを自動で並べ、始まった / 終わった配信に合わせて枠を増減
・音の左右と音量: 枠ごとに音を左 / 右から聞こえるようにしたり、音量を変えたりできます (2 視点の聞き分けに)
・再生リスト / 視聴履歴 / あとで見る / 配信開始の通知
・共有: 今の枠や再生リストを、画像・リンク・テキストにして人に渡せます
・スクリーンショット: Alt+Shift+S で枠の並び全体を PNG で保存 (クリップボードにもコピー)
・右クリックで追加: YouTube・Twitch のリンクを右クリック →「Hakomado の空き枠に追加」
・Twitch: チャンネル・VOD も枠に入れられます。チャンネルの登録・配信中の検知・自動再生・速度・音の左右・弾幕・共有まで、YouTube の枠とほぼ同じように使えます (twitch.tv へのアクセスは、初めて使うときに許可を求めます)

■ 使い方
1. ツールバーの Hakomado のアイコンを押すと、マルチビュー画面が開きます
2. 上の「自動再生」を押すと、配信中のチャンネルが自動で並びます
3. 自分で選ぶときは、空いている枠に URL・動画 ID・@チャンネル名を貼るか、「チャンネルから選ぶ」「ライブラリから選ぶ」で選びます
4. 音を出す枠は、枠のバーのスピーカーか数字キー (1〜9) で切り替えます
細かい操作は、画面右上の「📖」(使い方) で見られます。

■ プライバシー
開発者は利用者の情報を一切集めません (アクセス解析・広告もありません)。設定・チャンネル・視聴履歴などは、すべてお使いのブラウザの中にだけ保存されます。

■ 権限について
「www.youtube.com のデータの読み取りと変更」は、YouTube のプレイヤーとライブチャットをマルチビュー画面の枠の中に表示し、再生・音量を操作するためと、配信の一覧を取得するために使います。マルチビュー画面を開いているタブの中でだけ働きます。
「schedule.hololive.tv のデータの読み取りと変更」は、初期データのチャンネルの配信予定をまとめて取得するために使います (設定の「アドオン」で OFF にすると取得しません)。
「www.nijisanji.jp のデータの読み取りと変更」は、設定の「アドオン」で「にじさんじ」を ON にしたときだけ求めます。にじさんじ公式サイトのライブスケジュールを取得するために使います (初期値は OFF)。
「www.vspo-schedule.com のデータの読み取りと変更」は、設定の「アドオン」で「ぶいすぽっ!」を ON にしたときだけ求めます。ぶいすぽっ!の配信スケジュール (有志による非公式のサイト) を取得するために使います (初期値は OFF)。
「schedule-share-json.s3.ap-northeast-1.amazonaws.com のデータの読み取りと変更」は、設定の「アドオン」で「STPR (すとぷり)」を ON にしたときだけ求めます。STPR の公式の配信予定 (schedule.stpr.com のデータ) を取得するために使います (初期値は OFF)。
「x.com のデータの読み取りと変更」は、共有画面の「𝕏 に投稿」を初めて押したときだけ求めます。開いた X の投稿画面に共有画像を入れるために使い、投稿はしません。
「twitch.tv のデータの読み取りと変更」は、枠に Twitch のチャンネル・VOD の URL を初めて入れたとき、または Twitch のチャンネルを登録するときだけ求めます。Twitch の公式の埋め込みプレイヤーとチャットを、マルチビュー画面の枠の中に表示するためと、登録した Twitch のチャンネルの公開ページから配信中かどうかと最近の VOD を読むため、共有・あとで見る・再生リストに入れるときに Twitch のライブをその配信の VOD に置き換えるために使います。許可している間だけ、枠に入れた Twitch のプレイヤーとチャット欄の中にスクリプトを入れ、同期・速度・音の左右・弾幕を YouTube の枠と同じように使えるようにします (twitch.tv を普通に開いたときは何もしません)。

■ ご注意
個人が作った非公式のツールです。YouTube / Google や、初期データとして入っているチャンネルの運営元とは関係ありません。YouTube のページの構成が変わると、一部の機能が動かなくなることがあります。

■ 不具合・要望
画面右上の「📖」→「不具合の報告」から、エラーの記録を確かめて GitHub で報告できます。
https://github.com/contee213/hakomado/issues
```

### 詳しい説明 (英語)

```text
Watch up to 16 YouTube and Twitch streams and videos side by side on one screen.

Built for watching every point of view of a collab stream, or several overlapping streams, without switching tabs. It uses the YouTube account you are already signed in to in your browser, so members-only streams work too.

FEATURES
• Layouts: equal grid, main + sub tiles, or picture-in-picture. Every tile keeps a 16:9 shape
• Danmaku / chat panel: scroll each tile's live chat across the video, or open the chat beside it and post
• Channels: see live, upcoming and recently finished streams from the channels you add
• Auto play: automatically fills tiles with live channels and adds or removes tiles as streams start and end
• Per-tile audio: pan each tile's sound left or right and change its volume (handy for telling two voices apart)
• Playlists, watch history, Watch later and go-live notifications
• Sharing: turn your current tiles or a playlist into an image, a link or text
• Screenshots: press Alt+Shift+S to save all the tiles as a PNG (also copied to the clipboard)
• Right-click to add: right-click a YouTube or Twitch link and choose "Add to an empty Hakomado tile"
• Twitch: Twitch channels and VODs can go in tiles too. Adding channels, live detection, auto play, speed, left/right audio, danmaku and sharing work much like YouTube tiles (access to twitch.tv is requested the first time you use it)

HOW TO USE
1. Click the Hakomado icon in the toolbar to open the multiview screen
2. Press "Auto play" at the top to fill tiles with live channels
3. To choose yourself, paste a URL, video ID or @handle into an empty tile, or use "Pick from channels" / "Pick from library"
4. Pick the tile you hear with the speaker button on its bar or the number keys (1–9)
Press "📖" (Help) at the top right for all controls and shortcuts.

PRIVACY
The developer collects no information about you (no analytics, no ads). Your settings, channels, watch history and so on are stored only in your own browser.

PERMISSIONS
"Read and change your data on www.youtube.com" is used to show the YouTube player and live chat inside the tiles of the multiview screen, to control playback and volume, and to load stream lists. It only takes effect in tabs where the multiview screen is open.
"Read and change your data on schedule.hololive.tv" is used to load the stream schedule of the bundled channels in one request (not loaded when turned off under Settings > Add-ons).
"Read and change your data on www.nijisanji.jp" is only requested when you turn on the NIJISANJI add-on under Settings > Add-ons. It is used to load the live schedule from the NIJISANJI website (off by default).
"Read and change your data on www.vspo-schedule.com" is only requested when you turn on the VSPO! add-on under Settings > Add-ons. It is used to load the VSPO! stream schedule from that unofficial fan site (off by default).
"Read and change your data on schedule-share-json.s3.ap-northeast-1.amazonaws.com" is only requested when you turn on the STPR add-on under Settings > Add-ons. It is used to load the official STPR stream schedule (the data behind schedule.stpr.com; off by default).
"Read and change your data on twitch.tv" is only requested the first time you put a Twitch channel or VOD URL into a tile, or when you add a Twitch channel. It is used to show the official Twitch embedded player and chat inside the tiles of the multiview screen, to read whether an added Twitch channel is live and its recent VODs from the channel's public page, and to share, save or add a Twitch live to a playlist as the VOD of that stream. While it is granted, scripts are added inside the Twitch player and chat in the tiles so that sync, speed, left/right audio and danmaku work as they do for YouTube tiles (nothing runs when you open twitch.tv normally).

NOTE
This is an unofficial tool made by an individual. It is not affiliated with YouTube / Google or with the operators of the bundled channels. Some features may stop working when YouTube changes its pages.

BUGS AND REQUESTS
Open "📖" → "Report a problem" at the top right to review the error record and report it on GitHub.
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
3. Add a second video the same way (any public video or live stream). Hover over a tile to show its bar, and use the 🎧 button on each tile's bar or the number keys 1-9 to switch which tile you hear.
4. "▦ Layout" at the top changes the arrangement. Hover over a tile to show its bar; for a live stream, the 💬 button opens the live chat beside the video.
5. Right-click any YouTube video link on youtube.com and choose "Add to an empty Hakomado tile".

About declarativeNetRequest: YouTube watch and live chat pages send X-Frame-Options, which blocks them from appearing inside the extension's multiview page. The extension removes only that header, only for youtube.com/watch and youtube.com/live_chat sub-frame responses, and only in tabs where the multiview screen is open (session rules scoped by tabIds). No other headers or sites are touched.
```

## 審査で指摘されそうな点

- **`X-Frame-Options` を外していること**: 拡張機能の作りそのものなので外せない。対象を「マルチビュー画面のタブ・`watch` / `live_chat` の iframe・このヘッダーだけ」に絞っていることを、権限の理由と審査向けのメモに書いてある。
  同じ仕組みのマルチビュー拡張機能はストアにほかにもあるが、通らなかったり、掲載後に取り下げられたりすることもありうる。その場合は ZIP の配布だけに戻す
- **URL の枠 (YouTube 以外のサイト) と単一用途**: 任意のホスト権限 `https://*/*` を持ち、利用者が許可したサイトの `X-Frame-Options` を外す。
  `Content-Security-Policy` も、中身が `frame-ancestors` (と報告先など) だけで XSS 対策の指定 (`*-src`・`base-uri`・`sandbox`・`trusted-types` など) を含まないときに限って外す (条件はルールの `responseHeaders` / `excludedResponseHeaders` で書き、Chrome が応答ごとに判定する)。
  「YouTube の同時視聴」から用途が広がるので、単一用途の説明と合わせて「複数の動画を 1 画面で同時に見る」に言い換える必要があるかもしれない。
  インストール時には何も求めず、利用者が URL を入れたサイトだけを、そのとき `chrome.permissions.request` で聞くことを権限の理由に書いてある。
  サイトの利用規約 (動画配信サービスの埋め込み・同時視聴の扱い) は、サイトごとに利用者の責任になることも説明文に書く必要がある
- **名前の「YouTube」**: 「〜 for YouTube」の形は、提供元と誤解させない書き方として一般に使われている。ロゴは使っていない。指摘されたら `extName` から外す
- **ホロライブの初期データ**: チャンネル名・アイコンの URL と、配信予定の取得先 (`schedule.hololive.tv`)。説明文では「初期データのチャンネル」とだけ書き、事務所の名前は出していない。スクリーンショットにも写さない
- **ユーザーの操作で読み込むデータ**: チャンネルパック・取り込み用リンクは JSON / テキストのデータとして読むだけで、スクリプトは読み込まない (リモートコードではない)

## 単一用途 (Single purpose)

YouTube の複数の配信・動画を 1 つの画面に並べて同時に視聴し、各枠のライブチャットを表示・書き込みできるようにする。ダッシュボードには下の「プライバシー」タブの節の英語の文を入れる。

## 権限と理由

| 権限 | 理由 |
| --- | --- |
| `storage` | 枠の並び・レイアウト・チャンネル一覧・視聴履歴・再生リスト・設定を `chrome.storage.local` に保存する。マルチビュー画面を開いているタブの一覧を `chrome.storage.session` に一時保存する。登録チャンネルの配信状況を調べるために YouTube・Twitch から読んだもの (チャンネルごとの新しい配信・動画の ID と題名・日時、配信の実際の開始・終了は拡張機能の IndexedDB に、動画ごとの配信の状態と制限 (429) を受けたときの待ち時間は `chrome.storage.local` に) を覚え、ブラウザを開き直したときに同じものを取り直さないようにする (一覧から外したチャンネルの分・3 日より前の分は消す。配信の時刻は 8 日で消す)。ライブラリの 🤝 (コラボの判定) の判定の記録も、当たっているかを確かめるために IndexedDB に 8 日まで覚える。(同期入りの版だけ。ストア版・リリースの ZIP には無い。HAKO-51) 同期の調整の「〰 波形」のために、動画ごとの音の大きさ (0.1 秒ごとの数字だけ。音そのものは残さない) を IndexedDB に 100 本まで覚える。この拡張機能のエラーの記録 (新しい順に最大 100 件・7 日で消える。「? 使い方」→「不具合の報告」で見る) を `chrome.storage.local` に保存する。外部のサーバーには送らない |
| `declarativeNetRequestWithHostAccess` | (1) マルチビュー画面のタブの中だけで、`www.youtube.com/watch` と `www.youtube.com/live_chat` の iframe 応答から `X-Frame-Options` ヘッダーを外し、拡張機能のページに YouTube のプレイヤーとチャットを埋め込めるようにする (セッションルール。`tabIds` で対象タブを限定し、CSP など他のヘッダーは触らない)。(2) `hakomado=` 付きの `https://www.youtube.com/watch_videos?…` (再生リストの共有リンク) だけを拡張機能内の取り込み画面へ転送する (動的ルール)。(3) URL の枠: 利用者が許可したサイト (下の任意のホスト権限) の iframe 応答から `X-Frame-Options` を外す。`Content-Security-Policy` は、中身が埋め込み先の指定 (`frame-ancestors`) と報告先などだけで、XSS 対策の指定 (`default-src`・`script-src` などの `*-src`、`base-uri`、`sandbox`、`trusted-types` など) を 1 つも含まないときに限って外す (Chrome がルールの条件 `responseHeaders` / `excludedResponseHeaders` で応答ごとに判定する。XSS 対策の入った CSP はそのままなので、そのようなサイトで埋め込みを禁じているものは入らない)。(1) と同じくマルチビュー画面のタブだけのセッションルール。(4) twitch.tv の任意の権限を許可したときだけ、同じくマルチビュー画面のタブの中だけで、Twitch の公式の埋め込みプレイヤー (`https://player.twitch.tv/`) とチャット (`https://www.twitch.tv/embed/`) の iframe 応答から `Content-Security-Policy` (中身は埋め込み先を https のサイトに限る `frame-ancestors` だけ) と `X-Frame-Options` を外す (セッションルール。拡張機能のページは https でないため) |
| `contextMenus` | 右クリックのメニュー「Hakomado の空き枠に追加」を出す。YouTube の動画・配信へのリンク (`targetUrlPatterns` で watch / live / shorts / youtu.be に限定) と、YouTube の視聴ページ (`documentUrlPatterns`)、Twitch へのリンクと Twitch のページでだけ表示する (Twitch は URL の形だけではチャンネル・VOD とほかのページを見分けられないので、Twitch のページ全部に出し、チャンネル・VOD でなければ押しても何もしない)。押したときにリンクの URL から動画 ID (Twitch はチャンネル名・VOD の番号) を取り出し、開いているマルチビュー画面に渡す (画面が無ければ新しいタブで開く)。`tabs` 権限は使わず、タブの URL・タイトルは読まない |
| ホスト権限 `https://www.youtube.com/*` | 上の declarativeNetRequest ルールの適用先。視聴ページ / ライブチャットに content script を入れて、プレイヤーの操作・弾幕用のチャット取得を行う。ログイン中のアカウントで配信中 / 予定 / アーカイブの一覧、動画・再生リストの情報を取得する (メンバー限定配信も見られるようにするため Cookie 付き)。利用者がチャンネルの管理の画面の「登録チャンネルから選ぶ」を押したときだけ、登録チャンネルの管理ページ (`/feed/channels`) を Cookie 付きで読み、選んだチャンネルだけをチャンネル一覧 (`chrome.storage.local`) に足す。アドオン「YouTube の登録チャンネル」(`addons/youtube-subs.js`。初期値は ON) は、そうして足したチャンネルが一覧にあるときだけ、登録チャンネルのフィード (`/feed/subscriptions`) を Cookie 付きで 2 分に 1 回まで読み、配信中・配信予定をまとめて知ることで、チャンネルごとの RSS の取得回数を減らす (読んだフィードは配信の ID・チャンネル ID・開始予定だけを残し、外部へは送らない) |
| ホスト権限 `https://schedule.hololive.tv/*` | 初期データのホロライブのチャンネルについて、配信予定 (ホロジュール) をまとめて 1 回で取得し、YouTube への問い合わせ回数を減らす。アドオン `addons/holodule.js` が使う (設定 → アドオンで OFF にすると取得しない。初期値は ON なので、インストール時から使えるよう必須の権限のままにしている) |
| `activeTab` | 利用者がマルチビュー画面のタブで、この拡張機能のショートカットキー (既定 Alt+Shift+S。`commands` で登録し、chrome://extensions/shortcuts で変えられる) を押したときだけ、そのタブの表示中の画面を `chrome.tabs.captureVisibleTab` で撮る (マルチビュー画面のスクリーンショット)。撮った画像は枠の並びに切り抜いて、利用者のパソコンに PNG で保存し、クリップボードに入れるだけで、外部へは送らない。ほかのタブ (YouTube など) では何もしない |
| `scripting` | 共有画面の「𝕏 に投稿」を押したときだけ、そのボタンが開いた X の投稿画面のタブ 1 つにスクリプトを入れ、投稿欄の画像の入力欄に共有画像を入れる (人が画像を選んだのと同じ)。投稿ボタンは押さない。ほかのタブ・ページには入れない。また、URL の枠のために、利用者が許可したサイトにだけ `content/web-player.js` を `chrome.scripting.registerContentScripts` で登録する (下の content scripts の表) |
| 任意のホスト権限 `https://x.com/*` (`optional_host_permissions`) | 上の `scripting` で X の投稿画面に画像を入れるため。インストール時には求めず、利用者が初めて「𝕏 に投稿」を押したときに `chrome.permissions.request` で聞く。許可しなくても、投稿画面を開いて画像をクリップボードに入れるところまでは動く (利用者が Ctrl+V で貼る) |
| 任意の権限 `identity` (`optional_permissions`) | ⚙ チャンネルの管理の「Twitch のフォロー」の「フォローから選ぶ」を押したときだけ求める。Twitch の公式の認可の画面 (`id.twitch.tv`) を `chrome.identity.launchWebAuthFlow` で開き、利用者がログインして許可すると、フォローしているチャンネルを読むためのアクセストークン (scope `user:read:follows` だけ) を受け取る。トークンは Twitch の公式の API (`api.twitch.tv/helix`) でフォロー一覧とチャンネルのアイコンを読むのに 1 回だけ使い、読み終えたらすぐ無効にする (保存しない・ほかに送らない)。読んだ一覧は画面に出すだけで、利用者が選んだチャンネルだけをチャンネル一覧 (ブラウザの中) に足す。Twitch のアプリの登録 (Client ID) が済むまで、この項目は画面に出さない |
| 任意のホスト権限 `https://www.nijisanji.jp/*` (`optional_host_permissions`) | アドオン「にじさんじ」(`addons/nijisanji.js`。初期値は OFF) が、にじさんじ公式サイトのライブスケジュール (サイトが使っている JSON `https://www.nijisanji.jp/api/streams?…`) を読み、名前に「にじさんじ」が入るチャンネルパックから足したチャンネルの配信状況を YouTube に問い合わせる回数を減らす。このサイトは CORS で読めないので権限が要る。インストール時には求めず、利用者が設定 → アドオンで ON にしたときに `chrome.permissions.request` で聞き、OFF にすると手放す。読み取りだけで、Cookie は送らない |
| 任意のホスト権限 `https://www.vspo-schedule.com/*` (`optional_host_permissions`) | アドオン「ぶいすぽっ!」(`addons/vspo.js`。初期値は OFF) が、ぶいすぽっ!の配信スケジュールのサイト (有志による非公式のサイト) のページ `https://www.vspo-schedule.com/schedule/live`・`/schedule/upcoming` に埋め込まれた枠のデータを読み、名前に「ぶいすぽ」が入るチャンネルパックから足したチャンネルの配信状況を YouTube に問い合わせる回数を減らす。このサイトは CORS で読めないので権限が要る。インストール時には求めず、利用者が設定 → アドオンで ON にしたときに `chrome.permissions.request` で聞き、OFF にすると手放す。読み取りだけで、Cookie は送らない |
| 任意のホスト権限 `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/*` (`optional_host_permissions`) | アドオン「STPR (すとぷり)」(`addons/stpr.js`。初期値は OFF) が、STPR の公式の配信予定のサイト (schedule.stpr.com) が読んでいる JSON `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/schedule/schedule_v2.json` を読み、名前に「STPR」か「すとぷり」が入るチャンネルパックから足したチャンネルの配信状況を YouTube に問い合わせる回数を減らす。この JSON の CORS は schedule.stpr.com にだけ開いているので権限が要る。読むのはこの 1 ファイルだけ。インストール時には求めず、利用者が設定 → アドオンで ON にしたときに `chrome.permissions.request` で聞き、OFF にすると手放す。読み取りだけで、Cookie は送らない |
| 任意のホスト権限 `https://*/*` (`optional_host_permissions`) | URL の枠 (YouTube 以外の動画サイトのページを枠に入れて、中の動画を再生・一時停止・シーク・ミュートする)。インストール時には何も求めない。利用者が枠に https の URL を入れたときに、そのサイトだけ (`https://*.<ドメイン>/*`。URL のホスト名の登録されたドメイン (`live.example.co.jp` なら `example.co.jp`) とそのサブドメイン。`github.io` のように多くの人がサイトを置くドメインはホスト名のまま) を `chrome.permissions.request` で聞く。ドメインごとにするのは、動画サイトのプレイヤーが同じドメインの別のサブドメイン (ログイン・視聴権の確認など) にログインの Cookie 付きでアクセスするため (許可の無いサブドメインへのアクセスはサードパーティ扱いになり、再生できない)。許可したサイトは `chrome.storage.local` の `webOrigins` に覚え、Chrome の設定で許可を取り消すと、登録とルールも外す。拡張機能からそのサイトのデータを読み取ったり送ったりはしない |
| 任意のホスト権限 `https://*.twitch.tv/*` (`optional_host_permissions`) | (1) 枠に Twitch のライブ・VOD を表示し、YouTube の枠と同じように操作するため。上の declarativeNetRequest (4) の適用先。公式の埋め込みプレイヤー (`player.twitch.tv`) とチャット (`www.twitch.tv/embed/<チャンネル>/chat`) を iframe で入れ、ミュート・一時停止・シークは公式の埋め込み API と同じ postMessage で送る。公式の API に無い速度・音の左右・音量・遅延・アーカイブ同期の再生位置のやり取りのため、許可している間だけ埋め込みプレイヤーに content script (`content/twitch-player.js`。下の content scripts の表) を登録する。チャンネルのライブの弾幕のため、公式の埋め込みチャット欄に content script (`content/twitch-chat.js`) を登録し、画面に出たコメントの文字・絵文字・投稿者名を読んでプレイヤーの中に流す (読んだコメントは保存も送信もしない)。VOD をアーカイブ同期でそろえるために、VOD の公開ページ (`https://www.twitch.tv/videos/<番号>`) の先頭の構造化データから配信の開始時刻を Cookie なしで読む (VOD ごとに 1 回)。(2) チャンネル一覧に登録した Twitch のチャンネルの公開ページ (`https://www.twitch.tv/<名前>`) を Cookie なしで取得し、先頭の構造化データ (JSON-LD) から名前・アイコン・配信中か・始まった時刻・配信の題名・最近の VOD を読む (読んだら通信を打ち切る。マルチビュー画面を開いている間、1 チャンネル 2 分に 1 回まで)。(3) 枠の Twitch のライブを共有・あとで見る・再生リストに入れるとき、後から見ても同じ配信になるように、その配信の VOD の番号を `https://gql.twitch.tv/gql` に Cookie なしで聞く (送るのはチャンネルの名前だけ。利用者がそれらの操作をしたときだけ、1 チャンネル 2 分に 1 回まで)。インストール時には求めず、利用者が枠に Twitch の URL を初めて入れたとき・Twitch のチャンネルを登録するとき (または Twitch の枠の「Twitch を表示する」を押したとき) に `chrome.permissions.request` で聞く。ログイン中の Twitch アカウントで見られるもの (サブスク限定など) は、Twitch のページで見るのと同じように見られる |

### content scripts

| 対象 | ファイル | 用途 |
| --- | --- | --- |
| `https://www.youtube.com/live_chat*` (全フレーム) | `errlog.js`, `content/chat.js` | チャットのメッセージを読み取り、弾幕として親ページに渡す。マルチビュー画面の枠の中でだけ、この拡張機能のスクリプトで起きたエラーを記録する (`errlog.js`。YouTube 自身のエラーは記録しない) |
| `https://www.youtube.com/watch*` (全フレーム) | `errlog.js`, `content/mix.js`, `content/watch.js`, `content/timer-reader.js`, `content/watch.css` | 枠の中のプレイヤーの見た目を整え、再生状態をマルチビュー画面とやり取りする。利用者が枠の音の左右・音量を変えたときだけ、その枠の中で Web Audio (StereoPanner・Gain) に通す (音声はブラウザの中で処理するだけで、録音・送信はしない)。✨ 自動補正と「〰 波形」では、音の大きさ (数字) だけを測ってマルチビュー画面に渡す。🎬 同時視聴では、マルチビュー画面が画面の外に開いた視聴ページ (`hakomado_timer=1`、240p) でだけ `content/timer-reader.js` が動き、映像の一部 (配信の画面のタイマーの所) をブラウザの中で比べて、タイマーが動き出した再生位置をマルチビュー画面に渡す (映像は保存も送信もしない。文字認識などの外部の仕組みは使わない。それ以外のページでは何もしない)。枠の中でだけ、この拡張機能のスクリプトで起きたエラーを記録する (`errlog.js`) |
| `https://www.youtube.com/watch*` (全フレーム, MAIN world) | `content/watch-main.js` | ページ側のプレイヤー API (再生位置・音量など) を呼ぶ。「ℹ️ 枠の情報」・ストレッチ表示で縦長の映像を切らずに収めるために、すでに読み込まれているページの情報 (配信か動画か・配信の時刻・公開日・視聴者数・再生数・映像が縦長か) を読み、マルチビュー画面に渡す (新しい通信はしない) |
| `https://www.youtube.com/hakomado_import*` | `content/import.js` | 取り込み用リンクから転送されたときに、マルチビュー画面の「📥 読み込む」へ切り替える |
| `https://player.twitch.tv/*` (全フレーム。twitch.tv の任意の権限を許可している間だけ、manifest には書かず `chrome.scripting.registerContentScripts` で登録) | `errlog.js`, `content/mix.js`, `danmaku.js`, `content/twitch-player.js`, `danmaku.css` | Twitch の公式の埋め込みプレイヤーの動画要素の速度を変え、利用者が枠の音の左右・音量・遅延を変えたときだけ Web Audio に通し、VOD の再生位置・状態をマルチビュー画面に渡す。弾幕が ON のチャンネルのライブでは、チャット欄から届いたコメントをプレイヤーの中に流す (プレイヤーの上に重ねると Twitch が再生を止めるため) (音声はブラウザの中で処理するだけで、録音・送信はしない)。マルチビュー画面の枠に直接入ったとき (`location.ancestorOrigins`) だけ動き、twitch.tv を普通に開いたとき・ほかのサイトの埋め込みでは何もしない |
| `https://www.twitch.tv/embed/*` (全フレーム。登録の条件は上と同じ) | `errlog.js`, `content/twitch-chat.js` | Twitch の公式の埋め込みチャット欄に新しく出たコメントの文字・絵文字 (画像の URL)・投稿者名を読み、弾幕にするためマルチビュー画面に渡す。チャット欄のページ (`/embed/<チャンネル>/chat`) で、マルチビュー画面の枠に直接入ったときだけ動く。読んだものは保存も送信もしない |
| 利用者が URL の枠で許可したサイト (全フレーム。manifest には書かず、`chrome.scripting.registerContentScripts` で登録) | `web-site.js`, `content/web-player.js` | ページの中の `<video>` からそれらしいもの (見えている面積が大きく、読み込み中・再生中のもの) を 1 つ選び、マルチビュー画面からの指示で再生・一時停止・シーク・ミュート・速度を変え、再生位置などをマルチビュー画面に渡す。枠には動画だけを見せる: ページ全体を CSS (`transform`・`clip-path`) で拡大・移動して、その動画の部分を枠にぴったり映す (ページの作りは変えないので、動画に重なる操作ボタン・字幕は残る。中身は読まない。動画の無いページはそのまま見せる)。プレイヤーが同じサイトの内側の枠にあるときは、その枠から外側の枠へ知らせ (中身の無い `postMessage`)、外側はその枠を画面いっぱいに広げる。一番外側のページがこの拡張機能のマルチビュー画面のとき (`location.ancestorOrigins`) だけ動き、そのサイトを普通に開いたときは何もしない。サイトの内容は読まず、送らない |

## リモートコード

使っていない。読み込むスクリプトはすべてパッケージ内 (`extension/vendor/` の jsQR・qrcode-generator も同梱)。共有画像のタイトルのフォント (M PLUS Rounded 1c。SIL Open Font License 1.1) も `extension/fonts/` に同梱し、外からは読み込まない。

## 外部への通信

| 宛先 | 内容 |
| --- | --- |
| `www.youtube.com` / `i.ytimg.com` / `yt3.googleusercontent.com` / `yt3.ggpht.com` | 配信・動画の情報とサムネイル (上記)、チャンネルのアイコン (画像の読み込みだけ)。「登録チャンネルから選ぶ」を押したときだけ、登録チャンネルの一覧 (`/feed/channels`。数 MB) を 1 回取得する。アドオン「YouTube の登録チャンネル」が ON で、登録チャンネルから足したチャンネルがあるときは、登録チャンネルのフィード (`/feed/subscriptions`。約 3 MB) を 2 分に 1 回まで取得する (タブが複数あっても 1 回)。(同期入りの版だけ。ストア版・リリースの ZIP には無い。HAKO-51) 同期の調整の「〰 波形」を出している間だけ、枠に入っている YouTube のアーカイブの視聴ページを、画面の外の iframe で音を出さずに 16 倍速・一番低い画質で再生し、音の大きさを測る (同時に 8 本まで。中の通信は YouTube のページが行う。閉じると止める。拡張機能からは何も送らない) |
| `schedule.hololive.tv` | ホロライブの配信予定 (アドオン「ホロジュール」が ON のときだけ。初期値は ON)。Cookie は送らない |
| `www.nijisanji.jp` | にじさんじのライブスケジュール (アドオン「にじさんじ」が ON のときだけ。初期値は OFF)。配信中・今日・明日の分を、マルチビュー画面を開いている間 1 分に 1 回まで取得する (タブが複数あっても 1 回)。Cookie は送らない |
| `www.vspo-schedule.com` | ぶいすぽっ!の配信スケジュール (アドオン「ぶいすぽっ!」が ON のときだけ。初期値は OFF。有志による非公式のサイト)。配信中・これからの枠の 2 ページを、マルチビュー画面を開いている間 1 分に 1 回まで取得する (タブが複数あっても 1 回)。Cookie は送らない |
| `schedule-share-json.s3.ap-northeast-1.amazonaws.com` | STPR の公式の配信予定 (schedule.stpr.com が使っている JSON 1 つ。アドオン「STPR (すとぷり)」が ON のときだけ。初期値は OFF)。マルチビュー画面を開いている間 1 分に 1 回まで取得する (タブが複数あっても 1 回)。Cookie は送らない |
| `player.twitch.tv` / `www.twitch.tv` | 利用者が枠に Twitch の URL を入れたときだけ、公式の埋め込みプレイヤーとチャットを iframe で開く (中の通信は Twitch のページが行う)。利用者がチャンネル一覧に登録した Twitch のチャンネルだけ、その公開ページ (`www.twitch.tv/<名前>`) の先頭を読み、配信中か・最近の VOD を調べる (1 チャンネル 2 分に 1 回まで。Cookie は送らない)。枠に入れた VOD は、アーカイブ同期のために VOD のページ (`www.twitch.tv/videos/<番号>`) の先頭から配信の開始時刻を読む (VOD ごとに 1 回。Cookie は送らない)。枠の Twitch のライブを共有・あとで見る・再生リストに入れるときだけ、その配信の VOD の番号を `gql.twitch.tv` に聞く (送るのはチャンネルの名前だけ。Cookie は送らない) |
| `static-cdn.jtvnw.net` | Twitch のチャンネルのアイコン・配信と VOD のサムネイル (画像の読み込みだけ)。twitch.tv の許可を外したあとも登録した Twitch のチャンネルが残っているときは、配信のサムネイル画像 (誰でも読める) が「配信していない」画像に転送されるかで配信中かだけを調べる。Cookie は送らない |
| `id.twitch.tv` / `api.twitch.tv` | 利用者が「Twitch のフォロー」の「フォローから選ぶ」を押してログインしたときだけ、Twitch の認可の画面を開き、公式の API でフォローしているチャンネルとアイコンを読む。読み終えたらアクセストークンを無効にする (`id.twitch.tv/oauth2/revoke`)。トークンは保存しない |
| `api.github.com` | 新しい版が出ていないかの確認 (1 日 1 回まで。ストア版 = `update_url` がある場合は行わない)。Cookie は送らない |
| `raw.githubusercontent.com` | 「パックを探す」を押したときだけ、リポジトリの `packs/index.json` (パックの一覧) と、選んだパックを取得する。CORS で読めるので host 権限は使わない。Cookie は送らない |
| `x.com` | 共有画面で利用者が「𝕏 に投稿」を押したときだけ、名前と取り込み用リンクを入れた投稿画面 (`https://x.com/intent/post?…`) を新しいタブで開き、許可があれば共有画像をその投稿欄に入れる。拡張機能からは投稿しない (投稿するかどうか・何を投稿するかは、利用者が X の画面で確かめて決める) |
| `github.com` | 「不具合の報告」で利用者が「GitHub で報告」を押したときだけ、エラーの記録と環境 (版・ブラウザ・OS) を書き込んだ Issue の作成画面を新しいタブで開く。拡張機能からは送信しない (送るかどうか・何を送るかは、利用者が GitHub の画面で確かめて決める) |
| 利用者が指定した https の URL | チャンネルパックの読み込み、ドラッグした画像 (QR コード読み取り) の取得。Cookie は送らない |
| 利用者が URL の枠に入れたサイト | そのページを枠 (iframe) に表示するだけ (ブラウザでそのサイトを開くのと同じ通信。ログインの Cookie はブラウザが付ける)。拡張機能からは何も送らない |

開発者が運営するサーバー (Hakomado Feed `hakomado.contee.net`) とは通信しない。共有画面の「📮 サイトに投稿」は、
Feed の投稿画面 (`https://hakomado.contee.net/post#text=<コード>`) を新しいタブで開くだけ (`x.com` の投稿画面と同じ形。コードは URL の `#` の後ろなのでサーバーに送られない)。
投稿するかどうかは、利用者が Feed の画面で X でログインして「投稿する」を押して決める。拡張機能からは送らない。
以前あった短縮リンク (`sets-link.js`) は、Feed に Turnstile を通らずに入れられて悪用されると溜まるため、2026-11-24 にやめた

## データの取り扱い (プライバシー)

- 収集する利用者データ: なし。開発者のサーバーとは通信しない
- 保存はすべてブラウザ内 (`chrome.storage`)。バックアップは利用者が自分でファイルに書き出す
- 「ウェブ履歴」に当たるもの: 視聴履歴をローカルにのみ保存。外部へ送信・販売・譲渡しない
- YouTube の登録チャンネル: 利用者が「登録チャンネルから選ぶ」を押したときだけ YouTube から読み、画面に出すだけ。一覧そのものは保存しない。利用者が選んだチャンネルだけをチャンネル一覧としてローカルに保存し、外部へは送らない。アドオンが読む登録チャンネルのフィードも、配信の ID・チャンネル ID・開始予定だけをローカルに一時保存し、外部へは送らない
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
| `storage` | Saves the user's tile arrangement, layout, channel list, watch history, playlists and settings locally. Keeps the list of tabs showing the multiview screen for the current browser session. Caches what it read from YouTube and Twitch to check the user's channels' stream status (recent stream and video IDs, titles and dates per channel, each video's live/upcoming/ended state and actual start/end times, and the back-off time after a rate limit) locally (chrome.storage.local and the extension's IndexedDB), so reopening the browser does not fetch the same data again; entries for removed channels and older than 3 days are deleted (stream times after 8 days). Also keeps a local record of how the library's 🤝 (collab) grouping judged each pair for 8 days, to check its accuracy. Keeps a local record of errors raised by the extension's own scripts (up to 100 entries, deleted after 7 days), shown in "Report a problem". Nothing is sent to any server. |
| `declarativeNetRequestWithHostAccess` | (1) YouTube watch and live chat pages send X-Frame-Options, which blocks them from appearing in the extension's multiview page. A session rule removes only that header, only from www.youtube.com/watch and www.youtube.com/live_chat sub-frame responses, and only in tabs where the multiview screen is open (limited by tabIds). No other headers are changed. (2) A dynamic rule redirects only shared playlist links (https://www.youtube.com/watch_videos?... with a "hakomado=" parameter) to the extension's import screen. (3) URL tiles: for sites the user has allowed (optional host permission below), the same kind of session rule removes X-Frame-Options from sub-frame responses, only in multiview tabs. Content-Security-Policy is removed only when it contains nothing but frame-ancestors (and reporting directives): a rule condition (responseHeaders / excludedResponseHeaders) skips any CSP containing protective directives such as *-src, base-uri, sandbox or trusted-types, so a site's XSS protection is never removed and such sites stay unembeddable. (4) Only after the user grants the optional twitch.tv permission: the official Twitch embedded player (https://player.twitch.tv/) and chat (https://www.twitch.tv/embed/) send a Content-Security-Policy containing only frame-ancestors, which limits embedding to https sites. The extension page is not https, so a session rule removes that header and X-Frame-Options from those sub-frame responses, only in tabs where the multiview screen is open (limited by tabIds). |
| `contextMenus` | Adds "Add to an empty Hakomado tile" to the right-click menu, shown only on links to YouTube videos/streams, on YouTube watch pages, and on Twitch links and pages (URL patterns cannot tell Twitch channels and VODs from other Twitch pages, so it is shown on all of them and does nothing unless the target is a channel or VOD). It takes the video ID (or the Twitch channel name / VOD number) from the clicked link and passes it to the open multiview screen. The extension does not use the tabs permission and does not read tab URLs or titles. |
| `https://www.youtube.com/*` | Target of the rules above. Content scripts in the embedded watch and live chat frames control playback, volume and audio panning, and read chat messages to show them as scrolling comments. Loads live / upcoming / archived stream lists and video and playlist details with the user's signed-in session, so members-only streams the user can access also work. Only when the user presses "Choose from subscriptions" in the Manage channels screen, reads the user's subscriptions page (`/feed/channels`) with the signed-in session and adds just the channels the user picks to the local channel list. When such channels exist, the "YouTube subscriptions" add-on (on by default) reads the user's subscriptions feed (`/feed/subscriptions`) at most every 2 minutes to learn live and upcoming streams at once, so it fetches far fewer per-channel RSS feeds. Only video IDs, channel IDs and start times are kept locally; nothing is sent elsewhere. |
| `https://schedule.hololive.tv/*` | Loads the stream schedule for the bundled default channels in a single request, which reduces the number of requests made to YouTube. Used by the Holodule add-on, which is on by default and can be turned off under Settings > Add-ons (nothing is loaded from this site while it is off). |
| `activeTab` | Only when the user presses the extension's keyboard shortcut (Alt+Shift+S by default, registered with `commands` and changeable at chrome://extensions/shortcuts) on the extension's own multiview tab: captures that tab with chrome.tabs.captureVisibleTab to take a screenshot of the tiles. The image is cropped to the tiles, saved as a PNG on the user's computer and copied to the clipboard; it is never sent anywhere. Nothing happens on other tabs (such as YouTube pages). |
| `scripting` | Only when the user presses "𝕏 Post" on the share screen: injects a script into the single X post tab that button just opened, and puts the share image into the post box's image input (the same as choosing the image by hand). It never presses Post and is not injected into any other tab or page. Also, for URL tiles, registers `web-site.js` and `content/web-player.js` with chrome.scripting.registerContentScripts only for sites the user has allowed. That script controls the page's main video and, inside the multiview tile only, zooms the page with CSS (transform and clip-path) so that the video area fills the tile, keeping the site's own controls and subtitles over the video; it does not read or send page content. |
| `https://x.com/*` (optional host permission) | Needed for the `scripting` use above. Not requested at install; asked with chrome.permissions.request the first time the user presses "𝕏 Post". Without it, the extension still opens the post screen and copies the image to the clipboard for the user to paste. |
| `identity` (optional permission) | Requested only when the user presses "Choose from follows" under Twitch follows in channel management. Opens Twitch's official authorization page (id.twitch.tv) with chrome.identity.launchWebAuthFlow; when the user signs in and approves, receives an access token limited to the user:read:follows scope. The token is used once to read the followed channels and their icons from Twitch's official API (api.twitch.tv/helix) and is revoked right after (never stored or sent elsewhere). The list is only shown on screen; only the channels the user picks are added to the channel list in the browser. This item stays hidden until the Twitch app (Client ID) is registered. |
| `https://www.nijisanji.jp/*` (optional host permission) | Used only by the NIJISANJI add-on (`addons/nijisanji.js`, off by default) to read the live schedule from the NIJISANJI website (the JSON the site itself uses, `https://www.nijisanji.jp/api/streams?…`), which reduces requests to YouTube for channels added from a NIJISANJI channel pack. The site does not allow CORS, so host access is needed. Not requested at install; asked with chrome.permissions.request when the user turns the add-on on under Settings > Add-ons, and released when it is turned off. Read only; no cookies are sent. |
| `https://www.vspo-schedule.com/*` (optional host permission) | Used only by the VSPO! add-on (`addons/vspo.js`, off by default) to read the stream data embedded in the pages `https://www.vspo-schedule.com/schedule/live` and `/schedule/upcoming` of the VSPO! schedule site (an unofficial fan site), which reduces requests to YouTube for channels added from a VSPO! channel pack. The site does not allow CORS, so host access is needed. Not requested at install; asked with chrome.permissions.request when the user turns the add-on on under Settings > Add-ons, and released when it is turned off. Read only; no cookies are sent. |
| `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/*` (optional host permission) | Used only by the STPR add-on (`addons/stpr.js`, off by default) to read the JSON that the official STPR schedule site (schedule.stpr.com) loads, `https://schedule-share-json.s3.ap-northeast-1.amazonaws.com/schedule/schedule_v2.json`, which reduces requests to YouTube for channels added from an STPR channel pack. Its CORS only allows schedule.stpr.com, so host access is needed. Only that one file is read. Not requested at install; asked with chrome.permissions.request when the user turns the add-on on under Settings > Add-ons, and released when it is turned off. Read only; no cookies are sent. |
| `https://*/*` (optional host permission) | URL tiles: shows a video site's page in a tile and plays, pauses, seeks and mutes the video in it. Nothing is requested at install. When the user enters an https URL in a tile, only that site (`https://*.<domain>/*`: the registered domain of the URL's host, e.g. example.co.jp for live.example.co.jp, and its subdomains; shared hosting domains such as github.io keep the full host name) is requested with chrome.permissions.request. Subdomains are included because video players call other subdomains of the same domain (for example to sign in or check the user's access) with the user's sign-in cookies, and those calls fail as third-party without access. Allowed sites are remembered in chrome.storage.local; when the user revokes a site in Chrome, its script and rule are removed. The extension does not read or send any data from these sites. |
| `https://*.twitch.tv/*` (optional host permission) | (1) Lets a tile show a Twitch live channel or VOD and control it like a YouTube tile. Target of declarativeNetRequest rule (4) above. The official Twitch embedded player (player.twitch.tv) and chat (www.twitch.tv/embed/<channel>/chat) are put in iframes; mute, pause and seek are sent with the same postMessage commands as Twitch's official embed API. For what that API does not offer (playback speed, left/right audio, volume, delay and playback position for archive sync), a content script (content/twitch-player.js, see the content scripts table) is registered in the embedded player only while this permission is granted. For danmaku on live channels, a content script (content/twitch-chat.js) is registered in the official embedded chat; it reads the text, emotes and author names of comments shown there and passes them to the player to scroll across it (comments are neither stored nor sent anywhere). To line up VODs in archive sync, reads the stream start time from the structured data at the top of the VOD's public page (https://www.twitch.tv/videos/<number>) without cookies, once per VOD. (2) For Twitch channels the user added to the channel list, fetches the channel's public page (https://www.twitch.tv/<name>) without cookies and reads the name, icon, whether it is live, the start time, the stream title and recent VODs from the structured data (JSON-LD) at the top of the page, then stops the download. At most once every 2 minutes per channel while the multiview screen is open. The Twitch API is not used. Not requested at install; asked with chrome.permissions.request the first time the user puts a Twitch URL into a tile or adds a Twitch channel (or presses "Show Twitch" on a Twitch tile). Content the user's signed-in Twitch account can watch (such as subscriber-only streams) works as it does on Twitch. |

## 版の履歴 (ストアに出したもの)

| 版 | 日付 | 内容 | 状態 |
| --- | --- | --- | --- |
| 0.2.0 | 2026-11-22 | 初めての提出 (限定公開)。リリース `v0.2.0` の `hakomado-0.2.0-chrome-web-store.zip`。審査に合格したら自動で公開する設定 | 審査中 |
