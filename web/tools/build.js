// web/ のビルド: 拡張機能 (extension/) のスクリプトを、Worker と画面から使える形にして置く。
// - src/gen/ext.mjs: layouts-generated.js + layouts.js + share-code.js をつないで export を付けたもの (Worker 用)
// - public/js/ext/: 同じファイルをそのままコピー (画面では <script> で読む) と jsQR (共有画像の QR を読む)
// どちらも生成物なので git には入れない (.gitignore)。中身が同じなら書き直さない (wrangler dev の監視が回り続けないように)。
// wrangler.jsonc の build.command で、wrangler dev / deploy のたびに動く。依存パッケージは使わない
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const EXT = path.join(WEB, '..', 'extension');

const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');

function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.writeFileSync(file, text);
}

// Worker で使う名前 (share-code.js・layouts.js の /* exported */ から必要なものだけ)
const EXPORTS = ['LAYOUTS', 'getLayout', 'layoutIdOf', 'formatShareCode', 'formatShareLink', 'parseShareCode', 'parseShareLink', 'shareName', 'videoIdFromUrl'];

const parts = ['layouts-generated.js', 'layouts.js', 'share-code.js'].map((f) => `// ---- extension/${f}\n${read(f)}`);
writeIfChanged(
  path.join(WEB, 'src', 'gen', 'ext.mjs'),
  `// 生成物 (web/tools/build.js)。手で書き換えない\n${parts.join('\n')}\nexport { ${EXPORTS.join(', ')} };\n`,
);

for (const f of ['layouts-generated.js', 'layouts.js', 'share-code.js', 'vendor/jsQR.js', 'vendor/jsQR.LICENSE.txt']) {
  writeIfChanged(path.join(WEB, 'public', 'js', 'ext', path.basename(f)), read(f));
}
writeIfChanged(path.join(WEB, 'public', 'js', 'ext', 'icon.svg'), read('icons/icon.svg'));
