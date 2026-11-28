// リリース版 (アーカイブ同期のコードを抜いたビルド。HAKO-51) の確かめ:
// - sync-off.js が、残るスクリプトの使う Sync・AudioSync の窓口を全部持っているか (足りないと、リリース版だけ動かなくなる)
// - sync-off.js の窓口が、本物 (sync.js) にもあるか
// - tools/build.js で作ったフォルダに同期のファイルが入っておらず、grid.html のスクリプトをつないでもぶつからないか
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { readExt, EXT } = require('./helpers/load');
const { build, SYNC_FILES, SYNC_CONTENT_FILES, OFF_FILES } = require('../tools/build');

/** なんでも受け付ける代わり (読み込みの時点で document などに触れても止まらないように) */
const anything = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : anything()), apply: () => anything(), construct: () => anything() });

/** スクリプトを読み込み、Sync・AudioSync の窓口の名前を返す */
function apiOf(file) {
  const ctx = { document: anything(), window: anything(), chrome: anything(), navigator: anything(), console, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.createContext(ctx);
  vm.runInContext(`${readExt(file)}\n;this.__api = { Sync: Object.keys(Sync), AudioSync: Object.keys(AudioSync) };`, ctx, { filename: file });
  return { Sync: Array.from(ctx.__api.Sync), AudioSync: Array.from(ctx.__api.AudioSync) }; // この環境の配列にする (deepEqual で比べるため)
}

/** リリース版に残るスクリプトが使う Sync.x・AudioSync.x の x */
function usedNames() {
  const used = { Sync: new Set(), AudioSync: new Set() };
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(EXT, p).split(path.sep).join('/');
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && !SYNC_FILES.includes(rel) && !OFF_FILES.includes(rel)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(/(?<![\w.$])(Sync|AudioSync)\.([A-Za-z_$][\w$]*)/g)) used[m[1]].add(m[2]);
      }
    }
  };
  walk(EXT);
  return used;
}

test('sync-off.js は、リリース版に残るスクリプトが使う Sync・AudioSync の窓口を全部持っている', () => {
  const off = apiOf('sync-off.js');
  const used = usedNames();
  assert.ok(used.Sync.size >= 10, 'grid.js が Sync を使っているはず');
  for (const name of ['Sync', 'AudioSync']) {
    const missing = [...used[name]].filter((x) => !off[name].includes(x));
    assert.deepEqual(missing, [], `sync-off.js の ${name} に足りない窓口`);
  }
});

test('sync-off.js の窓口は、本物の sync.js にもある', () => {
  const off = apiOf('sync-off.js');
  const real = apiOf('sync.js');
  for (const name of ['Sync', 'AudioSync']) {
    const extra = off[name].filter((x) => !real[name].includes(x));
    assert.deepEqual(extra, [], `sync.js の ${name} に無い窓口`);
  }
});

test('ふだんの grid.html は sync.js を読み、sync-off.js は読まない', () => {
  const scripts = [...readExt('grid.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const f of SYNC_FILES.filter((f) => f !== 'audio-align-worker.js')) assert.ok(scripts.includes(f), `${f} を読み込んでいない`);
  assert.ok(!scripts.includes('sync-off.js'));
});

function tmpOut(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hakomado-build-')), name);
}

test('リリース版のビルドには同期のファイルが入らず、grid.html は sync-off.js を読む', () => {
  const { out, files } = build({ out: tmpOut('release') });
  try {
    for (const f of SYNC_FILES) assert.ok(!files.includes(f), `${f} が入っている`);
    assert.ok(files.includes('sync-off.js'));
    assert.ok(files.includes('sync-offsets.js') && files.includes('movie-anchors.js'), '補正を覚える仕組みは残す');
    const html = fs.readFileSync(path.join(out, 'grid.html'), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(scripts.at(-1), 'grid.js');
    assert.ok(scripts.indexOf('sync-off.js') >= 0 && scripts.indexOf('sync-off.js') < scripts.indexOf('grid.js'));
    // 素のスクリプトをつないで 1 つにしても、文法の誤り・最上位の名前のぶつかりが無い
    const joined = scripts.map((f) => `// ---- ${f}\n${fs.readFileSync(path.join(out, f), 'utf8')}\n;`).join('\n');
    assert.doesNotThrow(() => new vm.Script(joined, { filename: 'grid.html (release, joined)' }));
    // 同期の中身 (Sync の時計など) の文字が入っていない
    assert.ok(!files.filter((f) => f.endsWith('.js')).some((f) => /const Sync = \(\(\) => \{\n  const TICK_MS/.test(fs.readFileSync(path.join(out, f), 'utf8'))));
    // manifest.json は、同期だけが使うページ側のスクリプト (画面のタイマーを読む timer-reader.js) を外しただけ
    for (const f of SYNC_CONTENT_FILES) assert.ok(!files.includes(f), `${f} が入っている`);
    const want = JSON.parse(readExt('manifest.json'));
    for (const c of want.content_scripts) if (c.js) c.js = c.js.filter((f) => !SYNC_CONTENT_FILES.includes(f));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')), want, 'manifest.json は timer-reader.js を外しただけ');
    assert.ok(want.content_scripts.every((c) => !c.js || c.js.length), '中身が空になった content_scripts が無い');
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
});

test('同期入りのビルドは extension/ と同じ (sync-off.js だけ抜く)', () => {
  const { out, files } = build({ experimental: true, out: tmpOut('exp') });
  try {
    assert.ok(!files.includes('sync-off.js'));
    for (const f of [...SYNC_FILES, ...SYNC_CONTENT_FILES]) assert.ok(files.includes(f), `${f} が無い`);
    assert.equal(fs.readFileSync(path.join(out, 'grid.html'), 'utf8'), readExt('grid.html'));
    assert.equal(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'), readExt('manifest.json'));
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
});

test('extension/ の中には作れない', () => {
  assert.throws(() => build({ out: EXT }));
  assert.throws(() => build({ out: path.dirname(EXT) }));
});
