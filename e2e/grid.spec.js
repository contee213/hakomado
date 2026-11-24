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

  test('使い方・設定の下の版にビルド番号が出る (拡張機能の版はリリースの version だけ)', async ({ openGrid, serviceWorker }) => {
    const page = await openGrid();
    await skipTour(page);
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.version_name).toBeUndefined();
    const text = await page.locator('.app-version').first().textContent();
    expect(text).toMatch(new RegExp(`^Hakomado ${manifest.version.replace(/\./g, '\\.')} · build \\d+ \\(\\d{4}-\\d{2}-\\d{2}\\)$`));
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

  test('縦長のレイアウト: 枠が 9:16 になり、＋・− でも縦長のまま', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const picker = page.locator('#layoutPicker');
    await page.locator('#openLayout').click();
    await picker.locator('[data-tab="vertical"]').click();
    await expect(picker.locator('.layout-option')).toHaveCount(9);
    await picker.locator('.layout-option[data-id="v1x3"]').click();
    await expect(page.locator('#layoutName')).toHaveText('▯1×3');

    const ratios = () =>
      page.locator('#grid .tile:not([hidden])').evaluateAll((els) => els.map((e) => e.offsetWidth / e.offsetHeight));
    const r = await ratios();
    expect(r).toHaveLength(3);
    for (const v of r) expect(Math.abs(v - 9 / 16)).toBeLessThan(0.02);

    await page.locator('#addTile').click();
    await expect(page.locator('#layoutName')).toHaveText('▯1×4');
    await page.locator('#removeTile').click();
    await expect(page.locator('#layoutName')).toHaveText('▯1×3');
  });

  // ボタン → 開くダイアログ。開いて Esc で閉じられること
  const DIALOGS = [
    ['openSettings', '#settings'],
    ['openHelp', '#help'],
    ['openChannels', '#favorites'],
    ['openFavorites', '#favorites'],
    ['openShare', '#xferDialog #sharePane'],
    ['openRead', '#xferDialog #readPane'],
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

  // 設定のタブ → 「? 詳しい説明」で開く使い方の項目 (どのタブからも「はじめに」以外の、そのタブの説明が開く)
  const HELP_OF_SETTINGS_TAB = [
    ['danmaku', 'look'],
    ['audio', 'look'],
    ['chat', 'look'],
    ['view', 'tiles'],
    ['auto', 'auto'],
    ['channels', 'channels'],
    ['addons', 'channels'],
    ['backup', 'backup'],
  ];
  test('設定の「? 詳しい説明」は、開いているタブの説明を使い方で開く', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.locator('#openSettings').click();
    for (const [tab, help] of HELP_OF_SETTINGS_TAB) {
      await page.locator(`#settings [data-tab="${tab}"]`).click();
      await page.locator('#settingsHelp').click();
      await expect(page.locator(`#help [data-help-page="${help}"]`), `設定の ${tab} タブ`).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#help')).toBeHidden();
    }
  });

  test('設定を「すべて初期値に戻す」と、OFF に戻ったアドオンの任意の権限を手放し、必須の権限は手放さない', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    // にじさんじ (任意の権限・初期値 OFF) を ON にしておく。権限の取り外しは記録するだけにする
    await page.evaluate(() => {
      state.settings.addons = Addons.withState(state.settings.addons, 'nijisanji', true);
      Addons.setStates(state.settings.addons);
      window.__removed = [];
      chrome.permissions.remove = async ({ origins }) => (window.__removed.push(...origins), true);
    });
    page.once('dialog', (d) => d.accept());
    await page.locator('#openSettings').click();
    await page.locator('#settings [data-tab="backup"]').click();
    await page.locator('#settingsReset').click();
    await expect.poll(() => page.evaluate(() => window.__removed)).toEqual(['https://www.nijisanji.jp/*']);
    expect(await page.evaluate(() => Addons.isOn('nijisanji'))).toBe(false);
  });
});

test.describe('空き枠', () => {
  test('幅の狭い空き枠では、「📚 ライブラリから選ぶ」が 📚 のアイコンだけになる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.setViewportSize({ width: 480, height: 600 });
    // 枠を足して、どの枠も幅 260px 以下にする
    for (let n = 0; n < 3; n++) await page.locator('#addTile').click();
    const tile = visibleTiles(page).first();
    await expect.poll(() => tile.evaluate((el) => el.querySelector('.stage').offsetWidth)).toBeLessThanOrEqual(260);
    const icon = (sel) => tile.locator(sel).evaluate((el) => getComputedStyle(el, '::before').content);
    await expect.poll(() => icon('.pick-fav')).toBe('"📚"');
  });
});

