// service worker (background.js) の E2E テスト。YouTube を枠に入れるためのヘッダー書き換えが、
// マルチビュー画面のタブだけに効き、タブを閉じれば外れることを確かめる (他のサイトに影響させないための大事な決まり)
const { test, expect } = require('./fixtures');

const sessionRules = (worker) => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
const tabIdOf = (page) => page.evaluate(() => chrome.tabs.getCurrent().then((t) => t.id));

test('インストールで、取り込み用リンクのルールとツアーの印ができる',async ({ serviceWorker }) => {
  await expect
    .poll(() => serviceWorker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.map((x) => x.id))))
    .toContain(10);
  const { tourPending } = await serviceWorker.evaluate(() => chrome.storage.local.get('tourPending'));
  expect(tourPending).toBe(true);
});

test('ヘッダー書き換えはマルチビュー画面のタブだけに効き、閉じると外れる', async ({ openGrid, serviceWorker }) => {
  expect(await sessionRules(serviceWorker)).toEqual([]);

  const a = await openGrid();
  const b = await openGrid();
  const ids = [await tabIdOf(a), await tabIdOf(b)].sort();

  await expect
    .poll(async () => (await sessionRules(serviceWorker)).map((r) => [...r.condition.tabIds].sort()))
    .toEqual([ids, ids]);
  for (const rule of await sessionRules(serviceWorker)) {
    expect(rule.condition.resourceTypes).toEqual(['sub_frame']);
    expect(rule.action.responseHeaders).toEqual([{ header: 'x-frame-options', operation: 'remove' }]);
  }

  // 片方を閉じると、残ったタブだけになる
  const bId = await tabIdOf(b);
  await a.close();
  await expect.poll(async () => (await sessionRules(serviceWorker)).map((r) => r.condition.tabIds)).toEqual([[bId], [bId]]);

  await b.close();
  await expect.poll(() => sessionRules(serviceWorker)).toEqual([]);
});
