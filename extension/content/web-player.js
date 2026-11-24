// hakomado: YouTube 以外のサイト (URL の枠) の中で、動画プレイヤーを探して親 (マルチビュー画面) から操作できるようにする。
// - サイト専用の処理は持たない。ページの中の <video> から「それらしい 1 つ」を選び、HTMLMediaElement の API だけで操作する
// - 使う人が URL の枠に入れて許可したサイトにだけ、background.js が登録する (chrome.scripting.registerContentScripts)。
//   そのサイトを普通に開いたとき・ほかの拡張機能やサイトの枠に入ったときは何もしない (一番外側が Hakomado の画面のときだけ動く)
// - サイトの中の、さらに内側の枠 (同じサイト) にプレイヤーがあることもあるので、全部の枠で動き、動画のある枠が親に知らせる
(() => {
  'use strict';

  const EXT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  const anc = location.ancestorOrigins;
  if (window.top === window || !anc || anc.length === 0 || anc[anc.length - 1] !== EXT_ORIGIN) return;

  const TICK_MS = 1000;
  const want = { muted: null, rate: null }; // 親から指示された状態 (プレイヤーが入れ替わったら付け直す)
  let current = null;

  /** 開いている shadow root の中も含めて <video> を集める (閉じた shadow root の中は見えない) */
  function collect(root, out, depth = 0) {
    for (const v of root.querySelectorAll('video')) out.push(v);
    if (depth > 3) return out;
    // 軽い DOM のときだけ shadow root を探す (毎秒、大きなページ全部をたどらないように)
    if (out.length === 0) {
      const all = root.querySelectorAll('*');
      if (all.length < 5000) for (const el of all) if (el.shadowRoot) collect(el.shadowRoot, out, depth + 1);
    }
    return out;
  }

  /** いちばんそれらしい動画: 読み込みが始まっていて、画面に見えている面積が大きいもの */
  function pick() {
    let best = null;
    let bestScore = 0;
    for (const v of collect(document, [])) {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      const score = area * (v.readyState > 0 ? 4 : 1) * (v.paused ? 1 : 2);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
    return best;
  }

  function apply(v) {
    if (want.muted != null) v.muted = want.muted;
    if (want.rate != null && Number.isFinite(v.duration)) v.playbackRate = want.rate;
  }

  function tick() {
    const v = pick();
    if (v !== current) {
      current = v;
      if (v) apply(v);
    }
    if (!v) return;
    const d = v.duration;
    window.top.postMessage(
      {
        hakomadoWeb: 'state',
        t: v.currentTime,
        d: Number.isFinite(d) ? d : -1, // -1 = ライブなど、長さが決まっていない
        paused: v.paused,
        muted: v.muted,
        rate: v.playbackRate,
        w: v.videoWidth,
        h: v.videoHeight,
      },
      EXT_ORIGIN,
    );
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGIN || e.source !== window.top) return;
    const m = e.data;
    if (!m || typeof m.hakomadoWeb !== 'string') return;
    const v = current || pick();
    switch (m.hakomadoWeb) {
      case 'audio':
        want.muted = !!m.muted;
        if (v) v.muted = want.muted;
        break;
      case 'playback':
        if (!v) break;
        if (m.play) v.play().catch(() => {});
        else v.pause();
        break;
      case 'seek': {
        const t = Number(m.t);
        if (v && Number.isFinite(t) && t >= 0) v.currentTime = t;
        break;
      }
      case 'rate': {
        const r = Number(m.r);
        if (Number.isFinite(r) && r >= 0.25 && r <= 4) {
          want.rate = r;
          if (v) apply(v);
        }
        break;
      }
    }
    if (v) tick();
  });

  const timer = setInterval(tick, TICK_MS);
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) clearInterval(timer);
  });
})();
