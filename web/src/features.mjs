// 機能フラグ。wrangler.jsonc の vars.FEATURES (オブジェクト) か、文字列 (JSON か「unlisted,tags」のようなカンマ区切り) で決める。
// 書いていない機能はオフ。.dev.vars では FEATURES='{"tags":true}' のように JSON の文字列で上書きできる
export const FEATURE_NAMES = [
  'unlisted', // 公開範囲: 「リンクを知っている人だけ」(一覧・検索に載せない) で投稿できる
  'extShare', // 拡張機能からの短縮リンク: 拡張機能のページからの投稿・読み出しを受け付ける (限定公開で入れる。unlisted も要る)
  'tags', // タグ: 投稿に付けて、一覧をタグで絞り込む
  'search', // 検索: 名前・投稿者・タグ・動画のタイトル・チャンネル名で探す
  'videoCheck', // 消えた動画の見直し: Cron で動画があるかを確かめ直し、消えたものに印を付ける
  'en', // 英語の画面: 画面の言語を切り替えられる (オフなら日本語だけ)
  'xLogin', // X でログイン: 投稿者を @名前 で出す・自分の投稿の一覧・合言葉なしの削除 (X のアプリの設定も要る。src/xauth.mjs)
];

/** @returns {Record<string, boolean>} */
export function features(env) {
  let raw = env?.FEATURES ?? {};
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('{')) {
      try {
        raw = JSON.parse(s);
      } catch {
        raw = {};
      }
    } else {
      raw = Object.fromEntries(s.split(/[\s,]+/).filter(Boolean).map((k) => [k, true]));
    }
  }
  const out = {};
  for (const k of FEATURE_NAMES) out[k] = raw?.[k] === true || raw?.[k] === 'true' || raw?.[k] === 1;
  // 拡張機能からの投稿はいつも限定公開で入れるので、unlisted がオフなら受け付けない
  if (!out.unlisted) out.extShare = false;
  // X のアプリ (クライアント ID・シークレット) と公開の URL がそろっていなければ、X のログインは出さない
  if (!(env?.X_CLIENT_ID && env?.X_CLIENT_SECRET && env?.PUBLIC_ORIGIN)) out.xLogin = false;
  return out;
}
