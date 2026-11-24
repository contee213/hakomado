# Hakomado プライバシーポリシー / Privacy Policy

[日本語](#日本語) | [English](#english)

最終更新 / Last updated: 2026-11-24

---

## 日本語

Hakomado (以下「この拡張機能」) は、YouTube の配信・動画を 1 つの画面に並べて同時に視聴するための Chrome / Edge 拡張機能です。
個人が作った非公式のツールです。この拡張機能は、開発者が運営するサーバーとは通信しません。

### 集める情報

開発者は、利用者の情報を集めません。アクセス解析・広告・利用状況の送信はしていません。

### ブラウザの中に保存する情報

次の情報は、利用者のブラウザの中 (拡張機能の保存領域) にだけ保存します。開発者や第三者には送りません。

- 枠の並び・レイアウト・設定 (弾幕・チャット・自動再生など)
- 追加したチャンネル、ピックアップ、読み込んだチャンネルパック
- 視聴履歴・あとで見る・再生リスト (見た位置・同期のずれを含む)
- この拡張機能のスクリプトで起きたエラーの記録 (新しい順に最大 100 件。7 日たつと消えます)

### 通信する相手と内容

この拡張機能が通信するのは次の相手だけです。どれも、表示に必要な情報を取りに行くためのもので、上の保存情報は送りません。

| 相手 | 内容 |
| --- | --- |
| YouTube (`www.youtube.com`, `i.ytimg.com`, `yt3.googleusercontent.com`) | 配信・動画・チャンネル・再生リストの情報とサムネイル・チャンネルのアイコン、プレイヤーとライブチャットの表示。設定 →「チャンネル」の「登録チャンネルから選ぶ」を押したときだけ、登録チャンネルの一覧を読みます (選んだチャンネルだけをブラウザの中に保存し、一覧はどこにも送りません)。そうして足したチャンネルがあるときは、アドオン「YouTube の登録チャンネル」(設定 →「アドオン」で OFF にできます) が登録チャンネルのフィードを 2 分に 1 回まで読み、配信中・配信予定を調べます (配信の ID・チャンネル ID・開始予定だけをブラウザの中に一時保存します)。メンバー限定配信も見られるように、ブラウザでログインしている YouTube の Cookie が付きます (YouTube を普通に見るときと同じです) |
| ホロジュール (`schedule.hololive.tv`) | 初期データのチャンネルの配信予定 (設定の「アドオン」で ON のときだけ。初期値は ON)。Cookie は送りません |
| にじさんじ公式サイト (`www.nijisanji.jp`) | にじさんじのライブスケジュール (設定の「アドオン」で「にじさんじ」を ON にしたときだけ。初期値は OFF)。Cookie は送りません |
| ぶいすぽっ!のスケジュールサイト (`www.vspo-schedule.com`。有志による非公式のサイト) | ぶいすぽっ!の配信スケジュール (設定の「アドオン」で「ぶいすぽっ!」を ON にしたときだけ。初期値は OFF)。Cookie は送りません |
| STPR の配信予定のデータ (`schedule-share-json.s3.ap-northeast-1.amazonaws.com`。schedule.stpr.com が使っているもの) | STPR の公式の配信予定 (設定の「アドオン」で「STPR (すとぷり)」を ON にしたときだけ。初期値は OFF)。Cookie は送りません |
| GitHub (`api.github.com`) | 新しい版が出ていないかの確認 (1 日 1 回まで。Chrome ウェブストアから入れた版では行いません)。Cookie は送りません |
| GitHub (`raw.githubusercontent.com`) | 「パックを探す」を押したときだけ、チャンネルパックの一覧と選んだパック。Cookie は送りません |
| 利用者が指定した URL | 利用者が URL を入れて読み込んだチャンネルパックや画像。Cookie は送りません |

「不具合の報告」で「GitHub で報告」を押すと、エラーの記録と環境 (版・ブラウザ・OS) を書き込んだ GitHub の Issue 作成画面を新しいタブで開きます。
この拡張機能からは送信しません。送るかどうか・何を送るかは、利用者が GitHub の画面で確かめて決めます。

共有画面の「𝕏 に投稿」を押すと、X (`x.com`) の投稿画面を新しいタブで開き、共有画像・名前・取り込み用リンクを入れます。
画像を入れるために、初めて押したときに `x.com` へのアクセスの許可を求めます (許可しなくても、画像を貼り付けて使えます)。
この拡張機能は投稿しません。投稿するかどうか・何を投稿するかは、利用者が X の画面で確かめて決めます。

共有画面の「📮 サイトに投稿」を押すと、共有用のサイト Hakomado (`hakomado.contee.net`。開発者が運営) の投稿画面を新しいタブで開き、そのセットのコードを入れます。
コードは URL の「#」の後ろに入れるので、開いただけではサイトに送られません。投稿するかどうかは、利用者がサイトの画面で確かめて決めます (投稿には X でのログインが要ります)。
サイトでの情報の扱いは、[サイトのプライバシーポリシー](privacy-feed.md) に書いています。

これらのサービスでの情報の扱いは、それぞれのプライバシーポリシーに従います
([Google](https://policies.google.com/privacy) / [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) / [X](https://x.com/ja/privacy))。

### 第三者への提供

利用者の情報を、販売・譲渡・共有することはありません。

### 消し方

- 視聴履歴・エラーの記録・再生リストなどは、それぞれの画面から消せます
- ⚙ 設定 →「バックアップ」で、保存している情報をファイルに書き出せます
- この拡張機能を削除すると、ブラウザの中に保存した情報はすべて消えます

### このポリシーの変更

情報の扱いを変えるときは、このページを更新し、上の「最終更新」の日付を直します。変更の履歴は [GitHub のコミット履歴](https://github.com/contee213/hakomado/commits/main/docs/privacy.md) で見られます。

### 問い合わせ

[GitHub の Issues](https://github.com/contee213/hakomado/issues) からお願いします。

---

## English

Hakomado ("the extension") is a Chrome / Edge extension for watching several YouTube streams and videos side by side on one screen.
It is an unofficial tool made by an individual. The extension does not connect to any server run by the developer.

### Information we collect

The developer collects no information about you. The extension has no analytics, no ads, and sends no usage data.

### Information stored in your browser

The following is stored only inside your browser (the extension's storage). It is never sent to the developer or to third parties.

- Tile arrangement, layout and settings (danmaku, chat, auto play, etc.)
- Channels you added, picked-up channels, and channel packs you loaded
- Watch history, Watch later and playlists (including watched positions and sync offsets)
- A record of errors raised by the extension's own scripts (up to 100 entries, newest first; each is deleted after 7 days)

### Who the extension talks to

The extension only connects to the following. Each connection fetches what is needed for display; none of the stored information above is sent.

| Destination | What |
| --- | --- |
| YouTube (`www.youtube.com`, `i.ytimg.com`, `yt3.googleusercontent.com`) | Information and thumbnails for streams, videos, channels and playlists, and channel icons; showing the player and live chat. Only when you press "Choose from subscriptions" in Settings → Channels, your subscriptions list is read (only the channels you pick are saved in your browser; the list is not sent anywhere). While such channels are in your list, the "YouTube subscriptions" add-on (can be turned off in Settings → Add-ons) reads your subscriptions feed at most every 2 minutes to find live and upcoming streams (only video IDs, channel IDs and start times are kept in your browser, temporarily). Requests carry the cookies of the YouTube account you are signed in to in the browser, so members-only streams work (the same as visiting YouTube normally) |
| Holodule (`schedule.hololive.tv`) | Stream schedules for the bundled channels (only while the add-on is on under Settings > Add-ons; on by default). No cookies are sent |
| NIJISANJI website (`www.nijisanji.jp`) | The NIJISANJI live schedule (only while the NIJISANJI add-on is on under Settings > Add-ons; off by default). No cookies are sent |
| VSPO! schedule site (`www.vspo-schedule.com`, an unofficial fan site) | The VSPO! stream schedule (only while the VSPO! add-on is on under Settings > Add-ons; off by default). No cookies are sent |
| STPR schedule data (`schedule-share-json.s3.ap-northeast-1.amazonaws.com`, used by schedule.stpr.com) | The official STPR stream schedule (only while the STPR add-on is on under Settings > Add-ons; off by default). No cookies are sent |
| GitHub (`api.github.com`) | Checking for a newer version (at most once a day; not done in the version installed from the Chrome Web Store). No cookies are sent |
| GitHub (`raw.githubusercontent.com`) | Only when you press "Find packs": the list of channel packs and the pack you choose. No cookies are sent |
| URLs you enter | Channel packs or images you load from a URL. No cookies are sent |

When you press "Report on GitHub" under "Report a problem", the extension opens GitHub's new-issue page in a new tab with the error record and your environment (version, browser, OS) filled in.
The extension itself sends nothing; you review the page on GitHub and decide whether and what to submit.

When you press "𝕏 Post" on the share screen, the extension opens X's (`x.com`) post screen in a new tab and fills in the share image, the name and the import link.
To add the image, it asks for permission to access `x.com` the first time you press it (without it, you can still paste the image yourself).
The extension never posts; you review the post on X and decide whether and what to post.

When you press "📮 Post to the site" on the share screen, the extension opens the post screen of the sharing site Hakomado (`hakomado.contee.net`, run by the developer) in a new tab with that set's code filled in.
The code is placed after the "#" in the URL, so opening the page does not send it to the site. You review it on the site and decide whether to post (posting requires signing in with X).
How the site handles information is described in [the site's privacy policy](privacy-feed.md).

Information on those services is handled under their own privacy policies
([Google](https://policies.google.com/privacy) / [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) / [X](https://x.com/en/privacy)).

### Sharing with third parties

We never sell, transfer or share your information.

### Deleting your data

- Watch history, the error record, playlists and so on can be cleared from their own screens
- ⚙ Settings → "Backup" exports the stored information to a file
- Removing the extension deletes everything it stored in your browser

### Changes to this policy

If the way information is handled changes, this page will be updated along with the "Last updated" date above. The history of changes is in the [GitHub commit history](https://github.com/contee213/hakomado/commits/main/docs/privacy.md).

### Contact

Please use [GitHub Issues](https://github.com/contee213/hakomado/issues).
