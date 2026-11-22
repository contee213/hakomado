#!/usr/bin/env node
// extension/build.js に、ビルド番号と日付を書き込む (使い方 (?) と設定 (⚙) の画面の下の版の表示に出す)。
//   例: const BUILD = { n: 119, date: '2026-11-22' };
// ビルド番号 = これから作るコミットの通し番号 (今のコミット数 + 1)。
// manifest.json の version / version_name には入れない (chrome://extensions やストアの版はリリースの version だけにする)。
//
// 普段は .githooks/pre-commit からコミットのたびに呼ばれ、ステージした変更に extension/ のファイルがあるときだけ
// 番号を上げて build.js をコミットに含める (web/ や README だけのコミットでは上げない)。
// 手で番号を上げるとき: node tools/stamp-version.js --force (ステージはしない)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const REL = 'extension/build.js';
const file = path.join(root, REL);
const force = process.argv.includes('--force');

const git = (args) => execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

function commitCount() {
  try {
    return Number(git('rev-list --count HEAD')) || 0;
  } catch {
    return 0; // まだコミットが無い
  }
}

if (!force) {
  const staged = git('diff --cached --name-only --diff-filter=ACMRD -- extension/')
    .split('\n')
    .filter((f) => f && f !== REL);
  if (!staged.length) process.exit(0); // 拡張機能に変更の無いコミット
}

const d = new Date();
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const n = commitCount() + 1;

const text = `// ビルド番号と日付。コミットのときに tools/stamp-version.js が書き込む (手で変えない)。
// 使い方 (?) と設定 (⚙) の画面の下の版の表示と、不具合の報告に出す。リリースの版は manifest.json の version
// ブランチをマージしてここが衝突したら、どちらを取ってもよい (次に extension/ を変えたコミットで振り直される)
const BUILD = { n: ${n}, date: '${date}' };
`;
fs.writeFileSync(file, text);
if (!force) git(`add -- ${REL}`);
console.log(`build ${n} (${date})`);
