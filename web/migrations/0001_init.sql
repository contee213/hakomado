-- 投稿されたセット
CREATE TABLE sets (
  id TEXT PRIMARY KEY,           -- ページの URL に使う (8 文字)
  canon TEXT NOT NULL UNIQUE,    -- 名前を除いたコード。同じセットを 1 件にまとめる
  layout TEXT NOT NULL,          -- レイアウトの ID (u2x2 など)
  ids TEXT NOT NULL,             -- 動画 ID の並び (JSON)
  offsets TEXT,                  -- 同期のずれ (秒、JSON)。無ければ NULL
  ref INTEGER NOT NULL DEFAULT 0, -- 同期の基準の番号
  name TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '', -- 投稿者の名前 (任意)
  videos TEXT NOT NULL,          -- 投稿したときの動画のタイトル・チャンネル名 (JSON)
  opens INTEGER NOT NULL DEFAULT 0,   -- 「Hakomado で開く」の回数 (人気順)
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,  -- 通報が集まって隠したもの
  delete_hash TEXT NOT NULL,     -- 削除用の合言葉の SHA-256
  created_at INTEGER NOT NULL    -- ミリ秒
);
CREATE INDEX sets_new ON sets (hidden, created_at DESC);
CREATE INDEX sets_popular ON sets (hidden, opens DESC, created_at DESC);

-- 投稿の回数制限 (接続元は日ごとに変わるハッシュ。1 日で消す)
CREATE TABLE post_log (
  who TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX post_log_who ON post_log (who, at);

-- 「開く」を同じ接続元から 1 日 1 回だけ数える
CREATE TABLE open_log (
  set_id TEXT NOT NULL,
  who TEXT NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (set_id, who, day)
);
CREATE INDEX open_log_day ON open_log (day);

-- 通報を同じ接続元から 1 セットに 1 回だけ数える
CREATE TABLE report_log (
  set_id TEXT NOT NULL,
  who TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (set_id, who)
);