test.describe('視聴セッション', () => {
  test('再生速度: 枠の 1× で選び、< > キーで 1 段ずつ変え、上部バーの ⏩ でまとめて変える', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const tile = visibleTiles(page).first();
    const input = tile.locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    const btn = tile.locator('.bar [data-act="speed"]');
    const all = page.locator('#speedAll');
    const menu = page.locator('#speedMenu');
    await expect(btn).toHaveText('1×');
    await expect(all.locator('.tb-label')).toHaveText('1×');

    await tile.hover();
    await btn.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('.speed-head')).toContainText('枠 1');
    await menu.locator('button[data-speed="1.5"]').click();
    await expect(menu).toBeHidden();
    await expect(btn).toHaveText('1.5×');
    await expect(all.locator('.tb-label')).toHaveText('1.5×');

    // 音の出ている枠 (読み込んだ枠) を 1 段ずつ
    await page.mouse.move(0, 0);
    await page.keyboard.press('<');
    await expect(btn).toHaveText('1.25×');
    await page.keyboard.press('>');
    await page.keyboard.press('>');
    await expect(btn).toHaveText('1.75×');

    await all.click();
    await expect(menu.locator('.speed-head')).toHaveText('全部の枠の再生速度');
    await menu.locator('button[data-speed="0.5"]').click();
    await expect(btn).toHaveText('0.5×');
    // 視聴セッションに残る
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const all = await chrome.storage.local.get(null);
          return Object.values(all).some((v) => v?.tiles?.some?.((t) => t.videoId === 'dQw4w9WgXcQ' && t.speed === 0.5));
        }),
      )
      .toBe(true);
  });

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

  test('開き直したときの「読み込んで始める」は、空の枠で始めて 📥 読み込むの側を開く', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    await expect
      .poll(() => page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)).includes('dQw4w9WgXcQ')))
      .toBe(true);
    await page.close();

    const next = await openGrid();
    const start = next.locator('#startDialog');
    await expect(start).toBeVisible();
    await start.locator('#startChoices button[value="read"]').click();
    await expect(start).toBeHidden();
    await expect(next.locator('#readPane')).toBeVisible();
    await expect(next.locator('#readIn')).toBeFocused();
    await expect(visibleTiles(next).first().locator('.url-input')).toHaveValue('');
  });

  // 取り込み用リンク (background.js が #import=<watch_videos のクエリ> に付け替えて開く)
  const IMPORT_HASH = `#import=${encodeURIComponent('video_ids=dQw4w9WgXcQ,9bZkp7q5f_w&hakomado=テスト')}`;

  test('取り込み用リンクで開いて「読み込んで始める」を選んでも、リンクの中身と保存の主ボタンのまま', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    await expect
      .poll(() => page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)).includes('dQw4w9WgXcQ')))
      .toBe(true);
    await page.close();

    const next = await openGrid(IMPORT_HASH);
    const start = next.locator('#startDialog');
    await expect(start).toBeVisible();
    await start.locator('#startChoices button[value="read"]').click();
    await expect(next.locator('#readPane')).toBeVisible();
    await expect(next.locator('#readSummary')).toContainText('2 本を受け取りました');
    await expect(next.locator('#readSave')).toHaveClass(/primary-action/);
    await expect(next.locator('#readApply')).not.toHaveClass(/primary-action/);
  });

  test('インストール直後に取り込み用リンクで開くと、読み込む画面を閉じてから使い方ツアーが出る', async ({ openGrid }) => {
    const page = await openGrid(IMPORT_HASH);
    await expect(page.locator('#readPane')).toBeVisible();
    await expect(page.locator('#readSummary')).toContainText('2 本を受け取りました');
    // 読み込む画面 (モーダル) の後ろでは押せないので、まだ出さない
    await page.waitForTimeout(500);
    await expect(page.locator('.tour')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#xferDialog')).toBeHidden();
    await skipTour(page);
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
  const SHARE_RENDER_MS = 15000;

  test('画像の各枠の名前は既定で入れず、切り替えると作り直して、次に開いたときも覚えている', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    await page.locator('#openShare').click();
    await page.locator('#xferDialog [data-stab="image"]').click();
    const labels = page.locator('#shareImgLabels');
    const img = page.locator('#shareImg');
    await expect(labels).not.toBeChecked();
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('#shareToX')).toBeEnabled();
    const before = await img.getAttribute('src');
    await labels.check();
    // 画像を作るのは CI の遅いマシンでは 5 秒近くかかることがある (配信状況の確認の通信が重なると、PNG にするのが後回しになる)
    await expect(img).not.toHaveAttribute('src', before, { timeout: SHARE_RENDER_MS });
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
    await page.locator('#xferDialog [data-stab="image"]').click();
    const img = page.locator('#shareImg');
    await expect(img).toHaveAttribute('src', /^blob:/);
    const before = await img.getAttribute('src');
    await page.locator('#shareAuthor').fill('@someone');
    // 画像を作るのは CI の遅いマシンでは 5 秒近くかかることがある (配信状況の確認の通信が重なると、PNG にするのが後回しになる)
    await expect(img).not.toHaveAttribute('src', before, { timeout: SHARE_RENDER_MS });
    await expect(img).toHaveAttribute('src', /^blob:/);
    const second = await openGrid();
    await second.locator('#openShare').click();
    await expect(second.locator('#shareAuthor')).toHaveValue('@someone');
  });

  test('共有と読み込むは同じ画面の 2 つの側: 🔗 と 📥 でそれぞれの側が開き、上の 2 択で切り替えられる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const share = page.locator('#sharePane');
    const read = page.locator('#readPane');
    await page.locator('#openRead').click();
    await expect(read).toBeVisible();
    await expect(share).toBeHidden();
    await page.locator('#xferDialog [data-xfer="share"]').click();
    await expect(share).toBeVisible();
    await expect(read).toBeHidden();
    await expect(page.locator('#xferDialog [data-xfer="share"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#xferDialog [data-xfer="read"]').click();
    await expect(read).toBeVisible();
    await expect(page.locator('#readIn')).toBeFocused();
    // 左上は動かない (側を変えて高さが変わっても)
    const box1 = await page.locator('#xferDialog').boundingBox();
    await page.locator('#xferDialog [data-xfer="share"]').click();
    const box2 = await page.locator('#xferDialog').boundingBox();
    expect([box2.x, box2.y]).toEqual([box1.x, box1.y]);
  });

  test('共有画面は 画像・リンク・テキスト の 3 タブ。リンクは QR と同じ形 (レイアウト入り)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    await page.locator('#openShare').click();
    await expect(page.locator('#xferDialog [data-stab]')).toHaveText(['🖼 画像', '🌐 リンク', '📝 テキスト']);
    await page.locator('#xferDialog [data-stab="link"]').click();
    await expect(page.locator('#shareLink')).toHaveValue(/^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=dQw4w9WgXcQ&hkl=u2x2&title=.+&hakomado=0$/);
  });

  test('「サイトに投稿」はコードを # の後ろに入れた投稿画面をタブで開くだけで、拡張機能からは送らない', async ({ openGrid, context }) => {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    // サイトへの通信は止めずに、記録して空のページを返す (後から足した route が先に効く)
    const sent = [];
    await context.route('https://hakomado.contee.net/**', (route) => {
      sent.push(`${route.request().method()} ${route.request().url()}`);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>feed</title>' });
    });
    await page.locator('#openShare').click();
    const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('#shareToFeed').click()]);
    await tab.waitForLoadState();
    const url = new URL(tab.url());
    expect(url.origin + url.pathname).toBe('https://hakomado.contee.net/post');
    expect(decodeURIComponent(url.hash)).toBe('#text=#Hakomado u2x2.dQw4w9WgXcQ');
    // 開いたタブがページを読みに行くだけ (# の後ろは送られない)。POST はしない
    expect(sent).toEqual(['GET https://hakomado.contee.net/post']);
  });
});

