# Hakomado Feed (web/)

画面に出す名前は「Hakomado」(拡張機能と同じ)。内部 (Worker・D1・MCP・ドキュメント) では Hakomado Feed (`hakomado-feed`) と呼ぶ。

Hakomado で共有された視聴セット (コード `#Hakomado …` / 取り込み用リンク) を集めて一覧にする Web アプリ。
Cloudflare Workers (静的アセット付き) と D1 で動く。拡張機能 (`extension/`) とは別に配信する
(拡張機能からの短縮リンクは `extension/sets-link.js` の機能フラグで、今はオフ)。

本番: <https://hakomado.contee.net> (最初に出した `https://hakomado-feed.contee213.workers.dev` でも同じものが開く)

プライバシーポリシーは [docs/privacy-feed.md](../docs/privacy-feed.md) (画面の下からリンク)。拡張機能のもの (`docs/privacy.md`) とは別。
アクセス解析は Cloudflare Web Analytics (`contee.net` のゾーンの自動挿入。Cookie なし)。読み込めるように `public/_headers` の CSP で
`static.cloudflareinsights.com` (script-src) と `cloudflareinsights.com` (connect-src) を許している。
保存するもの・通信する相手を変えたら、`docs/privacy-feed.md` も直す。

## できること (MVP)

- **一覧** (`/`): 新着・人気 (「Hakomado で開く」を押された回数) の順。カードはレイアウトの形にサムネイルを並べたもの
- **セットのページ** (`/s/:id`): 動画の一覧 (タイトル・チャンネル名・同期のずれ)、「Hakomado で開く」、コードのコピー。OGP 付き
- **投稿** (`/post`): コードかリンクを貼る、または共有画像の QR を読む。投稿者の名前は任意
- **削除・通報**: 投稿すると削除用の合言葉が出る (投稿したブラウザにも保存)。通報が 3 件集まると隠す

機能フラグでオンオフするもの (下の「機能フラグ」):

- **公開範囲** (`unlisted`): 「リンクを知っている人だけ」で投稿できる。一覧・検索に出ず、ページは検索エンジンに載せない (`noindex`)
- **拡張機能の短縮リンク** (`extShare`): 拡張機能の共有画面から送られたセットを限定公開で入れ、`/s/:id` の短いリンクを返す。
  拡張機能が短縮リンクを読むときの 1 件の読み出しも受け付ける
- **タグ** (`tags`): 投稿に 5 個まで付け、一覧をタグで絞り込む (`/?tag=…`)。よく使われているタグを上部バーの選択肢に出す
- **検索** (`search`): 名前・投稿者・タグ・動画のタイトル・チャンネル名から探す (`/?q=…`。空白で区切ると全部を含むもの)
- **消えた動画の見直し** (`videoCheck`): Cron で 1 時間ごとに、7 日以上見直していないセットの動画を oEmbed で確かめ直す。
  見つからない動画に印を付け、ページとカードに「消えた動画 n 本」と出す。全部消えたセットは一覧に出さない
- **英語の画面** (`en`): ブラウザの言語に合わせて英語で出し、下の「English / 日本語」で切り替えられる

「Hakomado で開く」は取り込み用リンク (`https://www.youtube.com/watch_videos?…&hakomado=`) を開くだけ。
Hakomado を入れていればマルチビュー画面で開き、入れていなければ YouTube の一時的な再生リストとして開く。

## 仕組み

- `tools/build.js` が、拡張機能の `share-code.js`・`layouts.js`・`layouts-generated.js` と jsQR を
  `src/gen/ext.mjs` (Worker 用に export を付けたもの) と `public/js/ext/` (画面用のコピー) に置く。どちらも生成物で git には入れない。
  `wrangler dev` / `wrangler deploy` のたびに自動で動く (`wrangler.jsonc` の `build`)
- コードの読み書きは拡張機能と同じ関数を使うので、コードの形を変えたらこちらにもそのまま反映される
- `src/worker.mjs`: `/api/*`・`/mcp`・`/s/:id`・`/post`・`/config.js` だけ Worker を通す (認証・CORS もここ)。ほかは `public/` の静的アセット。
  Cron (`scheduled`) もここ
- `src/features.mjs`: 機能フラグを読む。`/config.js` (`window.SETS_CONFIG`) で画面にも渡し、オフの機能の欄・ボタンは出さない
- `public/js/i18n.js`: 画面の文言 (日本語・英語)。HTML は日本語で書き、`data-i18n` の付いた要素を英語に差し替える
- `public/index.html`: 画面は 1 枚だけ。上部バーは固定の枠で、その下の中身 (一覧・セット・投稿) を `public/js/app.js` が入れ替える
  (ページは読み込み直さない。一覧は隠して残すので、セットを見て戻っても読み込んだ所とスクロールの位置がそのまま)。
  `/s/:id` と `/post` も Worker がこの画面を返し、`/s/:id` ではタイトルと OGP をそのセットのものにする
