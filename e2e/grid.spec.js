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
    // 縦長の均等 9 つと、縦長 + 大きな枠 5 つ (選んでいる基準位置 = 左上のものだけ)
    await expect(picker.locator('.layout-option')).toHaveCount(14);
    await expect(picker.locator('.layout-option[data-id="tl-vm2x5"]')).toHaveCount(1);
    await expect(picker.locator('.layout-option[data-id="tr-vm2x5"]')).toHaveCount(0);
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

  // 設定のタブ → 「詳しい説明」で開く使い方の項目 (どのタブからも「はじめに」以外の、そのタブの説明が開く)
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
  test('設定の「詳しい説明」は、開いているタブの説明を使い方で開く', async ({ openGrid }) => {
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
  test('幅の狭い空き枠では、「📺 チャンネルから選ぶ」「📚 ライブラリから選ぶ」が記号だけになる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.setViewportSize({ width: 480, height: 600 });
    // 枠を足して、どの枠も幅 260px 以下にする
    for (let n = 0; n < 3; n++) await page.locator('#addTile').click();
    const tile = visibleTiles(page).first();
    await expect.poll(() => tile.evaluate((el) => el.querySelector('.stage').offsetWidth)).toBeLessThanOrEqual(260);
    const icon = (sel) => tile.locator(sel).evaluate((el) => getComputedStyle(el, '::before').content);
    await expect.poll(() => icon('.pick-fav')).toBe('"📚"');
    await expect.poll(() => icon('.pick-ch')).toBe('"📺"');
  });

  test('ファイルの枠: 動画ファイルを枠にドロップすると、その枠で再生する。動画でないファイルは入れない', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    // この画面で 2 秒の動画 (webm) を作り、1 番目の枠にドロップする (本物のドラッグではないので、ファイルの持ち手は無い)
    const drop = (k, kind) =>
      page.evaluate(
        async ({ k, kind }) => {
          let file;
          if (kind === 'video') {
            const c = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
            const g = c.getContext('2d');
            const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
            const chunks = [];
            rec.ondataavailable = (e) => chunks.push(e.data);
            rec.start(200);
            for (let n = 0; n < 20; n++) {
              g.fillStyle = `hsl(${n * 18},80%,50%)`;
              g.fillRect(0, 0, 160, 90);
              await new Promise((r) => setTimeout(r, 100));
            }
            rec.stop();
            await new Promise((r) => (rec.onstop = r));
            file = new File(chunks, 'clip.webm', { type: 'video/webm' });
          } else {
            file = new File(['memo'], 'memo.txt', { type: 'text/plain' });
          }
          const dt = new DataTransfer();
          dt.items.add(file);
          const tile = document.querySelectorAll('#grid .tile:not([hidden])')[k];
          for (const type of ['dragenter', 'dragover', 'drop']) tile.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
        },
        { k, kind },
      );
    const first = visibleTiles(page).first();
    await drop(0, 'video');
    await expect(first).toHaveClass(/is-web/);
    await expect(first.locator('video.file-video')).toBeAttached();
    await expect(first.locator('.tile-name')).toHaveText('clip.webm');
    await expect.poll(() => first.locator('video.file-video').evaluate((v) => v.readyState)).toBeGreaterThan(0);

    await page.locator('#addTile').click();
    const second = visibleTiles(page).nth(1);
    await drop(1, 'text');
    await expect(second).toHaveClass(/is-empty/);
    await expect(second.locator('.toast')).toHaveText('動画ファイルを枠にドロップすると、その枠で再生します');
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

  // 保存済みの内容を作って閉じる (次に開くと、ふつうは起動画面が出る状態にする)
  async function leaveSavedSession(openGrid) {
    const page = await openGrid();
    await skipTour(page);
    const input = visibleTiles(page).first().locator('.url-input');
    await input.fill('dQw4w9WgXcQ');
    await input.press('Enter');
    await expect
      .poll(() => page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)).includes('dQw4w9WgXcQ')))
      .toBe(true);
    await page.close();
  }
  const tileIds = (page) => page.evaluate(() => state.tiles.map((t) => t.videoId).filter(Boolean));

  test('保存済みの内容があっても、取り込み用リンクで開くと起動画面を出さず、新しく始めて読み込む画面を開く', async ({ openGrid }) => {
    await leaveSavedSession(openGrid);
    const next = await openGrid(IMPORT_HASH);
    await expect(next.locator('#readPane')).toBeVisible();
    await expect(next.locator('#startDialog')).toBeHidden();
    await expect(next.locator('#readSummary')).toContainText('2 本を受け取りました');
    await expect(next.locator('#readSave')).toHaveClass(/primary-action/);
    expect(await tileIds(next)).toEqual([]);
  });

  test('保存済みの内容があっても、右クリックの追加 (#add=) で開くと起動画面を出さず、その動画だけで新しく始める', async ({ openGrid }) => {
    await leaveSavedSession(openGrid);
    const next = await openGrid('#add=9bZkp7q5f_w');
    await expect.poll(() => tileIds(next)).toEqual(['9bZkp7q5f_w']);
    await expect(next.locator('#startDialog')).toBeHidden();
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

  test('🔴 配信 / 🎬 動画 / 📱 ショート で出す種類を切り替え、最後の 1 つは外せず、次に開いたときも覚えている', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.evaluate((h) => chrome.storage.local.set({ history: h }), HISTORY);
    await page.locator('#openFavorites').click();
    await page.locator('[data-favtab="history"]').click();
    const kinds = page.locator('#libKind [data-kind]');
    await expect(kinds).toHaveText(['🔴 配信', '🎬 動画', '📱 ショート']);
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

test.describe('チャンネルの管理', () => {
  // 既定のチャンネル (同梱のホロライブ) のうち 2 つ
  const SORA = 'UCp6993wxpyDPHUpavwDFqgg';
  const ROBO = 'UCDqI2jOz0weumE8s7paEk6g';
  const channels = (page) => page.evaluate(async () => (await chrome.storage.local.get('favorites')).favorites);
  const row = (page, name) => page.locator('#cmList .cm-item', { hasText: name });

  test('📺 チャンネルには ✕ と追加の欄が無く、⚙ 管理は絞り込みを引き継いで開き、閉じると 📺 に戻る', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.locator('#openChannels').click();
    await expect(page.locator('#favList .fav-item').first()).toBeVisible();
    await expect(page.locator('#favList .fav-del')).toHaveCount(0);
    await expect(page.locator('#favorites #favAdd')).toHaveCount(0);

    await page.locator('#favFilter').fill('ときのそら');
    await page.locator('#favManage').click();
    await expect(page.locator('#chManage')).toBeVisible();
    await expect(page.locator('#cmFilter')).toHaveValue('ときのそら');
    await expect(page.locator('#cmList .cm-item')).toHaveCount(1);
    await expect(page.locator('#packList li').first()).toBeVisible(); // パックもこの画面にある

    await page.keyboard.press('Escape');
    await expect(page.locator('#chManage')).toBeHidden();
    await expect(page.locator('#favorites')).toBeVisible();
    // ライブラリでは ⚙ 管理 を出さない
    await page.keyboard.press('Escape');
    await page.locator('#openFavorites').click();
    await expect(page.locator('#favManage')).toBeHidden();
  });

  test('まとめて外すと、確かめる画面を 1 回出し、📌 付きは既定で残す', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.locator('#openSettings').click();
    await page.locator('#settings [data-tab="channels"]').click();
    await page.locator('#settingsChManage').click();
    await expect(page.locator('#chManage')).toBeVisible();

    // ときのそらに 📌 を付けて選び、絞り込みを替えてロボ子さんも選ぶ (選択は絞り込みを替えても残る)
    await page.locator('#cmFilter').fill('ときのそら');
    await row(page, 'ときのそら').locator('.fav-star').click();
    await expect(row(page, 'ときのそら').locator('.fav-star')).toHaveClass(/\bon\b/);
    await row(page, 'ときのそら').locator('.fav-check').check();
    await page.locator('#cmFilter').fill('ロボ子');
    await row(page, 'ロボ子さん').locator('.fav-check').check();
    await expect(page.locator('#cmSelCount')).toHaveText('2 件を選択中');

    // やめると何も外さない
    await page.locator('#cmRemove').click();
    await expect(page.locator('#cmConfirm')).toBeVisible();
    await expect(page.locator('#cmConfirmStarRow')).toBeVisible();
    await expect(page.locator('#cmConfirmStar')).not.toBeChecked();
    await page.locator('#cmConfirm button[value="cancel"]').click();
    expect((await channels(page)).some((f) => f.channelId === ROBO)).toBe(true);

    // 外すと 📌 の無いロボ子さんだけ外れ、ときのそらは 📌 ごと残る
    await page.locator('#cmRemove').click();
    await page.locator('#cmConfirmOk').click();
    await expect(page.locator('#cmConfirm')).toBeHidden();
    await expect(page.locator('#cmError')).toContainText('1 件のチャンネルを外しました');
    const after = await channels(page);
    expect(after.some((f) => f.channelId === ROBO)).toBe(false);
    expect(after.find((f) => f.channelId === SORA)?.star).toBe(true);
    await expect(page.locator('#cmSelCount')).toHaveText('1 件を選択中');

    // 📌 付きだけを選んでいるときは、「📌 付きも外す」に印を付けるまで外せない
    await page.locator('#cmRemove').click();
    await expect(page.locator('#cmConfirmOk')).toBeDisabled();
    await page.locator('#cmConfirmStar').check();
    await page.locator('#cmConfirmOk').click();
    await expect.poll(async () => (await channels(page)).some((f) => f.channelId === SORA)).toBe(false);
    // 同梱のチャンネルは、外したことを覚えている (「戻す」で戻せる)
    const { removedPresets } = await page.evaluate(() => chrome.storage.local.get('removedPresets'));
    expect(removedPresets).toEqual(expect.arrayContaining([SORA, ROBO]));
  });

  test('チャンネルが 1 つも無いと、📺 チャンネルに足し方のボタンを出す', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.locator('#openChannels').click();
    await expect(page.locator('#favEmptyActions')).toBeHidden();
    await page.locator('#favManage').click();
    await page.locator('#cmSelAll').click();
    await page.locator('#cmRemove').click();
    await page.locator('#cmConfirmOk').click();
    await expect(page.locator('#cmList .cm-item')).toHaveCount(0);
    await expect(page.locator('#cmEmpty')).toBeVisible();
    await page.locator('#cmClose').click();

    await expect(page.locator('#favEmptyActions')).toBeVisible();
    await expect(page.locator('#favEmptyManage')).toBeVisible();
    await expect(page.locator('#favEmptySubs')).toBeVisible();
    const restore = page.locator('#favEmptyRestore');
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(page.locator('#favList .fav-item').first()).toBeVisible();
    await expect(page.locator('#favEmptyActions')).toBeHidden();
  });
});

