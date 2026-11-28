# 入口 (拡張機能の外)

マルチビュー画面 (`grid.html`) の外にあって、画面を開いたり枠に足したりする項目。Chrome のツールバー・右クリックのメニュー・キーボードショートカット、YouTube の取り込み用リンクを扱う。どれも `extension/background.js` と `manifest.json` で決まる。流れは [../screen-flow.md](../screen-flow.md) の 1 章を見る。

## Chrome の UI と取り込み用リンク

### 画面項目表

| No | 項目名 | 種類 | 要素 | 内容・動作 | 値・初期値 | キー | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Hakomado (ツールバーのアイコン) | ボタン | `manifest.json` の `action` | 押したウィンドウに、マルチビュー画面を新しいタブで開く | 乗せたときの説明「Hakomado を開く」(`actionTitle`) | | `chrome.action.onClicked`。開いたあとは起動の流れ (起動画面など) に進む |
| 2 | Hakomado の空き枠に追加 (リンク) | メニュー | `contextMenus` の `hakomado-add-link` | YouTube の動画のリンク・Twitch へのリンクを右クリックしたときに出る (Twitch はチャンネル・VOD のリンクのときだけ入れる。ほかの Twitch のページへのリンクでは何もしない)。開いているマルチビュー画面の空き枠に入れる (空き枠が無くても 16 枠未満なら、枠を 1 つ足して入れる。16 枠が埋まっている画面は飛ばす)。入れられる画面が無ければ `grid.html#add=<ID>` を新しいタブで開き、起動画面を出さずにその動画だけで新しく始める | 文言 `menuAddToTile` | | 対象は watch・live・shorts・youtu.be の URL (`VIDEO_URL_PATTERNS`) と Twitch の URL (`TWITCH_URL_PATTERNS`。`twitchIdFromUrl` で見分ける)。ショートは縦長の枠で入れる。Twitch は `#add=tw:<名前>` / `#add=tw:v:<番号>` |
| 3 | Hakomado の空き枠に追加 (ページ) | メニュー | `contextMenus` の `hakomado-add-page` | YouTube の動画のページ・動画の上、Twitch のページで右クリックしたときに出る。動作は No.2 と同じ (Twitch はチャンネル・VOD のページのときだけ) | 文言 `menuAddToTile` | | 送り先は同じウィンドウの画面を先に、最後に使ったものから (`gridTabsByRecent`)。入れた画面のタブを前に出す |
| 4 | スクリーンショット | ショートカット | `manifest.json` の `commands.screenshot` | マルチビュー画面のタブで押したときだけ、その画面の枠の並び全体を撮る (ほかのタブで押しても何もしない) | 既定 Alt+Shift+S (chrome://extensions/shortcuts で変えられる) | Alt+Shift+S | 説明 `cmdScreenshot` |
| 5 | 取り込み用リンク | リンク | `https://www.youtube.com/watch_videos?video_ids=…&hakomado=<名前>` | Hakomado が入っていれば、マルチビュー画面 (`grid.html#import=…`) に切り替えて 📥 読み込むを開く (保存が主ボタン)。入っていなければ YouTube の一時的な再生リストとして開く | | | `declarativeNetRequest` で `/hakomado_import` に付け替え、`content/import.js` の知らせで `background.js` がタブを切り替える。`hakomado=` の無い watch_videos には何もしない |

### 画面項目状態表

状態: **A** = マルチビュー画面を開いていない / **B** = 開いていて、16 枠は埋まっていない / **C** = 開いていて、送り先の画面の 16 枠が埋まっている

| No | 項目名 | A | B | C | 条件・備考 |
| --- | --- | --- | --- | --- | --- |
| 1 | ツールバーのアイコン | ○ | ○ | ○ | 開いていても、押すたびに新しいタブを開く |
| 2〜3 | Hakomado の空き枠に追加 | ○ 新しいタブで開いて入れる (起動画面は出さずに新しく始める) | ○ 空き枠に入れる (空き枠が無ければ枠を 1 つ足して入れる。もう表示中ならトーストだけ) | ○ 空き枠のある別の画面に入れる。どの画面もいっぱいなら新しいタブで開いて入れる | 入れた画面のタブを前に出す |
| 4 | スクリーンショット | ○ 何も起きない | ○ | ○ | マルチビュー画面のタブで押したときだけ撮る。ほかのタブで押したときは何もしない |
| 5 | 取り込み用リンク | ○ | ○ | ○ | 開いたタブそのものをマルチビュー画面に切り替える。起動画面は出さずに新しく始める |
