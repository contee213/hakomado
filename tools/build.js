#!/usr/bin/env node
// 配る用の拡張機能のフォルダを extension/ から作る (HAKO-51)。ふだんの開発では使わない (extension/ をそのまま読み込めば、全部入り)。
//
//   node tools/build.js                 リリース版: ⏱ アーカイブ同期 (実験的な機能) のコードを抜く → dist/hakomado/
//   node tools/build.js --experimental  同期入り: extension/ と同じ中身 (sync-off.js だけ抜く) → dist/hakomado-experimental/
//   --out <フォルダ>                     作る場所を変える (中身は消してから作る)
//
// リリース版では SYNC_FILES を入れず、grid.html の <script src="sync.js"> を sync-off.js (同じ窓口を何もしない形で持つ) に差し替え、
// ほかの同期のファイルの <script> を消す。Chrome ウェブストアと GitHub のリリースの ZIP はこれで作る (.github/workflows/release.yml)。
// 補正を覚える仕組み (sync-offsets.js・movie-anchors.js) は残す (共有コード・再生リスト・バックアップの補正を消さないため)。
// content/mix.js も残す (枠の音の遅延・左右・音量の経路と同じファイルで、分けられないため。親が頼まなければ音の記録はしない)。
// 動画ごとの波形 (waves.js) も残す (🎚 音量バランスが、保存してある波形から大きさを出すため。HAKO-54)。
// 作ったあと、抜いたファイルの名前がどこからも参照されていないか、grid.html が読むファイルがそろっているかを確かめ、だめなら止める
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');

/** リリース版で抜く、アーカイブ同期だけが使うファイル (extension/ からの相対) */
// 波形 (waves.js) は 🎚 音量バランスも使うので残す (HAKO-54)
const SYNC_FILES = ['sync.js', 'sync-groups.js', 'audio-align.js', 'audio-align-worker.js', 'wave-strip.js', 'timer-scan.js'];
/** 同期入りのときに抜く、リリース版だけが使うファイル */
const OFF_FILES = ['sync-off.js'];

const TEXT_EXT = new Set(['.js', '.html', '.css', '.json']);

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .DS_Store など (release.yml の zip -x '.*' と同じ)
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** grid.html の <script src> を、リリース版の形にする */
function stripGridHtml(html) {
  let out = html;
  const tag = (f) => new RegExp(`^[ \\t]*<script src="${f.replace(/[.]/g, '\\.')}"></script>\\r?\\n`, 'm');
  if (!tag('sync.js').test(out)) throw new Error('grid.html に <script src="sync.js"> がありません');
  out = out.replace(tag('sync.js'), (line) => line.replace('sync.js', 'sync-off.js'));
  for (const f of SYNC_FILES) if (f !== 'sync.js') out = out.replace(tag(f), '');
  return out;
}

/** dist の中身を確かめる。問題があれば Error */
function verify(out, { experimental }) {
  const files = listFiles(out);
  const gone = experimental ? OFF_FILES : SYNC_FILES;
  for (const f of gone) if (files.includes(f)) throw new Error(`${f} が入っています`);
  const html = fs.readFileSync(path.join(out, 'grid.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const s of scripts) if (!files.includes(s)) throw new Error(`grid.html が読む ${s} がありません`);
  if (scripts.at(-1) !== 'grid.js') throw new Error('grid.html の最後のスクリプトが grid.js ではありません');
  // 抜いたファイルを読み込もうとしているところが無いか (<script src="…"> ・ manifest.json ・ new Worker('…') など、引用符で囲んだ名前)
  for (const f of files) {
    if (!TEXT_EXT.has(path.extname(f))) continue;
    const text = fs.readFileSync(path.join(out, f), 'utf8');
    for (const g of gone) if (new RegExp(`["'\`/]${g.replace(/[.]/g, '\\.')}["'\`]`).test(text)) throw new Error(`${f} が、抜いた ${g} を参照しています`);
  }
  return { files, scripts };
}

/**
 * @param {{experimental?: boolean, out?: string}} [opts]
 * @returns {{out: string, files: string[]}}
 */
function build({ experimental = false, out } = {}) {
  out = path.resolve(out || path.join(ROOT, 'dist', experimental ? 'hakomado-experimental' : 'hakomado'));
  if (out === EXT || EXT.startsWith(out + path.sep)) throw new Error(`作る場所が extension/ と重なっています: ${out}`);
  fs.rmSync(out, { recursive: true, force: true });
  const skip = new Set(experimental ? OFF_FILES : SYNC_FILES);
  for (const f of listFiles(EXT)) {
    if (skip.has(f)) continue;
    const dest = path.join(out, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (f === 'grid.html' && !experimental) fs.writeFileSync(dest, stripGridHtml(fs.readFileSync(path.join(EXT, f), 'utf8')));
    else fs.copyFileSync(path.join(EXT, f), dest);
  }
  const { files } = verify(out, { experimental });
  return { out, files };
}

module.exports = { build, stripGridHtml, SYNC_FILES, OFF_FILES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const experimental = args.includes('--experimental');
  const k = args.indexOf('--out');
  const out = k >= 0 ? args[k + 1] : undefined;
  if (k >= 0 && !out) {
    console.error('--out のあとに作る場所を書いてください');
    process.exit(1);
  }
  try {
    const r = build({ experimental, out });
    console.log(`${experimental ? '同期入り' : 'リリース版 (同期なし)'}: ${path.relative(process.cwd(), r.out) || r.out} (${r.files.length} ファイル)`);
  } catch (e) {
    console.error(`ビルドに失敗しました: ${e.message}`);
    process.exit(1);
  }
}