test.describe('右クリックの「空き枠に追加」', () => {
  // 16 枠が埋まっている画面にする (空き枠も足す枠も無い)
  const makeFull = (page) => page.evaluate(() => (window.emptyTileOrAdd = () => null));
  const tileIds = (page) => page.evaluate(() => state.tiles.map((t) => t.videoId).filter(Boolean));

  test('送り先が 16 枠いっぱいなら空き枠のある別の画面に、どこもいっぱいなら新しいタブに入れる', async ({ openGrid, serviceWorker, context }) => {
    const a = await openGrid();
    await skipTour(a);
    const b = await openGrid();
    await expect(b.locator('#grid .tile').first()).toBeAttached();
    // 2 つとも登録され、追加を受け取れるようになるまで待つ (受け取りは起動し終えてから始める)
    await expect.poll(() => serviceWorker.evaluate(() => getGridTabs().then((t) => t.length))).toBe(2);
    await b.waitForTimeout(500);
    await b.bringToFront();
    await a.bringToFront(); // a を最後に使った画面にする

    await makeFull(a);
    await serviceWorker.evaluate(() => addToGrid('dQw4w9WgXcQ'));
    await expect.poll(() => tileIds(b)).toEqual(['dQw4w9WgXcQ']);
    expect(await tileIds(a)).toEqual([]);
    await expect(a.locator('#globalToast')).not.toContainText('埋まっている');

    await makeFull(b);
    const opened = context.waitForEvent('page');
    await serviceWorker.evaluate(() => addToGrid('9bZkp7q5f_w'));
    const c = await opened;
    await expect(c.locator('#grid .tile').first()).toBeAttached();
    await expect.poll(() => tileIds(c).catch(() => null)).toEqual(['9bZkp7q5f_w']);
    await expect(c.locator('#startDialog')).toBeHidden();
  });
});

