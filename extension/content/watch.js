// hukumado: マルチビュー画面の枠に入れた watch ページを、
// プレイヤーだけが枠いっぱいに出るように整え、親とミュート状態・配信情報をやりとりする。
// 普通に YouTube を開いたときは何もしない。
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (window.top === window || params.get('hukumado') !== '1') return;

  const PARENT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  document.documentElement.classList.add('hukumado-frame');

  // ---- ミュートの操作は、ページ側で動く watch-main.js が YouTube プレイヤーの API で行う
  // (プレイヤーのスピーカー表示と実際の状態をそろえるため)。ここは親との中継だけ。
  const setMuted = (muted) =>
    document.dispatchEvent(new CustomEvent('hukumado:set-muted', { detail: muted ? '1' : '0' }));

  // 枠内のプレイヤーで直接ミュートを切り替えた → 親に知らせる (親が「音は 1 枠だけ」にそろえる)
  document.addEventListener('hukumado:user-audio', (e) => {
    let muted;
    try {
      muted = !!JSON.parse(e.detail).muted;
    } catch {
      return;
    }
    window.parent.postMessage({ hukumado: 'userAudio', muted }, PARENT_ORIGIN);
  });

  // ---- 配信のタイトルとチャンネル名を親に知らせる (上部バーの「今の音声」表示用)
  let sentMeta = '';
  const sendMeta = () => {
    const title = document.title.replace(/ - YouTube$/, '').trim();
    // ページに埋め込まれた構造化データ (itemprop) を優先。無ければ画面上のチャンネル名
    const channel =
      document.querySelector('span[itemprop="author"] link[itemprop="name"]')?.getAttribute('content')?.trim() ||
      document.querySelector('ytd-watch-metadata #owner #channel-name a, #owner ytd-channel-name a, #upload-info #channel-name a')
        ?.textContent?.trim() ||
      '';
    const key = title + '\n' + channel;
    if (!channel || key === sentMeta) return;
    sentMeta = key;
    window.parent.postMessage({ hukumado: 'meta', title, channel }, PARENT_ORIGIN);
  };
  let metaTicks = 0;
  const metaTimer = setInterval(() => {
    sendMeta();
    if (++metaTicks > 30) clearInterval(metaTimer);
  }, 1000);

  // 「画面いっぱい」表示のときは映像を枠に合わせて拡大し、はみ出た端を切る
  document.documentElement.classList.toggle('hukumado-fill', params.get('hukumado_fill') === '1');

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    if (e.data?.hukumado === 'audio') {
      setMuted(!!e.data.muted);
    } else if (e.data?.hukumado === 'fill') {
      document.documentElement.classList.toggle('hukumado-fill', !!e.data.on);
    }
  });

  // プレイヤーは枠のサイズに合わせて自分の大きさを決めるので、しばらく resize を送り続ける
  let ticks = 0;
  const timer = setInterval(() => {
    window.dispatchEvent(new Event('resize'));
    if (++ticks > 20) clearInterval(timer);
  }, 500);
})();
