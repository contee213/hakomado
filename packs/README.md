# チャンネルパックの一覧

ここに置いたパックは、Hakomado の ⚙ 設定 →「チャンネル」→「パックを探す」に出て、1 クリックで読み込めます。
一覧は `index.json` で、拡張機能は `https://raw.githubusercontent.com/contee213/hakomado/main/packs/` から取ってきます
(main にマージされると、すぐに一覧に出ます)。

パックは利用者が作って投稿した**非公式**のものです。各事務所・配信者とは関係ありません (画面にもそう表示しています)。

## パックを投稿する (PR)

1. パックを作る。Hakomado の ⚙ 設定 →「チャンネル」→「チャンネルパックを書き出す」で、自分のチャンネル一覧から書き出すと楽です。
   形式は [README の「チャンネルパック」](../README.md#チャンネルパック) を見てください
2. `packs/<id>.json` として置く。`<id>` は英小文字・数字・`-` (40 文字まで。例: `nijisanji`、`vspo`)
   - `name` (一覧とチャンネル一覧に出る名前)・`author` (作った人)・`updated` (`YYYY-MM-DD`) を入れる
   - チャンネルごとに `channelId` (`UC` で始まる 24 文字) を必ず入れる。`group` (期・ユニットなど) があると絞り込みに使えます
   - `icon` は YouTube の画像 (`yt3.ggpht.com`・`yt3.googleusercontent.com`・`i.ytimg.com`) だけ。無くてもかまいません
3. `packs/index.json` の `packs` に 1 件足す

   ```json
   {
     "id": "nijisanji",
     "file": "nijisanji.json",
     "name": "パックの name と同じ",
     "nameEn": "英語の画面で出す名前 (任意)",
     "author": "パックの author と同じ",
     "updated": "パックの updated と同じ",
     "channels": 123,
     "description": "どんなパックか (300 文字まで)",
     "descriptionEn": "英語の説明 (任意)"
   }
   ```

4. `npm test` で確かめてから PR を出す (PR でも GitHub Actions が同じテストを回します)。テストが見るもの:
   - 一覧とパックの形式、`name`・`updated`・`channels` (チャンネルの数) が一覧とパックで合っているか
   - 読み込めないチャンネル (ID の形が違う・同じチャンネルが 2 回) が無いか
   - `packs/` のパックがすべて一覧に載っているか

## 配信予定のアドオンから作る (保守者向け)

配信予定のアドオン (`extension/addons/<id>.js`) が配信者の一覧の読み方 (`listChannels`) とパックの名前 (`pack`) を持っていれば、
公式サイトの一覧からパックを作り直せます (今は `nijisanji` → `nijisanji.json`、`holodule` → `hololive.json`)。

```sh
node tools/make-pack.js nijisanji --dry   # 書かずに、増えた・減ったチャンネルだけ見る
node tools/make-pack.js nijisanji         # packs/nijisanji.json と index.json を書き換える
node tools/make-pack.js holodule          # packs/hololive.json (ホロライブ) を作り直す
```

- アドオンのサイト (`origins` の中) から YouTube のチャンネル ID を読み、ハンドル・アイコンは YouTube のチャンネルページで補います (1.5 秒おき。200 件で 5〜6 分)
- 配信予定のサイトに配信者の一覧が無いときは、アドオンの `pack.origins` のサイトから読みます (ホロジュールは公式サイト `hololive.hololivepro.com/talents`。パック作り専用で、拡張機能はここへ通信しません)
- 何人かで使うチャンネル (FUWAMOCO など) は前のパックの名前を残し、並びも前のパックのままにします。中身が変わらなければ `updated` も変えません
- ホロライブのパックは同梱の初期データ (`extension/presets.js`) と同じチャンネルにそろえます。増えた・減ったら presets.js も直します (テストが見ます)
- パックの名前はアドオンの `covers` の条件に合わせてあります (このパックから足したチャンネルは、アドオンで配信状況の確認が軽くなる)
- 書き換えたら差分を見て、いくつかのチャンネルを開いて確かめ、`npm test` を通してから PR にします

## 更新する

チャンネルを足したら `updated` (パックと一覧の両方) と `channels` を直して PR を出してください。
一覧の `updated` が、利用者が読み込んだときより新しいと「更新があります」と出て、増えたチャンネルを足せます
(外したチャンネルは、利用者の一覧からは消えません)。

## 受け入れの基準 (保守者向け)

- YouTube のチャンネル ID が正しいこと (いくつか開いて確かめる)。公式サイトなど、出どころを PR に書いてもらう
- 名前・グループ・説明に、誹謗中傷・誤解を招く書き方 (公式を名乗るなど) が無いこと
- 同じグループのパックが既にあるときは、新しく足すより、今のものを更新する