// docs/design-guide.md の決まり (docs/ui-consistency.md で決めたもの) どおりに動くか
test.describe('デザインガイドの決まり', () => {
  test('空き枠が無いときにチャンネルの行を押すと、枠を足して入れる (A1)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const before = await page.evaluate(() => {
      for (const i of visibleIndexes()) setTileVideo(i, 'dQw4w9WgXcQ');
      return state.count;
    });
    await page.evaluate(() => pickFavorite({ channelId: 'UCabcdefghijklmnopqrstuv', handle: '@x' }, { videoId: 'aaaaaaaaaaa' }));
    await expect.poll(() => page.evaluate(() => state.count)).toBe(before + 1);
    expect(await page.evaluate(() => state.tiles.some((t) => t.videoId === 'aaaaaaaaaaa'))).toBe(true);
  });

  test('通知の「全部消す」は件数を見せて確かめる。やめれば消えない (A3)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const notice = { videoId: 'dQw4w9WgXcQ', channelId: 'UCabcdefghijklmnopqrstuv', name: 'テスト', title: 'テスト配信', at: Date.now() };
    await page.evaluate((n) => chrome.storage.local.set({ notices: [n] }), notice);
    await page.locator('#openNotices').click();
    const messages = [];
    page.once('dialog', (d) => {
      messages.push(d.message());
      d.dismiss();
    });
    await page.locator('#noticeClear').click();
    await expect.poll(() => messages).toEqual(['通知を全部 (1 件) 消しますか？']);
    expect(await page.evaluate(async () => (await chrome.storage.local.get('notices')).notices.length)).toBe(1);
    page.once('dialog', (d) => d.accept());
    await page.locator('#noticeClear').click();
    await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('notices')).notices.length)).toBe(0);
  });

  test('画面の下の知らせは、開いているダイアログより前に出る (A6)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.locator('#openSettings').click();
    await expect(page.locator('#settings')).toBeVisible();
    await page.evaluate(() => notify('テストの知らせ'));
    const toast = page.locator('#globalToast');
    await expect(toast).toHaveText('テストの知らせ');
    expect(await toast.evaluate((el) => el.matches(':popover-open'))).toBe(true);
    // ダイアログを開いた後に出したので、最前面 (top layer) の一番上に積まれている
    // (ダイアログの外は inert になり当たり判定から外れるので、elementFromPoint では確かめられない。見た目はスクリーンショットで確かめた)
  });

  test('繰り返し: 自動再生で入れた枠 (fill) も繰り返す。あとで見るの順の再生の枠 (queue) は繰り返さない (HAKO-12)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const sent = await page.evaluate(() => {
      Object.assign(state.tiles[0], { fill: true, queue: false });
      Object.assign(state.tiles[1], { fill: false, queue: true });
      const log = [];
      const orig = postToFrame;
      // 枠のプレイヤーへ送った繰り返しの指示を、枠ごとに記録する
      window.postToFrame = (frame, msg) => {
        if (msg?.hakomado === 'loop') log.push({ i: views.findIndex((v) => v.player === frame), on: msg.on });
        return orig(frame, msg);
      };
      for (const i of [0, 1]) views[i].player ??= document.createElement('iframe');
      setRepeatAll(true);
      window.postToFrame = orig;
      return log;
    });
    expect(sent.find((m) => m.i === 0)?.on).toBe(true);
    expect(sent.find((m) => m.i === 1)?.on).toBe(false);
  });

  test('自動再生の枠を ✕ で閉じたら、1 分ごとの確認を待たずに次の動画を入れにいく (繰り返し ON でも。HAKO-12)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.evaluate(() => {
      window.refillCalls = 0;
      // 次の動画を探す処理 (通信する) の代わりに、呼ばれた回数だけ数える
      window.refillArchives = async () => {
        window.refillCalls++;
        return 0;
      };
      state.autoMode = true;
      state.settings.autoArchive = true;
      setRepeatAll(true);
      Object.assign(state.tiles[0], { input: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', fill: true, label: 'test' });
      renderTile(0);
    });
    await page.locator('.tile').nth(0).hover();
    await page.locator('.tile').nth(0).locator('[data-act="clear"]').click();
    await expect.poll(() => page.evaluate(() => window.refillCalls)).toBe(1);
    expect(await page.evaluate(() => state.tiles[0].videoId)).toBeFalsy();
  });

  test('全体の切り替えは、キーのときだけ知らせる (A7)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const toast = page.locator('#globalToast');
    await page.locator('#repeatAll').click();
    await expect(page.locator('#repeatAll')).toHaveAttribute('aria-pressed', 'true');
    expect(await toast.evaluate((el) => el.matches(':popover-open'))).toBe(false);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('r');
    await expect(toast).toHaveText('繰り返し OFF');
  });

  test('枠のバー (▭・H): 隠すと全部の枠の操作バーが消え、視聴セッションに残る。キーのときだけ知らせる', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const btn = page.locator('#tileBars');
    const bar = page.locator('.tile .bar').first();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('body')).toHaveClass(/bars-off/);
    await expect(bar).toBeHidden();
    expect(await page.locator('#globalToast').evaluate((el) => el.matches(':popover-open'))).toBe(false);
    // 視聴セッションに保存される
    await expect
      .poll(() => page.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).find(([k]) => k.startsWith('session:'))?.[1].tileBars))
      .toBe(false);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('h');
    await expect(page.locator('#globalToast')).toHaveText('枠のバーを出しました');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).not.toHaveClass(/bars-off/);
  });

  test('URL の枠: 映像の上に黒い帯でバーの場所を取り、URL の枠で効くボタンだけを出す。バーを隠すと帯も無くす', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    // サイトの許可は取らない (取れない) ので、枠には「許可して読み込む」が出る。バーの形だけを見る
    await page.evaluate(() => setTileWeb(state.order[0], 'https://video.example.com/watch/1'));
    const tile = visibleTiles(page).first();
    await expect(tile).toHaveClass(/is-web/);
    await expect(tile.locator('.web-perm')).toBeVisible();
    const slotTop = () => tile.evaluate((el) => el.querySelector('.player-slot').getBoundingClientRect().top - el.getBoundingClientRect().top);
    expect(await slotTop()).toBeGreaterThanOrEqual(30); // バーの帯の下
    await expect(tile.locator('.bar')).toBeVisible();
    await expect(tile.locator('.drag-zone')).toBeHidden();
    await tile.hover();
    const acts = await tile.locator('.bar [data-act]').evaluateAll((bs) => bs.filter((b) => b.checkVisibility()).map((b) => b.dataset.act));
    expect(acts).toEqual(['audio', 'reload', 'max', 'clear']);
    await page.locator('#tileBars').click();
    await expect(tile.locator('.bar')).toBeHidden();
    expect(await slotTop()).toBeLessThan(5);
  });

  test('ロゴから開いた起動画面は、背景のクリックでも閉じる (A8)', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.locator('#brandHome').click();
    const start = page.locator('#startDialog');
    await expect(start).toBeVisible();
    await expect(page.locator('#startClose')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(start).toBeHidden();
  });
});

