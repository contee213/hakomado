// hukumado service worker
// - ツールバーのアイコンでマルチビュー画面を開く
// - マルチビュー画面のタブだけに、YouTube を iframe 表示するためのヘッダー書き換えルールを適用する
//   (他のサイトには一切影響させないよう tabIds で限定する)

const RULE_IDS = [1, 2];

// アイコンを押すたびに新しいタブを開く (タブごとに別の視聴セッションになるので、いくつ開いてもよい)
chrome.action.onClicked.addListener((current) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('grid.html'), windowId: current.windowId });
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
  }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: RULE_IDS, addRules });
}

// 初めてインストールしたときだけ、マルチビュー画面でツアーを出す印を付ける (バージョンアップや再読み込みでは出さない)
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.storage.local.set({ tourPending: true });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId == null || sender.id !== chrome.runtime.id) return false;
  if (sender.url && !sender.url.startsWith(chrome.runtime.getURL('grid.html'))) return false;

  serialized(async () => {
    const tabs = await getGridTabs();
    if (msg?.type === 'register-grid-tab') {
      await setGridTabs([...tabs, tabId]);
    } else if (msg?.type === 'unregister-grid-tab') {
      await setGridTabs(tabs.filter((id) => id !== tabId));
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

// グリッド画面から別ページへ移動した場合もルールを外す。
// tabs 権限が無いので、移動先が他のサイトだと URL は分からない → 読み込みが始まった時点で、いったん外す。
// マルチビュー画面自身の読み込み (再読み込みなど) なら、画面が開いたときに登録し直すので問題ない
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' || (info.url && !info.url.startsWith(chrome.runtime.getURL('grid.html')))) {
    removeTab(tabId);
  }
});
