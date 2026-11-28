# データ定義詳細: chrome.storage.local

[データ定義一覧](../data-definitions.md) の `chrome.storage.local` の各キーの形。上限・バックアップに入るかは [data-io.md](../data-io.md) の 1 章。

**表の見方:** 型は JavaScript の型 (`string` `number` `boolean` `object` `array`)。日時は特に書かない限り `number` のミリ秒 (`Date.now()`)。「必須」が − のものは無いことがある。読むときは、どのキーも形を確かめ、知らない項目やおかしな値は捨てる (各ファイルの `clean`・`adopt`・`valid`)。

共通の ID の形:

| 名前 | 形 | 例 |
| --- | --- | --- |
| YouTube の動画 ID | 英数字と `_` `-` の 11 文字 | `dQw4w9WgXcQ` |
| Twitch の VOD | `tw:v:<数字 1〜12 桁>` | `tw:v:2312345678` |
| Twitch のチャンネル (ライブ) | `tw:<ログイン名 (小文字・数字・_ 1〜25 文字)>` | `tw:lofigirl` |
| YouTube のチャンネル ID | `UC` + 22 文字 | `UCp6993wxpyDPHUpavwDFqgg` |

## settings

共通設定。1 つの `object`。初期値は `grid.js` の `DEFAULT_SETTINGS`。読むときは初期値に重ねる (`{ ...DEFAULT_SETTINGS, ...settings }`) ので、無い項目は初期値になる。バックアップから読むときは、初期値にある項目で同じ型のものだけ取り込む (`backup.js` の `cleanSettings`)。

| 項目 | 型 | 初期値 | 意味・取りうる値 |
| --- | --- | --- | --- |
| `duration` | number | 5 | 弾幕が画面を横切る秒数 |
| `fontScale` | number | 1 | 弾幕の文字の大きさ (倍) |
| `opacity` | number | 0.9 | 弾幕の不透明度 (0〜1) |
| `area` | number | 0.75 | 弾幕を流す高さ (枠の高さに対する割合) |
| `areaPos` | string | `'top'` | 弾幕を流す位置: `top` / `middle` / `bottom` |
| `maxOnScreen` | number | 60 | 一度に出す弾幕の数の上限 |
| `authorName` | string | `'off'` | 弾幕に投稿者名を出す: `off` / `staff` (配信者とモデレーター) / `all` |
| `showPaid` | boolean | true | スーパーチャットなども弾幕に出す |
| `dmFont` | string | `'standard'` | 弾幕のフォント (`grid.js` の `DM_FONTS` のどれか) |
| `dmWeight` | string | `'bold'` | 弾幕の太さ: `normal` / `bold` |
| `hlStyle` | string | `'sky'` | 音が出ている枠の線の色 (`HL_PRESETS` のどれか) |
| `liveStyle` | string | `'pink'` | ライブ配信中の枠の線の色 (`HL_PRESETS` のどれか / `none`) |
| `hlWidth` | number | 2 | 枠の線の太さ (px) |
| `hlGlow` | number | 0.3 | 枠の線の光の強さ |
| `hlAnimate` | boolean | false | 枠の線を動かす |
| `verticalLiveFit` | boolean | true | 縦型の配信と分かったら、枠を縦長 (9:16) に寄せる |
| `expSync` | boolean | false | 実験的な機能: ⏱ アーカイブ同期 (同期の調整の帯・✨ 自動補正・🎬 同時視聴・⏱ 開いて同期を含む) を使うか。OFF なら同期を始めず、入口も出さない (HAKO-50。前の版には無いので、前の版から上げた人も OFF から)。リリース版 (同期のコードが無い) では設定に出さず、true になっていても同期は動かない。値は消さずに残す (HAKO-51) |
| `chatZoom` | number | 0.9 | チャット欄の拡大率 |
| `chatWidth` | number | 0.3 | チャット欄の幅 (割合) |
| `chatHideAvatars` | boolean | false | チャット欄のアイコンを隠す |
| `skipMembersOnly` | boolean | true | 自動再生: メンバーになっていないメンバー限定配信は入れない |
| `cruiseSec` | number | 120 | クルーズでメイン枠を次の配信に回す間隔 (秒) |
| `prestartMin` | number | 10 | 開始の何分前から配信予定の枠を用意するか (0 = しない) |
| `autoArchive` | boolean | false | 自動再生: 配信中が無いときは最近の動画を流す |
| `autoArchiveVideos` | boolean | true | そのとき動画も流す |
| `autoArchiveShorts` | boolean | false | そのときショートも流す |
| `autoPremiereVideos` | boolean | true | プレミア公開の動画も配信と同じに扱う (自動再生・通知) |
| `autoPremiereShorts` | boolean | true | プレミア公開のショートも配信と同じに扱う |
| `autoPickupMain` | boolean | true | 自動再生: 📌 のライブをメイン枠に置く |
| `addons` | string | `''` | アドオンの ON / OFF。`id:on,id:off` の形 (書いていないものは各アドオンの初期値。`addons.js`) |
| `autoMaxTiles` | number | 8 | 自動再生で同時に再生する最大の枠数 |
| `autoLive` | boolean | true | 自動再生の対象: 配信 |
| `autoVideos` | boolean | false | 自動再生の対象: 動画 |
| `autoShorts` | boolean | false | 自動再生の対象: ショート |
| `openAuto` | boolean | false | 開いたら、起動画面を出さずに自動再生で始める |
| `autoTarget` | string | `'all'` | 自動再生のチャンネル: `all` / `fav` (📌 だけ) |
| `noticeTarget` | string | `'all'` | 通知のチャンネル: `all` / `fav` / `off` |
| `feedPickMin` | number | 3 | 📌 のチャンネルの新着 (RSS) を見に行く間隔 (分) |
| `feedOtherMin` | number | 15 | それ以外のチャンネルの間隔 (分) |
| `aiCollab` | boolean | false | ライブラリの 🤝 (コラボの判定) に、Chrome の組み込み AI (Prompt API) を使う。使えない PC では設定を出さない (HAKO-25) |
| `layoutFavs` | string | `''` | レイアウト画面の「お気に入り」に出すレイアウトの id (カンマ区切り) |

