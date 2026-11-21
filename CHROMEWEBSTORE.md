# Chrome Web Store 掲載情報

Chrome ウェブストアのデベロッパー ダッシュボードに入れる内容の控えです。
今はストアに公開していません (GitHub のリリースから開発者モードで読み込む配布) が、
権限の理由をいつでも説明できるように、拡張機能を変えたらここも合わせて直します。

- 対象バージョン: 0.2.0 (`extension/manifest.json`)
- 最低 Chrome バージョン: 128 (Manifest V3)

## 拡張機能の ID

- GitHub のリリースの ZIP は、`manifest.json` に `"key"` (公開鍵 `tools/release-key.pub`) を入れて ID を `lhafnnpnfpgogdbapeepkgohemnnifpp` に固定している
  (`.github/workflows/release.yml` が ZIP を作るときに `tools/release-key.js` で差し込む。リポジトリの `extension/manifest.json` には入れない)
- ストアに上げるパッケージには `"key"` を入れない (ストアが自分の鍵で ID を決める)。ストア版と ZIP 版の ID をそろえたいときは、
  ダッシュボードの「パッケージ」→「公開鍵を表示」の鍵を `tools/release-key.pub` に入れ替える (`tests/release-key.test.js` の ID も直す)

## ストアの掲載情報

- 名前: Hakomado
- 概要 (short description): YouTube の配信を 1 画面で最大 16 枠並べて同時視聴する (`_locales/*/messages.json` の `extDescription`)
- カテゴリ: エンターテイメント
- 言語: 日本語 / 英語 (既定は英語 `default_locale: en`)

## 単一用途 (Single purpose)

YouTube の複数の配信・動画を 1 つの画面に並べて同時に視聴し、各枠のライブチャットを表示・書き込みできるようにする。

## 権限と理由

| 権限 | 理由 |
| --- | --- |
| `storage` | 枠の並び・レイアウト・チャンネル一覧・視聴履歴・再生リスト・設定を `chrome.storage.local` に保存する。マルチビュー画面を開いているタブの一覧を `chrome.storage.session` に一時保存する。外部のサーバーには送らない |
| `declarativeNetRequestWithHostAccess` | (1) マルチビュー画面のタブの中だけで、`www.youtube.com/watch` と `www.youtube.com/live_chat` の iframe 応答から `X-Frame-Options` ヘッダーを外し、拡張機能のページに YouTube のプレイヤーとチャットを埋め込めるようにする (セッションルール。`tabIds` で対象タブを限定し、CSP など他のヘッダーは触らない)。(2) `hakomado=` 付きの `https://www.youtube.com/watch_videos?…` (再生リストの共有リンク) だけを拡張機能内の取り込み画面へ転送する (動的ルール) |
| `contextMenus` | 右クリックのメニュー「Hakomado の空き枠に追加」を出す。YouTube の動画・配信へのリンク (`targetUrlPatterns` で watch / live / shorts / youtu.be に限定) と、YouTube の視聴ページ (`documentUrlPatterns`) でだけ表示する。押したときにリンクの URL から動画 ID を取り出し、開いているマルチビュー画面に渡す (画面が無ければ新しいタブで開く)。`tabs` 権限は使わず、タブの URL・タイトルは読まない |
| ホスト権限 `https://www.youtube.com/*` | 上の declarativeNetRequest ルールの適用先。視聴ページ / ライブチャットに content script を入れて、プレイヤーの操作・弾幕用のチャット取得・同期再生を行う。ログイン中のアカウントで配信中 / 予定 / アーカイブの一覧、動画・再生リストの情報を取得する (メンバー限定配信も見られるようにするため Cookie 付き) |
| ホスト権限 `https://schedule.hololive.tv/*` | 初期データのホロライブのチャンネルについて、配信予定 (ホロジュール) をまとめて 1 回で取得し、YouTube への問い合わせ回数を減らす |

### content scripts

| 対象 | ファイル | 用途 |
| --- | --- | --- |
| `https://www.youtube.com/live_chat*` (全フレーム) | `content/chat.js` | チャットのメッセージを読み取り、弾幕として親ページに渡す |
| `https://www.youtube.com/watch*` (全フレーム) | `content/watch.js`, `content/watch.css` | 枠の中のプレイヤーの見た目を整え、再生状態をマルチビュー画面とやり取りする。利用者が枠の音の左右・音量を変えたときだけ、その枠の中で Web Audio (StereoPanner・Gain) に通す (音声はブラウザの中で処理するだけで、録音・送信はしない) |
| `https://www.youtube.com/watch*` (全フレーム, MAIN world) | `content/watch-main.js` | ページ側のプレイヤー API (再生位置・音量など) を呼ぶ |
| `https://www.youtube.com/hakomado_import*` | `content/import.js` | 取り込み用リンクから転送されたときに、マルチビュー画面の「📥 読み込む」へ切り替える |

## リモートコード

使っていない。読み込むスクリプトはすべてパッケージ内 (`extension/vendor/` の jsQR・qrcode-generator も同梱)。

## 外部への通信

| 宛先 | 内容 |
| --- | --- |
| `www.youtube.com` / `i.ytimg.com` | 配信・動画の情報とサムネイル (上記) |
| `schedule.hololive.tv` | ホロライブの配信予定 |
| `api.github.com` | 新しい版が出ていないかの確認 (1 日 1 回まで。ストア版 = `update_url` がある場合は行わない)。Cookie は送らない |
| `raw.githubusercontent.com` | 「パックを探す」を押したときだけ、リポジトリの `packs/index.json` (パックの一覧) と、選んだパックを取得する。CORS で読めるので host 権限は使わない。Cookie は送らない |
| 利用者が指定した https の URL | チャンネルパックの読み込み、ドラッグした画像 (QR コード読み取り) の取得。Cookie は送らない |

## データの取り扱い (プライバシー)

- 収集する利用者データ: なし (開発者のサーバーは無い)
- 保存はすべてブラウザ内 (`chrome.storage`)。バックアップは利用者が自分でファイルに書き出す
- 「ウェブ履歴」に当たるもの: 視聴履歴をローカルにのみ保存。外部へ送信・販売・譲渡しない
