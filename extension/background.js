// hakomado service worker
// - ツールバーのアイコンでマルチビュー画面を開く
// - マルチビュー画面のタブだけに、YouTube を iframe 表示するためのヘッダー書き換えルールを適用する
//   (他のサイトには一切影響させないよう tabIds で限定する)
// - 右クリックのメニュー「Hakomado の空き枠に追加」(YouTube のリンク・動画のページ)
// - ショートカットキーで、マルチビュー画面のスクリーンショット

importScripts('errlog.js'); // ErrLog (エラーの記録。最初に始めて、ほかのファイルのエラーも記録する)
ErrLog.install('background');
importScripts('share-code.js'); // videoIdFromUrl

const RULE_IDS = [1, 2, 3, 4, 5];

// アイコンを押すたびに新しいタブを開く (タブごとに別の視聴セッションになるので、いくつ開いてもよい)
chrome.action.onClicked.addListener((current) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('grid.html'), windowId: current.windowId });
});

// ショートカットキー (既定 Alt+Shift+S): マルチビュー画面のタブで押すと、そのタブにスクリーンショットを頼む。
// 押したときにそのタブへ activeTab が付くので、画面の側で captureVisibleTab を確認なしで使える (タブを閉じる・移動するまで続く)
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'screenshot' || tab?.id == null) return;
  if (!(await getGridTabs()).includes(tab.id)) return;
  chrome.runtime.sendMessage({ type: 'screenshot', tabId: tab.id }).catch(() => {});
});

async function getGridTabs() {
  const { gridTabs = [] } = await chrome.storage.session.get('gridTabs');
  return gridTabs;
}

async function setGridTabs(tabIds) {
  // 既に閉じられたタブを除外
  const alive = [];
  for (const id of new Set(tabIds)) {
    try {
      await chrome.tabs.get(id);
      alive.push(id);
    } catch {
      /* closed */
    }
  }
  await chrome.storage.session.set({ gridTabs: alive });
  await applyRules(alive);
}

async function applyRules(tabIds) {
  const addRules = [];
  if (tabIds.length > 0) {
    // YouTube の視聴ページ / ライブチャットは X-Frame-Options: SAMEORIGIN で他サイトの iframe 表示を禁止している。
    // それだけを外す (Content-Security-Policy には frame-ancestors が無いので残す = YouTube 側の XSS 対策は有効のまま)
    const stripFrameHeaders = {
      type: 'modifyHeaders',
      responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }],
    };
    addRules.push(
      {
        // ライブチャット (弾幕の取得元 / チャット欄)
        id: 1,
        priority: 1,
        action: stripFrameHeaders,
        condition: { urlFilter: '||www.youtube.com/live_chat', resourceTypes: ['sub_frame'], tabIds },
      },
      {
        // プレイヤー (視聴ページをそのまま枠に入れる)
        id: 2,
        priority: 1,
        action: stripFrameHeaders,
        condition: { urlFilter: '||www.youtube.com/watch', resourceTypes: ['sub_frame'], tabIds },
      },
    );
    // URL の枠 (YouTube 以外) に入れることを使う人が許可したサイトも、X-Frame-Options だけを外す。
    // Content-Security-Policy (frame-ancestors) は外さない (サイトの XSS 対策まで切らないため。それで入らないサイトは入らない)
    // requestDomains はサブドメインも含む ('https://*.example.com/*' → example.com)
    const domains = (await webOrigins()).map((o) => o.match(WEB_ORIGIN_RE)[1].toLowerCase());
    if (domains.length > 0) {
      addRules.push({
        id: 3,
        priority: 1,
        action: stripFrameHeaders,
        condition: { requestDomains: domains, resourceTypes: ['sub_frame'], tabIds },
      });
    }
    // Twitch の埋め込みプレイヤー / チャットは、応答の Content-Security-Policy (frame-ancestors だけが入っている) で
    // parent= に書いた https のサイトの中でしか開けない。拡張機能のページは https でないので、その 2 か所だけ外す。
    // twitch.tv の権限 (optional_host_permissions) を許可したときだけ入れる (許可が変わったら入れ直す: permissions.onAdded / onRemoved)
    const twitch = await chrome.permissions.contains({ origins: ['https://*.twitch.tv/*'] }).catch(() => false);
    const stripTwitchFrame = {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'x-frame-options', operation: 'remove' },
      ],
    };
    if (twitch) {
      addRules.push(
        {
          id: 4,
          priority: 1,
          action: stripTwitchFrame,
          condition: { urlFilter: '|https://player.twitch.tv/', resourceTypes: ['sub_frame'], tabIds },
        },
        {
          id: 5,
          priority: 1,
          action: stripTwitchFrame,
          condition: { urlFilter: '|https://www.twitch.tv/embed/', resourceTypes: ['sub_frame'], tabIds },
        },
      );
    }
  }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: RULE_IDS, addRules });
}

