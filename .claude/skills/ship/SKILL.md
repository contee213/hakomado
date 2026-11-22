---
name: ship
description: ワークツリーの変更をコミット → push → PR → CI を待つ → main にマージ → 元のフォルダの main を pull まで一度に行う。ユーザーが /ship と打ったときだけ使う。
disable-model-invocation: true
---

# /ship: コミットからローカルの main を pull するまで

`/ship` が打たれたことが、この一連の操作 (push・PR 作成・main へのマージを含む) をまとめて行ってよいという指示になる。途中で確認は取らずに進めてよい。ただし下の「止めるとき」に当たったら、そこで止めてユーザーに知らせる。

引数 (`/ship` のあとの文) があれば、コミットメッセージや PR の説明に入れる補足として使う。

## 手順

1. **確かめる**
   - 今のブランチが `main` なら止める (ワークツリーのブランチで作業している前提)。
   - `extension/` の権限・ホスト権限・content scripts・外部への通信を変えたのに `CHROMEWEBSTORE.md` が直っていなければ、先に直す (CLAUDE.md の決まり)。
2. **コミットする**
   - 変更が残っていれば、内容と理由が分かるメッセージでコミットする。最近のコミットに合わせて英語の 1 行の見出しと箇条書きにする。
   - pre-commit フック (`.githooks/pre-commit`) が、`extension/` を変えたコミットで `extension/build.js` の build 番号を上げるので、手で触らない。
   - コミットするものが無く、main より先のコミットも無ければ、何もせずに知らせて終わる。
3. **push して PR を作る**
   - `git push -u origin HEAD`
   - このブランチで開いている PR があれば、それを使う。無ければ `gh pr create --base main` で作る (下書きにはしない)。説明は日本語で、変更内容・理由・確かめたこと (実際の Chrome で試したかどうかも) を書く。
4. **CI を待つ**
   - `gh pr checks <番号> --watch --fail-fast` を background で走らせ、終わるのを待つ (e2e があるので数分かかる)。
   - チェックが落ちたら止める。落ちたチェックの名前とログの要点 (`gh run view --log-failed`) を伝える。直してよいかはユーザーに聞く。
5. **マージする**
   - `gh pr merge <番号> --merge` (これまでの main と同じマージコミットにする)。ブランチはワークツリーが使っているので消さない (`--delete-branch` は付けない)。
   - 衝突などでマージできなければ止めて知らせる。
6. **元のフォルダの main を pull する**
   - `C:\Users\ktets\project\hakomado` で `git pull --ff-only` する。
   - そのフォルダに変更中のファイルがある、`main` 以外のブランチになっている、fast-forward できない、のどれかなら、何もせずに知らせる。
7. **報告する**
   - PR の URL、マージしたこと、pull した版 (`extension/manifest.json` の `version` と `extension/build.js` の build 番号) を伝える。
   - Chrome は元のフォルダの `extension` を読み込んでいるので、「`chrome://extensions` で再読み込みしてください」と添える。

## 止めるとき

次のときは無理に進めず、そこまでの状態 (どこまで済んだか) を伝えて止める。

- テスト・CI が落ちた
- マージで衝突した、またはマージできない状態になっている
- 元のフォルダが pull できない状態になっている
- 消す・上書きするなど、上の手順に無い操作が必要になった
