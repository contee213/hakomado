# Hakomado (Chrome 拡張機能)

拡張機能の本体は `extension/` (Manifest V3)。

`web/` は共有されたセットを集める Web アプリ「Hakomado Feed」(画面の名前は「Hakomado」)(Cloudflare Workers + D1)。拡張機能の `share-code.js`・`layouts.js` をビルドのときに読み込んで使う (詳しくは `web/README.md`)。コードやリンクの形を変えたら `web/` でも読めるかを確かめる。
web/ の機能 (公開範囲・拡張機能の短縮リンク・タグ・検索・消えた動画の見直し・英語の画面) は `web/wrangler.jsonc` の `FEATURES` でオンオフする。拡張機能の短縮リンクは `extension/sets-link.js` の `ENABLED` (オン。送り先は本番の `https://hakomado.contee.net`)。オンオフや送り先を変えるときは `CHROMEWEBSTORE.md` の「短縮リンク」の節に従う。

## Chrome Web Store 情報

- Chrome 拡張機能 (`extension/` 以下、特に `manifest.json` の権限・ホスト権限・content scripts・外部への通信) を変えたら、`CHROMEWEBSTORE.md` も合わせて作成・更新する
- 書式は `chrome-extensions` スキル (Modern Web Guidance) があればそれに従う。権限ごとに、なぜ必要かの理由を必ず書く

## ブラウザでの確認 (Chrome DevTools MCP)

- `.mcp.json` に `chrome-devtools` (chrome-devtools-mcp, `--categoryExtensions --autoConnect`) を入れてある。拡張機能の読み込み・再読み込み、マルチビュー画面・service worker の確認に使う
- `--autoConnect` は普段使っている Chrome のプロファイル (ログイン中の YouTube アカウント) につながる。使う前に Chrome で `chrome://inspect/#remote-debugging` を開き、「Allow remote debugging for this browser instance」をオンにする (ブラウザを起動するたびに必要)
- ログイン中のアカウントで操作するので、コメントの書き込み・設定の変更などアカウントに残る操作はしない
