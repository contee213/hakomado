# Hakomado (Chrome 拡張機能)

拡張機能の本体は `extension/` (Manifest V3)。

`web/` は共有されたセットを集める Web アプリ「Hakomado Feed」(画面の名前は「Hakomado」)(Cloudflare Workers + D1)。拡張機能の `share-code.js`・`layouts.js` をビルドのときに読み込んで使う (詳しくは `web/README.md`)。コードやリンクの形を変えたら `web/` でも読めるかを確かめる。
web/ の機能 (公開範囲・タグ・検索・消えた動画の見直し・英語の画面) は `web/wrangler.jsonc` の `FEATURES` でオンオフする。拡張機能は Feed と通信しない (短縮リンクは 2026-11-24 にやめた)。共有画面の「📮 サイトに投稿」は Feed の `/post#text=<コード>` をタブで開くだけ。

## 設計の文書 (改修したら必ず更新する)

画面の見た目・動き・言葉は `docs/design-guide.md` (デザインガイド) の決まりに合わせる。決まりに無いことを新しく決めたときは、ユーザーに確かめてからガイドに足す。

拡張機能 (`extension/`) を改修したら、同じ PR で次の文書も直す。直すところが無ければ、PR の本文にそう書く。

- **画面遷移図** `docs/screen-flow.md`: 画面・ダイアログの開き方、入口、遷移の条件が変わったとき
- **画面項目表・画面項目状態表** `docs/screen-items/`: 項目 (ボタン・入力・表示) を足す・消す・文言や動きを変えたとき、出る条件や押せる条件が変わったとき
- **データの入出力** `docs/data-io.md`: 保存するもの (キー・上限・バックアップに入るか)、ファイルやコードでの出し入れ、外との通信、権限が変わったとき
- **UI の不揃いの一覧** `docs/ui-consistency.md`: 一覧の項目を直したら状態を「済 (#PR)」にする。新しく不揃いを作ってしまったら足す

## Chrome Web Store 情報

- Chrome 拡張機能 (`extension/` 以下、特に `manifest.json` の権限・ホスト権限・content scripts・外部への通信) を変えたら、`CHROMEWEBSTORE.md` も合わせて作成・更新する
- 書式は `chrome-extensions` スキル (Modern Web Guidance) があればそれに従う。権限ごとに、なぜ必要かの理由を必ず書く

## ブラウザでの確認 (Chrome DevTools MCP)

- `.mcp.json` に `chrome-devtools` (chrome-devtools-mcp, `--categoryExtensions --autoConnect`) を入れてある。拡張機能の読み込み・再読み込み、マルチビュー画面・service worker の確認に使う
- `--autoConnect` は普段使っている Chrome のプロファイル (ログイン中の YouTube アカウント) につながる。使う前に Chrome で `chrome://inspect/#remote-debugging` を開き、「Allow remote debugging for this browser instance」をオンにする (ブラウザを起動するたびに必要)
- ログイン中のアカウントで操作するので、コメントの書き込み・設定の変更などアカウントに残る操作はしない
