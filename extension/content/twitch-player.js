// hakomado: Twitch の公式の埋め込みプレイヤー (player.twitch.tv) を Hakomado の枠に入れたとき、親 (マルチビュー画面) と
// 再生の状態・速度・音の経路をやりとりする。YouTube の枠の content/watch.js・watch-main.js と同じ形の知らせを使う。
// - twitch.tv の任意の権限を許可したときだけ、background.js が登録する (chrome.scripting.registerContentScripts)。
//   マルチビュー画面の枠に直接入れたときだけ動く。twitch.tv を普通に開いたとき・ほかのサイトに埋め込まれたときは何もしない
// - 一時停止・シーク・消音は、親が公式の埋め込みの命令で送る (プレイヤーの表示とそろうように)。最後まで再生したこと
//   (繰り返しもそこで行う) は、公式の埋め込みが親に知らせる ended で親が扱う (動画要素の ended は来ない)。ここで受けるのは、
//   公式の命令に無いもの: 速度 (speed と同期の速度の補正)・音の遅延・左右・音量 (mix)・✨ 自動補正の音の記録 (measure)・
//   弾幕 (danmaku で ON / OFF と設定、chat でコメント)。弾幕はプレイヤーの上 (親の画面) に重ねると Twitch が止まるので、
//   このページの中に描く (danmaku.js・danmaku.css を一緒に登録してある)
// - 親へ知らせるもの:
//   syncState  VOD の再生位置・状態 (0.5 秒ごと。{t, ps, ad, r, up, sk, ts}。ps は YouTube のプレイヤーの状態の番号に合わせる:
//              0 = 終わった / 1 = 再生中 / 2 = 一時停止 / 3 = 読み込み中)
//   info       種類 (VOD = archive / チャンネル = live) と長さ (親が求めたときと、長さが分かったとき)
//   twPause    止まった / 再生に戻った ({on, user}。user = 枠の中で使う人が止めた)。Twitch のプレイヤーは、
//              何かが重なると自分で止まって戻らないので、親はそのとき (user でないとき) に再生の命令を送り直す
//   mix / measure / envChunk  音の経路・記録 (content/mix.js)
(() => {
  'use strict';

  const PARENT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  const anc = location.ancestorOrigins;
  if (window.top === window || !anc || anc.length !== 1 || anc[0] !== PARENT_ORIGIN) return;
  ErrLog.install('twitch');

  const vod = new URLSearchParams(location.search).has('video');
  const video = () => document.querySelector('video');
  const post = (msg) => window.parent.postMessage(msg, PARENT_ORIGIN);

  // 消音は親が公式の命令で行う (測っている間の消音の付け外しも、親が命令を送る) ので、ここでは何もしない
  const Mix = HakomadoMix({ video, adShowing: () => false, setMuted: () => {}, unmuteQuietly: () => {}, parentOrigin: PARENT_ORIGIN });

  // ---- 速度: 枠の速度 (base) × 同期の補正 (corr)。公式の命令に速度は無いので、動画要素に直接掛ける。
  // 画質の切り替えなどで戻ることがあるので、ときどき確かめて掛け直す
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 4;
  let base = 1;
  let corr = 1;
  const applyRate = () => {
    const v = video();
    const r = vod ? base * corr : 1; // チャンネルのライブは等速
    if (v && Math.abs(v.playbackRate - r) > 0.001) v.playbackRate = r;
  };
  setInterval(applyRate, 1000);

  // ---- 枠の中での操作 (同期の「止めて待つ」・シークでずれを決める、のため。親の指示による一時停止・シークと見分ける)
  let lastAct = -Infinity;
  let userPaused = false;
  let userSeeks = 0;
  for (const type of ['pointerdown', 'pointerup', 'keydown']) document.addEventListener(type, () => (lastAct = performance.now()), true);
  const byUser = () => performance.now() - lastAct < 1500;
  document.addEventListener(
    'pause',
    (e) => {
      if (e.target !== video()) return;
      userPaused = byUser();
      post({ hakomado: 'twPause', on: true, user: userPaused });
    },
    true,
  );
  document.addEventListener('play', () => (userPaused = false), true);
  document.addEventListener('playing', (e) => e.target === video() && post({ hakomado: 'twPause', on: false, user: false }), true);
  document.addEventListener('seeking', () => byUser() && userSeeks++, true);

  // ---- 種類と長さ
  let infoSent = false;
  const info = () => {
    const v = video();
    const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    if (vod && dur == null) return false;
    post({ hakomado: 'info', kind: vod ? 'archive' : 'live', dur: vod ? dur : null, t: v ? v.currentTime : null });
    return true;
  };

  // ---- 再生位置・状態 (VOD だけ。同期再生用)
  setInterval(() => {
    if (!infoSent) infoSent = info();
    const v = video();
    if (!vod || !v || !(v.duration > 0)) return;
    const ps = v.ended ? 0 : v.paused ? 2 : v.seeking || v.readyState < 3 ? 3 : 1;
    post({
      hakomado: 'syncState',
      t: v.currentTime,
      ps,
      ad: false,
      r: v.playbackRate || 1,
      up: ps === 2 && userPaused,
      sk: userSeeks,
      ts: performance.timeOrigin + performance.now(),
    });
  }, 500);

  // ---- 弾幕 (チャンネルのライブだけ。コメントは親がチャット欄 (content/twitch-chat.js) から回してくる)
  let dmSettings = null;
  let danmaku = null;
  function setDanmaku(on, settings) {
    dmSettings = settings && typeof settings === 'object' ? settings : dmSettings;
    if (!on) {
      danmaku?.setEnabled(false);
      return;
    }
    if (!danmaku) {
      const layer = document.createElement('div');
      layer.className = 'danmaku-layer';
      // ページのどこが動いても枠全体に出るよう、画面に固定して一番前に置く (操作は下のプレイヤーに通す)
      layer.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647;';
      document.body.append(layer);
      danmaku = new Danmaku(layer, () => dmSettings || {});
    }
    const look = dmSettings?.look || {};
    danmaku.layer.style.setProperty('--dm-font', String(look.font || 'inherit'));
    danmaku.layer.style.setProperty('--dm-weight', String(look.weight || '700'));
    danmaku.setEnabled(true);
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    const d = e.data;
    if (!d || typeof d.hakomado !== 'string') return;
    if (d.hakomado === 'audio') {
      Mix.audio(!!d.muted); // 測っている間だけ届く (Web Audio 側で消音する)
    } else if (d.hakomado === 'measure') {
      Mix.measure(!!d.on, !!d.muted);
    } else if (d.hakomado === 'mix') {
      Mix.set(d.pan, d.gain, d.delay);
    } else if (d.hakomado === 'speed' && Number.isFinite(Number(d.r))) {
      base = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(d.r)));
      applyRate();
    } else if (d.hakomado === 'sync' && d.op === 'rate' && Number.isFinite(Number(d.r))) {
      // 少しのずれは速度をわずかに変えて吸収する (枠の速度に掛ける補正)
      corr = Math.min(1.25, Math.max(0.75, Number(d.r)));
      applyRate();
    } else if (d.hakomado === 'infoReq') {
      info();
    } else if (d.hakomado === 'danmaku') {
      if (!vod) setDanmaku(!!d.on, d.s);
    } else if (d.hakomado === 'chat' && Array.isArray(d.messages)) {
      if (danmaku?.enabled) for (const m of d.messages.slice(0, 50)) danmaku.add(m);
    }
  });
})();