test.describe('自動再生の進み具合', () => {
  test('ボタンの下端の線でも見せる。配信予定のチャンネルがあっても、確認が終わったら消える', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const btn = page.locator('#autoMode');
    const idleTitle = await btn.getAttribute('title');
    // 外へは通信しないので、チャンネルと配信状況を差し替える。
    // 「配信予定の枠を用意する」の時間内に始まる配信予定を混ぜる (以前はここで例外になり、進み具合が残り続けた)
    const checked = await page.evaluate(async () => {
      state.settings.prestartMin = 10;
      const chs = Array.from({ length: 20 }, (_, n) => ({ channelId: `UC${String(n).padStart(22, '0')}`, name: `ch${n}`, star: false }));
      Favorites.list = async () => chs;
      Favorites.checkAccess = async () => 'ok';
      let calls = 0;
      // 自動再生の最初の確認 (force) の分だけ数える (通知の確認なども取りに来るので)
      Favorites.fetchStatus = async (f, opts = {}) => {
        if (opts.force) calls++;
        await new Promise((r) => setTimeout(r, 30));
        return f.name === 'ch0' ? { state: 'upcoming', videoId: 'aaaaaaaaaaa', startAt: Date.now() + 60 * 1000 } : { state: 'none' };
      };
      const seen = [];
      const bar = document.getElementById('autoProgressBar');
      new MutationObserver(() => seen.push(!bar.hidden)).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
      await setAutoMode(true);
      await new Promise((r) => setTimeout(r, 300));
      return { calls, shown: seen.includes(true), upcomingPlaced: state.tiles.some((t) => t.videoId === 'aaaaaaaaaaa') };
    });
    expect(checked.calls).toBe(20);
    expect(checked.shown).toBe(true);
    // 時間内に始まる配信予定は、最初の確認で枠に入る
    expect(checked.upcomingPlaced).toBe(true);
    await expect(page.locator('#autoProgressBar')).toBeHidden();
    await expect(btn).toHaveAttribute('title', idleTitle);
    await expect(page.locator('#autoProgressText')).toHaveText('');
    await expect(page.locator('#autoProgressBox')).toBeHidden();
  });

  test('画面中央の箱は ✕ で隠せる。隠しても準備は続き、ボタンの線には出し続ける', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const box = page.locator('#autoProgressBox');
    const bar = page.locator('#autoProgressBar');
    // 確認が終わらないように、配信状況の取得を止めておく (release で進める)
    await page.evaluate(() => {
      const chs = Array.from({ length: 3 }, (_, n) => ({ channelId: `UC${String(n).padStart(22, '0')}`, name: `ch${n}`, star: false }));
      Favorites.list = async () => chs;
      Favorites.checkAccess = async () => 'ok';
      let release;
      const gate = new Promise((r) => (release = r));
      window.__releaseStatus = release;
      Favorites.fetchStatus = async (f, opts = {}) => {
        if (opts.force) await gate;
        return { state: 'none' };
      };
      window.__autoDone = setAutoMode(true);
    });
    // 線は 0% の間は幅が 0 なので、見えるかでなく hidden で確かめる
    await expect(box).toBeVisible();
    await expect(bar).not.toHaveAttribute('hidden');
    await page.locator('#autoProgressClose').click();
    await expect(box).toBeHidden();
    await expect(bar).not.toHaveAttribute('hidden');
    await expect(page.locator('#autoMode')).toHaveAttribute('title', /自動再生を準備しています/);
    await page.evaluate(async () => {
      window.__releaseStatus();
      await window.__autoDone;
    });
    await expect(bar).toBeHidden();
    await expect(box).toBeHidden();
  });
});

