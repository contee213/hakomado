# Hakomado セット集 (web/)

Hakomado で共有された視聴セット (コード `#Hakomado …` / 取り込み用リンク) を集めて一覧にする Web アプリ。
Cloudflare Workers (静的アセット付き) と D1 で動く。拡張機能 (`extension/`) とは別に配信する
(拡張機能からの短縮リンクは `extension/sets-link.js` の機能フラグで、今はオフ)。

## できること (MVP)

- **一覧** (`/`): 新着・人気 (「Hakomado で開く」を押された回数) の順。カードはレイアウトの形にサムネイルを並べたもの
- **セットのページ** (`/s/:id`): 動画の一覧 (タイトル・チャンネル名・同期のずれ)、「Hakomado で開く」、コードのコピー。OGP 付き
- **投稿** (`/post`): コードかリンクを貼る、または共有画像の QR を読む。投稿者の名前は任意
- **削除・通報**: 投稿すると削除用の合言葉が出る (投稿したブラウザにも保存)。通報が 3 件集まると隠す

機能フラグでオンオフするもの (下の「機能フラグ」):

- **公開範囲** (`unlisted`): 「リンクを知っている人だけ」で投稿できる。一覧・検索に出ず、ページは検索エンジンに載せない (`noindex`)
- **拡張機能の短縮リンク** (`extShare`): 拡張機能の共有画面から送られたセットを限定公開で入れ、`/s/:id` の短いリンクを返す。
  拡張機能が短縮リンクを読むときの 1 件の読み出しも受け付ける
- **タグ** (`tags`): 投稿に 5 個まで付け、一覧をタグで絞り込む (`/?tag=…`)。よく使われているタグを一覧の上に出す
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
- `src/worker.mjs`: `/api/*`・`/mcp`・`/s/:id`・`/config.js` だけ Worker を通す (認証・CORS もここ)。ほかは `public/` の静的アセット。
  Cron (`scheduled`) もここ
- `src/features.mjs`: 機能フラグを読む。`/config.js` (`window.SETS_CONFIG`) で画面にも渡し、オフの機能の欄・ボタンは出さない
- `public/js/i18n.js`: 画面の文言 (日本語・英語)。HTML は日本語で書き、`data-i18n` の付いた要素を英語に差し替える
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
`EXT_IDS` (カンマ区切り。`npx wrangler secret put` か vars) を設定すると、その ID の拡張機能だけにする。
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

`/mcp` が MCP のサーバー (Streamable HTTP。状態を持たない形で、JSON で返す)。`API_TOKEN` を設定するまでは閉じている (404)。
道具は `list_sets`・`get_set`・`list_layouts`・`list_tags`・`post_set`・`delete_set` で、中身は上の API と同じ。
機能フラグがオフの道具 (`list_tags`) と引数 (`tag`・`q`・`tags`・`unlisted`) は `tools/list` に出さない。

Claude Code から使うとき (`.mcp.json` か `claude mcp add`):

```json
{
  "mcpServers": {
    "hakomado-sets": {
      "type": "http",
      "url": "https://<デプロイ先>/mcp",
      "headers": { "Authorization": "Bearer ${HAKOMADO_SETS_TOKEN}" }
    }
  }
}
```

認証はトークン (Bearer) だけ。claude.ai のコネクタ (カスタムコネクタ) やクラウドで動く定期タスクのように、
OAuth で接続するものからはまだつなげない (つなぐなら OAuth の口を足す)。

## ローカルで動かす

```sh
cd web
npm install
npm run db:migrate:local
npm run dev            # http://localhost:8787
```

API・MCP をトークン付きで試すときは、`web/.dev.vars` (git には入れない) に `API_TOKEN=<適当な長い文字列>` を書いてから `npm run dev`。

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

## Cloudflare に出す (初回)

```sh
cd web
npx wrangler login
npx wrangler d1 create hakomado-sets      # 出てきた database_id を wrangler.jsonc に書く
npm run db:migrate:remote              # 0003_features.sql (公開範囲・タグ・検索・見直し) もここで入る
npx wrangler secret put IP_SALT           # 接続元のハッシュに混ぜる値 (長いランダムな文字列)
npx wrangler secret put API_TOKEN         # API・MCP のトークン (長いランダムな文字列。設定しなければ /mcp は閉じたまま)
npm run deploy
```

Turnstile を使うときは、Cloudflare のダッシュボードでウィジェットを作り、サイトキーを `wrangler.jsonc` の
`TURNSTILE_SITE_KEY` に、シークレットを `npx wrangler secret put TURNSTILE_SECRET` で入れる。

GitHub から自動で出すときは、Workers Builds で「ルートディレクトリ」を `web`、
ビルドを動かすパスを `web/**` と `extension/share-code.js`・`extension/layouts*.js` にする
(拡張機能だけを直したときにデプロイが走らないように)。

## まだ無いもの

- X アカウントでのログイン、MCP の OAuth (claude.ai のコネクタ・クラウドの定期タスクからつなぐのに要る)
- 拡張機能で作った短縮リンクを消す手段 (拡張機能は削除用の合言葉を持っていない)
- セットのページの OGP (タイトル・説明) の英語
