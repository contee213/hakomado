# データ定義一覧

拡張機能 (`extension/`) がブラウザの中に保存しているデータの一覧。各データの項目 (名前・型・必須・取りうる値) は [データ定義詳細](data-definitions/) に書く。

- 上限・バックアップに入るか・外との出し入れは [データの入出力](data-io.md) に書く。ここは「何をどんな形で持っているか」だけ。
- 保存するものの形 (キー・項目・型) を変えたら、同じ PR でこの一覧と詳細を直す。
- Hakomado Feed (`web/`) のデータベース (D1) はここに入れない (`web/README.md`)。

**種類:** **作った** = 使う人が作ったもの (消えると取り戻せない) / **設定** = 使う人が選んだ設定 / **取得** = 外から取ったものの一時保存 (取り直せる) / **一時** = 動かすための印・覚え

## chrome.storage.local (すべてのタブで共有、ブラウザを閉じても残る)

| キー | 中身 | 種類 | 書くところ | 詳細 |
| --- | --- | --- | --- | --- |
| `settings` | 共通設定 | 設定 | `grid.js` | [local.md#settings](data-definitions/local.md#settings) |
| `favorites` | チャンネル一覧 (📌 を含む) | 作った | `favorites.js` | [local.md#favorites](data-definitions/local.md#favorites) |
| `presetVersion` | 同梱のチャンネルの版 | 一時 | `favorites.js` | [local.md#presets](data-definitions/local.md#presets) |
| `removedPresets` | 外した同梱のチャンネル | 作った | `favorites.js` | [local.md#presets](data-definitions/local.md#presets) |
| `presetsDeclined` | 同梱のチャンネルを断ったか | 設定 | `favorites.js` | [local.md#presets](data-definitions/local.md#presets) |
| `history` | 視聴履歴 | 作った | `history.js` | [local.md#history](data-definitions/local.md#history) |
| `saved` | あとで見る | 作った | `history.js` | [local.md#saved](data-definitions/local.md#saved) |
| `playlistIndex` | 再生リストの並び順 | 作った | `playlists.js` | [local.md#playlists](data-definitions/local.md#playlists) |
| `playlist:<id>` | 再生リスト 1 件 | 作った | `playlists.js` | [local.md#playlists](data-definitions/local.md#playlists) |
| `playlists` | 以前の版の再生リスト (読んで移すだけ) | 作った | (書かない) | [local.md#playlists](data-definitions/local.md#playlists) |
| `playlistSeeded` | 既定の再生リストを作ったか | 一時 | `playlists.js` | [local.md#playlists](data-definitions/local.md#playlists) |
| `session:<id>` | 視聴セッション (タブごとの枠の並び・中身) | 作った | `grid.js` | [local.md#session](data-definitions/local.md#session) |
| `syncOffsets` | 動画ごとの同期のずれ | 作った | `sync-offsets.js` | [local.md#syncoffsets](data-definitions/local.md#syncoffsets) |
| `movieAnchors` | 動画ごとの本編の位置 | 作った | `movie-anchors.js` | [local.md#movieanchors](data-definitions/local.md#movieanchors) |
| `notices` | 🔔 通知 | 一時 | `grid.js` | [local.md#notices](data-definitions/local.md#notices) |
| `errorLog` | エラーの記録 | 一時 | `errlog.js` (service worker) | [local.md#errorlog](data-definitions/local.md#errorlog) |
| `webOrigins` | URL の枠で許可したサイト | 設定 | `grid.js` (足す)・`background.js` (外れたものを除く) | [local.md#weborigins](data-definitions/local.md#weborigins) |
| `packCatalogImported` | 「パックを探す」から読み込んだパック | 一時 | `packs.js` | [local.md#packcatalogimported](data-definitions/local.md#packcatalogimported) |
| `updateCheck` | 新しい版の確認結果 | 取得 | `update-check.js` | [local.md#updatecheck](data-definitions/local.md#updatecheck) |
| `updateNotified` | お知らせを出した版 | 一時 | `update-check.js` | [local.md#updatecheck](data-definitions/local.md#updatecheck) |
| `ui:<名前>` | 画面の小さな覚え (絞り込み・最後の再生リスト・共有画像の設定・同期パネルの置き方) | 設定 | `ui-prefs.js` | [local.md#ui](data-definitions/local.md#ui) |
| `tourPending` | 使い方ツアーを出す印 | 一時 | `background.js` | [local.md#tourpending](data-definitions/local.md#tourpending) |
| `feed:<チャンネル ID>` (`feed:UULF:…` `feed:UUSH:…`) | チャンネルの再生リストの RSS | 取得 | `favorites.js` | [local.md#feed](data-definitions/local.md#feed) |
| `twpage:<名前>` | Twitch のチャンネルのページ | 取得 | `favorites.js` | [local.md#twpage](data-definitions/local.md#twpage) |
| `videoStates` | 動画ごとの状態 | 取得 | `favorites.js` | [local.md#videostates](data-definitions/local.md#videostates) |
| `fetchBackoff` | 制限 (429) を受けたときの待ち時間 | 一時 | `favorites.js` | [local.md#fetchbackoff](data-definitions/local.md#fetchbackoff) |

## chrome.storage.session (すべてのタブで共有、ブラウザを閉じると消える)

| キー | 中身 | 種類 | 書くところ | 詳細 |
| --- | --- | --- | --- | --- |
| `gridTabs` | 開いているマルチビュー画面のタブ | 一時 | `background.js` | [other.md#gridtabs](data-definitions/other.md#gridtabs) |
| `statusShared` | 配信予定のアドオンの結果・最後に取りに行った時刻 | 取得 | `favorites.js` | [other.md#statusshared](data-definitions/other.md#statusshared) |
| `twvod:<番号>` | Twitch の VOD の開始時刻・題名 | 取得 | `favorites.js` | [other.md#twvod](data-definitions/other.md#twvod) |

## localStorage・sessionStorage (この画面のブラウザだけ)

| 保存先 | キー | 中身 | 種類 | 詳細 |
| --- | --- | --- | --- | --- |
| localStorage | `hakomado.lang` | 表示言語 | 設定 | [other.md#localstorage](data-definitions/other.md#localstorage) |
| sessionStorage | `hakomado.sessionId` `hakomado.startChoice` `hakomado.helpPage` | このタブの視聴セッション・始める内容・使い方で最後に開いたページ | 一時 | [other.md#sessionstorage](data-definitions/other.md#sessionstorage) |
| sessionStorage | `hakomado.settingsTab` `hakomado.libTab` `hakomado.shareTab` | 設定・ライブラリ・受け渡しで最後に開いたタブ | 一時 | [other.md#sessionstorage](data-definitions/other.md#sessionstorage) |

## IndexedDB

| データベース | ストア | 中身 | 種類 | 詳細 |
| --- | --- | --- | --- | --- |
| `hakomado-files` | `handles` | ファイルの枠のファイルの持ち手 | 作った | [other.md#indexeddb](data-definitions/other.md#indexeddb) |

## ファイル

| ファイル | 中身 | 詳細 |
| --- | --- | --- |
| `hakomado-backup-<日付>.json` | バックアップ | [backup.md](data-definitions/backup.md) |

チャンネルパック・視聴セットのコードの形は、それぞれ `packs.js`・`share-code.js` と [data-io.md](data-io.md) の 3 章を見る。
