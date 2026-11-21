// リポジトリの packs/ (パックの一覧と、投稿されたパック) の検証。PR で足されたパックも、ここで形式を確かめる
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, plain, ROOT } = require('./helpers/load');

const DIR = path.join(ROOT, 'packs');
const env = load(['presets.js', 'packs.js']);
const P = env.get('ChannelPack');
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const entries = plain(P.parseIndex(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')));

test('packs/index.json の項目は、どれも飛ばされずに読める (必須の項目・形がそろっている)', () => {
  assert.equal(entries.length, raw.packs.length);
  for (const [k, e] of entries.entries()) {
    const r = raw.packs[k];
    assert.ok(r.author, `${r.id}: author が無い`);
    assert.equal(e.updated, r.updated, `${r.id}: updated は YYYY-MM-DD`);
    assert.ok(r.description, `${r.id}: description が無い`);
  }
});

test('一覧のパックはファイルがあり、パックとして読め、一覧の内容と合っている', () => {
  for (const r of raw.packs) {
    const file = path.join(DIR, r.file);
    assert.ok(fs.existsSync(file), `${r.file} が無い`);
    const text = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(text);
    const pack = plain(P.parse(text));
    assert.equal(pack.channels.length, json.channels.length, `${r.file}: 読み込めないチャンネルがある (channelId の形・重なりを確かめる)`);
    assert.equal(pack.name, r.name, `${r.file}: パックの name と一覧の name が違う`);
    assert.equal(pack.updated, r.updated, `${r.file}: パックの updated と一覧の updated が違う`);
    assert.equal(pack.channels.length, r.channels, `${r.file}: 一覧の channels (${r.channels}) と実際の数 (${pack.channels.length}) が違う`);
    assert.ok(pack.author, `${r.file}: author が無い`);
  }
});

test('packs/ のパックはすべて一覧に載っている', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
  assert.deepEqual(files.sort(), raw.packs.map((r) => r.file).sort());
});

test('ホロライブのパックは同梱の初期データ (presets.js) と同じチャンネル', () => {
  const pack = plain(P.parse(fs.readFileSync(path.join(DIR, 'hololive.json'), 'utf8')));
  assert.deepEqual(pack.channels.map((c) => c.channelId), plain(env.get('PRESET_FAVORITES').map((f) => f.channelId)));
});
