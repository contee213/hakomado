// hakomado: 枠の中のプレイヤーの音の経路 (遅延・左右・音量)、✨ 自動補正のための音の記録と、🎚 音量バランスのための音の大きさ。
// YouTube の枠 (content/watch.js) と Twitch の枠 (content/twitch-player.js) で共通。同じ content script の中で先に読み込む。
// プレイヤーごとに違うところ (動画要素の見つけ方・広告中か・プレイヤーの消音の操作) は呼ぶ側から渡す:
//   video()          今の動画要素
//   adShowing()      広告中か (広告中は音を記録しない)
//   setMuted(m)      プレイヤーの消音を m にする (測り終わったとき)
//   unmuteQuietly()  プレイヤーの消音を外す (止まっていても再生し直さない。測っている間)
//   parentOrigin     親 (マルチビュー画面) のオリジン
/* exported HakomadoMix */
'use strict';

// ---- 枠ごとの音の遅延・左右 (パン)・音量。Web Audio で video → Delay → StereoPanner → Gain → outGain → 出力 とつなぐ
// - 遅延はライブ配信の音ずれ用 (映像はそのまま、音だけ遅らせる)。追っかけ再生を切った配信は、YouTube が
//   遅れを 1 秒ほどの幅に保とうとして映像ごとは遅らせられないため、音のほうを遅らせる
// - 経路は、初めて遅延 0・中央・等倍以外にしたときだけ作る (使っていない枠には何もしない)。
//   一度つなぐと元には戻せない (createMediaElementSource は 1 つの要素に 1 回だけ) ので、元に戻したときは値だけ戻す
// - AudioContext が動いていない (自動再生の許可が無いなど) ときにつなぐと音が消えるので、動いているのを確かめてからつなぐ。
//   つなげなかったら親に知らせる
// - 消音・音量・再生速度はプレイヤー (video 要素) 側の操作のまま効く (経路は video の出力のあとにつなぐ)
// - YouTube は video 要素を差し替えることがあるので、つないでいる間は見張って、差し替わったらつなぎ直す
// - ✨ 自動補正 (親の同期再生。音で合わせる) で測っている間は、音の大きさ (包絡) を記録して親に送る (下の measure)
const HakomadoMix = ({ video, adShowing, setMuted, unmuteQuietly, parentOrigin }) => {
  let ctx = null;
  let panner = null;
  let gainNode = null;
  let delayNode = null;
  let outGain = null; // 測っている間の消音用 (ふだんは 1)
  let connected = null; // 今つないでいる video
  let timer = 0;
  const MAX_DELAY = 60; // 遅延の上限 (秒)。grid.js の clampDelay と合わせる
  const MAX_GAIN = 4; // 音量の倍率の上限。volume-balance.js の MAX_EFFECTIVE と合わせる
  const sources = new WeakMap(); // video → MediaElementAudioSourceNode
  const report = (ok) => window.parent.postMessage({ hakomado: 'mix', ok }, parentOrigin);

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
    if (meter && metering && !measuring) src.connect(meter);
    connected = v;
  }

  // gain は枠の音量 × 🎚 音量バランスの自動の倍率 × 主役の割合 (grid.js の effectiveGain) なので、上限は MAX_GAIN
  async function set(pan, gain, delay, level) {
    pan = Math.max(-1, Math.min(1, Number(pan) || 0));
    gain = Math.max(0, Math.min(MAX_GAIN, Number.isFinite(Number(gain)) ? Number(gain) : 1));
    delay = Math.max(0, Math.min(MAX_DELAY, Number(delay) || 0));
    level = !!level;
    if (!ctx && pan === 0 && gain === 1 && delay === 0 && !level) return; // まだ使っていない枠は、そのまま
    if (!(await running())) {
      report(false);
      if (level) window.parent.postMessage({ hakomado: 'level', ok: false }, parentOrigin);
      return;
    }
    connectVideo();
    setMetering(level);
    panner.pan.setTargetAtTime(pan, ctx.currentTime, 0.02);
    gainNode.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
    // 遅延は急に変えるとプツッと鳴るので、少しかけて変える (変えている間だけ音の高さが少し揺れる)
    delayNode.delayTime.setTargetAtTime(delay, ctx.currentTime, 0.05);
    if (!timer) timer = setInterval(connectVideo, 2000);
    report(true);
  }

  // ---- 🎚 音量バランスの「大きさをそろえる」(grid.js の VolumeBalance): ON の間、音の大きさ (2 乗の平均) を 1 秒ごとに親へ送る
  // - 測るのは経路の頭 (遅延・左右・音量の前)。プレイヤーの消音・音量は効いたあとの音 (= この枠がそのまま出す大きさ)
  // - 消音中・止まっている・シーク中・広告中は送らない (無音を「小さい」と数えないように)
  // - AnalyserNode は出力につながなくても動く。読むのは 250 ミリ秒ごと (2048 サンプル ≒ 43 ミリ秒ぶんを 4 回 / 秒)
  // - ✨ 自動補正・〰 波形で音を記録している (measuring) 間は AnalyserNode を外し、記録と同じ音 (onAudio) から大きさも取る
  //   (同じ枠の音を 2 か所で取らない)。記録の間はプレイヤーの消音を外しているので、消音は親の求め (wantMuted) で見る
  let meter = null;
  let metering = false;
  let meterTimer = 0;
  let meterBuf = null;
  let meterSum = 0;
  let meterCnt = 0;
  let meterTicks = 0;
  let tapSq = 0; // 記録している間の、2 乗の和とサンプル数 (onAudio が足す)
  let tapN = 0;
  function readMeter() {
    const v = connected;
    meterTicks++;
    if (measuring) {
      if (!wantMuted && tapN) {
        meterSum += tapSq / tapN;
        meterCnt++;
      }
      tapSq = 0;
      tapN = 0;
    } else if (v && !v.paused && !v.seeking && !v.muted && !adShowing()) {
      meter.getFloatTimeDomainData(meterBuf);
      let sq = 0;
      for (let k = 0; k < meterBuf.length; k++) sq += meterBuf[k] * meterBuf[k];
      meterSum += sq / meterBuf.length;
      meterCnt++;
    }
    if (meterTicks < 4) return;
    if (meterCnt) window.parent.postMessage({ hakomado: 'level', ok: true, ms: meterSum / meterCnt, n: meterCnt }, parentOrigin);
    meterTicks = 0;
    meterSum = 0;
    meterCnt = 0;
  }
  function setMetering(on) {
    if (on === metering) return;
    metering = on;
    if (on) {
      if (!meter) {
        meter = new AnalyserNode(ctx, { fftSize: 2048 });
        meterBuf = new Float32Array(meter.fftSize);
      }
      if (connected && !measuring) sources.get(connected)?.connect(meter);
      meterTicks = 0;
      meterSum = 0;
      meterCnt = 0;
      meterTimer = setInterval(readMeter, 250);
    } else {
      clearInterval(meterTimer);
      meterTimer = 0;
      detachMeter();
    }
  }
  function detachMeter() {
    if (!meter) return;
    try {
      sources.get(connected)?.disconnect(meter);
    } catch {
      /* つないでいなかった */
    }
  }

  // ---- ✨ 自動補正 (音で合わせる): 測っている間、音の大きさ (1 ミリ秒ごとの |x| の平均) を記録して、1 秒ごとに親へ送る
  // - 消音中のプレイヤーからは無音しか取れないので、測っている間はプレイヤーの消音を外し、消音は Web Audio 側 (outGain = 0) で行う。
  //   YouTube は再生・シークのあとに消音を戻すことがあるので、測っている間は見張って外し続ける。終わったらプレイヤーの消音に戻す
  // - 記録するのは「再生中で、シーク中でも広告中でもない」間だけ。バッファごとに [累計サンプル数, 再生位置, 速度] も送る
  //   (サンプルが抜けることがあるので、親はこれでビンの再生位置を求める。audio-align.js の toReal)
  // - 音は MediaStreamAudioDestinationNode → MediaStreamTrackProcessor で受け取る (10 ミリ秒ずつ届く)。
  //   ScriptProcessor は非推奨で、使うと拡張機能のエラーに警告が残る。AudioWorklet はモジュールを読めない
  //   (blob: / data: は YouTube の CSP で止まる。拡張機能の URL は web_accessible_resources で公開しないと読めず、
  //   公開すると YouTube から拡張機能の有無が分かるようになるので避ける)
  // - 印 (marks) は従来どおり MARK_EVERY サンプルごと (親は前後 8 個の印の中央値で平らにするため、細かすぎると揺れる)
  const MARK_EVERY = 4096;
  let tap = null;
  let reader = null; // 測っている間だけ読む (止めたら閉じる)
  let track = null; // reader が読んでいる、複製したトラック
  let measuring = false;
  let wantMuted = false; // 測っている間に親が求めている消音
  let guard = 0;
  let flushTimer = 0;
  let bins = [];
  let marks = [];
  let total = 0;
  let markedAt = 0; // 最後に印を付けたときの total
  let last = null; // まだ印にしていない最新の [累計サンプル数, 再生位置, 速度]
  let acc = 0;
  let cnt = 0;
  let per = 48;
  let planes = [];

  function markNow() {
    if (last) marks.push(last);
    last = null;
    markedAt = total;
  }
  /** @param {AudioData} data */
  function onAudio(data) {
    const v = connected;
    if (!measuring || !v || v.paused || v.seeking || adShowing()) {
      markNow(); // 抜けの前までの分は、抜ける前の再生位置で印を付けておく
      return;
    }
    const n = data.numberOfFrames;
    const ch = Math.min(2, data.numberOfChannels);
    for (let c = 0; c < ch; c++) {
      if (planes[c]?.length !== n) planes[c] = new Float32Array(n);
      data.copyTo(planes[c], { planeIndex: c, format: 'f32-planar' });
    }
    const a = planes[0];
    const b = ch > 1 ? planes[1] : a;
    if (metering) {
      for (let k = 0; k < n; k++) tapSq += a[k] * a[k] + b[k] * b[k];
      tapN += 2 * n;
    }
    for (let k = 0; k < n; k++) {
      acc += Math.abs(a[k]) + Math.abs(b[k]);
      if (++cnt === per) {
        bins.push(acc / (2 * per));
        acc = 0;
        cnt = 0;
      }
    }
    total += n;
    last = [total, v.currentTime, v.playbackRate || 1];
    if (total - markedAt >= MARK_EVERY) markNow();
  }
  async function pump(r) {
    for (;;) {
      let got;
      try {
        got = await r.read();
      } catch {
        return; // 止めた (cancel)
      }
      if (got.done) return;
      try {
        if (r === reader) onAudio(got.value);
      } finally {
        got.value.close();
      }
    }
  }
  function closeReader() {
    reader?.cancel().catch(() => {});
    track?.stop();
    reader = null;
    track = null;
  }
  function flush() {
    markNow();
    if (!bins.length) return;
    const out = Float32Array.from(bins);
    window.parent.postMessage({ hakomado: 'envChunk', sr: ctx.sampleRate, per, bins: out, marks }, parentOrigin, [out.buffer]);
    bins = [];
    marks = [];
  }
  function applyMute() {
    outGain.gain.cancelScheduledValues(ctx.currentTime);
    outGain.gain.setValueAtTime(measuring && wantMuted ? 0 : 1, ctx.currentTime);
  }
  async function startMeasure(muted) {
    wantMuted = !!muted;
    if (typeof MediaStreamTrackProcessor !== 'function' || !(await running())) {
      window.parent.postMessage({ hakomado: 'measure', ok: false }, parentOrigin);
      return;
    }
    connectVideo();
    if (!timer) timer = setInterval(connectVideo, 2000);
    if (!tap) tap = new MediaStreamAudioDestinationNode(ctx, { channelCount: 2 });
    closeReader();
    // 測るたびに複製したトラックから読む (止めるときに閉じれば、測っていない間は何も溜まらない)
    track = tap.stream.getAudioTracks()[0].clone();
    reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    per = Math.round(ctx.sampleRate / 1000);
    bins = [];
    marks = [];
    total = 0;
    markedAt = 0;
    last = null;
    acc = 0;
    cnt = 0;
    measuring = true;
    applyMute(); // 先に Web Audio 側で消音してから、プレイヤーの消音を外す
    if (connected) sources.get(connected)?.connect(tap);
    detachMeter(); // 測っている間の大きさは記録から取る
    tapSq = 0;
    tapN = 0;
    pump(reader);
    unmuteQuietly();
    clearInterval(guard);
    guard = setInterval(() => {
      if (connected?.muted) unmuteQuietly();
    }, 250);
    clearInterval(flushTimer);
    flushTimer = setInterval(flush, 1000);
    window.parent.postMessage({ hakomado: 'measure', ok: true }, parentOrigin);
  }
  function stopMeasure() {
    if (!measuring) return;
    flush();
    measuring = false;
    clearInterval(guard);
    clearInterval(flushTimer);
    closeReader();
    try {
      sources.get(connected)?.disconnect(tap);
    } catch {
      /* つないでいなかった */
    }
    if (metering && meter && connected) sources.get(connected)?.connect(meter);
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
    clearInterval(meterTimer);
    ctx?.close().catch(() => {});
  });
  return { set, measure: (on, muted) => (on ? startMeasure(muted) : stopMeasure()), audio };
};