test.describe('ライブラリの複数選択', () => {
  // 既定のチャンネル (ときのそら・ロボ子さん) どうしのコラボ 2 本と、関係の無い 1 本
  const SORA = 'UCp6993wxpyDPHUpavwDFqgg';
  const ROBO = 'UCDqI2jOz0weumE8s7paEk6g';
  const now = Date.now();
  const HISTORY = [
    { videoId: 'aaaaaaaaaa1', title: '【マイクラ】ロボ子さんと建築するよ！', channelId: SORA, label: 'ときのそら', at: now },
    { videoId: 'bbbbbbbbbb2', title: '【マイクラ】そらちゃんと建築！', channelId: ROBO, label: 'ロボ子さん', at: now - 60e3 },
    { videoId: 'ccccccccccc', title: '朝の雑談', channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz', label: 'ほかの人', at: now - 5 * 86400e3 },
  ];

  async function openHistory(page) {
    await page.evaluate((h) => chrome.storage.local.set({ history: h }), HISTORY);
    await page.locator('#openFavorites').click();
    await page.locator('[data-favtab="history"]').click();
    await expect(page.locator('#favList .fav-item')).toHaveCount(3);
  }

  test('🤝 でコラボをまとめて選び、☐ で足して、まとめて枠に入れる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await openHistory(page);
    const collab = page.locator('#favList .fav-collab');
    await expect(collab).toHaveCount(2);
    await expect(collab.first()).toHaveText('🤝 2');
    await collab.first().click();
    await expect(page.locator('#favSelBar')).toBeVisible();
    await expect(page.locator('#favSelCount')).toHaveText('2 本を選択中');
    // 選んでいる間は、行のクリックも選ぶ (枠には入れない)
    await page.locator('#favList .fav-item[data-sel="ccccccccccc"] .fav-title').click();
    await expect(page.locator('#favSelCount')).toHaveText('3 本を選択中');
    await page.locator('#favSelLoad').click();
    await expect(page.locator('#favorites')).toBeHidden();
    const ids = await visibleTiles(page).locator('.url-input').evaluateAll((els) => els.map((e) => e.value).join(' '));
    for (const h of HISTORY) expect(ids).toContain(h.videoId);
  });

  test('🔖 を押しても一覧を描き直さない (カードが動かない)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await openHistory(page);
    const card = page.locator('#favList .fav-item[data-sel="bbbbbbbbbb2"]');
    await card.evaluate((el) => (el.dataset.mark = '1'));
    await card.locator('.fav-star').click();
    await expect(card.locator('.fav-star')).toHaveClass(/\bon\b/);
    await expect(card).toHaveAttribute('data-mark', '1'); // 同じ要素のまま
  });
});

