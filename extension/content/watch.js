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

  // 見られるか (playabilityStatus) → 親に知らせる (メンバー限定の配信を自動再生から外すため)
  document.addEventListener('hukumado:playability', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    window.parent.postMessage(
      { hukumado: 'playability', status: String(d.status || ''), text: String(d.text || '').slice(0, 8000) },
      PARENT_ORIGIN,
    );
  });

  // ライブ配信中か (watch-main.js から)
  document.addEventListener('hukumado:live', (e) => window.parent.postMessage({ hukumado: 'live', on: e.detail === '1' }, PARENT_ORIGIN));

  // アーカイブのチャットリプレイ用 (watch-main.js から)
  document.addEventListener('hukumado:replay', (e) => {
    const c = String(e.detail || '');
    if (/^[\w%=-]{10,2000}$/.test(c)) window.parent.postMessage({ hukumado: 'replay', continuation: c }, PARENT_ORIGIN);
  });
  document.addEventListener('hukumado:progress', (e) => {
    const t = Number(e.detail);
    if (Number.isFinite(t)) window.parent.postMessage({ hukumado: 'progress', t }, PARENT_ORIGIN);
  });

  // 配信・動画が終わった → 親に知らせる (自動再生中に枠を片付けるため)
  document.addEventListener('hukumado:ended', (e) => {
    const reason = e.detail === 'played' ? 'played' : 'already';
    window.parent.postMessage({ hukumado: 'ended', reason }, PARENT_ORIGIN);
  });

  // チャンネル登録・高評価の状態 → 親に知らせる (枠のバーのボタンの表示用)
  document.addEventListener('hukumado:social', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    window.parent.postMessage(
      {
        hukumado: 'social',
        loggedIn: !!d.loggedIn,
        subscribed: typeof d.subscribed === 'boolean' ? d.subscribed : null,
        liked: typeof d.liked === 'boolean' ? d.liked : null,
        failed: typeof d.failed === 'string' ? d.failed : '',
      },
      PARENT_ORIGIN,
    );
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
    // チャンネルの URL (@ハンドル または /channel/UC…) → ピックアップに入っているかの判定用
    const url = document.querySelector('span[itemprop="author"] link[itemprop="url"]')?.getAttribute('href') || '';
    const handle = url.match(/\/(@[^/?#]+)/)?.[1] || '';
    const channelId = url.match(/\/channel\/(UC[\w-]{22})/)?.[1] || '';
    const key = [title, channel, handle, channelId].join('\n');
    if (!channel || key === sentMeta) return;
    sentMeta = key;
    window.parent.postMessage({ hukumado: 'meta', title, channel, handle, channelId }, PARENT_ORIGIN);
  };
  let metaTicks = 0;
  const metaTimer = setInterval(() => {
    sendMeta();
    if (++metaTicks > 30) clearInterval(metaTimer);
  }, 1000);

  // 「ストレッチ」表示のときは映像を枠に合わせて拡大し、はみ出た端を切る
  document.documentElement.classList.toggle('hukumado-fill', params.get('hukumado_fill') === '1');

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    if (e.data?.hukumado === 'audio') {
      setMuted(!!e.data.muted);
    } else if (e.data?.hukumado === 'fill') {
      document.documentElement.classList.toggle('hukumado-fill', !!e.data.on);
    } else if (e.data?.hukumado === 'social' && ['subscribe', 'like'].includes(e.data.act)) {
      document.dispatchEvent(new CustomEvent('hukumado:social-act', { detail: e.data.act }));
    } else if (e.data?.hukumado === 'playback') {
      document.dispatchEvent(new CustomEvent('hukumado:playback', { detail: e.data.play ? 'play' : 'pause' }));
    } else if (e.data?.hukumado === 'away') {
      // マウスが枠の外に出ている間は、プレイヤーの操作 UI を隠す (watch.css)
      document.documentElement.classList.toggle('hukumado-away', !!e.data.on);
    }
  });

  // プレイヤーは枠のサイズに合わせて自分の大きさを決めるので、しばらく resize を送り続ける
  let ticks = 0;
  const timer = setInterval(() => {
    window.dispatchEvent(new Event('resize'));
    if (++ticks > 20) clearInterval(timer);
  }, 500);
})();