- `public/js/list.js`・`set.js`・`post.js`: 一覧・セット・投稿の中身
- `public/js/bar.js`: 上部バー (検索・並び順・タグ)。一覧の条件を持ち、変えると一覧に切り替わる。ほかの画面ではロゴで絞り込んだままの一覧に戻る
- `src/sets.mjs`: セットの読み書き (D1)。REST の API と MCP (`src/mcp.mjs`) の両方から使う
- `src/core.mjs`: D1・fetch に触らない部分 (テストは `tests/web.test.js`。ルートの `npm test` で動く)
- 投稿のときに YouTube の oEmbed で動画があるかを確かめ、タイトル・チャンネル名を保存する
- 荒らし対策: 同じ接続元からの投稿は 1 時間に 10 件まで (接続元は日ごとに変わるハッシュで持ち、1 日で消す)、
  同じセット (名前を除いて同じ) は 1 件にまとめる、Turnstile (設定したときだけ)。
  限定公開は名前も含めて、限定公開どうしでだけまとめる (付けた名前のままのリンクになるように。公開のものとは混ぜない)

## API

| メソッド・パス | トークン | 内容 |
|---|---|---|
| `GET /api/sets?sort=new\|popular&page=0&tag=…&q=…` | 不要 | 一覧 (公開のものだけ。24 件ずつ。`more` が true なら次のページがある。`tag`・`q` は機能フラグがオンのときだけ効く) |
| `GET /api/sets/:id` | 不要 | 1 件 (コード `code`、取り込み用リンク `link`、`listed`・`tags`・`dead` 付き。限定公開のものも読める) |
| `GET /api/layouts` | 不要 | 使えるレイアウト |
| `GET /api/tags` | 不要 | よく使われているタグ (`tags` がオンのとき) |
| `GET /api/config` | 不要 | 機能フラグと Turnstile のサイトキー (画面は `/config.js` で同じものを読む) |
| `POST /api/sets` | 任意 | 投稿。下を参照 |
| `POST /api/sets/:id/delete` | 任意 | 削除。トークンが無ければ `{"key": "削除用の合言葉"}` が要る |

POST の本文は JSON だけ受け付ける (`content-type: application/json`)。

投稿 (`POST /api/sets`) の本文は `{ "text": "コードかリンク", "author": "…", "tags": "空白区切り" か配列, "unlisted": true }`
(`tags`・`unlisted` は機能フラグがオンのときだけ効く。オフなら無視して、タグなしの公開にする)。
返すのは `{ id, url, listed, deleteKey }` (同じセットがもうあれば `{ id, url, listed, existed: true }`)。

**拡張機能から** (`extShare`): Origin が `chrome-extension://<ID>` の投稿は Turnstile なしで受け付け、`text` だけを使っていつも限定公開で入れる
(回数の制限は掛ける)。CORS は拡張機能のページにだけ、`POST /api/sets` と `GET /api/sets/:id` で許す。
`EXT_IDS` (カンマ区切り。`wrangler.jsonc` の vars) に書いた ID の拡張機能だけにする (ストア版 `bhmbchggpdficakjfllkmfkpbdpddomp` と GitHub のリリースの ZIP 版 `lhafnnpnfpgogdbapeepkgohemnnifpp` を入れてある。空にすると、どの拡張機能からでも受け付ける)。
開発用のフォルダから読み込んだ拡張機能 (ID が違う) で試すときは、`web/.dev.vars` に `EXT_IDS=` (空) を書いて上書きする。
Origin は Turnstile を通らない呼び出しでも名乗れるので、ここから入るものは限定公開 (一覧に出ない) にだけして、荒らしが一覧に出ないようにしている。

**トークン**: `Authorization: Bearer <API_TOKEN>` を付けると、定期的なタスクなどから投稿する用になる。

- Turnstile と回数の制限 (1 時間に 10 件) を掛けない。投稿は `source: "api"` として記録する
- コード・リンク (`text`) のほかに、動画の並びでも投稿できる:

```json
{
  "videos": ["https://www.youtube.com/watch?v=xxxxxxxxxxx", "yyyyyyyyyyy"],
  "layoutId": "u1x2",
  "name": "セットの名前",
  "offsets": [0, 1.5],
  "ref": 0,
  "author": "Claude"
}
```

`layoutId` を省くと本数に合う均等のレイアウトになる。`offsets` (同期のずれ、秒) と `ref` (同期の基準にする動画の番号) は任意。
名前を除いて同じセットがもうあれば、新しく作らずにそれを返す (`existed: true`)。

