// 読み込むファイルがそろっていて、文法の誤りや名前のぶつかりが無いか (manifest.json と grid.html)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readExt, EXT } = require('./helpers/load');

const manifest = JSON.parse(readExt('manifest.json'));
const gridScripts = [...readExt('grid.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test('manifest.json から参照しているファイルがある', () => {
  const files = [
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), `${f} が無い`);
});

test('grid.html から読み込むスクリプトがある', () => {
  assert.ok(gridScripts.length > 0);
  for (const f of gridScripts) assert.ok(fs.existsSync(path.join(EXT, f)), `${f} が無い`);
  assert.equal(gridScripts.at(-1), 'grid.js', 'grid.js は最後 (ほかのスクリプトのグローバルを使う)');
  assert.ok(gridScripts.indexOf('share-code.js') < gridScripts.indexOf('grid.js'));
});

test('grid.html のスクリプトを 1 つにつないでも文法の誤り・最上位の名前のぶつかりが無い', () => {
  // 素のスクリプトは最上位の const / let / class を 1 つの環境で共有するので、同じ名前があると 2 つ目が読み込めずに止まる。
  // つないで 1 つのスクリプトとしてコンパイルすれば (実行はしない)、それを見つけられる
  const joined = gridScripts.map((f) => `// ---- ${f}\n${readExt(f)}\n;`).join('\n');
  assert.doesNotThrow(() => new vm.Script(joined, { filename: 'grid.html (joined)' }));
});

test('どのスクリプトも文法の誤りが無い', () => {
  const all = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) all.push(p);
    }
  };
  walk(EXT);
  assert.ok(all.length > 10);
  for (const p of all) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(p, 'utf8'), { filename: p }), path.relative(EXT, p));
  }
});
