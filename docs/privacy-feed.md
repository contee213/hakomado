# Hakomado (Web 版) プライバシーポリシー / Privacy Policy

[日本語](#日本語) | [English](#english)

最終更新 / Last updated: 2026-11-22

このページは Web サイト <https://hakomado.contee.net> (共有された視聴セットを集めるサイト) のものです。
Chrome 拡張機能の Hakomado のポリシーは [privacy.md](privacy.md) にあります。

This page covers the website <https://hakomado.contee.net> (a site that collects shared viewing sets).
The policy for the Hakomado Chrome extension is in [privacy.md](privacy.md).

---

## 日本語

個人が作った非公式のサイトです。ログインはなく、アカウントも作りません。

### 投稿したときに保存するもの

- 投稿したセット: 動画の ID・レイアウト・同期のずれ・名前、任意で入れた投稿者の名前とタグ。動画のタイトル・チャンネル名 (YouTube から取ったもの)
- 削除用の合言葉のハッシュ (合言葉そのものは保存しません)
- 「Hakomado で開く」が押された回数、通報の件数

公開で投稿したものは、誰でも一覧・検索から見られます。「リンクを知っている人だけ」で投稿したものは一覧・検索に出ず、検索エンジンにも載せないように伝えますが、リンクを知っている人は見られます。

### 接続元 (IP アドレス) の扱い

荒らし対策 (投稿の回数の制限、「開く」・通報を同じ人から 1 回だけ数える) のために、IP アドレスを**日ごとに変わるハッシュ**にして使います。IP アドレスそのものは保存しません。
投稿の回数の記録と「開く」の記録は 1 日で消します。通報の記録は、そのセットが消えるまで残ります。

### アクセス解析

[Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) で、見られたページ・参照元・国・ブラウザと端末の種類・表示の速さを数えています。
Cookie は使わず、一人ひとりを見分けることはしません。扱いは [Cloudflare のプライバシーポリシー](https://www.cloudflare.com/privacypolicy/) に従います。
広告は出していません。

### ブラウザの中に保存するもの

次のものは、利用者のブラウザ (localStorage) にだけ保存します。

- 自分が投稿したセットの削除用の合言葉 (このブラウザから消せるように)
- 最後に入れた投稿者の名前、画面の言語

### 通信する相手

| 相手 | 内容 |
| --- | --- |
| Cloudflare | サイトの配信・保存 (このサイトは Cloudflare の上で動いています) とアクセス解析 |
| YouTube (`i.ytimg.com`) | サムネイルの表示 |
| YouTube (`www.youtube.com`) | 「Hakomado で開く」を押したときに開くページ。投稿のときは、サーバーから YouTube に動画があるかを確かめます |

### 消し方

- 投稿したセットは、セットのページの「削除・通報」から、投稿したブラウザか削除用の合言葉で消せます
- 合言葉をなくしたときは、[GitHub の Issues](https://github.com/contee213/hakomado/issues) からお知らせください

### 変更・問い合わせ

扱いを変えるときは、このページと上の日付を直します。変更の履歴は [GitHub のコミット履歴](https://github.com/contee213/hakomado/commits/main/docs/privacy-feed.md) で見られます。
問い合わせは [GitHub の Issues](https://github.com/contee213/hakomado/issues) からお願いします。

---

## English

An unofficial site made by an individual. There is no login and no account.

### What is stored when you post

- The set you post: video IDs, layout, sync offsets and name, plus the optional author name and tags. Video titles and channel names (taken from YouTube)
- A hash of the delete key (the key itself is not stored)
- How many times "Open in Hakomado" was pressed, and the number of reports

Public sets can be seen by anyone in the list and search. Sets posted as "Only people with the link" are not shown in the list or search, and search engines are asked not to index them, but anyone with the link can see them.

### How your IP address is used

To prevent abuse (limiting posts, counting "Open" and reports once per person), your IP address is turned into a **hash that changes every day**. The IP address itself is not stored.
Post and "Open" records are deleted after one day. Report records stay until the set is deleted.

### Analytics

[Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) counts pages viewed, referrers, countries, browser and device types, and page speed.
It does not use cookies and does not identify individual visitors. It is handled under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
There are no ads.

### What is stored in your browser

The following is stored only in your browser (localStorage):

- Delete keys for sets you posted (so you can delete them from this browser)
- The author name you last entered, and the display language

### Who the site talks to

| Who | What |
| --- | --- |
| Cloudflare | Hosting and storage (this site runs on Cloudflare) and analytics |
| YouTube (`i.ytimg.com`) | Thumbnails |
| YouTube (`www.youtube.com`) | The page opened by "Open in Hakomado". When you post, the server checks with YouTube that the videos exist |

### Deleting

- You can delete a set you posted from "Delete / report" on its page, from the browser you posted with or with the delete key
- If you lost the key, please let us know via [GitHub Issues](https://github.com/contee213/hakomado/issues)

### Changes and contact

If the way information is handled changes, this page and the date above will be updated. The history of changes is in the [GitHub commit history](https://github.com/contee213/hakomado/commits/main/docs/privacy-feed.md).
Please contact us via [GitHub Issues](https://github.com/contee213/hakomado/issues).
