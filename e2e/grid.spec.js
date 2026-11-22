// マルチビュー画面 (grid.html) の E2E テスト。拡張機能の中だけで完結する操作を、本物の Chromium で確かめる。
// YouTube の中で動く部分 (content/・プレイヤー・ライブチャット) は扱わない (tests/MANUAL.md の手順で手で確かめる)
const { test, expect, visibleTiles, skipTour } = require('./fixtures');

test.describe('インストール直後', () => {
  test('最初に開いたときだけ使い方ツアーが出る', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);

    // もう一度開いても出ない (印はインストールのときに 1 回だけ立つ)
    const again = await openGrid();
    await expect(again.locator('#grid .tile:not([hidden])').first()).toBeVisible();
    await expect(again.locator('.tour')).toHaveCount(0);
  });

  test('ツアーを最後まで進められる', async ({ openGrid }) => {
    const page = await openGrid();
    const tour = page.locator('.tour');
    await expect(tour).toBeVisible();
    // 最後の一歩は自動再生のボタンを押してもらうので、そこまで「次へ」で進んでから Esc で閉じる
    for (let n = 0; n < 6; n++) await page.keyboard.press('ArrowRight');
    await expect(tour).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
  });

  test('枠が出ていて、どの枠も空', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const tiles = visibleTiles(page);
    expect(await tiles.count()).toBeGreaterThan(0);
    await expect(tiles.locator('.url-input').first()).toBeVisible();
    await expect(page.locator('#layoutName')).not.toBeEmpty();
  });
});

test.describe('ツールバー', () => {
  test('＋ / − で枠が増え、減る', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const tiles = visibleTiles(page);
    const before = await tiles.count();

    await page.locator('#addTile').click();
    await expect.poll(() => tiles.count()).toBeGreaterThan(before);
    const added = await tiles.count();

    await page.locator('#removeTile').click();
    await expect.poll(() => tiles.count()).toBeLessThan(added);
  });

  test('レイアウトを選ぶと切り替わり、画面が閉じる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const picker = page.locator('#layoutPicker');

    await page.locator('#openLayout').click();
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();

    // 今と違うレイアウトを 1 つ選ぶ
    await page.locator('#openLayout').click();
    const other = picker.locator('.layout-option:not(.current)').last();
    const name = await other.locator('.layout-name').textContent();
    await other.click();
    await expect(picker).toBeHidden();
    await expect(page.locator('#layoutName')).toHaveText(name);
    await page.locator('#openLayout').click();
    await expect(picker.locator('.layout-option.current .layout-name')).toHaveText(name);
  });

  // ボタン → 開くダイアログ。開いて Esc で閉じられること
  const DIALOGS = [
    ['openSettings', '#settings'],
    ['openHelp', '#help'],
    ['openChannels', '#favorites'],
    ['openFavorites', '#favorites'],
    ['openShare', '#shareDialog'],
    ['openRead', '#readDialog'],
    ['openNotices', '#notices'],
  ];
  for (const [button, dialog] of DIALOGS) {
    test(`#${button} で ${dialog} が開き、Esc で閉じる`, async ({ openGrid }) => {
      const page = await openGrid();
      await skipTour(page);
      await page.locator(`#${button}`).click();
      await expect(page.locator(dialog)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(dialog)).toBeHidden();
    });
  }

  test('使い方 (?) からツアーをもう一度見られる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.locator('#openHelp').click();
    await page.locator('#tourReplay').click();
    await expect(page.locator('#help')).toBeHidden();
    await skipTour(page);
  });
});

test.describe('視聴セッション', () => {
  test('配信を入れた枠は、閉じて開き直すと再開を聞かれる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    // 保存されるのを待つ
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const all = await chrome.storage.local.get(null);
          return JSON.stringify(all).includes('dQw4w9WgXcQ');
        }),
      )
      .toBe(true);
    await page.close();

    const next = await openGrid();
    const start = next.locator('#startDialog');
    await expect(start).toBeVisible();
    await expect(start).toContainText('dQw4w9WgXcQ');
    // 「続きから」を選ぶと、その配信が枠に入っている
    await start.locator('#startChoices button').first().click();
    await expect(start).toBeHidden();
    await expect(visibleTiles(next).first().locator('.url-input')).toHaveValue('dQw4w9WgXcQ');
  });

  test('2 つ目のタブは別の視聴セッションになる (同じものを取り合わない)', async ({ openGrid }) => {
    const first = await openGrid();
    await skipTour(first);
    const input = visibleTiles(first).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');

    // 1 つ目が開いたままなら、再開の確認は出さずに新しく始める
    const second = await openGrid();
    await expect(visibleTiles(second).first().locator('.url-input')).toHaveValue('');
    await expect(second.locator('#startDialog')).toBeHidden();
  });
});

test.describe('共有', () => {
  test('短縮リンク (sets-link.js の機能フラグ) は既定でオフで、画面に出ない', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    expect(await page.evaluate(() => SetsLink.enabled)).toBe(false);
    await page.locator('#openShare').click();
    await page.locator('#shareDialog [data-stab="link"]').click();
    await expect(page.locator('#shareShortMake')).toBeHidden();
    await page.locator('#shareDialog [data-stab="image"]').click();
    await expect(page.locator('#shareImgShort')).toBeHidden();
  });

  test('画像の各枠の名前は既定で入れず、切り替えると作り直して、次に開いたときも覚えている', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    await page.locator('#openShare').click();
    await page.locator('#shareDialog [data-stab="image"]').click();
    const labels = page.locator('#shareImgLabels');
    const img = page.locator('#shareImg');
    await expect(labels).not.toBeChecked();
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('#shareToX')).toBeEnabled();
    const before = await img.getAttribute('src');
    await labels.check();
    await expect(img).not.toHaveAttribute('src', before);
    await expect(img).toHaveAttribute('src', /^blob:/);
    // 別のタブで開いても覚えている (ツアーは最初の 1 回だけ)
    const second = await openGrid();
    await second.locator('#openShare').click();
    await expect(second.locator('#shareImgLabels')).toBeChecked();
  });

  test('作者名を入れると画像を作り直し、次に開いたときも残っている', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    await page.locator('#openShare').click();
    await page.locator('#shareDialog [data-stab="image"]').click();
    const img = page.locator('#shareImg');
    await expect(img).toHaveAttribute('src', /^blob:/);
    const before = await img.getAttribute('src');
    await page.locator('#shareAuthor').fill('@someone');
    await expect(img).not.toHaveAttribute('src', before);
    await expect(img).toHaveAttribute('src', /^blob:/);
    const second = await openGrid();
    await second.locator('#openShare').click();
    await expect(second.locator('#shareAuthor')).toHaveValue('@someone');
  });
});