// ---- URL の枠 (YouTube 以外のサイト)
// 使う人が枠に URL を入れて許可したサイト (オリジンごとの任意のホスト権限) を storage.local の webOrigins に覚えておく
// ('https://*.example.com/*' の形。サブドメインごと)。そのサイトにだけ:
//  - 汎用のプレイヤー操作 (content/web-player.js) を登録する。一番外側が Hakomado の画面のときだけ動く
//  - マルチビュー画面のタブで、枠 (sub_frame) の X-Frame-Options を外す (applyRules)
// 許可を取り消されたサイトは使わない (権限が無ければ、登録もルールも効かないが、念のため外す)
const WEB_SCRIPT_ID = 'hakomado-web-player';
const WEB_ORIGIN_RE = /^https:\/\/(?:\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/\*$/i;

/** 覚えているサイトのうち、今も許可されているもの */
async function webOrigins() {
  const { webOrigins: list = [] } = await chrome.storage.local.get('webOrigins');
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    if (typeof o === 'string' && WEB_ORIGIN_RE.test(o) && (await chrome.permissions.contains({ origins: [o] }))) out.push(o);
  }
  return out;
}

async function syncWebPlayer() {
  const origins = await webOrigins();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [WEB_SCRIPT_ID] });
  if (origins.length === 0) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [WEB_SCRIPT_ID] });
  } else {
    const script = { id: WEB_SCRIPT_ID, matches: origins, js: ['content/web-player.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true };
    if (registered.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }
  await applyRules(await getGridTabs());
}

// ---- Twitch の枠の中のスクリプト (content/twitch-player.js。速度・音の経路・同期の状態・弾幕)
// twitch.tv の任意の権限を許可している間だけ、公式の埋め込みプレイヤー (player.twitch.tv) に登録する
// (manifest の content_scripts に書くと、インストール時に twitch.tv の権限を求めることになるため)。
// スクリプトは、マルチビュー画面の枠に直接入ったときだけ動く
// チャット欄 (www.twitch.tv/embed/<チャンネル>/chat) には、弾幕用にコメントを読むスクリプト (content/twitch-chat.js) を入れる
const TWITCH_SCRIPTS = [
  {
    id: 'hakomado-twitch-player',
    matches: ['https://player.twitch.tv/*'],
    js: ['errlog.js', 'content/mix.js', 'danmaku.js', 'content/twitch-player.js'],
    css: ['danmaku.css'],
    allFrames: true,
    runAt: 'document_start',
    persistAcrossSessions: true,
  },
  {
    id: 'hakomado-twitch-chat',
    matches: ['https://www.twitch.tv/embed/*'],
    js: ['errlog.js', 'content/twitch-chat.js'],
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  },
];
async function syncTwitchPlayer() {
  const allowed = await chrome.permissions.contains({ origins: ['https://*.twitch.tv/*'] }).catch(() => false);
  const ids = TWITCH_SCRIPTS.map((s) => s.id);
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts({ ids })).map((s) => s.id));
  if (!allowed) {
    if (registered.size) await chrome.scripting.unregisterContentScripts({ ids: [...registered] });
    return;
  }
  const update = TWITCH_SCRIPTS.filter((s) => registered.has(s.id));
  const add = TWITCH_SCRIPTS.filter((s) => !registered.has(s.id));
  if (update.length) await chrome.scripting.updateContentScripts(update);
  if (add.length) await chrome.scripting.registerContentScripts(add);
}

// twitch.tv の権限を許可したら、開いているマルチビュー画面のタブに Twitch のルールを入れ、枠の中のスクリプトを登録する
// (外したときは下の onRemoved が入れ直す)
chrome.permissions.onAdded.addListener(() => {
  serialized(async () => {
    await syncTwitchPlayer();
    await applyRules(await getGridTabs());
  }).catch((e) => console.warn('hakomado: ルールを入れ直せませんでした', e));
});

