// リリース版 (node tools/build.js。アーカイブ同期のコードを抜いたもの。HAKO-51) を読み込んで、マルチビュー画面を確かめる。
// ビルドはワーカーごとに一時フォルダへ作る (ワーカーは別々のプロセスで、このファイルをそれぞれ読み込むため)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, skipTour } = require('./fixtures');
const { build } = require('../tools/build');

const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hakomado-e2e-release-')), 'hakomado');
build({ out: OUT });

test.use({ extensionPath: OUT });

test.afterAll(() => fs.rmSync(path.dirname(OUT), { recursive: true, force: true }));

test.describe('リリース版のビルド (同期なし)', () => {
  test('マルチビュー画面がエラーなく開き、同期の入口が無い', async ({ openGrid }) => {
    const page = await openGrid();
    // ようこそに「⏱ コラボを同時視聴」を出さない
    await expect(page.locator('.tour-uses li')).toHaveCount(2);
    await skipTour(page);
    // 同期にしてある再生リストも、同期再生としては扱わない
    expect(await page.evaluate(() => plSynced({ sync: true }))).toBe(false);
    // 同期のコードが入っていない
    expect(await page.evaluate(() => [typeof WaveStrip, typeof Waves, typeof SyncGroups, typeof AudioAlign])).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
    await expect(page.locator('#syncToggle')).toBeHidden();
    await expect(page.locator('#syncBar')).toBeHidden();
    expect(await page.evaluate(() => [...document.querySelectorAll('[data-help="sync"]')].every((b) => b.hidden))).toBe(true);
    await expect(page.locator('body')).toHaveClass(/\bsync-off\b/);
    // 設定の「実験的な機能」が出ない
    await page.locator('#openSettings').click();
    await page.locator('#settings [data-tab="view"]').click();
    await expect(page.locator('#verticalLiveFit')).toBeVisible();
    await expect(page.locator('#expSync')).toBeHidden();
  });

  test('保存の値 expSync を true にしても、同期は出ず、始まらない', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.evaluate(async () => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, expSync: true } });
    });
    const again = await openGrid();
    await expect(again.locator('#grid .tile:not([hidden])').first()).toBeVisible();
    await expect(again.locator('#syncToggle')).toBeHidden();
    const r = await again.evaluate(() => {
      Sync.startWhenReady([0, 1], 0, {});
      return new Promise((res) => setTimeout(() => res([Sync.enabled(), Sync.isOn()]), 200));
    });
    expect(r).toEqual([false, false]);
  });
});
