# データ定義詳細: chrome.storage.session・localStorage・sessionStorage・IndexedDB

[データ定義一覧](../data-definitions.md) の、`chrome.storage.local` 以外の保存先の形。表の見方は [local.md](local.md) と同じ。

## chrome.storage.session

すべてのタブと service worker で共有し、ブラウザを閉じると消える。

### gridTabs

開いているマルチビュー画面のタブ。`array` of number (タブの id、登録した順)。最後に使った順に並べるのは読むとき (`gridTabsByRecent`)。閉じたタブは書くときに除く。右クリックの追加の送り先と、X-Frame-Options を外すルールの対象のタブ (`background.js`)。

### statusShared

配信状況の取得のうち、ブラウザを開き直したら使わないもの (`favorites.js`)。1 つの `object`。書き込みはロック `hakomado-status-store`。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `sched3` | object | 配信予定のアドオンの結果。アドオンの id → `{at: 取った日時, byKey}`。`byKey` はチャンネル ID か `@ハンドル` (小文字) → 枠の `array` `[{videoId, live: boolean, startAt?: number}]` |
| `lastYtFetch` | number | YouTube のページを最後に取りに行った日時 (間を空けるため) |
| `lastFeedFetch` | number | RSS を最後に取りに行った日時 |
| `lastTwFetch` | number | Twitch を最後に取りに行った日時 |

**前の版から:** `sched2` (ホロジュールだけだったころの結果) は、`sched3` を書くときに消す。HAKO-2 より前の版は `backoff`・`twBackoff` もここに置いていた (今は読まない。`chrome.storage.local` の `fetchBackoff`)。

### twvod

`twvod:<VOD の番号>` → `{at: 取った日時, start: 配信が始まった日時, title: string, channel: string}`。Twitch の VOD のページから読む (アーカイブの同期再生・枠の情報用)。変わらない値なので、取れたら取り直さない。`title` が無いもの (前の版の形) は取り直す。

## localStorage

この画面 (拡張機能のページ) のブラウザだけ。値は文字列。表示言語だけを置く (画面を描く前に同期して読むため)。ほかの画面の覚えは chrome.storage.local の [`ui:<名前>`](local.md#ui) と下の sessionStorage。

| キー | 値 | 意味 |
| --- | --- | --- |
| `hakomado.lang` | `ja` / `en` (無ければ自動) | 表示言語。バックアップの `lang` にも入る (`i18n.js`) |

**前の版から (HAKO-8):** ほかの `hakomado.*` は [local.md#ui](local.md#ui) のとおり移すか消す。

YouTube の視聴ページの中 (`content/watch-main.js`) は、YouTube 自身の `yt-player-volume` を読み書きする (YouTube のサイトの localStorage。Hakomado のデータではない)。

## sessionStorage

このタブだけ。タブを閉じると消える。

| キー | 値 | 意味 |
| --- | --- | --- |
| `hakomado.sessionId` | 視聴セッションの id | このタブで使っている視聴セッション (再読み込みで同じセッションに戻る) |
| `hakomado.startChoice` | `new` / `read` / `auto` / `resume:<id>` | ロゴから選んで開き直したときに始める内容。読んだら消す |
| `hakomado.helpPage` | 使い方のページの名前 | 使い方で最後に開いたページ |
| `hakomado.settingsTab` | 設定のタブの名前 | 設定で最後に開いたタブ (`grid.js` の `TabMemory`) |
| `hakomado.libTab` | `archive` / `history` / `saved` / `playlists` (無い・知らない値なら `archive`) | ライブラリで最後に開いたタブ (チャンネルは覚えない) |
| `hakomado.shareTab` | 受け渡しのタブの名前 | 受け渡しで最後に開いたタブ |

## IndexedDB

### hakomado-files

ファイルの枠のファイルの持ち手 (`local-files.js`)。データベース `hakomado-files` (版 1)、ストア `handles`。

| | 型 | 意味 |
| --- | --- | --- |
| キー | string | 枠の `file` (`f` + 数字) |
| 値 `handle` | FileSystemFileHandle | ファイルの持ち手 (ファイルの中身は入れない) |
| 値 `at` | number | 覚えた日時 |

どの視聴セッションの枠にも入っていない持ち手は、画面を開いたときに消す。覚えてから 10 分以内のものは消さない (`pruneLocalFiles`)。
