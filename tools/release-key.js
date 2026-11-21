#!/usr/bin/env node
// hakomado: リリースの ZIP の manifest.json に "key" (公開鍵) を差し込み、拡張機能の ID を固定する。
// - Chrome は "key" の無い「パッケージ化されていない拡張機能」の ID を、読み込んだフォルダの場所から決める。
//   そのため、ZIP を別の場所に展開し直すと別の拡張機能になり、設定やチャンネルが引き継がれなかった
// - "key" はリリースの ZIP にだけ入れる (.github/workflows/release.yml から呼ぶ)。リポジトリの extension/ には入れない。
//   開発用のフォルダはフォルダの場所で決まる ID のままなので、同じ Chrome のプロファイルに開発版と配布版を
//   並べて入れられ、保存したデータも混ざらない
// - 公開鍵 (tools/release-key.pub) は秘密ではない。対になる秘密鍵はリポジトリに入れない (CRX を作るときだけ要る)
//
// 使い方:
//   node tools/release-key.js id                         … 固定する ID を表示する
//   node tools/release-key.js inject <manifest.json>     … そのファイルに "key" を書き込む
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUB_FILE = path.join(__dirname, 'release-key.pub');

/** 公開鍵 (SubjectPublicKeyInfo の DER を base64 にしたもの) */
const publicKey = () => fs.readFileSync(PUB_FILE, 'utf8').trim();

/** 公開鍵から拡張機能の ID を求める (SHA-256 の先頭 32 桁の 16 進数を a〜p に置き換える。Chrome と同じ決め方) */
function extensionId(key) {
  const der = Buffer.from(key, 'base64');
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

/** manifest.json の中身 (文字列) に "key" を入れる。既にあれば置き換える。ほかの行の書き方は変えない */
function injectKey(text, key) {
  const json = JSON.parse(text);
  const line = `"key": ${JSON.stringify(key)}`;
  if ('key' in json) return text.replace(/"key"\s*:\s*"[^"]*"/, line);
  // "version" の次の行に入れる
  const out = text.replace(/^(\s*)"version"(\s*:\s*"[^"]*")(,?)$/m, (m, indent, rest, comma) => {
    return `${indent}"version"${rest},\n${indent}${line}${comma}`;
  });
  if (out === text) throw new Error('manifest.json に "version" の行が見つかりません');
  JSON.parse(out); // 壊していないか
  return out;
}

if (require.main === module) {
  const [cmd, file] = process.argv.slice(2);
  const key = publicKey();
  if (cmd === 'id') {
    console.log(extensionId(key));
  } else if (cmd === 'inject' && file) {
    fs.writeFileSync(file, injectKey(fs.readFileSync(file, 'utf8'), key));
    console.log(`key -> ${file} (ID: ${extensionId(key)})`);
  } else {
    console.error('使い方: node tools/release-key.js id | inject <manifest.json>');
    process.exit(1);
  }
}

module.exports = { publicKey, extensionId, injectKey };