**前の版から:** `showAuthor: true` (投稿者名の ON / OFF だった版) で `authorName` が無ければ、`authorName: 'all'` として読む (`loadSettings`)。

## favorites

チャンネル一覧。`array` of チャンネル。並びは足した順。書き込みはロック `hakomado-favorites`。

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `channelId` | string | ○ | YouTube のチャンネル ID か Twitch のチャンネル (`tw:<名前>`)。一覧の中で重ならない |
| `name` | string | ○ | 表示名 |
| `handle` | string | − | `@ハンドル` (YouTube) |
| `icon` | string | − | アイコンの URL (https だけ) |
| `group` | string | − | 所属 (同梱のチャンネルの期など) |
| `nameEn` `groupEn` | string | − | 英語の表示名・所属 (同梱のチャンネル。`presets.js` から写したもの) |
| `pack` | string | − | 足したチャンネルパックの名前 (パックごとに外すため) |
| `preset` | boolean | − | 同梱のチャンネル (`presets.js` の `PRESET_FAVORITES`) なら true |
| `star` | boolean | − | 📌 ピックアップ。外すと項目ごと消す |

```json
{ "channelId": "UCp6993wxpyDPHUpavwDFqgg", "name": "ときのそら", "handle": "@TokinoSora", "group": "0期生", "preset": true, "star": true }
```

## presets

同梱のチャンネル (ホロライブ) の状態。3 つのキー。

| キー | 型 | 意味 |
| --- | --- | --- |
| `presetVersion` | number | 最後に足した同梱の版 (`presets.js` の `PRESET_VERSION`)。上がったら新しい同梱のチャンネルを足す |
| `removedPresets` | array of string | 使う人が外した同梱のチャンネルの ID (次の版で足し直さない) |
| `presetsDeclined` | boolean | 同梱のチャンネルを断った (初めに入れない) |

## history

視聴履歴。`array` of 動画、新しい順。最大 100 件。書き込みはロック `hakomado-history`。動画 1 件の形は `saved` と共通 (`history.js` の `VideoEntry`)。

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `videoId` | string | ○ | YouTube の動画 ID・Twitch の VOD・Twitch のチャンネル (ライブ。視聴履歴だけ) |
| `at` | number | ○ | 枠で読み込んだ日時 (バックアップから戻したものには無いことがある) |
| `title` | string | − | 題名 (300 文字まで) |
| `channel` | string | − | チャンネル名 |
| `handle` | string | − | `@ハンドル` |
| `channelId` | string | − | チャンネル ID |
| `label` | string | − | 枠の名前 |
| `input` | string | − | 枠に入れたときの文字 (URL など) |
| `kind` | string | − | `live` (配信) / `video` (動画) / `short` (ショート)。種類を書く前の版の項目には無い |
| `thumb` | string | − | Twitch の VOD のサムネイル (`https://static-cdn.jtvnw.net/` だけ) |
| `reason` | string | − | 枠から外れた理由: `ended` / `closed` / `members` / `replaced` |
| `removedAt` | number | − | 枠から外れた日時 |

