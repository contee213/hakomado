# データ定義詳細: バックアップのファイル

設定 › バックアップ「ファイルに書き出す」で作る `hakomado-backup-<日付>.json` の形 (`backup.js`)。出し入れの動きは [data-io.md](../data-io.md) の 3 章。

## 全体

| 項目 | 型 | 必須 | 意味 |
| --- | --- | --- | --- |
| `app` | string | ○ | `hakomado` (違えば読まない) |
| `format` | number | ○ | ファイルの形の版。今は 1。読む側より新しいとき・整数でないとき・無いときは断る (`tooNew`) |
| `version` | string | − | 書き出した拡張機能の版 (読むときは使わない) |
| `exportedAt` | string | − | 書き出した日時 (ISO 8601) |
| `lang` | string | − | 表示言語 `auto` / `ja` / `en` |
| `data` | object | ○ | 中身 (下の表) |

## data

各項目の形は [local.md](local.md) の同じ名前のキーと同じ。読むときは確かめて、知っている項目・正しい形の値だけ取り込む (下の「読むときに捨てるもの」)。

| 項目 | 型 | 元のキー | 読むときの上限 |
| --- | --- | --- | --- |
| `settings` | object | `settings` | 初期値にある項目で、初期値と同じ型のものだけ |
| `favorites` | array | `favorites` | 2000 件。`channelId` で重なりを除く |
| `presetVersion` | number | `presetVersion` | 0 以上の整数 |
| `removedPresets` | array of string | `removedPresets` | チャンネル ID の形のものだけ |
| `presetsDeclined` | boolean | `presetsDeclined` | |
| `history` | array | `history` | 100 件 |
| `saved` | array | `saved` | 100 件 |
| `playlists` | array of 再生リスト | `playlistIndex` の順の `playlist:<id>` | 30 個 (`Playlists.clean` で確かめる) |

## 読むときに捨てるもの

- チャンネル: ID の形が違うもの。項目は `channelId` `handle` `name` `nameEn` `group` `groupEn` `pack` `icon` (https だけ) `preset` `star` だけ残す。`name` が無ければ `handle` か `channelId` を入れる。
- 履歴・あとで見る: 動画 ID の形が違うもの (Twitch のチャンネルのライブは履歴だけ)。`at` `removedAt` は数のときだけ、`reason` は決まった値のときだけ。
- 文字の項目は 300 文字まで。

## 入らないもの

視聴セッション・同期のずれ・本編の位置・通知・エラーの記録・取得結果 (`feed:*` など)・画面の小さな覚え (`ui:*`)・この画面のブラウザだけのもの (localStorage など。表示言語は `lang` に入る)・ファイルの枠の持ち手。
