-- X でログイン (機能フラグ xLogin。src/xauth.mjs)

-- 投稿した人の X のユーザー ID (ログインして投稿したときだけ。自分の投稿の一覧・合言葉なしの削除に使う)
ALTER TABLE sets ADD COLUMN owner_x TEXT;
CREATE INDEX sets_owner ON sets (owner_x, created_at DESC);

-- ログインの状態。id_hash = Cookie の値の SHA-256 (Cookie の値そのものは持たない)
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  username TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_x ON sessions (x_id);
CREATE INDEX sessions_exp ON sessions (expires_at);

-- X のログインの途中 (state と PKCE の verifier。10 分で使えなくなる)
CREATE TABLE x_login (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