## saved

あとで見る。`array` of 動画、新しい順。最大 100 件 (いっぱいなら足せない)。書き込みはロック `hakomado-saved`。項目は `history` と同じで、`at` は保存した日時。`reason`・`removedAt` はふつう無いが、バックアップから戻したときは残ることがある (`backup.js` の `cleanVideo`)。Twitch のチャンネル (ライブ) は入らない (その配信の VOD にして入れる)。

## playlists

再生リスト。1 件ずつ別のキーに置く。書き込みは `playlists.js` の `mutate` (変わったものだけ書く `writeDiff`)。

| キー | 型 | 意味 |
| --- | --- | --- |
| `playlistIndex` | array of string | 再生リストの id の並び順。新しく作る・バックアップから戻すときは 30 個まで (前の版で 30 個を超えて作ったものは残す) |
| `playlist:<id>` | object | 再生リスト 1 件 (下の表) |
| `playlistSeeded` | boolean | 既定の再生リスト (「新規マイリスト」) を作った。一度作ったら、全部消しても作り直さない |

`playlist:<id>` の中身 (`Playlists.clean`):

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `id` | string | ○ | id (64 文字まで) |
| `name` | string | ○ | 名前 (新しく付けるのは 40 文字まで。前の版の 80 文字までの名前はそのまま) |
| `items` | array | ○ | 動画 (最大 200 本。同期再生の再生リストは 16 本)。項目は下 |
| `sync` | boolean | ○ | 同期再生の再生リスト |
| `layoutId` | string \| null | ○ | 同期再生で並べるレイアウトの id |
| `ref` | string \| null | ○ | 同期再生の基準の動画 (`items` の中の動画) |
| `resume` | object \| null | ○ | 同期再生の続きの位置 `{at: 実際の時刻, pos: 秒, savedAt}` |
| `createdAt` `updatedAt` | number | ○ | 作った・変えた日時 (分からなければ 0) |

`items` の 1 本: `videoId` (YouTube の動画 ID か Twitch の VOD)、`history` と同じ `title` `channel` `handle` `channelId` `label` (80 文字まで) `input` `kind` `thumb`、`offset` (number。同期のずれ、秒)、`watched` (boolean)。

**前の版から:** 以前は全部を `playlists` (1 つの `array`) に置いていた。画面を開いたとき (`Playlists.setup`)、`playlistIndex` が無く `playlists` があれば、それを読んで `playlist:<id>` と `playlistIndex` に分け、`playlists` を消す。`playlistIndex` と `playlists` が両方あるときは、`playlists` を読まずに消す (`readAll`・`writeDiff`)。

## session

視聴セッション。`session:<id>` → `object`。id は `Date.now().toString(36)` + ランダム 5 文字。最大 8 つ (古い `updatedAt` から消す)。枠が 1 つも入っていないものは数によらず消す。開いているタブが使っているものは消さない (`pruneSessions`)。

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `layoutId` | string | ○ | レイアウトの id |
| `anchor` | string | ○ | メインを置く角: `tl` / `bl` / `tr` / `br` |
| `order` | array of number | ○ | レイアウトの k 番目に置く枠の番号 |
| `fit` | string | ○ | `fit` (16:9 に合わせる) / `fill` (ストレッチ) |
| `autoMode` `cruise` `repeatAll` | boolean | ○ | 自動再生・クルーズ・全枠繰り返し |
| `tileBars` | boolean | ○ | 枠のバーを出す |
| `dmAuto` | boolean | ○ | true。枠の `danmaku: null` (自動) を使う版で保存した印 |
| `tiles` | array of 枠 | ○ | 全部の枠 (枠数を減らしても全枠分)。項目は下 |
| `audible` | array of number | − | 音が出ている枠の番号 (`[]` = 全部ミュート)。前の版には無い |
| `updatedAt` | number | ○ | 保存した日時 |

枠 1 つ (`grid.js` の `newTileState`。読むときは知っている項目で、型が同じものだけ取り込む `applySession`):

