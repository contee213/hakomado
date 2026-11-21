// hakomado: 取り込み用リンク (https://www.youtube.com/watch_videos?video_ids=…&hakomado=名前) を開いたとき。
// background.js のルールが、そのリンクを YouTube の存在しないページ /hakomado_import?… に付け替えるので、
// そこで動いて background.js に知らせる。background.js がこのタブをマルチビュー画面に切り替え、中身の取り込みを聞く。
// (リンクそのものは YouTube の一時的な再生リストなので、Hakomado を入れていない人にもそのまま開ける)
'use strict';
chrome.runtime.sendMessage({ type: 'import-link' }).catch(() => {});
