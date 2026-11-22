-- 公開範囲・タグ・検索・消えた動画の見直し (どれも機能フラグでオンオフする。src/features.mjs)

-- 1 = 一覧・検索に載せる (公開) / 0 = リンクを知っている人だけ (限定公開)
ALTER TABLE sets ADD COLUMN listed INTEGER NOT NULL DEFAULT 1;
-- タグ (JSON の配列。絞り込みには set_tags を使う)
ALTER TABLE sets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
-- 検索用の文字列 (名前・投稿者・タグ・動画のタイトル・チャンネル名を小文字にしてつないだもの)
ALTER TABLE sets ADD COLUMN search TEXT NOT NULL DEFAULT '';
-- 見直しで見つからなかった動画の数と、最後に見直した時刻 (ミリ秒。0 = まだ)
ALTER TABLE sets ADD COLUMN dead INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sets ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS sets_new;
DROP INDEX IF EXISTS sets_popular;
CREATE INDEX sets_new ON sets (hidden, listed, created_at DESC);
CREATE INDEX sets_popular ON sets (hidden, listed, opens DESC, created_at DESC);
CREATE INDEX sets_check ON sets (checked_at);

CREATE TABLE set_tags (
  tag TEXT NOT NULL,
  set_id TEXT NOT NULL,
  PRIMARY KEY (tag, set_id)
);
CREATE INDEX set_tags_set ON set_tags (set_id);

-- 今あるセットの検索用の文字列を作る
UPDATE sets SET search = lower(
  name || ' ' || author || ' ' ||
  COALESCE((SELECT group_concat(COALESCE(json_extract(v.value, '$.title'), '') || ' ' || COALESCE(json_extract(v.value, '$.channel'), ''), ' ')
            FROM json_each(sets.videos) AS v), '')
);
