// E2E テストの共通部分: extension/ を読み込んだ Chromium を、まっさらなプロファイルで起動する。
// - テストごとに新しいプロファイルなので、毎回「インストール直後」から始まる (ふだんの Chrome・YouTube アカウントには触れない)
// - 外への通信 (YouTube・GitHub など) はページからのものを全部止める。結果がネットの状態や YouTube の変更に左右されないように
// - ページの JavaScript のエラーは集めておき、テストの最後に無いことを確かめる
const path = require('node:path');
const { test: base, chromium, expect } = require('@playwright/test');

const EXTENSION = path.join(__dirname, '..', 'extension');

// 通信を止めたことで出るコンソールのエラーは、拡張機能の不具合ではないので数えない
const IGNORED_CONSOLE = [/Failed to load resource/, /net::ERR_/];

const test = base.extend({
  /** 読み込む拡張機能のフォルダ (ふだんは extension/。リリース版のビルドを試すときは test.use で差し替える。HAKO-51) */
  extensionPath: [EXTENSION, { option: true }],

  context: async ({ extensionPath }, use) => {
    const context = await chromium.launchPersistentContext('', {
      // 拡張機能はヘッドレスでも読み込める (同梱の Chromium の新しいヘッドレス)。
      // 同梱の Chromium が動かない環境では E2E_CHANNEL=msedge などで差し替える (市販版の Chrome は --load-extension を無視するので不可)
      channel: process.env.E2E_CHANNEL || 'chromium',
      locale: 'ja-JP',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route(/^https?:/, (route) => route.abort());
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  /** ページのエラー (例外・console.error)。テストの最後に空であることを確かめる */
  pageErrors: async ({ context }, use) => {
    const errors = [];
    const watch = (page) => {
      page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (!IGNORED_CONSOLE.some((re) => re.test(text))) errors.push(`${page.url()}: ${text}`);
      });
    };
    context.pages().forEach(watch);
    context.on('page', watch);
    await use(errors);
    expect(errors, 'ページで JavaScript のエラーが出ていないこと').toEqual([]);
  },

  /** マルチビュー画面 (grid.html) を開く関数 */
  openGrid: async ({ context, extensionId, pageErrors }, use) => {
    void pageErrors; // エラーの記録を先に始めておく
    await use(async (hash = '') => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/grid.html${hash}`);
      await expect(page.locator('#grid .tile').first()).toBeAttached();
      return page;
    });
  },
});

/** 表示されている枠 (hidden でないもの) */
const visibleTiles = (page) => page.locator('#grid .tile:not([hidden])');

/** ツアーが出ていたら閉じる (Esc) */
async function skipTour(page) {
  const tour = page.locator('.tour');
  await expect(tour).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
}

module.exports = { test, expect, visibleTiles, skipTour };
