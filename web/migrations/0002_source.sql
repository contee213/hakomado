-- どこから投稿されたか: web = 投稿フォーム / api = トークンを使った API・MCP (定期的なタスクなど)
ALTER TABLE sets ADD COLUMN source TEXT NOT NULL DEFAULT 'web';