test.describe('動画・ショートの自動再生の始め方 (HAKO-13)', () => {
  test('前回の結果があれば、取り直しを待たずにすぐ枠を埋め、裏で取り直す', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const got = await page.evaluate(async () => {
      state.settings.autoLive = false;
      state.settings.autoVideos = false;
      state.settings.autoShorts = true;
      state.settings.autoMaxTiles = 4;
      const chs = Array.from({ length: 4 }, (_, n) => ({ channelId: `UC${String(n).padStart(22, '0')}`, name: `ch${n}`, star: false }));
      Favorites.list = async () => chs;
      Favorites.checkAccess = async () => 'ok';
      Favorites.fetchStatus = async () => ({ state: 'none' });
      // 前回の結果: チャンネルごとにショートが 1 本ずつ残っている
      const now = Date.now();
      Favorites.peekArchives = async (ids) =>
        new Map(ids.map((id, n) => [id, [{ videoId: `short${id.slice(-1)}`.padEnd(11, 'x'), title: `s${n}`, at: now - n * 60000, list: 'UUSH', kind: 'short' }]]));
      // 取り直しは終わらない (遅い通信の代わり)。呼ばれた数を数える
      window.__fetches = 0;
      Favorites.fetchArchives = () => {
        window.__fetches++;
        return new Promise(() => {});
      };
      setAutoMode(true);
      await new Promise((r) => setTimeout(r, 1500));
      return { ids: state.tiles.map((t) => t.videoId).filter(Boolean).sort(), fetches: window.__fetches };
    });
    expect(got.ids).toEqual(['short0xxxxx', 'short1xxxxx', 'short2xxxxx', 'short3xxxxx']);
    // 裏で取り直しに行っている
    expect(got.fetches).toBeGreaterThan(0);
  });
});