## MCP

`/mcp` が MCP のサーバー (Streamable HTTP。状態を持たない形で、JSON で返す)。
道具は `list_sets`・`get_set`・`list_layouts`・`list_tags`・`post_set`・`delete_set` で、中身は上の API と同じ。
機能フラグがオフの道具 (`list_tags`) と引数 (`tag`・`q`・`tags`・`unlisted`) は `tools/list` に出さない。

つなぎ方は 2 つ。どちらも持ち主だけが使える:

| | 使うもの | 認証 |
|---|---|---|
| OAuth (`src/oauth.mjs`) | claude.ai のコネクタ、クラウドの定期タスク (claude.ai のコネクタを使う) | OAuth 2.1 (クライアントの自動登録・PKCE)。許可の画面 `/authorize` は Cloudflare Access の後ろにあり、Access の証明書のメールが `OWNER_EMAIL` の人にだけ出る |
| トークン | Claude Code・スクリプト | `Authorization: Bearer <API_TOKEN>` |

OAuth は `@cloudflare/workers-oauth-provider` が受け持つ (メタデータ `/.well-known/oauth-*`、登録 `/oauth/register`、トークン `/oauth/token`)。
クライアント・許可・トークン (ハッシュ) は KV `OAUTH_KV` に入る。設定:

- vars: `PUBLIC_ORIGIN` (OAuth の resource = `<PUBLIC_ORIGIN>/mcp`。コネクタにはこの URL を入れる)・`ACCESS_TEAM_DOMAIN`・`ACCESS_AUD` (`/authorize` を守る Access のアプリの AUD)
- シークレット: `OWNER_EMAIL` (許可できる人のメールアドレス。Access でログインするもの)
- Access: 本番は `hakomado.contee.net/authorize` だけを守るアプリ (ポリシーは自分)。ステージングは Worker 全体を守っているので、
  claude.ai のサーバー (Anthropic の送信元 IP `160.79.104.0/21`・`153.61.208.0/20`) を通す Bypass のポリシーを足してある
  (そこから来ても `/mcp` は OAuth のトークン、`/authorize` は Access の証明書が無いと使えない)

claude.ai からつなぐ: 設定 → コネクタ → カスタムコネクタを追加 で、URL に `https://hakomado.contee.net/mcp` (ステージングは
`https://hakomado-feed-staging.contee213.workers.dev/mcp`) を入れて接続する。Access のログイン → 許可の画面 →「許可する」で戻る。

Claude Code から使うとき (`.mcp.json` か `claude mcp add`):

```json
{
  "mcpServers": {
    "hakomado-feed": {
      "type": "http",
      "url": "https://hakomado.contee.net/mcp",
      "headers": { "Authorization": "Bearer ${HAKOMADO_SETS_TOKEN}" }
    }
  }
}
```

ステージングは Access の後ろなので、`CF-Access-Client-Id`・`CF-Access-Client-Secret` (Access のサービストークン) も付ける。

## ローカルで動かす

```sh
cd web
npm install
npm run db:migrate:local
npm run dev            # http://localhost:8787
```

API・MCP をトークン付きで試すときは、`web/.dev.vars` (git には入れない) に `API_TOKEN=<適当な長い文字列>` を書いてから `npm run dev`。

MCP の OAuth を手元で試すときは、`.dev.vars` に `PUBLIC_ORIGIN=http://localhost:8787` と `ACCESS_TEAM_DOMAIN=` (空。localhost のときだけ
Access なしで許可の画面を出す) を足す。`wrangler.jsonc` の `routes` (本番のドメイン) があると `wrangler dev` の URL が本番のものになり
OAuth の resource と合わないので、`routes` を消した設定のコピーを `-c` で渡して起動する。

Cron (消えた動画の見直し) を試すときは `npx wrangler dev --test-scheduled` で起動し、`http://localhost:8787/cdn-cgi/handler/scheduled` を開く。

## 機能フラグ

`wrangler.jsonc` の `vars.FEATURES` で、機能ごとに `true` / `false` を決める (書いていないものはオフ)。
`.dev.vars` では `FEATURES='{"tags":true,"search":true}'` のように JSON の文字列 (か `FEATURES=tags,search`) で上書きできる。

| フラグ | 内容 | オフにしたとき |
|---|---|---|
| `unlisted` | 公開範囲 (リンクを知っている人だけ) | 投稿はすべて公開。入っている限定公開のセットは、リンクから見られるまま |
| `extShare` | 拡張機能の短縮リンク (`unlisted` も要る) | 拡張機能からの呼び出しを CORS で許さない (拡張機能には「短縮リンクを作れませんでした」と出る) |
| `tags` | タグ | 欄・絞り込み・`/api/tags` を出さない。付いているタグは残る |
| `search` | 検索 | 欄を出さず、`q` を無視する |
| `videoCheck` | 消えた動画の見直し (Cron) | 見直さない。付けた印は残る |
| `en` | 英語の画面 | いつも日本語 |

