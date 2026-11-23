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

  // ---- 枠ごとの音の遅延・左右 (パン)・音量。Web Audio で video → Delay → StereoPanner → Gain → outGain → 出力 とつなぐ
  // - 遅延はライブ配信の音ずれ用 (映像はそのまま、音だけ遅らせる)。追っかけ再生を切った配信は、YouTube が
  //   遅れを 1 秒ほどの幅に保とうとして映像ごとは遅らせられないため、音のほうを遅らせる
  // - 経路は、初めて遅延 0・中央・等倍以外にしたときだけ作る (使っていない枠には何もしない)。
  //   一度つなぐと元には戻せない (createMediaElementSource は 1 つの要素に 1 回だけ) ので、元に戻したときは値だけ戻す
  // - AudioContext が動いていない (自動再生の許可が無いなど) ときにつなぐと音が消えるので、動いているのを確かめてからつなぐ。
  //   つなげなかったら親に知らせる
  // - 消音・音量・再生速度はプレイヤー (video 要素) 側の操作のまま効く (経路は video の出力のあとにつなぐ)
  // - YouTube は video 要素を差し替えることがあるので、つないでいる間は見張って、差し替わったらつなぎ直す
  // - 🎧 音で合わせる (親の同期再生) で測っている間は、音の大きさ (包絡) を記録して親に送る (下の measure)
  const Mix = (() => {
    let ctx = null;
    let panner = null;
    let gainNode = null;
    let delayNode = null;
    let outGain = null; // 測っている間の消音用 (ふだんは 1)
    let connected = null; // 今つないでいる video
    let timer = 0;
    const MAX_DELAY = 60; // 遅延の上限 (秒)。grid.js の clampDelay と合わせる
    const sources = new WeakMap(); // video → MediaElementAudioSourceNode
    const video = () => document.querySelector('#movie_player video');
    const report = (ok) => window.parent.postMessage({ hakomado: 'mix', ok }, PARENT_ORIGIN);

    async function running() {
      if (!ctx) {
        ctx = new AudioContext();
        panner = new StereoPannerNode(ctx);
        gainNode = new GainNode(ctx);
        delayNode = new DelayNode(ctx, { maxDelayTime: MAX_DELAY });
        outGain = new GainNode(ctx);
        delayNode.connect(panner).connect(gainNode).connect(outGain).connect(ctx.destination);
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
      src.connect(delayNode);
      // 測る記録は遅延の前から取る (再生位置 currentTime と合わせるため)
      if (tap && measuring) src.connect(tap);
      connected = v;
    }

    async function set(pan, gain, delay) {
      pan = Math.max(-1, Math.min(1, Number(pan) || 0));
      gain = Math.max(0, Math.min(2, Number.isFinite(Number(gain)) ? Number(gain) : 1));
      delay = Math.max(0, Math.min(MAX_DELAY, Number(delay) || 0));
      if (!ctx && pan === 0 && gain === 1 && delay === 0) return; // まだ使っていない枠は、そのまま
      if (!(await running())) {
        report(false);
        return;
      }
      connectVideo();
      panner.pan.setTargetAtTime(pan, ctx.currentTime, 0.02);
      gainNode.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
      // 遅延は急に変えるとプツッと鳴るので、少しかけて変える (変えている間だけ音の高さが少し揺れる)
      delayNode.delayTime.setTargetAtTime(delay, ctx.currentTime, 0.05);
      if (!timer) timer = setInterval(connectVideo, 2000);
      report(true);
    }

    // ---- 🎧 音で合わせる: 測っている間、音の大きさ (1 ミリ秒ごとの |x| の平均) を記録して、1 秒ごとに親へ送る
    // - 消音中のプレイヤーからは無音しか取れないので、測っている間はプレイヤーの消音を外し、消音は Web Audio 側 (outGain = 0) で行う。
    //   YouTube は再生・シークのあとに消音を戻すことがあるので、測っている間は見張って外し続ける。終わったらプレイヤーの消音に戻す
    // - 記録するのは「再生中で、シーク中でも広告中でもない」間だけ。バッファごとに [累計サンプル数, 再生位置, 速度] も送る
    //   (サンプルが抜けることがあるので、親はこれでビンの再生位置を求める。audio-align.js の toReal)
    // - ScriptProcessor を使う (AudioWorklet はモジュールの読み込みがページの CSP に左右されるため)
    let tap = null;
    let measuring = false;
    let wantMuted = false; // 測っている間に親が求めている消音
    let guard = 0;
    let flushTimer = 0;
    let bins = [];
    let marks = [];
    let total = 0;
    let acc = 0;
    let cnt = 0;
    let per = 48;
    const adShowing = () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');

    function onAudio(e) {
      const v = connected;
      if (!measuring || !v || v.paused || v.seeking || adShowing()) return;
      const buf = e.inputBuffer;
      const a = buf.getChannelData(0);
      const b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
      for (let k = 0; k < a.length; k++) {
        acc += Math.abs(a[k]) + Math.abs(b[k]);
        if (++cnt === per) {
          bins.push(acc / (2 * per));
          acc = 0;
          cnt = 0;
        }
      }
      total += a.length;
      marks.push([total, v.currentTime, v.playbackRate || 1]);
    }
    function flush() {
      if (!bins.length) return;
      const out = Float32Array.from(bins);
      window.parent.postMessage({ hakomado: 'envChunk', sr: ctx.sampleRate, per, bins: out, marks }, PARENT_ORIGIN, [out.buffer]);
      bins = [];
      marks = [];
    }
    function applyMute() {
      outGain.gain.cancelScheduledValues(ctx.currentTime);
      outGain.gain.setValueAtTime(measuring && wantMuted ? 0 : 1, ctx.currentTime);
    }
    async function startMeasure(muted) {
      wantMuted = !!muted;
      if (!(await running())) {
        window.parent.postMessage({ hakomado: 'measure', ok: false }, PARENT_ORIGIN);
        return;
      }
      connectVideo();
      if (!timer) timer = setInterval(connectVideo, 2000);
      if (!tap) {
        tap = ctx.createScriptProcessor(4096, 2, 1);
        tap.connect(new GainNode(ctx, { gain: 0 })).connect(ctx.destination); // 音は出さない (つながっていないと動かない)
      }
      per = Math.round(ctx.sampleRate / 1000);
      bins = [];
      marks = [];
      total = 0;
      acc = 0;
      cnt = 0;
      measuring = true;
      applyMute(); // 先に Web Audio 側で消音してから、プレイヤーの消音を外す
      if (connected) sources.get(connected)?.connect(tap);
      tap.onaudioprocess = onAudio;
      unmuteQuietly();
      clearInterval(guard);
      guard = setInterval(() => {
        if (connected?.muted) unmuteQuietly();
      }, 250);
      clearInterval(flushTimer);
      flushTimer = setInterval(flush, 1000);
      window.parent.postMessage({ hakomado: 'measure', ok: true }, PARENT_ORIGIN);
    }
    function stopMeasure() {
      if (!measuring) return;
      flush();
      measuring = false;
      clearInterval(guard);
      clearInterval(flushTimer);
      tap.onaudioprocess = null;
      try {
        sources.get(connected)?.disconnect(tap);
      } catch {
        /* つないでいなかった */
      }
      setMuted(wantMuted); // プレイヤーの消音に戻してから、Web Audio 側の消音を外す
      applyMute();
    }
    /** 親からの消音の指示。測っている間は Web Audio 側で行う (true を返す) */
    function audio(muted) {
      if (!measuring) return false;
      wantMuted = !!muted;
      applyMute();
      return true;
    }

    // 枠を読み直す・閉じるときは片付ける (「戻る」で元に戻せるように残すとき (persisted) は閉じない)
    window.addEventListener('pagehide', (e) => {
      if (e.persisted) return;
      clearInterval(timer);
      clearInterval(guard);
      clearInterval(flushTimer);
      ctx?.close().catch(() => {});
    });
    return { set, measure: (on, muted) => (on ? startMeasure(muted) : stopMeasure()), audio };
  })();

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    if (e.data?.hakomado === 'audio') {
      if (!Mix.audio(!!e.data.muted)) setMuted(!!e.data.muted);
    } else if (e.data?.hakomado === 'measure') {
      Mix.measure(!!e.data.on, !!e.data.muted);
    } else if (e.data?.hakomado === 'mix') {
      Mix.set(e.data.pan, e.data.gain, e.data.delay);
    } else if (e.data?.hakomado === 'fill') {
      document.documentElement.classList.toggle('hakomado-fill', !!e.data.on);
    } else if (e.data?.hakomado === 'social' && ['subscribe', 'like'].includes(e.data.act)) {
      document.dispatchEvent(new CustomEvent('hakomado:social-act', { detail: e.data.act }));
    } else if (e.data?.hakomado === 'playback') {
      document.dispatchEvent(new CustomEvent('hakomado:playback', { detail: e.data.play ? 'play' : 'pause' }));
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