test.describe('枠の入れ替え', () => {
  test('ドラッグ中の影は 240px までに縮めて、つかんだ場所 (比) がカーソルの下に来る。落とし先の枠は塗る。離すと消える', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    await page.evaluate(() => setTileWeb(state.order[0], 'https://video.example.com/watch/1'));
    const tile = visibleTiles(page).first();
    const target = visibleTiles(page).nth(1);
    const bar = tile.locator('.bar');
    await tile.hover();
    const t = await tile.boundingBox();
    const b = await bar.boundingBox();
    expect(t.width).toBeGreaterThan(240); // 縮める大きさの枠で確かめる
    const k = Math.min(1, 240 / t.width, 240 / t.height);
    // バーの真ん中寄り (ボタンの無いところ) をつかむ
    const grab = { x: b.x + b.width * 0.45, y: b.y + b.height / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 30, grab.y + 20, { steps: 5 });
    const tb = await target.boundingBox();
    const to = { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 };
    await page.mouse.move(to.x, to.y, { steps: 10 });
    // Linux の Playwright では、影の位置が 1 つ前のマウスの位置になることがある (dragover の座標が 1 回遅れる)。
    // 同じ場所でもう一度動かして、最後の位置の dragover を届ける
    await page.mouse.move(to.x, to.y);
    const ghost = page.locator('.drag-ghost');
    await expect(ghost).toHaveCount(1);
    const g = await ghost.boundingBox();
    expect(Math.abs(g.width - t.width * k)).toBeLessThan(2);
    expect(Math.abs(g.height - t.height * k)).toBeLessThan(2);
    // 影の中でのカーソルの位置 = つかんだときの枠の中での位置 × 縮めた比
    await expect
      .poll(async () => {
        const p = await ghost.boundingBox();
        return Math.max(Math.abs(to.x - p.x - (grab.x - t.x) * k), Math.abs(to.y - p.y - (grab.y - t.y) * k));
      })
      .toBeLessThan(3);
    // 落とし先の枠に、塗る板が重なる
    const fill = page.locator('.drop-fill');
    await expect(fill).toBeVisible();
    const f = await fill.boundingBox();
    expect(Math.abs(f.x - tb.x) + Math.abs(f.y - tb.y) + Math.abs(f.width - tb.width)).toBeLessThan(3);
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    await expect(fill).toHaveCount(0);
  });
});

