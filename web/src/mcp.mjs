// MCP の口 (/mcp)。Streamable HTTP の、状態を持たない最小の形: POST で JSON-RPC を 1 件受け、JSON で 1 件返す
// (ストリーム・セッション・サーバーからの通知は使わない)。認証 (トークン) は worker.mjs で済ませてから呼ぶ。
// 道具は REST の API と同じ処理 (sets.mjs) を呼ぶ
import { ApiError, listSets, listTags, getSet, createSet, deleteSet } from './sets.mjs';
import { layoutList, MAX_VIDEOS, TAGS_MAX, TAG_LEN } from './core.mjs';
import { features } from './features.mjs';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'hakomado-feed', title: 'Hakomado', version: '0.1.0' };
const INSTRUCTIONS =
  'Hakomado (Hakomado Feed): YouTube の配信・動画を同時視聴する Chrome 拡張機能 Hakomado の「視聴セット」(最大 16 本の動画とレイアウト) を集めたサイト。' +
  '投稿する前に list_sets で似たセットが無いか確かめ、レイアウトに迷ったら list_layouts を見る (layoutId を省くと本数に合う均等のレイアウトになる)。';

const ERROR_TEXT = {
  not_found: 'コード・リンク・動画が見つからない',
  bad_layout: '知らないレイアウト (list_layouts で確かめる)',
  bad_video: '動画の URL か ID として読めないものがある',
  too_many_videos: `動画は ${MAX_VIDEOS} 本まで`,
  bad_offsets: 'offsets は動画と同じ数の秒 (数値)、ref は 0 から始まる動画の番号',
  missing_video: '見つからない動画 (削除・非公開) が入っている',
  hidden: '同じセットが通報により非公開になっている',
  bad_request: '入力の形が違う',
  bad_tags: `タグは ${TAGS_MAX} 個まで、1 つ ${TAG_LEN} 文字まで`,
};

