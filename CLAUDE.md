# Hakomado (Chrome 拡張機能)

拡張機能の本体は `extension/` (Manifest V3)。

## Chrome Web Store 情報

- Chrome 拡張機能 (`extension/` 以下、特に `manifest.json` の権限・ホスト権限・content scripts・外部への通信) を変えたら、`CHROMEWEBSTORE.md` も合わせて作成・更新する
- 書式は `chrome-extensions` スキル (Modern Web Guidance) があればそれに従う。権限ごとに、なぜ必要かの理由を必ず書く

## ブラウザでの確認 (Chrome DevTools MCP)

- `.mcp.json` に `chrome-devtools` (chrome-devtools-mcp, `--categoryExtensions --autoConnect`) を入れてある。拡張機能の読み込み・再読み込み、マルチビュー画面・service worker の確認に使う
- `--autoConnect` は普段使っている Chrome のプロファイル (ログイン中の YouTube アカウント) につながる。使う前に Chrome で `chrome://inspect/#remote-debugging` を開き、「Allow remote debugging for this browser instance」をオンにする (ブラウザを起動するたびに必要)
- ログイン中のアカウントで操作するので、コメントの書き込み・設定の変更などアカウントに残る操作はしない