test.describe('自動再生の最大枠数', () => {
  test('増やしたら、1 分ごとの確認を待たずに空いた分を足す', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    const filled = () => page.evaluate(() => visibleIndexes().filter((i) => state.tiles[i].videoId).length);
    // 外へは通信しないので、配信中のチャンネルを 4 つに差し替える
    await page.evaluate(async () => {
      state.settings.autoMaxTiles = 2;
      syncSettingsInputs();
      const chs = Array.from({ length: 4 }, (_, n) => ({ channelId: `UC${String(n).padStart(22, '0')}`, name: `ch${n}`, star: false }));
      Favorites.list = async () => chs;
      Favorites.checkAccess = async () => 'ok';
      Favorites.fetchStatus = async (f) => ({ state: 'live', videoId: `live${f.name.slice(2)}`.padEnd(11, 'x') });
      await setAutoMode(true);
    });
    expect(await filled()).toBe(2);

    await page.locator('#openSettings').click();
    await page.locator('#settings [data-tab="auto"]').click();
    const slider = page.locator('#autoMaxTiles');
    await slider.fill('4');
    await slider.dispatchEvent('change');
    // 1 分ごとの確認 (60 秒) より、ずっと早く足される
    await expect.poll(filled, { timeout: 10000 }).toBe(4);
  });
});