拡張機能の側の短縮リンクは、拡張機能に入っている `extension/sets-link.js` の `ENABLED` で別にオンオフする
(オンにする手順はルートの `CHROMEWEBSTORE.md` の「短縮リンク」)。

## Cloudflare に出す

環境は 3 つ:

| 環境 | 場所 | D1 | 使いどころ |
|---|---|---|---|
| ローカル | `npm run dev` (http://localhost:8787) | 手元 (`.wrangler/`) | ふだんの開発 |
| ステージング | https://hakomado-feed-staging.contee213.workers.dev (Cloudflare Access で自分だけ) | `hakomado-feed-staging` | 本番に出す前に、Cloudflare の上で確かめる |
| 本番 | https://hakomado.contee.net | `hakomado-feed` | 公開 |

`wrangler dev --remote` は使わない (本番の D1 につながる)。

直したものを出すときは、`web/` のあるフォルダ (リポジトリ全体。ビルドで `../extension` を読む) で、ステージング → 本番の順に:

```sh
cd web
npm install
npm run db:migrate:staging  # migrations/ に足したものがあるときだけ
npm run deploy:staging      # ステージングで確かめてから ↓
npm run db:migrate:remote   # migrations/ に足したものがあるときだけ
npm run deploy
```

ステージングは `wrangler.jsonc` の `env.staging`。wrangler の環境は `vars`・`d1_databases` を上から引き継がない
(`routes`・`triggers` は引き継ぐ) ので、本番の設定を変えたらステージングの側も直す (`npm test` がずれを見つける)。
ステージングの Cron は 1 日 1 回 (3:23 UTC)。シークレットは本番とは別 (`npx wrangler secret put <名前> --env staging`)。
`API_TOKEN` を入れるまでは、ステージングの `/mcp` は閉じている。

ステージングを自分だけが見られるようにする (Cloudflare Access。一度だけ):
ダッシュボードの Workers & Pages → `hakomado-feed-staging` → Settings → Domains & Routes で、`workers.dev` の
「Cloudflare Access」をオンにする。Access の画面でログインできる人 (自分のメールアドレス) を決める。
Access を掛けると、ブラウザ以外 (curl・MCP・拡張機能の短縮リンク) は Access のサービストークンが無いと通らない。

ドメイン (`hakomado.contee.net`) は `wrangler.jsonc` の `routes` (`custom_domain`)。`contee.net` は同じアカウントの
Cloudflare のゾーンなので、DNS レコードと証明書はデプロイのときに自動で作られる (同じ名前のレコードを手で作らない)。

最初に出したときの手順 (別のアカウントに出し直すとき):

```sh
cd web
npx wrangler login
npx wrangler d1 create hakomado-feed      # 出てきた database_id を wrangler.jsonc の DB の欄に書く。
                                          # wrangler が d1_databases に 2 つ目の欄を足して書式も変えるので、それは戻す
npm run db:migrate:remote
npx wrangler secret put IP_SALT           # 接続元のハッシュに混ぜる値 (長いランダムな文字列)
npx wrangler secret put API_TOKEN         # API・MCP のトークン (長いランダムな文字列。設定しなければ /mcp は閉じたまま)
npm run deploy
```

シークレットは暗号用の乱数で作る (PowerShell の例。`IP_SALT` は値を控えなくていいので、そのまま流し込む):

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) | npx wrangler secret put IP_SALT
```

同じ名前でもう一度 `secret put` すると上書きされ、すぐに本番に効く (デプロイし直さなくていい)。
`API_TOKEN` は Cloudflare からは読み出せないので、パスワード管理アプリなどに控えておく。

Turnstile を使うときは、Cloudflare のダッシュボードでウィジェットを作り、サイトキーを `wrangler.jsonc` の
`TURNSTILE_SITE_KEY` に、シークレットを `npx wrangler secret put TURNSTILE_SECRET` で入れる。

GitHub から自動で出すときは、Workers Builds で「ルートディレクトリ」を `web`、
ビルドを動かすパスを `web/**` と `extension/share-code.js`・`extension/layouts*.js` にする
(拡張機能だけを直したときにデプロイが走らないように)。

## まだ無いもの

- X アカウントでのログイン (MCP の OAuth の許可の画面のログインも、作るならここに差し替えられる)
- 拡張機能で作った短縮リンクを消す手段 (拡張機能は削除用の合言葉を持っていない)
- セットのページの OGP (タイトル・説明) の英語