chrome.permissions.onRemoved.addListener(() => {
  serialized(async () => {
    // 許可を取り消されたサイトは、覚えている一覧からも消す
    await chrome.storage.local.set({ webOrigins: await webOrigins() });
    await syncTwitchPlayer();
    await syncWebPlayer();
  }).catch((e) => console.warn('hakomado: URL の枠の設定を直せませんでした', e));
});

// 初めてインストールしたときだけ、マルチビュー画面でツアーを出す印を付ける (バージョンアップや再読み込みでは出さない)
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.storage.local.set({ tourPending: true });
  installImportRule().catch((e) => console.warn('hakomado: 取り込み用リンクのルールを設定できませんでした', e));
  createMenus();
  // 更新で中身の変わったスクリプトを登録し直す (許可がある間だけ)
  serialized(syncTwitchPlayer).catch((e) => console.warn('hakomado: Twitch の枠のスクリプトを登録できませんでした', e));
});

// ---- 取り込み用リンク (AI チャットなどが作る再生リストのリンク)
// https://www.youtube.com/watch_videos?video_ids=ID,ID,…&hakomado=名前 は、YouTube では一時的な再生リストとして開く
// (hakomado= は YouTube には無視される)。Hakomado が入っていれば、hakomado= の付いたものだけを
// YouTube の存在しないページ /hakomado_import?… (クエリはそのまま) に付け替え、そこで動く content/import.js の知らせで
// タブをマルチビュー画面 (grid.html#import=…) に切り替える。hakomado= の無い watch_videos には何もしない
const IMPORT_RULE_ID = 10;
const IMPORT_PAGE = 'https://www.youtube.com/hakomado_import';

async function installImportRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [IMPORT_RULE_ID],
    addRules: [
      {
        id: IMPORT_RULE_ID,
        priority: 1,
        action: { type: 'redirect', redirect: { transform: { path: '/hakomado_import' } } },
        condition: { urlFilter: '|https://www.youtube.com/watch_videos?*hakomado=', resourceTypes: ['main_frame'] },
      },
    ],
  });
}