test.describe('画面の覚え (HAKO-8)', () => {
  test('以前の版の localStorage の覚えを chrome.storage.local に引き継ぐ。タブの位置はこのタブの間だけ覚える', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    // 以前の版が localStorage に残した覚え (この版で開いて書いた ui:* は消し、更新した直後の状態にする)
    await page.evaluate(async () => {
      await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('ui:')));
      localStorage.setItem('hakomado.lang', 'ja');
      localStorage.setItem('hakomado.settingsTab', 'backup');
      localStorage.setItem('hakomado.libKinds', '["video"]');
      localStorage.setItem('hakomado.shareAuthor', 'TK');
      localStorage.setItem('hakomado.syncDock', '{"floating":false}');
    });
    await page.reload();
    await expect(page.locator('#grid .tile').first()).toBeAttached();
    await expect
      .poll(() => page.evaluate(() => chrome.storage.local.get(['ui:libKinds', 'ui:shareAuthor', 'ui:syncDock', 'ui:settingsTab'])))
      .toEqual({ 'ui:libKinds': ['video'], 'ui:shareAuthor': 'TK', 'ui:syncDock': { floating: false } });
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hakomado.')));
    expect(left).toEqual(['hakomado.lang']);
    // 引き継いだ覚えが画面に戻る
    await page.locator('#openFavorites').click();
    await expect(page.locator('#libKind [data-kind="video"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#libKind [data-kind="live"]')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await page.locator('#openShare').click();
    await expect(page.locator('#shareAuthor')).toHaveValue('TK');
    await page.keyboard.press('Escape');
    // タブの位置は引き継がないので、設定は最初のタブ (弾幕) から
    await page.locator('#openSettings').click();
    await expect(page.locator('#settings [data-tab="danmaku"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#settings [data-tab="view"]').click();
    expect(await page.evaluate(() => sessionStorage.getItem('hakomado.settingsTab'))).toBe('view');
    // 再読み込みではそのタブに戻る
    await page.reload();
    await expect(page.locator('#grid .tile').first()).toBeAttached();
    await page.locator('#openSettings').click();
    await expect(page.locator('#settings [data-tab="view"]')).toHaveAttribute('aria-selected', 'true');
    // 新しいタブでは最初のタブから
    const other = await openGrid();
    await other.locator('#openSettings').click();
    await expect(other.locator('#settings [data-tab="danmaku"]')).toHaveAttribute('aria-selected', 'true');
    await other.keyboard.press('Escape');
    // ほかのタブで変えた覚えは、開いたままのタブでも次に開いたときに使う
    await other.locator('#openFavorites').click();
    await other.locator('#libKind [data-kind="short"]').click();
    await other.keyboard.press('Escape');
    await other.locator('#openShare').click();
    await other.locator('#shareAuthor').fill('Hako');
    await expect.poll(() => page.evaluate(() => UiPrefs.get('shareAuthor'))).toBe('Hako');
    await page.keyboard.press('Escape');
    await page.locator('#openFavorites').click();
    await expect(page.locator('#libKind [data-kind="short"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.locator('#openShare').click();
    await expect(page.locator('#shareAuthor')).toHaveValue('Hako');
  });
});

test.describe('ライブラリの最近の動画 (HAKO-9)', () => {
  const SORA = 'UCp6993wxpyDPHUpavwDFqgg';
  const ROBO = 'UCDqI2jOz0weumE8s7paEk6g';
  const now = Date.now();
  const old = now - 5 * 3600e3; // 30 分の間隔を過ぎている (取りに行くが、通信は止めているので失敗する)
  const item = (videoId, hoursAgo) => ({ videoId, title: videoId, at: now - hoursAgo * 3600e3, views: 10 });
  const SEED = {
    favorites: [
      { channelId: SORA, name: 'ときのそら' },
      { channelId: ROBO, name: 'ロボ子さん' },
    ],
    ['feed:' + SORA]: { at: old, items: [item('sora0000001', 1), item('sora0000003', 3)] },
    ['feed:UULF:' + SORA]: { at: old, items: [] },
    ['feed:UUSH:' + SORA]: { at: old, items: [] },
    ['feed:' + ROBO]: { at: old, items: [item('robo0000002', 2)] },
    ['feed:UULF:' + ROBO]: { at: old, items: [item('robo0000004', 4)] },
    ['feed:UUSH:' + ROBO]: { at: old, items: [] },
  };
  const ORDER = ['sora0000001', 'robo0000002', 'sora0000003', 'robo0000004'];
  const shownIds = (page) => page.locator('#favList [data-key]').evaluateAll((els) => els.map((e) => e.dataset.key));

  test('前回の結果を 1 回で揃えて出し、取れなくても「⟳ 更新」しても消えず、並びが変わらない', async ({ openGrid }) => {
    const page = await openGrid();
    await skipTour(page);
    // 既定のチャンネル (77) の配信状況の取得と取り合わないよう、2 チャンネルだけにして開き直す
    await page.evaluate((seed) => chrome.storage.local.set(seed), SEED);
    await page.reload();
    await expect(page.locator('#grid .tile').first()).toBeAttached();
    // 一覧の行の数が変わるたびに覚えておく (途中で一部だけ出た・消えたを見つける)
    await page.evaluate(() => {
      window.__counts = [];
      new MutationObserver(() => {
        const n = document.querySelectorAll('#favList [data-key]').length;
        if (window.__counts.at(-1) !== n) window.__counts.push(n);
      }).observe(document.getElementById('favList'), { childList: true, subtree: true });
    });
    await page.locator('#openFavorites').click();
    await page.locator('[data-favtab="archive"]').click();
    await expect.poll(() => shownIds(page)).toEqual(ORDER);
    // 取りに行った分は (通信を止めているので) 失敗し、前回の結果のままであることを件数の横に出す
    await expect(page.locator('#savedCount')).toHaveText('4 件 (2 チャンネルは取り直せず、前回の結果)');
    expect(await page.evaluate(() => window.__counts.filter((n) => n > 0))).toEqual([4]);
    await page.locator('#favRefresh').click();
    await expect(page.locator('#savedCount')).toHaveText('4 件 (2 チャンネルは取り直せず、前回の結果)');
    expect(await shownIds(page)).toEqual(ORDER);
    expect(await page.evaluate(() => window.__counts.filter((n) => n > 0))).toEqual([4]);
  });

  // 取り直して新しい動画が届いたら、元からある動画は元の位置から滑って動く (パッと飛ばない)。動きを減らす設定では滑らせない
  for (const reduced of [false, true]) {
    test(`新しく届いた動画が入るとき、ほかの動画を${reduced ? '滑らせない (動きを減らす設定)' : '滑らせて動かす'}`, async ({ openGrid }) => {
      const page = await openGrid();
      await skipTour(page);
      if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate((seed) => chrome.storage.local.set(seed), SEED);
      await page.reload();
      await expect(page.locator('#grid .tile').first()).toBeAttached();
      // そらの「ライブ配信」の RSS だけ、いちばん新しい動画が 1 本増えて返る
      const entry = (id, hoursAgo) =>
        `<entry><yt:videoId>${id}</yt:videoId><title>${id}</title><published>${new Date(now - hoursAgo * 3600e3).toISOString()}</published>` +
        `<media:group><media:community><media:statistics views="10"/></media:community></media:group></entry>`;
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route(/\/feeds\/videos\.xml\?playlist_id=UULV/, async (route) => {
        if (!route.request().url().includes(SORA.slice(2))) return route.abort();
        await gate; // 前回の結果を出したあとで届くように
        await route.fulfill({
          contentType: 'application/xml',
          body: `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">${entry('sora0000000', 0.5)}${entry('sora0000001', 1)}${entry('sora0000003', 3)}</feed>`,
        });
      });
      await page.locator('#openFavorites').click();
      await page.locator('[data-favtab="archive"]').click();
      await expect.poll(() => shownIds(page)).toEqual(ORDER);
      // 描き直しで入れ替わった行に動きが付いたかを覚えておく
      await page.evaluate(() => {
        window.__moved = new Set();
        new MutationObserver(() => {
          for (const el of document.querySelectorAll('#favList [data-key]')) if (el.getAnimations().length) window.__moved.add(el.dataset.key);
        }).observe(document.getElementById('favList'), { childList: true, subtree: true });
      });
      release();
      await expect.poll(() => shownIds(page)).toEqual(['sora0000000', ...ORDER]);
      await page.waitForTimeout(50);
      const moved = await page.evaluate(() => [...window.__moved].sort());
      expect(moved).toEqual(reduced ? [] : ['robo0000002', 'robo0000004', 'sora0000000', 'sora0000001', 'sora0000003']);
    });
  }
});
