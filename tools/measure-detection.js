#!/usr/bin/env node
// 配信開始の検知の速さを、取得元ごとに比べる実験 (タスク #6 の下調べ)。
//   node tools/measure-detection.js [--minutes 180] [--interval 60] [--max-channels 12] [--out <file.jsonl>]
//
// ホロジュールに載っている「もうすぐ始まる / 配信中」のホロライブの配信を対象に、同じ間隔で次の 3 つを見比べる:
//   A. ホロジュール (schedule.hololive.tv/lives)        … 今ホロライブに使っている方法。1 回で全員分
//   B. チャンネルの /live ページ (1 件ずつ)               … 今ホロライブ以外に使っている方法
//   C. チャンネルの RSS (feeds/videos.xml?channel_id=)   … 改善案。軽いが「配信中」かは分からないので、
//                                                          「その動画が RSS に載った時刻」を見る (どれだけ前から分かるか)
// 正解 (実際に配信が始まった時刻) は、配信中になった /live ページの liveBroadcastDetails.startTimestamp を使う。
// 検知の遅れ = 「その取得元で初めて配信中と分かった時刻」−「実際の開始時刻」。見に行く間隔 (--interval) の分だけ
// ばらつくので、どの取得元も同じ間隔で見て比べる。あわせて 1 回の取得の大きさ・時間も記録する。
//
// 1 件ずつの記録を JSON Lines で書き出し、終わったとき (Ctrl+C でも) に配信ごとの表と平均を表示する。
// YouTube への取得は 1 件ずつ 1 秒以上空ける (拡張機能と同じ)。429 や確認ページに飛ばされたら止める。

