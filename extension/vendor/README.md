# vendor

拡張機能に同梱している外部のライブラリ (視聴セットの共有画像の QR を作る / 読むため)。
外部から読み込むことはせず、ここにあるファイルだけを使う。

| ファイル | ライブラリ | 版 | ライセンス |
| --- | --- | --- | --- |
| `qrcode-generator.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (Kazuhiko Arase) | 1.4.4 (npm の `qrcode.js`) | MIT (ファイルの先頭に表記) |
| `jsQR.js` | [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 (npm の `dist/jsQR.js`) | Apache-2.0 (`jsQR.LICENSE.txt`) |

更新するときは、npm から同じファイルを取り直して置き換える。
