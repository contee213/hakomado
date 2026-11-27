// hakomado: YouTube 以外のサイト (URL の枠) の中で、動画プレイヤーを探して親 (マルチビュー画面) から操作できるようにする。
// - サイト専用の処理は持たない。ページの中の <video> から「それらしい 1 つ」を選び、HTMLMediaElement の API だけで操作する
// - 使う人が URL の枠に入れて許可したサイトにだけ、background.js が登録する (chrome.scripting.registerContentScripts)。
//   そのサイトを普通に開いたとき・ほかの拡張機能やサイトの枠に入ったときは何もしない (一番外側が Hakomado の画面のときだけ動く)
// - サイトの中の、さらに内側の枠 (同じサイト) にプレイヤーがあることもあるので、全部の枠で動き、動画のある枠が親に知らせる
// - 動画だけを枠いっぱいに見せる: ページ全体を拡大して、選んだ動画の部分を枠にぴったり映す (WebSite.fitZoom)。
//   内側の枠に動画があるときは、その枠が親の枠に知らせ、親はその枠 (iframe) を広げる。動画の無いページ (ログインなど) はそのまま見せる
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
      // 端を切って埋める背景の飾り (object-fit: cover。作品のページの上の予告など) は、ほかに動画があればそちらを選ぶ
      const score = area * (v.readyState > 0 ? 4 : 1) * (v.paused ? 1 : 2) * (getComputedStyle(v).objectFit === 'cover' ? 1 / 16 : 1);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
    return best;
  }

  // ---- 動画だけを枠いっぱいに見せる
  // ページの作り (要素の大きさ・並び) は変えず、ページ全体を拡大・移動して、動画の部分を枠にぴったり映す
  // (html に transform をかけ、動画の外側は clip-path で切る)。動画に重なっている操作ボタン・字幕・コメントは
  // 元のページと同じ位置関係のまま残る。サイトのプレイヤーの作りは見ない (どこに操作ボタンを置くかはサイトごとに違うため)
  // 動画が内側の枠 (同じサイトの埋め込みのプレイヤー) にあるときは、その枠 (iframe) を画面いっぱいに広げる。
  // 内側の枠は中身全体がプレイヤーなので、広げれば中のプレイヤーが枠の大きさに並べ直す (拡大で合わせると、狭い枠向けの
  // 縦長の並びのまま大きくなってしまう)
  const ZOOM = 'data-hakomado-zoom';
  const FILL = 'data-hakomado-fill'; // 画面いっぱいに広げる内側の枠
  const FILL_ANC = 'data-hakomado-fill-anc'; // その外側の要素 (広げた枠を閉じ込める変形を外し、兄弟を隠す)
  const CHILD_TTL = TICK_MS * 3; // 内側の枠の知らせがこれより古ければ、もう動画は無い
  let zoom = null; // 今の拡大 { s, tx, ty, x, y, w, h } (x〜h は拡大する前の、合わせている部分の位置と大きさ)
  let child = null; // { el: 動画のある内側の枠 (iframe), at: 知らせを受けた時刻 }
  let styleEl = null;
  let fillEl = null;

  /** 拡大する前の位置と大きさ (今の拡大を戻して計算する) */
  function rawRect(el) {
    const r = el.getBoundingClientRect();
    // 拡大する前はページの左上からの位置 (スクロールの分を足す。拡大するときにスクロールを 0 に戻すため)
    if (!zoom) return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    return { x: (r.left - zoom.tx) / zoom.s, y: (r.top - zoom.ty) / zoom.s, width: r.width / zoom.s, height: r.height / zoom.s };
  }

  function setZoom(r) {
    const root = document.documentElement;
    if (!r) {
      if (!zoom) return;
      zoom = null;
      root.removeAttribute(ZOOM);
      styleEl?.remove();
      styleEl = null;
      return;
    }
    const z = WebSite.fitZoom(r, innerWidth, innerHeight);
    // 変わっていなければ書き直さない (位置は 0.5px、倍率は 0.2% まで同じとみなす)
    if (zoom && Math.abs(zoom.s - z.s) < 0.002 && ['tx', 'ty', 'x', 'y', 'w', 'h'].every((k) => Math.abs(zoom[k] - z[k]) < 0.5)) return;
    if (!zoom) scrollTo(0, 0); // 拡大は html の左上を基準にするので、ページの位置を戻しておく (位置はスクロールの分を含めて計算し直す)
    zoom = z;
    if (!styleEl?.isConnected) {
      styleEl = document.createElement('style');
      (document.head || root).appendChild(styleEl);
    }
    const px = (n) => `${Math.round(n * 100) / 100}px`;
    const [x1, y1, x2, y2] = [z.x, z.y, z.x + z.w, z.y + z.h].map(px);
    styleEl.textContent = `
html[${ZOOM}] { transform-origin: 0 0 !important; transform: translate(${px(z.tx)}, ${px(z.ty)}) scale(${z.s}) !important;
  clip-path: polygon(${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}) !important; }
html[${ZOOM}] { background: #000 !important; }
html[${ZOOM}], html[${ZOOM}] body { scrollbar-width: none !important; }
`;
    root.setAttribute(ZOOM, '');
  }

  /** 内側の枠 el を画面いっぱいに広げる (null で戻す) */
  function setFill(el) {
    if (el === fillEl) return;
    for (const e of document.querySelectorAll(`[${FILL}], [${FILL_ANC}]`)) {
      e.removeAttribute(FILL);
      e.removeAttribute(FILL_ANC);
    }
    fillEl = el;
    if (!el) return;
    if (!document.getElementById('hakomado-fill-style')) {
      const s = document.createElement('style');
      s.id = 'hakomado-fill-style';
      s.textContent = `
html:has([${FILL}]), html:has([${FILL}]) body { overflow: hidden !important; background: #000 !important; }
[${FILL_ANC}] { transform: none !important; filter: none !important; perspective: none !important; contain: none !important; will-change: auto !important; backdrop-filter: none !important; }
[${FILL_ANC}] > :not([${FILL_ANC}]):not([${FILL}]) { visibility: hidden !important; }
[${FILL}] { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; border: 0 !important; z-index: 2147483647 !important; transform: none !important; }
`;
      (document.head || document.documentElement).appendChild(s);
    }
    el.setAttribute(FILL, '');
    for (let a = el.parentElement; a; a = a.parentElement) a.setAttribute(FILL_ANC, '');
  }

  /** 画面に固定された要素 (position: fixed) の中にあるか。そうしたプレイヤーは自分で画面いっぱいに広がる */
  function inFixed(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (getComputedStyle(e).position === 'fixed') return true;
    }
    return false;
  }

  function updateZoom(v) {
    // 画面に固定されたプレイヤー (Prime Video の再生画面など) は拡大しない。html に変形をかけると、固定された要素が
    // 画面でなくページ全体の大きさに引き伸ばされ (高さ 4000px 超)、映像が縦長の真ん中に小さく置かれ、サイトの操作ボタンも枠の外に出るため
    if (v && v.isConnected && inFixed(v)) {
      setZoom(null);
      setFill(null);
      return;
    }
    // 大きめの動画 (おすすめの小さな試聴などは除く) で、映像があり (読み込まれていないものは除く)、端を切って埋める背景の飾り
    // (object-fit: cover。作品のページの上の予告など。プレイヤーは映像を切らずに収める) でないものがあれば、その部分を拡大して映す。
    // 背景の飾りに合わせると、その帯だけを映して、下の再生のボタンを切り落としてしまう
    if (v && v.isConnected && v.videoWidth > 0 && getComputedStyle(v).objectFit !== 'cover') {
      // 拡大はページの左上を基準にするので、拡大している間にサイトがスクロールしたら戻してから測る
      if (zoom && (scrollX || scrollY)) scrollTo(0, 0);
      // 要素でなく、映像が映っている部分に合わせる (要素が縦に長いと、余白ごと収めて映像が小さくなる)
      const r = WebSite.pictureRect(rawRect(v), v.videoWidth, v.videoHeight, getComputedStyle(v).objectFit);
      if (WebSite.bigEnough(r, innerWidth, innerHeight)) {
        setFill(null);
        setZoom(r);
        return;
      }
    }
    setZoom(null);
    // 無ければ、動画のある内側の枠を広げる
    setFill(child && Date.now() - child.at < CHILD_TTL && child.el.isConnected ? child.el : null);
  }

  /** 広げるものがあれば、親の枠 (Hakomado の画面でなく、サイトの外側の枠) に、この枠を広げてもらう */
  function tellParent() {
    if ((zoom || fillEl) && window.parent !== window.top) window.parent.postMessage({ hakomadoWeb: 'child' }, '*');
  }

  /** 内側の枠からの知らせ。同じサイト (ドメイン) の枠だけを広げる (広告の枠などに広げさせない) */
  function onChild(e) {
    let same = false;
    try {
      same = WebSite.siteDomain(new URL(e.origin).hostname) === WebSite.siteDomain(location.hostname);
    } catch {
      /* 読めないオリジン */
    }
    if (!same) return;
    const el = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === e.source);
    if (el) child = { el, at: Date.now() };
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
    updateZoom(v);
    tellParent();
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
    if (e.data?.hakomadoWeb === 'child' && e.source && e.source !== window) {
      onChild(e);
      return;
    }
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

  // パソコンのファイルを持って枠の上に入ってきたら、マルチビュー画面に知らせる (画面が枠の iframe を無視して、ドロップを受け取れるように)
  document.addEventListener(
    'dragenter',
    (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) window.top.postMessage({ hakomadoWeb: 'fileDrag' }, EXT_ORIGIN);
    },
    true,
  );

  const timer = setInterval(tick, TICK_MS);
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) clearInterval(timer);
  });
})();