'use strict';
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const MINUTES = Number(args.minutes) || 180;
const INTERVAL_MS = (Number(args.interval) || 60) * 1000;
const MAX_CHANNELS = Number(args['max-channels']) || 12;
const OUT = args.out || path.join(process.cwd(), `detection-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const YT_GAP_MS = 1000;
// 対象にする配信: 開始予定が「30 分前〜90 分後」のもの (少し遅れて始まる枠も拾う)
const WINDOW_BEFORE_MS = 30 * 60e3;
const WINDOW_AFTER_MS = 90 * 60e3;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const HEADERS = { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' };

const channels = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hololive-channels.json'), 'utf8')).filter(
  (c) => c.status === 'active',
);
// ホロジュールの名前 → チャンネル
const byName = new Map();
for (const c of channels) for (const n of c.members || []) byName.set(n, c);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (rec) => fs.appendFileSync(OUT, JSON.stringify({ t: Date.now(), ...rec }) + '\n');

class StopError extends Error {}

/** 取得して {text, bytes, ms} を返す */
async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (res.status === 429 || /\/sorry\//.test(res.url)) throw new StopError(`YouTube に制限されました (${res.status} ${res.url})`);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, bytes: Buffer.byteLength(text), ms: Date.now() - t0 };
}

let lastYt = 0;
async function getYt(url) {
  const wait = lastYt + YT_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return await get(url);
  } finally {
    lastYt = Date.now();
  }
}

// ---- A. ホロジュール (拡張機能の parseSchedule と同じ見方を正規表現で)
function parseSchedule(html) {
  const nowJst = new Date(Date.now() + 9 * 3600e3);
  const out = [];
  let month = null;
  let day = null;
  const re = /<div class="holodule navbar-text"[^>]*>([\s\S]*?)<\/div>|<a href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})" class="thumbnail"[^>]*style="([^"]*)"[\s\S]*?class="[^"]*datetime"[^>]*>([\s\S]*?)<\/div>[\s\S]*?class="[^"]*name"[^>]*>([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] != null) {
      const d = m[1].match(/(\d{1,2})\/(\d{1,2})/);
      if (d) [month, day] = [Number(d[1]), Number(d[2])];
      continue;
    }
    const hm = m[4].replace(/<[^>]*>/g, '').match(/(\d{1,2}):(\d{2})/);
    if (!hm || month == null) continue;
    let year = nowJst.getUTCFullYear();
    const cur = nowJst.getUTCMonth() + 1;
    if (month - cur > 6) year--;
    else if (cur - month > 6) year++;
    out.push({
      videoId: m[2],
      startAt: Date.UTC(year, month - 1, day, Number(hm[1]) - 9, Number(hm[2])),
      live: /border:\s*3px\s+red/.test(m[3]),
      name: m[5].replace(/<[^>]*>/g, '').trim(),
    });
  }
  return out;
}

// ---- B. /live ページ (拡張機能の parseLivePage と同じ見方) + 実際の開始時刻
function parseLivePage(html) {
  const vid = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/)?.[1];
  if (!vid) return { state: 'offline' };
  const at = html.indexOf('"videoDetails":{"videoId":"' + vid + '"');
  const details = at >= 0 ? html.slice(at, at + 3000) : '';
  const started = html.match(/"liveBroadcastDetails":\{[^}]*"startTimestamp":"([^"]+)"/)?.[1];
  const actualStart = started ? Date.parse(started) : null;
  if (/"isLive":true/.test(details)) return { state: 'live', videoId: vid, actualStart };
  if (/"isUpcoming":true/.test(details)) return { state: 'upcoming', videoId: vid };
  return { state: 'offline', videoId: vid, actualStart };
}

// ---- C. RSS (載っている動画 ID)
function parseFeed(xml) {
  return [...xml.matchAll(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g)].map((m) => m[1]);
}

// ---- 記録
const videos = new Map(); // videoId -> {channel, name, scheduledAt, actualStart, detected: {A, B}, rssSeen}
const cost = { A: [], B: [], C: [] }; // {bytes, ms}
const v = (id) => {
  if (!videos.has(id)) videos.set(id, { detected: {} });
  return videos.get(id);
};
const firstSeen = (rec, key, at) => {
  if (rec.detected[key] == null) rec.detected[key] = at;
};

async function cycle(targets) {
  // A. ホロジュール
  const a = await get('https://schedule.hololive.tv/lives');
  cost.A.push({ bytes: a.bytes, ms: a.ms });
  const now = Date.now();
  const entries = parseSchedule(a.text);
  log({ src: 'A', bytes: a.bytes, ms: a.ms, entries: entries.length, live: entries.filter((e) => e.live).map((e) => e.videoId) });
  for (const e of entries) {
    if (!e.live && !(e.startAt >= now - WINDOW_BEFORE_MS && e.startAt <= now + WINDOW_AFTER_MS)) continue;
    const c = byName.get(e.name);
    if (!c) continue;
    const rec = v(e.videoId);
    Object.assign(rec, { channelId: c.channelId, name: e.name, scheduledAt: e.startAt });
    if (e.live) firstSeen(rec, 'A', now);
    if (!targets.has(c.channelId) && targets.size < MAX_CHANNELS && !e.live) targets.set(c.channelId, e.name);
  }

  // B / C. 対象のチャンネルを 1 件ずつ
  for (const [channelId, name] of targets) {
    const b = await getYt(`https://www.youtube.com/channel/${channelId}/live`);
    cost.B.push({ bytes: b.bytes, ms: b.ms });
    const st = parseLivePage(b.text);
    log({ src: 'B', channelId, name, bytes: b.bytes, ms: b.ms, ...st });
    if (st.videoId) {
      const rec = v(st.videoId);
      rec.channelId ??= channelId;
      rec.name ??= name;
      if (st.state === 'live') firstSeen(rec, 'B', Date.now());
      if (st.actualStart) rec.actualStart = st.actualStart;
      // /live ページには開始時刻が載らないことがあるので、配信中になったら動画のページで 1 度だけ確かめる
      if (st.state === 'live' && !rec.actualStart) {
        const w = await getYt(`https://www.youtube.com/watch?v=${st.videoId}`);
        const s = w.text.match(/"startTimestamp":"([^"]+)"/)?.[1];
        if (s) rec.actualStart = Date.parse(s);
        log({ src: 'truth', videoId: st.videoId, actualStart: rec.actualStart || null });
      }
    }

    const c = await getYt(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    cost.C.push({ bytes: c.bytes, ms: c.ms });
    const ids = c.ok ? parseFeed(c.text) : [];
    log({ src: 'C', channelId, name, bytes: c.bytes, ms: c.ms, status: c.status, ids });
    for (const id of ids) if (videos.has(id) && videos.get(id).rssSeen == null) videos.get(id).rssSeen = Date.now();
  }

  // 見終わったチャンネルは外して、次に始まる配信のチャンネルを入れられるようにする
  // (A と B の両方で配信中を確かめた / 予定の時刻を 30 分過ぎても始まらない)
  for (const channelId of [...targets.keys()]) {
    const recs = [...videos.values()].filter((r) => r.channelId === channelId && r.scheduledAt);
    const done = recs.some((r) => r.detected.A && r.detected.B && r.actualStart);
    const stale = recs.length && recs.every((r) => !r.detected.A && !r.detected.B && r.scheduledAt < Date.now() - WINDOW_BEFORE_MS);
    if (done || stale) targets.delete(channelId);
  }
}