function openImport(sender) {
  if (sender.id !== chrome.runtime.id || sender.tab?.id == null || sender.frameId !== 0) return;
  let url;
  try {
    url = new URL(sender.url);
  } catch {
    return;
  }
  if (url.origin + url.pathname !== IMPORT_PAGE) return;
  // 中身はページから受け取らず、タブの URL から読む
  const target = `${chrome.runtime.getURL('grid.html')}#import=${encodeURIComponent(url.search.slice(1))}`;
  chrome.tabs.update(sender.tab.id, { url: target }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === ErrLog.MSG_TYPE) return false; // errlog.js が受け取る
  if (msg?.type === 'import-link') {
    openImport(sender);
    return false;
  }
  const tabId = sender.tab?.id;
  if (tabId == null || sender.id !== chrome.runtime.id) return false;
  if (sender.url && !sender.url.startsWith(chrome.runtime.getURL('grid.html'))) return false;

  serialized(async () => {
    const tabs = await getGridTabs();
    if (msg?.type === 'register-grid-tab') {
      await setGridTabs([...tabs, tabId]);
    } else if (msg?.type === 'unregister-grid-tab') {
      await setGridTabs(tabs.filter((id) => id !== tabId));
    } else if (msg?.type === 'web-origins-changed') {
      // 画面がサイトの許可を取って webOrigins に足した → 枠を読み込む前に、登録とルールを済ませる
      await syncWebPlayer();
    } else if (msg?.type === 'twitch-rules') {
      // 画面が twitch.tv の許可を確かめた → Twitch の枠を読み込む前に、ヘッダーを外すルールを入れておく
      // (permissions.onAdded でも入れるが、画面の描き直しのほうが先に走るので、ここで待てるようにする)
      await syncTwitchPlayer();
      await applyRules(await getGridTabs());
    }
  })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// 再読み込み時は unregister → register が続けて届くので、順番どおりに処理する
let queue = Promise.resolve();
function serialized(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

function removeTab(tabId) {
  return serialized(async () => {
    const tabs = await getGridTabs();
    if (tabs.includes(tabId)) await setGridTabs(tabs.filter((id) => id !== tabId));
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

// グリッド画面から別ページへ移動した場合もルールを外す (普段は画面の pagehide で外れるので、その取りこぼし用)。
// 注意: タブの status は、枠 (iframe) の読み込みだけでも 'loading' になる (チャット欄の読み込み直し・
// 自動再生での切り替えなど)。'loading' だけで外すと、画面を開いたままルールが消え、それ以降に読み込んだ
// チャット欄が「www.youtube.com で接続が拒否されました」になってしまう。
// → タブにまだマルチビュー画面が開いているかを確かめ、開いていなければ外す
async function hasGridPage(tabId) {
  const gridUrl = chrome.runtime.getURL('grid.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], tabIds: [tabId] });
  return contexts.some((c) => c.documentUrl?.startsWith(gridUrl));
}

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.status && !info.url) return;
  if (!(await getGridTabs()).includes(tabId)) return;
  if (info.url && !info.url.startsWith(chrome.runtime.getURL('grid.html'))) {
    removeTab(tabId);
    return;
  }
  try {
    if (await hasGridPage(tabId)) return;
  } catch {
    /* 確かめられないときは外す側に倒す */
  }
  removeTab(tabId);
});

// ---- 右クリックのメニュー「Hakomado の空き枠に追加」
// - YouTube の動画・配信へのリンク (どのサイトでも) と、YouTube の視聴ページ (動画の上を含む) で出す
// - 押したら動画 ID を取り出し、開いているマルチビュー画面 (同じウィンドウ → 最後に使ったタブの順) に送る。
//   画面が空き枠に入れて (空き枠が無ければ枠を 1 つ足して。16 枠埋まっていれば知らせるだけ) 返事をしたら、そのタブに切り替える
// - 受け取れる画面が無ければ、新しいタブで grid.html#add=<ID> を開く
// - tabs 権限は使わない (送り先はマルチビュー画面の登録 (gridTabs) から選び、タブの URL は読まない)
const MENU_LINK = 'hakomado-add-link';
const MENU_PAGE = 'hakomado-add-page';
const VIDEO_URL_PATTERNS = [
  '*://www.youtube.com/watch*',
  '*://m.youtube.com/watch*',
  '*://music.youtube.com/watch*',
  '*://youtube.com/watch*',
  '*://www.youtube.com/live/*',
  '*://www.youtube.com/shorts/*',
  '*://m.youtube.com/shorts/*',
  '*://youtu.be/*',
];

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    const title = chrome.i18n.getMessage('menuAddToTile');
    chrome.contextMenus.create({ id: MENU_LINK, title, contexts: ['link'], targetUrlPatterns: VIDEO_URL_PATTERNS });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title,
      contexts: ['page', 'video'],
      documentUrlPatterns: VIDEO_URL_PATTERNS.filter((p) => p.startsWith('*://www.') || p.startsWith('*://m.')),
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === MENU_LINK ? info.linkUrl : info.menuItemId === MENU_PAGE ? info.frameUrl || info.pageUrl : null;
  const videoId = url ? videoIdFromUrl(url) : null;
  if (!videoId) return;
  // ショート (/shorts/ の URL) は、画面でも /shorts/ の URL で入れて最初から縦長の枠にする
  addToGrid(videoId, tab?.windowId, /^https?:\/\/(www\.|m\.)?youtube\.com\/shorts\//i.test(url)).catch((e) => console.warn('hakomado: 枠に追加できませんでした', e));
});

/** 送り先の候補: 登録されているマルチビュー画面のタブ (同じウィンドウを先に、最後に使ったものから) */
async function gridTabsByRecent(windowId) {
  const tabs = (await Promise.all((await getGridTabs()).map((id) => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
  return tabs.sort((a, b) => (b.windowId === windowId) - (a.windowId === windowId) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
}

/**
 * 右クリックの「空き枠に追加」: 開いている画面に順に頼み、入れた (またはもう表示中の) 画面を前に出す。
 * 16 枠が埋まっている画面は handled を返さないので次の画面へ。どこにも入らなければ、新しいタブで開いて入れる
 * (#add= で開いた画面は、起動画面を出さずに新しく始める)
 */
async function addToGrid(videoId, windowId, short = false) {
  for (const t of await gridTabsByRecent(windowId)) {
    let res = null;
    try {
      // 画面は全部が受け取るが、返事をするのは tabId が自分のものだけ (誰も返事をしなければ例外になる)
      res = await chrome.runtime.sendMessage({ type: 'add-video', tabId: t.id, videoId, ...(short ? { short: true } : {}) });
    } catch {
      /* 受け取る画面が無い (まだ起動中・閉じかけ) */
    }
    if (res?.handled) {
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return;
    }
  }
  const url = `${chrome.runtime.getURL('grid.html')}#add=${videoId}${short ? '&short' : ''}`;
  await chrome.tabs.create(windowId != null ? { url, windowId } : { url });
}
