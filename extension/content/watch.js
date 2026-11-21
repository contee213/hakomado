// hakomado: マルチビュー画面の枠に入れた watch ページを、
// プレイヤーだけが枠いっぱいに出るように整え、親とミュート状態・配信情報をやりとりする。
// 普通に YouTube を開いたときは何もしない。
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (window.top === window || params.get('hakomado') !== '1') return;

  const PARENT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  document.documentElement.classList.add('hakomado-frame');

  // ---- ミュートの操作は、ページ側で動く watch-main.js が YouTube プレイヤーの API で行う
  // (プレイヤーのスピーカー表示と実際の状態をそろえるため)。ここは親との中継だけ。
  const setMuted = (muted) =>
    document.dispatchEvent(new CustomEvent('hakomado:set-muted', { detail: muted ? '1' : '0' }));

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
    if ([start, end, dur].every(Number.isFinite)) window.parent.postMessage({ hakomado: 'archive', start, end, dur }, PARENT_ORIGIN);
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
      },
      PARENT_ORIGIN,
    );
  });

  // 配信・動画が終わった → 親に知らせる (自動再生中に枠を片付けるため)
  document.addEventListener('hakomado:ended', (e) => {
    const reason = e.detail === 'played' ? 'played' : 'already';
    window.parent.postMessage({ hakomado: 'ended', reason }, PARENT_ORIGIN);
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

  // ---- 枠ごとの音の左右 (パン) と音量。Web Audio で video → StereoPanner → Gain → 出力 とつなぐ
  // - 経路は、初めて中央・等倍以外にしたときだけ作る (使っていない枠には何もしない)。
  //   一度つなぐと元には戻せない (createMediaElementSource は 1 つの要素に 1 回だけ) ので、中央・等倍に戻したときは値だけ戻す
  // - AudioContext が動いていない (自動再生の許可が無いなど) ときにつなぐと音が消えるので、動いているのを確かめてからつなぐ。
  //   つなげなかったら親に知らせる
  // - 消音・音量・再生速度はプレイヤー (video 要素) 側の操作のまま効く (経路は video の出力のあとにつなぐ)
  // - YouTube は video 要素を差し替えることがあるので、つないでいる間は見張って、差し替わったらつなぎ直す
  const Mix = (() => {
    let ctx = null;
    let panner = null;
    let gainNode = null;
    let connected = null; // 今つないでいる video
    let timer = 0;
    const sources = new WeakMap(); // video → MediaElementAudioSourceNode
    const video = () => document.querySelector('#movie_player video');
    const report = (ok) => window.parent.postMessage({ hakomado: 'mix', ok }, PARENT_ORIGIN);

    async function running() {
      if (!ctx) {
        ctx = new AudioContext();
        panner = new StereoPannerNode(ctx);
        gainNode = new GainNode(ctx);
        panner.connect(gainNode).connect(ctx.destination);
        // 途中で止められたら (タブを長く隠したなど) 動かし直す。動かなければ親に知らせる
        ctx.addEventListener('statechange', () => {
          if (ctx.state === 'suspended') ctx.resume().catch(() => {}).finally(() => ctx.state !== 'running' && report(false));
        });
      }
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      return ctx.state === 'running';
    }

    function connectVideo() {
      const v = video();
      if (!v || v === connected) return;
      let src = sources.get(v);
      if (!src) {
        src = ctx.createMediaElementSource(v);
        sources.set(v, src);
      }
      if (connected) sources.get(connected)?.disconnect();
      src.connect(panner);
      connected = v;
    }

    async function set(pan, gain) {
      pan = Math.max(-1, Math.min(1, Number(pan) || 0));
      gain = Math.max(0, Math.min(2, Number.isFinite(Number(gain)) ? Number(gain) : 1));
      if (!ctx && pan === 0 && gain === 1) return; // まだ使っていない枠は、そのまま
      if (!(await running())) {
        report(false);
        return;
      }
      connectVideo();
      panner.pan.setTargetAtTime(pan, ctx.currentTime, 0.02);
      gainNode.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
      if (!timer) timer = setInterval(connectVideo, 2000);
      report(true);
    }

    // 枠を読み直す・閉じるときは片付ける (「戻る」で元に戻せるように残すとき (persisted) は閉じない)
    window.addEventListener('pagehide', (e) => {
      if (e.persisted) return;
      clearInterval(timer);
      ctx?.close().catch(() => {});
    });
    return { set };
  })();

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    if (e.data?.hakomado === 'audio') {
      setMuted(!!e.data.muted);
    } else if (e.data?.hakomado === 'mix') {
      Mix.set(e.data.pan, e.data.gain);
    } else if (e.data?.hakomado === 'fill') {
      document.documentElement.classList.toggle('hakomado-fill', !!e.data.on);
    } else if (e.data?.hakomado === 'social' && ['subscribe', 'like'].includes(e.data.act)) {
      document.dispatchEvent(new CustomEvent('hakomado:social-act', { detail: e.data.act }));
    } else if (e.data?.hakomado === 'playback') {
      document.dispatchEvent(new CustomEvent('hakomado:playback', { detail: e.data.play ? 'play' : 'pause' }));
    } else if (e.data?.hakomado === 'sync' && ['seek', 'play', 'pause', 'rate'].includes(e.data.op)) {
      const detail = JSON.stringify({ op: e.data.op, t: Number(e.data.t), r: Number(e.data.r) });
      document.dispatchEvent(new CustomEvent('hakomado:sync', { detail }));
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
