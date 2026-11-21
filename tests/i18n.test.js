// 画面の文言 (extension/i18n.js, grid.html, _locales)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, readExt, EXT } = require('./helpers/load');

// 使っている {n} の種類 (同じ {0} を 2 回使うのはかまわない)
const placeholders = (s) => [...new Set([...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]))].sort().join(',');

test('スクリプトの文言はどれも [日本語, 英語] の組で、{0} などの数が同じ', () => {
  const env = load(['i18n.js']);
  const messages = env.get('MESSAGES');
  for (const [key, pair] of Object.entries(messages)) {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key} が [ja, en] の組ではない`);
    const [ja, en] = pair;
    assert.ok(typeof ja === 'string' && ja && typeof en === 'string' && en, `${key} に空の文言がある`);
    assert.equal(placeholders(ja), placeholders(en), `${key} の {n} が日本語と英語で違う`);
  }
});

test('tr("…") で使っている文言はすべて定義されている', () => {
  const env = load(['i18n.js']);
  const messages = env.get('MESSAGES');
  const scripts = [...readExt('grid.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((f) => !f.startsWith('vendor/'));
  const missing = [];
  for (const f of scripts) {
    // コメントの行は除く。tr('key' …) と tr(条件 ? 'a' : 'b' …) の形だけを見る
    // (tr(step.key + 'T') のように組み立てるものは確かめられないので見ない)
    const code = readExt(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    const keys = [
      ...[...code.matchAll(/\btr\(\s*'(\w+)'\s*[,)]/g)].map((m) => [m[1]]),
      ...[...code.matchAll(/\btr\((?:[^()?']|'[^']*')*\?\s*'(\w+)'\s*:\s*'(\w+)'\s*[,)]/g)].map((m) => [m[1], m[2]]),
    ].flat();
    for (const k of keys) if (!(k in messages)) missing.push(`${f}: ${k}`);
  }
  assert.deepEqual(missing, []);
});

test('tr: 表示言語と引数', () => {
  const ja = load(['i18n.js'], { lang: 'ja-JP' });
  assert.equal(ja.get('LANG'), 'ja');
  assert.equal(ja.get('tr')('inUse', 3).startsWith('ほかのタブ (ウィンドウ) で 3 つ'), true);
  const en = load(['i18n.js'], { lang: 'ko' }); // 日本語以外は英語
  assert.equal(en.get('LANG'), 'en');
  assert.equal(en.get('tr')('inUse', 2).startsWith('2 other tab(s)'), true);
  assert.equal(en.get('tr')('noSuchKey'), 'noSuchKey', '無いキーはキーをそのまま出す');
});

test('grid.html の data-i18n* はすべて英語がある', () => {
  const env = load(['i18n.js']);
  const en = env.get('HTML_EN');
  const html = readExt('grid.html');
  const missing = [];
  for (const m of html.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria)?="([^"]+)"/g)) {
    if (!(m[1] in en)) missing.push(m[1]);
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('使われていない文言が残っていない (画面から消したものの英語・スクリプトの文言)', () => {
  const env = load(['i18n.js']);
  const html = readExt('grid.html');
  const scripts = fs
    .readdirSync(EXT)
    .filter((f) => f.endsWith('.js') && f !== 'i18n.js')
    .map((f) => readExt(f))
    .join('\n');
  const usedInHtml = new Set([...html.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria)?="([^"]+)"/g)].map((m) => m[1]));
  const staleHtml = Object.keys(env.get('HTML_EN')).filter((k) => !usedInHtml.has(k) && !scripts.includes(`'${k}'`));
  assert.deepEqual(staleHtml, [], 'grid.html に無い英語の文言');
  // 組み立てて使うもの (tr(step.key + 'T') の使い方ツアー、tr(`layoutTab_${…}`) のような「前半_」) は、組み立てる元が出てくればよい
  const used = (k) =>
    scripts.includes(`'${k}'`) ||
    scripts.includes(`'${k.replace(/T$/, '')}'`) ||
    (k.includes('_') && new RegExp(`['\`]${k.split('_')[0]}_`).test(scripts));
  const staleMsg = Object.keys(env.get('MESSAGES')).filter((k) => !used(k));
  assert.deepEqual(staleMsg, [], 'どこからも使われていないスクリプトの文言');
});

test('_locales: manifest.json の __MSG_…__ が日本語・英語の両方にある', () => {
  const manifest = readExt('manifest.json');
  const keys = [...new Set([...manifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]))];
  for (const lang of fs.readdirSync(path.join(EXT, '_locales'))) {
    const msgs = JSON.parse(readExt(`_locales/${lang}/messages.json`));
    for (const k of keys) assert.ok(msgs[k]?.message, `_locales/${lang} に ${k} が無い`);
  }
});
