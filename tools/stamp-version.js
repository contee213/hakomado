#!/usr/bin/env node
// extension/manifest.json の version_name に、ビルド番号と日付を書き込む。
//   例: "0.1.0 (build 19 / 2026-11-21)"
// ビルド番号 = これから作るコミットの通し番号 (今のコミット数 + 1)。
// 普段は .githooks/pre-commit からコミットのたびに呼ばれる (README の開発メモを参照)。
// 手で実行するとき: node tools/stamp-version.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'extension', 'manifest.json');

function commitCount() {
  try {
    return Number(execSync('git rev-list --count HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) || 0;
  } catch {
    return 0; // まだコミットが無い
  }
}

const d = new Date();
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let text = fs.readFileSync(file, 'utf8');
const { version } = JSON.parse(text);
const name = `${version} (build ${commitCount() + 1} / ${date})`;
const line = `"version_name": ${JSON.stringify(name)}`;

// 書式 (インデントや並び) を崩さないよう、行を置き換える / version の次の行に足す
if (/"version_name":\s*"[^"]*"/.test(text)) {
  text = text.replace(/"version_name":\s*"[^"]*"/, line);
} else {
  text = text.replace(/^(\s*)("version":\s*"[^"]*",)$/m, `$1$2\n$1${line},`);
}
if (JSON.parse(text).version_name !== name) throw new Error('manifest.json に version_name を書き込めませんでした');

fs.writeFileSync(file, text);
console.log(`version_name: ${name}`);
