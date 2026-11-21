// E2E テスト (e2e/) の設定。npm run test:e2e で実行する。単体テスト (tests/, npm test) とは別
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  // テストごとにブラウザを 1 つ起動する (プロファイルを分けるため)。CI では並べすぎない
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