test.describe('ライブラリの種類の絞り込み', () => {
  const now = Date.now();
  const HISTORY = [
    { videoId: 'live0000001', title: '雑談配信', label: 'A', kind: 'live', at: now },
    { videoId: 'video000002', title: 'MV', label: 'B', kind: 'video', at: now - 60e3 },
    { videoId: 'short000003', title: 'ショート', label: 'C', input: 'https://www.youtube.com/shorts/short000003', at: now - 120e3 }, // 種類を書く前の版の履歴 (/shorts/ の URL でショート)
    { videoId: 'unknown0004', title: '種類の分からないもの', label: 'D', at: now - 180e3 },
  ];
  const shownIds = (page) => page.locator('#favList .fav-item').evaluateAll((els) => els.map((e) => e.dataset.sel));

  test('🔴 ライブ / 🎬 動画 / 📱 ショート で出す種類を切り替え、最後の 1 つは外せず、次に開いたときも覚えている', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.evaluate((h) => chrome.storage.local.set({ history: h }), HISTORY);
    await page.locator('#openFavorites').click();
    await page.locator('[data-favtab="history"]').click();
    const kinds = page.locator('#libKind [data-kind]');
    await expect(kinds).toHaveText(['🔴 ライブ', '🎬 動画', '📱 ショート']);
    await expect(page.locator('#favList .fav-item')).toHaveCount(4); // 全部出すときは種類の分からないものも出す
    await page.locator('#libKind [data-kind="short"]').click();
    await expect.poll(() => shownIds(page)).toEqual(['live0000001', 'video000002']);
    await page.locator('#libKind [data-kind="live"]').click();
    await expect.poll(() => shownIds(page)).toEqual(['video000002']);
    await page.locator('#libKind [data-kind="video"]').click(); // 最後の 1 つは外せない
    await expect(page.locator('#libKind [data-kind="video"]')).toHaveClass('selected');
    await expect.poll(() => shownIds(page)).toEqual(['video000002']);
    // あとで見るでも同じ絞り込み。チャンネルの一覧と再生リストでは出さない
    await page.locator('[data-favtab="playlists"]').click();
    await expect(page.locator('#libKind')).toBeHidden();
    await page.reload();
    await skipTour(page).catch(() => {});
    await page.locator('#openFavorites').click();
    await page.locator('[data-favtab="history"]').click();
    await expect.poll(() => shownIds(page)).toEqual(['video000002']);
    await page.locator('#libKind [data-kind="short"]').click();
    await expect.poll(() => shownIds(page)).toEqual(['video000002', 'short000003']);
  });
});
