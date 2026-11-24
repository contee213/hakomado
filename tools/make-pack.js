#!/usr/bin/env node
// 配信予定のアドオン (extension/addons/<id>.js) から、チャンネルパック (packs/<file>) を作る / 作り直す。
//   node tools/make-pack.js nijisanji          … packs/ のパックと packs/index.json の項目を書き換える
//   node tools/make-pack.js nijisanji --dry    … 書かずに、増えた・減ったチャンネルだけ出す (YouTube には問い合わせない)
// - アドオンが listChannels({fetchText, wait}) → [{channelId (無ければ handle), name, group, handle?, icon?}] と pack ({file, name, ...}) を持っているときだけ使える
// - アドオンが取りに行けるのは pack.origins (無ければアドオンの origins) の中だけ。Cookie は送らない
// - ハンドル・アイコンが無いチャンネルは、YouTube のチャンネルページ (og:image と canonicalBaseUrl) で補う (間を 1.5 秒空ける)
// - 前のパックにあったハンドル・アイコンは、取れなかったときに使い回す
// 作ったら、いくつかのチャンネルを開いて確かめ、npm test を通してから PR にする (packs/README.md)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { load, plain, ROOT } = require('../tests/helpers/load');

const PACKS = path.join(ROOT, 'packs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const SITE_GAP_MS = 300;
const YT_GAP_MS = 1500;
const ICON_RE = /^https:\/\/(yt3\.ggpht\.com|yt3\.googleusercontent\.com|i\.ytimg\.com)\//;
const HANDLE_RE = /^@[^\s/?#]{1,100}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 日本時間の日付

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** YouTube のチャンネルページから、ハンドルと小さいアイコン */
async function youtubeInfo(channelId) {
  const html = await getText(`https://www.youtube.com/channel/${channelId}`);
  const handle = html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/)?.[1] || '';
  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || '';
  const icon = ICON_RE.test(og) ? og.replace(/=s\d+[^/]*$/, '=s88-c-k-c0x00ffffff-no-rj') : '';
  return { handle: HANDLE_RE.test(decodeURIComponent(handle)) ? decodeURIComponent(handle) : '', icon };
}

/** ハンドル → チャンネル ID (YouTube のハンドルのページの canonical) */
async function channelIdOf(handle) {
  const html = await getText(`https://www.youtube.com/${encodeURI(handle)}`);
  const id = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] || html.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
  if (!id) throw new Error('ID が見つからない');
  return id;
}

