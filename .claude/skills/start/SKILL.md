---
name: start
description: Jira の HAKO の作業項目を読み、受け入れ条件と実装の計画を見せて OK をもらってから、作業項目を「進行中」にしてブランチを切る。ユーザーが /start <キー> と打ったときだけ使う。
argument-hint: HAKO-<番号>
disable-model-invocation: true
---

# /start: 作業項目から書き始めるまで

引数は Jira の HAKO のキー (例: `HAKO-12`)。無ければ、どの作業項目かを聞く。頼まれた作業に項目が無ければ、先に作り (Story・Bug・Task)、キーを伝える (CLAUDE.md の「Jira と Confluence」)。

Jira・Confluence はサイト `contee213-dev.atlassian.net` を Atlassian MCP で読み書きする。

## 手順

1. **読む**
   - 作業項目 (説明・受け入れ条件・コメント・リンク) を読む。
   - リンクされた Confluence のページ (仕様) を読む。
   - `docs/decisions.md` と、関わる設計の文書 (`docs/design-guide.md`・`docs/screen-flow.md`・`docs/screen-items/`・`docs/data-io.md`) を読む。
2. **受け入れ条件を確かめる**
   - 受け入れ条件が無い、または確かめられない形なら、計画の前に聞く。design-guide.md 10 章のストーリーの「うまくいっている状態」に照らした案を添える。
   - 決まった受け入れ条件は、作業項目の説明に書き足す。
3. **計画を見せて OK を待つ**
   - 受け入れ条件と、実装の計画 (直すファイル、足すテスト、直す設計の文書) を見せる。
   - ユーザーの OK をもらうまで、コードを書かない。直してと言われたら直して、もう一度見せる。
4. **書き始める**
   - OK をもらったら、作業項目を「進行中」にする (Atlassian MCP で遷移する。遷移の名前が違って見つからなければ、無理に進めず伝える)。
   - `main` から、ブランチ `claude/<キー>-<短い英語>` を切る (例: `claude/HAKO-12-drag-ghost`)。
   - コミットの見出しにはキーを入れる (例: 「feat: HAKO-12 ドラッグ中の影を小さくする」)。
   - 書き終えたら `/ship` で出す。