// feature = その機能フラグがオンのときだけ出す道具・引数
const TOOLS = [
  {
    name: 'list_sets',
    title: 'セットの一覧',
    description: '公開のセットを新着順 (sort=new) か人気順 (sort=popular) で 24 件ずつ返す。page は 0 から',
    inputSchema: {
      type: 'object',
      properties: {
        sort: { type: 'string', enum: ['new', 'popular'], default: 'new' },
        page: { type: 'integer', minimum: 0, default: 0 },
        tag: { type: 'string', description: 'このタグの付いたものだけ', feature: 'tags' },
        q: { type: 'string', description: '検索の語 (空白で区切ると全部を含むもの。名前・投稿者・タグ・動画のタイトル・チャンネル名から探す)', feature: 'search' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env, a, ctx) => listSets(env, { sort: a.sort, page: a.page, tag: a.tag, q: a.q }, ctx.feats),
  },
  {
    name: 'list_tags',
    title: 'タグの一覧',
    feature: 'tags',
    description: 'よく使われているタグ (多い順に 30 個)。投稿するときは、できるだけ今あるタグに合わせる',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env) => listTags(env),
  },
  {
    name: 'get_set',
    title: 'セットを見る',
    description: 'セット 1 件 (動画のタイトル・チャンネル名、コード、取り込み用リンク、ページの URL)',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'セットの ID (8 文字)' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (env, a) => {
      const set = await getSet(env, a.id);
      if (!set) throw new ApiError('not_found', 404);
      return set;
    },
  },
  {
    name: 'list_layouts',
    title: 'レイアウトの一覧',
    description: '使えるレイアウト。id を post_set の layoutId に使う。slots = 枠の数、kind = uniform (均等) / focus・balance・single (メイン + サブ) / pip (小窓) / vertical (縦長。どの枠も 9:16 でショート・縦型の配信向け)。id の頭の tl・tr・bl・br はメイン枠を置く角',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => ({ layouts: layoutList() }),
  },
  {
    name: 'post_set',
    title: 'セットを投稿',
    description:
      'セットを投稿して公開する。text (Hakomado のコード #Hakomado … か取り込み用リンク) か、videos (YouTube の URL か動画 ID の並び。最大 16 本) のどちらかを渡す。' +
      '名前を除いて同じセットがすでにあれば、新しく作らずにそれを返す (existed: true)。動画は YouTube にあるかを確かめてから入れる',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'コード (#Hakomado …) か取り込み用リンク。videos と一緒には使わない' },
        videos: { type: 'array', items: { type: 'string' }, maxItems: MAX_VIDEOS, description: 'YouTube の URL か動画 ID (11 文字)。並び順 = 枠の番号' },
        layoutId: { type: 'string', description: '省くと本数に合う均等のレイアウト' },
        name: { type: 'string', maxLength: 40, description: 'セットの名前' },
        offsets: { type: 'array', items: { type: 'number' }, description: '同期再生の補正 (秒。配信していた実際の時刻でそろえた上に足し引きする分。+ で先へ進める)。videos と同じ数' },
        ref: { type: 'integer', minimum: 0, description: '同期の基準にする動画の番号 (0 から)' },
        author: { type: 'string', maxLength: 30, description: '投稿者として出す名前' },
        tags: { type: 'array', items: { type: 'string', maxLength: TAG_LEN }, maxItems: TAGS_MAX, description: 'タグ (頭の # は要らない)', feature: 'tags' },
        unlisted: { type: 'boolean', description: 'true なら一覧・検索に載せず、リンクを知っている人だけが見られる', feature: 'unlisted' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: async (env, a, ctx) => {
      const r = await createSet(env, a, { who: null, feats: ctx.feats });
      return { id: r.id, existed: !!r.existed, listed: r.listed, url: `${ctx.origin}/s/${r.id}` };
    },
  },
  {
    name: 'delete_set',
    title: 'セットを削除',
    description: 'セットを削除する (元に戻せない)',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (env, a) => {
      await deleteSet(env, a.id, { admin: true });
      return { deleted: a.id };
    },
  },
];

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** 機能フラグに合わせた道具の一覧 (オフの機能の道具・引数は出さない。feature の印も外す) */
function toolList(feats) {
  return TOOLS.filter((t) => !t.feature || feats[t.feature]).map(({ run, feature, inputSchema, ...t }) => {
    const properties = {};
    for (const [k, v] of Object.entries(inputSchema.properties)) {
      const { feature: f, ...rest } = v;
      if (!f || feats[f]) properties[k] = rest;
    }
    return { ...t, inputSchema: { ...inputSchema, properties } };
  });
}

async function callTool(env, params, ctx) {
  const tool = TOOLS.find((t) => t.name === params?.name && (!t.feature || ctx.feats[t.feature]));
  if (!tool) return null;
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  try {
    const out = await tool.run(env, args, ctx);
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return { content: [{ type: 'text', text: `${e.message}: ${ERROR_TEXT[e.message] || e.message}` }], isError: true };
  }
}

export async function handleMcp(request, env) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  let msg;
  try {
    msg = JSON.parse(await request.text());
  } catch {
    return reply(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return reply(rpcError(msg?.id, -32600, 'Invalid Request'), 400);
  }
  // 通知 (id の無いもの。notifications/initialized など) には本文なしで受け取ったことだけ返す
  if (!('id' in msg)) return new Response(null, { status: 202 });

  const { id, method, params } = msg;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return reply(
        rpcResult(id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER,
          instructions: INSTRUCTIONS,
        }),
      );
    }
    case 'ping':
      return reply(rpcResult(id, {}));
    case 'tools/list':
      return reply(rpcResult(id, { tools: toolList(features(env)) }));
    case 'tools/call': {
      const out = await callTool(env, params, { origin: new URL(request.url).origin, feats: features(env) });
      return reply(out ? rpcResult(id, out) : rpcError(id, -32602, `Unknown tool: ${params?.name}`));
    }
    default:
      return reply(rpcError(id, -32601, `Method not found: ${method}`));
  }
}