async function main() {
  const [id, ...flags] = process.argv.slice(2);
  const dry = flags.includes('--dry');
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id || '')) throw new Error('使い方: node tools/make-pack.js <アドオンの id> [--dry]');
  const file = `addons/${id}.js`;
  if (!fs.existsSync(path.join(ROOT, 'extension', file))) throw new Error(`extension/${file} が無い`);
  const env = load(['i18n.js', 'addons.js', file]);
  const addon = env.get(`Addons.list().find((a) => a.id === ${JSON.stringify(id)})`);
  if (!addon || typeof addon.listChannels !== 'function' || !addon.pack?.file) throw new Error(`${id} はパックを作れない (listChannels と pack が無い)`);
  // 取りに行けるのは pack.origins (パック作り専用の取得先。拡張機能は通信しない) か、無ければアドオンの origins の中だけ
  const origins = addon.pack.origins || addon.origins;
  if (!Array.isArray(origins) || !origins.every((o) => /^https:\/\/[a-z0-9.-]+\/\*$/.test(o))) throw new Error(`${id} の pack.origins が正しくない`);
  const allowed = (url) => origins.some((o) => String(url).startsWith(o.slice(0, -1)));

  const fetchText = (url) => (allowed(url) ? getText(url) : Promise.reject(new Error(`対象外の URL: ${url}`)));
  console.log(`${id}: 配信者の一覧を取得中…`);
  const listed = plain(await addon.listChannels({ fetchText, wait: () => sleep(SITE_GAP_MS) }));

  const packPath = path.join(PACKS, addon.pack.file);
  const old = fs.existsSync(packPath) ? JSON.parse(fs.readFileSync(packPath, 'utf8')) : null;
  const oldById = new Map((old?.channels || []).map((c) => [c.channelId, c]));

  // チャンネル ID をそろえ、同じチャンネルをまとめる (1 つのチャンネルを何人かで使っていると、一覧に何度も出る)
  const byId = new Map(); // channelId -> {c, names}
  for (const c of listed) {
    // チャンネル ID が無くハンドルだけのものは、YouTube のハンドルのページで ID を調べる (--dry でも)
    if (!/^UC[\w-]{22}$/.test(c.channelId || '') && HANDLE_RE.test(c.handle || '')) {
      try {
        await sleep(YT_GAP_MS);
        c.channelId = await channelIdOf(c.handle);
      } catch (e) {
        console.warn(`  YouTube でチャンネル ID が分からなかった: ${c.handle} ${c.name} (${e.message})`);
      }
    }
    if (!/^UC[\w-]{22}$/.test(c.channelId || '')) continue;
    const had = byId.get(c.channelId);
    if (had) {
      if (c.name && !had.names.includes(c.name)) had.names.push(c.name);
    } else byId.set(c.channelId, { c, names: c.name ? [c.name] : [] });
  }
  const seen = new Set(byId.keys());

  const channels = [];
  for (const { c, names } of byId.values()) {
    const prev = oldById.get(c.channelId) || {};
    // 何人かで使うチャンネルは、前のパックの名前 (FUWAMOCO など) を残す。無ければ名前を並べる
    const name = (names.length > 1 ? prev.name || names.join(' / ') : names[0]) || prev.name || c.channelId;
    const ch = { channelId: c.channelId, name };
    let handle = HANDLE_RE.test(c.handle || '') ? c.handle : '';
    let icon = ICON_RE.test(c.icon || '') ? c.icon : '';
    if ((!handle || !icon) && !dry) {
      try {
        await sleep(YT_GAP_MS);
        const yt = await youtubeInfo(c.channelId);
        handle ||= yt.handle;
        icon ||= yt.icon;
      } catch (e) {
        console.warn(`  YouTube で調べられなかった: ${c.channelId} ${ch.name} (${e.message})`);
      }
    }
    handle ||= prev.handle || '';
    icon ||= prev.icon || '';
    if (handle) ch.handle = handle;
    if (c.group) ch.group = c.group;
    if (icon) ch.icon = icon;
    channels.push(ch);
    if (process.stdout.isTTY) process.stdout.write(`\r  ${channels.length} / ${byId.size}`);
  }
  // 並びは前のパックのまま (差分を小さくする)。増えたものは後ろに、一覧の順で
  const oldOrder = new Map((old?.channels || []).map((c, i) => [c.channelId, i]));
  channels.sort((a, b) => (oldOrder.get(a.channelId) ?? Infinity) - (oldOrder.get(b.channelId) ?? Infinity));
  if (process.stdout.isTTY) process.stdout.write('\n');
  if (!channels.length) throw new Error('チャンネルが 1 つも取れなかった');

  const added = channels.filter((c) => !oldById.has(c.channelId));
  const removed = [...oldById.values()].filter((c) => !seen.has(c.channelId));
  console.log(`チャンネル ${channels.length} (増えた ${added.length} / 減った ${removed.length})`);
  for (const c of added) console.log(`  + ${c.name} ${c.handle || ''} ${c.channelId}`);
  for (const c of removed) console.log(`  - ${c.name} ${c.handle || ''} ${c.channelId}`);
  const noHandle = channels.filter((c) => !c.handle).length;
  if (noHandle) console.log(`  (ハンドルなし ${noHandle})`);
  if (dry) return;

  // 中身が前と同じなら日付は変えない (一覧の updated が新しくなると、利用者に「更新があります」と出るため)
  const same = old && JSON.stringify(old.channels) === JSON.stringify(channels) && old.name === addon.pack.name;
  const updated = same && old.updated ? old.updated : today();
  if (same) console.log('中身は前と同じ (日付はそのまま)');
  const pack = { app: 'hakomado', type: 'channels', name: addon.pack.name, author: old?.author || 'Hakomado', updated, channels };
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);

  const indexPath = path.join(PACKS, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const entry = {
    id: addon.pack.file.replace(/\.json$/, ''),
    file: addon.pack.file,
    name: addon.pack.name,
    ...(addon.pack.nameEn ? { nameEn: addon.pack.nameEn } : {}),
    author: pack.author,
    updated,
    channels: channels.length,
    description: addon.pack.description,
    ...(addon.pack.descriptionEn ? { descriptionEn: addon.pack.descriptionEn } : {}),
  };
  const i = index.packs.findIndex((p) => p.file === entry.file);
  if (i >= 0) index.packs[i] = entry;
  else index.packs.push(entry);
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`書いた: packs/${addon.pack.file}, packs/index.json`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