// ---- まとめ
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const fmtS = (ms) => (ms == null || Number.isNaN(ms) ? '-' : `${Math.round(ms / 1000)}s`);
const fmtMin = (ms) => (ms == null || Number.isNaN(ms) ? '-' : `${(ms / 60000).toFixed(1)}分`);
const kb = (b) => `${Math.round(b / 1024)}KB`;

function summary() {
  const rows = [...videos.entries()]
    .filter(([, r]) => r.actualStart && (r.detected.A || r.detected.B))
    .map(([id, r]) => ({
      video: id,
      name: r.name,
      予定: new Date(r.scheduledAt || 0).toLocaleTimeString('ja-JP'),
      実開始: new Date(r.actualStart).toLocaleTimeString('ja-JP'),
      'A ホロジュール': fmtS(r.detected.A && r.detected.A - r.actualStart),
      'B /live': fmtS(r.detected.B && r.detected.B - r.actualStart),
      'C RSSに載った (開始の何分前)': fmtMin(r.rssSeen && r.actualStart - r.rssSeen),
    }));
  console.log(`\n=== 配信ごとの検知の遅れ (実際の開始から、見に行く間隔 ${INTERVAL_MS / 1000} 秒ごと) ===`);
  if (rows.length) console.table(rows);
  else console.log('配信が始まるところを観測できませんでした (時間を延ばすか、配信の多い時間帯に実行してください)');
  const delays = (k) => rows.map((r) => r[k]).filter((s) => s !== '-').map((s) => parseInt(s, 10));
  console.log(`平均の遅れ: A ホロジュール ${Math.round(avg(delays('A ホロジュール')))}s / B /live ${Math.round(avg(delays('B /live')))}s`);
  console.log('\n=== 1 回の取得の大きさ・時間 (平均) ===');
  for (const [k, label] of [['A', 'ホロジュール (全員分)'], ['B', '/live (1 チャンネル)'], ['C', 'RSS (1 チャンネル)']]) {
    const xs = cost[k];
    if (xs.length) console.log(`${k} ${label}: ${kb(avg(xs.map((x) => x.bytes)))} / ${Math.round(avg(xs.map((x) => x.ms)))}ms (${xs.length} 回)`);
  }
  // 拡張機能のやり方で N チャンネルを 1 巡するのにかかる時間の見積もり (1 件ずつ、間を 1 秒以上空ける)
  const per = (k) => Math.max(YT_GAP_MS, avg(cost[k].map((x) => x.ms)));
  if (cost.B.length && cost.C.length) {
    console.log('\n=== N チャンネルを 1 巡する時間の見積もり (1 件ずつ・1 秒以上空ける) ===');
    for (const n of [20, 50, 100, 150]) {
      console.log(`${n} チャンネル: /live ${fmtMin(per('B') * n)} (${Math.round((avg(cost.B.map((x) => x.bytes)) * n) / 1048576)}MB) / RSS ${fmtMin(per('C') * n)} (${Math.round((avg(cost.C.map((x) => x.bytes)) * n) / 1024)}KB)`);
    }
  }
  console.log(`\n記録: ${OUT}`);
}

async function main() {
  console.log(`${MINUTES} 分間、${INTERVAL_MS / 1000} 秒ごとに計測します (対象は最大 ${MAX_CHANNELS} チャンネル)。記録: ${OUT}`);
  const targets = new Map(); // channelId -> name
  const until = Date.now() + MINUTES * 60e3;
  let n = 0;
  while (Date.now() < until) {
    const t0 = Date.now();
    try {
      await cycle(targets);
    } catch (e) {
      log({ error: String(e) });
      console.error(`取得に失敗: ${e.message}`);
      if (e instanceof StopError) break;
    }
    const live = [...videos.values()].filter((r) => r.detected.A || r.detected.B).length;
    console.log(`[${new Date().toLocaleTimeString('ja-JP')}] ${++n} 回目: 対象 ${targets.size} チャンネル / 配信中を観測 ${live} 件 (${Math.round((Date.now() - t0) / 1000)}s)`);
    await sleep(Math.max(0, INTERVAL_MS - (Date.now() - t0)));
  }
  summary();
}

process.on('SIGINT', () => {
  summary();
  process.exit(0);
});
main();
