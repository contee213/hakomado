// レイアウトの進化図 (docs/layout-evolution.html。tools/gen-layout-evolution.js が作る)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { build, OUT } = require('../tools/gen-layout-evolution');

test('進化図が今のレイアウト・選び方と合っている (違えば `node tools/gen-layout-evolution.js` で作り直す)', () => {
  const normalize = (s) => s.replace(/\r\n/g, '\n');
  assert.ok(normalize(fs.readFileSync(OUT, 'utf8')) === normalize(build()), 'docs/layout-evolution.html が古い。`node tools/gen-layout-evolution.js` で作り直す');
});
