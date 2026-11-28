// hakomado: マルチビュー画面の枠に入れた watch ページを、
// プレイヤーだけが枠いっぱいに出るように整え、親とミュート状態・配信情報をやりとりする。
// 普通に YouTube を開いたときは何もしない。
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (window.top === window || params.get('hakomado') !== '1') return;
  ErrLog.install('watch');

  const PARENT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  document.documentElement.classList.add('hakomado-frame');

  // パソコンのファイルを持って枠の上に入ってきたら、親に知らせる (親が枠の iframe を無視して、ファイルの枠へのドロップを受け取れるように)
  document.addEventListener(
    'dragenter',
    (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) window.parent.postMessage({ hakomado: 'fileDrag' }, PARENT_ORIGIN);
    },
    true,
  );

  // ---- ミュートの操作は、ページ側で動く watch-main.js が YouTube プレイヤーの API で行う
  // (プレイヤーのスピーカー表示と実際の状態をそろえるため)。ここは親との中継だけ。
  const setMuted = (muted) =>
    document.dispatchEvent(new CustomEvent('hakomado:set-muted', { detail: muted ? '1' : '0' }));
  // 消音を外すだけ (止まっていても再生し直さない)
  const unmuteQuietly = () => document.dispatchEvent(new CustomEvent('hakomado:set-muted', { detail: '0q' }));

  // 枠内のプレイヤーで直接ミュートを切り替えた → 親に知らせる (親が「音は 1 枠だけ」にそろえる)
  document.addEventListener('hakomado:user-audio', (e) => {
    let muted;
    try {
      muted = !!JSON.parse(e.detail).muted;
    } catch {
      return;
    }
    window.parent.postMessage({ hakomado: 'userAudio', muted }, PARENT_ORIGIN);
  });
  // 枠内のプレイヤーで速度を変えた → 親に知らせる (同期中ならグループ全部の速度にする)
  document.addEventListener('hakomado:user-speed', (e) => {
    const r = Number(e.detail);
    if (Number.isFinite(r)) window.parent.postMessage({ hakomado: 'userSpeed', r }, PARENT_ORIGIN);
  });

  // 見られるか (playabilityStatus) → 親に知らせる (メンバー限定の配信を自動再生から外すため)
  document.addEventListener('hakomado:playability', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    window.parent.postMessage(
      { hakomado: 'playability', status: String(d.status || ''), text: String(d.text || '').slice(0, 8000) },
      PARENT_ORIGIN,
    );
  });

  // ライブの位置 (配信開始からの経過。watch-main.js から。🎬 本編モード用)
  document.addEventListener('hakomado:live-pos', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    const pos = Number(d.pos);
    if (Number.isFinite(pos)) window.parent.postMessage({ hakomado: 'livePos', pos, ps: Number(d.ps) || 0 }, PARENT_ORIGIN);
  });

  // ライブ配信中か (watch-main.js から)
  document.addEventListener('hakomado:live', (e) => window.parent.postMessage({ hakomado: 'live', on: e.detail === '1' }, PARENT_ORIGIN));

  // アーカイブのチャットリプレイ用 (watch-main.js から)
  document.addEventListener('hakomado:replay', (e) => {
    const c = String(e.detail || '');
    if (/^[\w%=-]{10,2000}$/.test(c)) window.parent.postMessage({ hakomado: 'replay', continuation: c }, PARENT_ORIGIN);
  });
  document.addEventListener('hakomado:progress', (e) => {
    const t = Number(e.detail);
    if (Number.isFinite(t)) window.parent.postMessage({ hakomado: 'progress', t }, PARENT_ORIGIN);
  });

  // アーカイブの同期再生用 (watch-main.js から): 配信の時刻と、再生の状態
  document.addEventListener('hakomado:archive', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    const [start, end, dur] = [Number(d.start), Number(d.end), Number(d.dur)];
    if ([start, end, dur].every(Number.isFinite)) window.parent.postMessage({ hakomado: 'archive', start, end, dur, premiere: d.premiere === true }, PARENT_ORIGIN);
  });
  document.addEventListener('hakomado:sync-state', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    const t = Number(d.t);
    if (!Number.isFinite(t)) return;
    window.parent.postMessage({ hakomado: 'syncState', t, ps: Number(d.ps), ad: !!d.ad, r: Number(d.r) || 1, up: !!d.up, sk: Number(d.sk) || 0, ts: Number(d.ts) || 0 }, PARENT_ORIGIN);
  });

  // 枠の情報 (種類・視聴者数・再生数・配信の時刻・公開日。watch-main.js から) → 親の「ℹ 枠の情報」・同期ボタン用
  const KINDS = ['live', 'upcoming', 'archive', 'video'];
  document.addEventListener('hakomado:info', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    // 縦長の映像は、ストレッチ表示でも切らずに枠に収める (16:9 の枠いっぱいに広げると上下の大半が切れるため)
    document.documentElement.classList.toggle('hakomado-vertical', d.vertical === true);
    window.parent.postMessage(
      {
        hakomado: 'info',
        kind: KINDS.includes(d.kind) ? d.kind : '',
        viewers: num(d.viewers),
        views: num(d.views),
        start: num(d.start),
        end: num(d.end),
        publish: num(d.publish),
        dur: num(d.dur),
        t: num(d.t),
        vertical: typeof d.vertical === 'boolean' ? d.vertical : null,
      },
      PARENT_ORIGIN,
    );
  });

  // 配信・動画が終わった → 親に知らせる (自動再生中に枠を片付けるため)
  document.addEventListener('hakomado:ended', (e) => {
    const reason = e.detail === 'played' ? 'played' : 'already';
    window.parent.postMessage({ hakomado: 'ended', reason }, PARENT_ORIGIN);
  });

  // ほかの動画に移った (YouTube の自動再生・レイドなど。watch-main.js から) → 親が元に戻すか、移った先に合わせる
  document.addEventListener('hakomado:moved', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    const id = String(d.id || '');
    if (/^[\w-]{11}$/.test(id)) window.parent.postMessage({ hakomado: 'moved', id, follow: d.follow === true }, PARENT_ORIGIN);
  });

  // チャンネル登録・高評価の状態 → 親に知らせる (枠のバーのボタンの表示用)
  document.addEventListener('hakomado:social', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    window.parent.postMessage(
      {
        hakomado: 'social',
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
    // 先頭の「(448) 」は YouTube の通知の数なので除く
    const title = document.title.replace(/ - YouTube$/, '').replace(/^\(\d+\+?\)\s*/, '').trim();
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
    window.parent.postMessage({ hakomado: 'meta', title, channel, handle, channelId }, PARENT_ORIGIN);
  };
  let metaTicks = 0;
  const metaTimer = setInterval(() => {
    sendMeta();
    if (++metaTicks > 30) clearInterval(metaTimer);
  }, 1000);

  // 「ストレッチ」表示のときは映像を枠に合わせて拡大し、はみ出た端を切る
  document.documentElement.classList.toggle('hakomado-fill', params.get('hakomado_fill') === '1');
  // 端を切るとき残す角 (配信者が映っている角)。右下・左下・左上・右上
  const setCorner = (c) => {
    const pos = { br: '100% 100%', bl: '0% 100%', tl: '0% 0%', tr: '100% 0%' }[c] || '100% 100%';
    document.documentElement.style.setProperty('--hakomado-crop-pos', pos);
  };
  setCorner(params.get('hakomado_corner'));

  // ---- 枠ごとの音の遅延・左右 (パン)・音量と、✨ 自動補正のための音の記録 (content/mix.js。Twitch の枠と共通)
  const Mix = HakomadoMix({
    video: () => document.querySelector('#movie_player video'),
    adShowing: () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'),
    setMuted,
    unmuteQuietly,
    parentOrigin: PARENT_ORIGIN,
  });

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    if (e.data?.hakomado === 'audio') {
      if (!Mix.audio(!!e.data.muted)) setMuted(!!e.data.muted);
    } else if (e.data?.hakomado === 'measure') {
      Mix.measure(!!e.data.on, !!e.data.muted);
    } else if (e.data?.hakomado === 'mix') {
      Mix.set(e.data.pan, e.data.gain, e.data.delay, e.data.level);
    } else if (e.data?.hakomado === 'fill') {
      document.documentElement.classList.toggle('hakomado-fill', !!e.data.on);
    } else if (e.data?.hakomado === 'corner') {
      setCorner(e.data.corner);
    } else if (e.data?.hakomado === 'social' && ['subscribe', 'like'].includes(e.data.act)) {
      document.dispatchEvent(new CustomEvent('hakomado:social-act', { detail: e.data.act }));
    } else if (e.data?.hakomado === 'loop') {
      document.dispatchEvent(new CustomEvent('hakomado:loop', { detail: e.data.on ? '1' : '0' }));
    } else if (e.data?.hakomado === 'playback') {
      document.dispatchEvent(new CustomEvent('hakomado:playback', { detail: e.data.play ? (e.data.onlyPaused ? 'resume' : 'play') : 'pause' }));
    } else if (e.data?.hakomado === 'sync' && ['seek', 'play', 'pause', 'rate'].includes(e.data.op)) {
      const detail = JSON.stringify({ op: e.data.op, t: Number(e.data.t), r: Number(e.data.r) });
      document.dispatchEvent(new CustomEvent('hakomado:sync', { detail }));
    } else if (e.data?.hakomado === 'speed' && Number.isFinite(Number(e.data.r))) {
      document.dispatchEvent(new CustomEvent('hakomado:speed', { detail: String(Number(e.data.r)) }));
    } else if (e.data?.hakomado === 'infoReq') {
      document.dispatchEvent(new CustomEvent('hakomado:info-req'));
    } else if (e.data?.hakomado === 'away') {
      // マウスが枠の外に出ている間は、プレイヤーの操作 UI を隠す (watch.css)
      document.documentElement.classList.toggle('hakomado-away', !!e.data.on);
    }
  });

  // プレイヤーは枠のサイズに合わせて自分の大きさを決めるので、しばらく resize を送り続ける
  let ticks = 0;
  const timer = setInterval(() => {
    window.dispatchEvent(new Event('resize'));
    if (++ticks > 20) clearInterval(timer);
  }, 500);
})();