| 項目 | 型 | 初期値 | 意味 |
| --- | --- | --- | --- |
| `input` | string | `''` | 入れたときの文字 |
| `videoId` | string \| null | null | YouTube の動画 ID か Twitch のチャンネル・VOD |
| `web` | string | `''` | URL の枠の URL (https だけ) |
| `file` | string | `''` | ファイルの枠の持ち手の id (`f` + 数字。IndexedDB のキー) |
| `chat` | boolean | false | チャット欄を出す |
| `danmaku` | boolean \| null | null | 弾幕 (null = 自動) |
| `auto` | boolean | false | 自動再生で入れた枠 |
| `queue` | boolean | false | あとで見るを順に再生中 (保存しても読むときに false) |
| `fill` | boolean | false | 自動再生で、ライブの代わりに最近の動画を入れた枠 |
| `label` | string | `''` | 枠の名前 (ファイルの枠はファイル名) |
| `pan` | number | 0 | 音の左右 (-1〜1、0.01 刻み) |
| `gain` | number | 1 | 音量 (0〜2、0.01 刻み) |
| `delay` | number | 0 | 音を遅らせる秒数 (0〜60、0.01 秒単位) |
| `speed` | number | 1 | 再生速度 (0.1〜4、0.05 刻み。0.25 より遅いのは、同期の調整の帯のグループの速度で 0.1× にしたときだけ) |
| `short` | boolean | false | ショートとして縦長で見せる |
| `corner` | string | `'br'` | ストレッチで残す角 |
| `note` | string | `''` | 説明付きの空き枠の説明 (60 文字まで。「"」・改行は空白)。共有画面で URL の枠・ファイルの枠に書くと、コードに説明付きの空き枠として入る。受け取ったら空き枠の上に出す。中身を入れても消さず、✕ で空き枠に戻すとまた出る (HAKO-49) |

`muted` は保存しない (`audible` で戻す)。**前の版から:** 今は無いメイン + サブのレイアウト (`m<メイン数>s<サブ数>`。例 `m2s4r`) が `layoutId` に入っていれば、メインの数と枠数の近いレイアウトに置き換えて読む (`savedLayoutId`)。`audible` が無い版のセッションは、1 番の枠だけ音を出す。視聴セッションに分ける前の版は、`layoutId` `order` `fit` `autoMode` `danmakuAll` `tiles` を `chrome.storage.local` の最上位のキーに置いていた。あれば視聴セッション 1 つに移して消す (`migrateLegacyStorage`)。枠に `syncOffset` があれば動画のずれ (`syncOffsets`) に移す。`dmAuto` が無い版の `danmaku: true` は null (自動) として読む。

## syncOffsets

動画ごとの同期のずれ。`object`: YouTube の動画 ID → `{o: number (秒、+ = 先へ。0.01 秒単位、±86400 まで), at: 調整した日時}`。0 は記録しない。最大 1000 本 (古い `at` から消す)。書き込みはロック `hakomado-sync-offsets`。

## movieAnchors

動画ごとの本編の位置 (🎬 同時視聴)。`object`: YouTube の動画 ID → 下の `object`。最大 1000 本。

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `at` | number | ○ | 決めた日時 |
| `s` | number | − | 本編の 0:00 に当たる再生位置 (秒、0.01 秒単位、±1 週間まで)。0 も意味がある |
| `g` | 1 | − | `s` は見当で付けた値 |
| `m` | 1 | − | 使う人がこの動画を本編にした |
| `w` | array | − | 配信の画面のタイマーが動き出した所の並び `[[動き出した再生位置 (秒), そのときのタイマーの値 (秒)], ...]` (再生位置の順・0.01 秒単位・最大 200)。値が 0 (か最初の 1 つ) なら新しい作品の始まり、それ以外は同じ作品の続き。作品の 0:00 = 動き出した位置 − 値 (HAKO-49) |
| `k` | number | − | `w` のうち今選んでいる作品 (1 から)。選んだ作品の 0:00 は `s` にも入れる。手で `s` を決め直したら消す |

`s` も `m` も `w` も無いものは捨てる。

**前の版から:** `w`・`k` は HAKO-49 で足した。前の版は `w`・`k` を読まず、`s` だけ使う (選んだ作品の 0:00 が入っているので、そのまま合う)。

## notices

🔔 通知。`array` of 通知、新しい順。最大 50 件。書き込みはロック `hakomado-notices`。

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `videoId` | string | ○ | 始まった配信の YouTube の動画 ID。Twitch のチャンネル (`tw:<名前>`) も書かれるが、読むとき (`readNotices`) に YouTube の形だけ残すので、次に読んだときに消える (不具合。HAKO-6) |
| `channelId` | string | ○ | チャンネル ID |
| `handle` `name` `title` | string | ○ | ハンドル・チャンネル名・題名 (無ければ `''`) |
| `at` | number | ○ | 知らせた日時 |
| `read` | boolean | ○ | 読んだ |

## errorLog

エラーの記録。`array`、新しい順。最大 100 件・7 日。書くのは service worker だけ。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `src` | string | 起きた場所: `grid` / `background` / `watch` / `chat` / `twitch` |
| `kind` | string | `warn` / `error` / `exception` / `rejection` |
| `msg` | string | 内容 (500 文字まで) |
| `t` | number | 最後に起きた日時 |
| `n` | number | 同じ場所・同じ内容が起きた回数 |

## webOrigins

URL の枠で許可したサイト。`array` of string。各要素は `https://*.<ドメイン>/*` の形 (ホスト名の登録されたドメインごと)。許可が外れたものは読むときに除く。

## packCatalogImported

「パックを探す」から読み込んだパック。`object`: パックの名前 → そのパックの更新日 (カタログの `updated` の値)。

## updateCheck

新しい版の確認 (ストア版はしない)。`updateCheck` = `{at: 確かめた日時, latest: 最新の版, url: 入手先, none?: true}`。リリースがまだ無いときは `latest`・`url` が `''` で `none: true` (次は 1 日後に確かめる)。取りに行けなかったときは前の `latest`・`url` (無ければ `''`) を残し、1 時間後に確かめ直す。`updateNotified` = string (お知らせを出した版)。

## ui

画面の小さな覚え (`ui-prefs.js`)。キーは `ui:<名前>`。画面を開いたときにまとめて読み、ほかのタブで変わったら覚え直す。チャンネル・ライブラリ・受け渡しを開くときに読み直す。

| キー | 型 | 取りうる値 | 意味 |
| --- | --- | --- | --- |
| `ui:libScope` | string | `star` / `all` | すべて / ピックアップの絞り込み |
| `ui:libKinds` | array | `live` `video` `short` のうち選んだもの (空・知らない値だけなら 3 つとも) | 種類の絞り込み |
| `ui:libPlaylist` | string | 再生リストの id | 開いていた再生リスト |
| `ui:shareImgLabels` | boolean | | 共有画像の各枠に枠の名前を入れるか |
| `ui:shareAuthor` | string | | 共有画像に描く作者名 |
| `ui:syncDock` | (使わない) | − | 同期の調整パネルの置き方と小窓の位置だった。HAKO-48 でパネルを無くしたので、画面を開いて読んだときに消す |
| `ui:waveH` | number | 90〜 (ドット) | 〰 波形の帯の高さ (HAKO-39。以前の版には無い) |
| `ui:waveRuler` | string | `elapsed` / `clock` | 〰 波形の帯の目盛り (経過時間 / 時刻) (HAKO-39) |

**前の版から (HAKO-8):** localStorage の `hakomado.<名前>` (`libScope` `libKinds` `libPlaylist` `shareImgLabels` `shareAuthor`) は、初めて開いたときに `ui:<名前>` へ移して localStorage から消す。`ui:<名前>` がもうあればそちらを使う。`libKinds` は JSON の文字列から、`shareImgLabels` は `1` / `0` から直す。読めない値は移さずに消す。`hakomado.settingsTab` `hakomado.libTab` `hakomado.shareTab` は移さずに消す (今は sessionStorage)。`hakomado.syncDock` も移さずに消す (パネルを無くした。HAKO-48)。

## tourPending

boolean。インストールしたときに true。画面を開いてツアーを始めたら消す。

## videoStates

動画ごとの状態 (取得)。`object`: 動画 ID → 下の `object`。最大 3000 本。終わったもの 3 日・過ぎた予定 1 日・確かめ直されないもの 7 日で消える。書き込みはロック `hakomado-video-states`。

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `state` | string | ○ | `live` / `upcoming` / `ended` (配信のアーカイブ) / `none` (配信ではない・見られない) |
| `at` | number | ○ | 確かめた日時 |
| `kind` | string | − | 配信中・配信予定の種類: `live` / `video` (プレミア公開の動画) / `short` |
| `startAt` | number | − | 開始 (予定) の日時。終わった配信 (`ended`) は実際の開始 (HAKO-30) |
| `endAt` | number | − | 終わった配信 (`ended`) の実際の終了 (HAKO-30) |
| `title` | string | − | 題名 |
| `channel` `channelId` | string | − | チャンネル名・ID (分かれば) |
| `avail` | string | − | `ok` / `gone` (削除・非公開) / `members` / `blocked` |

**前の版から:** `state` が `live` か `upcoming` で `kind` が無いもの (種類を書く前の版で覚えたもの) は、確かめ直す (`needsCheck`)。

## fetchBackoff

制限 (429) を受けたときの待ち時間。`{backoff?: {until, step}, twBackoff?: {until, step}}` (`backoff` = YouTube、`twBackoff` = Twitch)。`until` = この日時まで取りに行かない、`step` = 段階 (1〜10。待ち時間は 5 分 × 2^(step-1)、最大 60 分)。取れたら消す。
