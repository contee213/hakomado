// hakomado: 同期の調整の「〰 波形」(HAKO-39)。グループの枠ごとの配信全編の音の大きさの波を、画面の下の帯に並べ、
// 人が「似ているところ」を探して大まかに合わせられるようにする (細かいところはそのあと ✨ 自動補正で)。
// - 帯は枠ごとに 1 行: 左にサムネイルと名前、右に波。横の軸は実際の時刻 (今の補正を入れた位置)
// - 行を横にドラッグすると、その枠の補正が変わる (基準の枠は動かない)。押すと、グループがそこへ動く。
//   ホイールで拡大・縮小、Shift + ホイールで左右に動かす
// - 帯を出している間は、波形がまだ無いところの音の大きさを自動で測る (閉じたらやめる。ボタンは置かない): 枠とは別に、画面の外に下見用のプレイヤー (同じ視聴ページ + hakomado_scan=1) を
//   開き、音を出さずに 16 倍速・一番低い画質で流して、音の大きさを記録する (content/mix.js。✨ と同じ仕組み)。枠はそのまま見られる
// - 下見は、全部の枠の配信が始まっている時刻の頭から、全部のプレイヤーが同じ時刻を一緒に進む (進みすぎたものは止めて待つ)。
//   一緒の区間が終わったら、残り (先に始めた人の冒頭など) をそれぞれ取る。取ってある区間は飛ばす
// - 波形は Waves (waves.js) が動画ごとに持ち、IndexedDB に残す。grid.js の Sync・views・state・mk・tr などを使うのは
//   操作されてから (読み込みの時点では使わない) なので、grid.js より前に読み込んでよい
/* exported WaveStrip */
'use strict';

const WaveStrip = (() => {
  const SCAN_RATE = 16;
  const LEAD_MS = 30000; // 下見で、一番遅いプレイヤーよりこれ以上先へ行ったら止めて待つ (実際の時刻)
  const MAX_PLAYERS = 8; // 同時に開く下見用のプレイヤーの数 (PC が重くなりすぎないように)
  const LOAD_MS = 20000; // 開いてから知らせが来なければ開き直す
  const LAG_SEC = 40; // 16 倍速で、音の記録が届くまでに進む再生位置の幅 (1 秒ごとに送られるので 16 秒 + 余裕)
  const ROW_H = 44;
  const HEAD_H = 34;
  const RULER_H = 22;

  let g = null; // 出しているグループ
  let info = null; // Sync.waveGroup(g)
  let view = null; // 見ている範囲 {from, to} (実際の時刻のミリ秒)
  let rowsKey = '';
  const rows = new Map(); // i -> {el, canvas}
  let drag = null; // {i, x0, off0, off, moved}
  let timer = 0;
  let drawQueued = false;
  let autoFor = ''; // 自動で測り始めた枠の組 (動画 ID を並べたもの)。同じ組では一度だけ
  let rulerMode = 'elapsed'; // 目盛り: 'elapsed' (基準の枠の配信の経過時間) / 'clock' (実際の時刻)
  let hoverX = null; // 目盛りに乗せている位置 (ドット)
  const selected = new Set(); // 選んだ行 (枠の番号)。← → で補正を動かす
  const MIN_H = 90;

  const root = () => document.getElementById('waveStrip');
  const offOf = (i) => (drag?.i === i ? drag.off : Sync.offOf(i));
  const realStart = (t) => t.start - offOf(t.i) * 1000;
  const realEnd = (t) => t.start + (t.dur - offOf(t.i)) * 1000;

  // ---------------------------------------------------------------- 下見
  let scan = null; // {g, players: Map(vid -> p), box, timer}
  const RC = () => Math.max(...scan.tiles.map(realStart)); // 全員が始まっている時刻

  function frameUrl(vid, pos) {
    const p = new URLSearchParams({ v: vid, app: 'desktop', hakomado: '1', hakomado_muted: '1', hakomado_scan: '1', t: `${Math.max(0, Math.floor(pos))}s` });
    return `${YT}/watch?${p}`;
  }
  const send = (p, msg) => p.frame?.contentWindow?.postMessage({ hakomado: msg.hakomado, ...msg }, YT);

  /** プレイヤー p の、次に取るところ (自分の再生位置の秒)。無ければ null。区間は [全員が始まった位置, 終わり] → [0, 全員が始まった位置] */
  function nextGap(p, from) {
    const vals = Waves.get(p.vid);
    const t = scan.tiles.find((x) => x.vid === p.vid);
    if (!t) return null;
    const rc = Math.max(0, (RC() - t.start) / 1000 + Sync.offOf(t.i));
    const segs = [
      [rc, t.dur],
      [0, Math.min(rc, t.dur)],
    ];
    for (const [a, b] of segs) {
      if (b - a < 1) continue;
      const lo = from != null && from >= a && from < b ? from : a;
      const seg = a === rc ? 'common' : 'head';
      const gap = Waves.firstGap(vals, lo, b);
      if (gap != null && b - gap >= 1) return { pos: gap, seg, end: b };
      // 先に無ければ、通り過ぎたところの抜け (音が届かなかった所など) を取り直す。
      // 今の位置の直前 LAG_SEC は、まだ記録が送られてくる途中なので見ない
      const behind = Math.max(a, lo - LAG_SEC);
      const back = behind > a ? Waves.firstGap(vals, a, behind) : null;
      // 何度戻っても埋まらない抜けは、あきらめる (同じ所を行き来し続けないように)
      if (back != null && behind - back >= 1 && !p.giveUp?.has(Math.round(back))) return { pos: back, seg, end: b };
    }
    return null;
  }

  function openPlayer(p) {
    const n = nextGap(p, null);
    if (!n) {
      p.done = true;
      return;
    }
    p.target = n;
    p.frame?.remove();
    p.frame = mk('iframe', { src: frameUrl(p.vid, n.pos), allow: 'autoplay', tabIndex: -1, title: '' });
    p.frame.setAttribute('aria-hidden', 'true');
    scan.box.append(p.frame);
    p.openedAt = performance.now();
    p.ready = false;
    p.t = null;
  }

  /** 音の大きさを測り始める (帯を開いたとき・枠の組が変わったときに、足りなければ自動で) */
  function startScan() {
    stopScan();
    if (!info?.tiles.length) return;
    const box = mk('div', { class: 'wave-scan-box' });
    box.setAttribute('aria-hidden', 'true');
    document.body.append(box);
    scan = { g, tiles: info.tiles.slice(), players: new Map(), box, timer: 0, tries: new Map() };
    Promise.all(scan.tiles.map((t) => Waves.ensure(t.vid))).then(() => {
      if (!scan) return;
      for (const t of scan.tiles) {
        if (scan.players.has(t.vid) || scan.players.size >= MAX_PLAYERS) continue;
        const p = { vid: t.vid, frame: null, done: false, paused: false };
        scan.players.set(t.vid, p);
        openPlayer(p);
      }
      if ([...scan.players.values()].every((p) => p.done)) {
        stopScan(); // どの枠も、もう測ってある
        return;
      }
      scan.timer = setInterval(stepScan, 1000);
      render();
    });
    render();
  }

  function stopScan() {
    if (!scan) return;
    clearInterval(scan.timer);
    for (const p of scan.players.values()) {
      send(p, { hakomado: 'measure', on: false });
      p.frame?.remove();
    }
    scan.box.remove();
    scan = null;
    Waves.save();
    render();
  }

  /** 下見用のプレイヤーからの知らせ */
  function onMessage(e) {
    if (!scan || e.origin !== YT) return;
    const p = [...scan.players.values()].find((x) => x.frame?.contentWindow === e.source);
    if (!p) return;
    const d = e.data || {};
    if (d.hakomado === 'envChunk') {
      Waves.feed(p.vid, d).catch(() => {});
    } else if (d.hakomado === 'syncState') {
      const t = Number(d.t);
      if (!Number.isFinite(t)) return;
      p.t = t;
      p.ad = !!d.ad;
      if (!p.ready) {
        // 読み込めた: 16 倍速・消音で記録を始める
        p.ready = true;
        send(p, { hakomado: 'speed', r: SCAN_RATE });
        send(p, { hakomado: 'measure', on: true, muted: true });
        send(p, { hakomado: 'playback', play: true });
      }
    } else if (d.hakomado === 'ended' || d.hakomado === 'moved') {
      p.atEnd = true;
    }
  }

  function stepScan() {
    if (!scan) return;
    const now = Sync.waveGroup(scan.g);
    if (!now) {
      stopScan();
      return;
    }
    // 枠を入れ替えた・グループから外した動画は、下見もやめる
    const vids = new Set(now.tiles.map((t) => t.vid));
    scan.tiles = now.tiles;
    for (const [vid, p] of scan.players) {
      if (vids.has(vid)) continue;
      p.frame?.remove();
      scan.players.delete(vid);
    }
    // 空きがあれば、まだ開いていない枠を開く (枠が多いとき・あとから入れた枠)
    for (const t of scan.tiles) {
      if (scan.players.size >= MAX_PLAYERS + [...scan.players.values()].filter((p) => p.done).length) break;
      if (scan.players.has(t.vid)) continue;
      const p = { vid: t.vid, frame: null, done: false, paused: false };
      scan.players.set(t.vid, p);
      openPlayer(p);
    }
    const live = [...scan.players.values()].filter((p) => !p.done);
    for (const p of live) {
      if (!p.ready) {
        // 開けない (マルチビュー画面を開いた直後の準備が間に合わなかったなど): 開き直す。3 回だめならあきらめる
        if (performance.now() - p.openedAt > LOAD_MS) {
          const n = (scan.tries.get(p.vid) || 0) + 1;
          scan.tries.set(p.vid, n);
          if (n >= 3) {
            p.done = true;
            p.frame?.remove();
            p.failed = true;
          } else openPlayer(p);
        }
        continue;
      }
      if (p.t == null || p.ad) continue;
      // 今の区間の終わりに来た・取ってあるところに入った → 次に取るところへ
      const n = nextGap(p, p.t);
      if (!n) {
        p.done = true;
        send(p, { hakomado: 'measure', on: false });
        p.frame?.remove();
        continue;
      }
      // 直前に同じ所へ動かしたばかりなら待つ (再生位置の知らせが、まだ前の位置のことがある)
      if (p.seekPos === n.pos && performance.now() - p.seekAt < 4000) continue;
      if (n.pos < p.t - 3) {
        // 後ろへ戻って取り直す。同じ所へ 3 回戻っても埋まらなければ、その抜けはあきらめる
        const k = Math.round(n.pos);
        p.backs ??= new Map();
        p.backs.set(k, (p.backs.get(k) || 0) + 1);
        if (p.backs.get(k) > 3) (p.giveUp ??= new Set()).add(k);
      }
      if (p.atEnd || n.pos - p.t > 3 || n.pos < p.t - 3 || n.seg !== p.target.seg) {
        p.atEnd = false;
        p.target = n;
        send(p, { hakomado: 'sync', op: 'seek', t: n.pos });
        p.seekPos = n.pos;
        p.seekAt = performance.now();
        send(p, { hakomado: 'playback', play: true });
        p.paused = false;
      }
    }
    // 一緒の区間を取っているプレイヤーは、同じ時刻を一緒に進む (進みすぎたものは止めて待つ)
    const common = live.filter((p) => !p.done && p.ready && p.t != null && p.target?.seg === 'common');
    const realOfP = (p) => {
      const t = scan.tiles.find((x) => x.vid === p.vid);
      return t ? t.start + (p.t - Sync.offOf(t.i)) * 1000 : null;
    };
    if (common.length >= 2) {
      const R = new Map(common.map((p) => [p, realOfP(p)]));
      const min = Math.min(...R.values());
      for (const p of common) {
        const lead = R.get(p) - min;
        if (!p.paused && lead > LEAD_MS) {
          p.paused = true;
          send(p, { hakomado: 'playback', play: false });
        } else if (p.paused && lead < LEAD_MS / 2) {
          p.paused = false;
          send(p, { hakomado: 'playback', play: true });
        }
      }
    } else {
      for (const p of common.filter((x) => x.paused)) {
        p.paused = false;
        send(p, { hakomado: 'playback', play: true });
      }
    }
    if (scan.tiles.every((t) => scan.players.get(t.vid)?.done)) {
      const failed = [...scan.players.values()].some((p) => p.failed);
      stopScan();
      notify(tr(failed ? 'waveScanSomeFailed' : 'waveScanDone'));
      return;
    }
    render();
  }

  /** 波形のある割合 (グループ全部の配信の長さに対して。0〜1) */
  function progress() {
    if (!info?.tiles.length) return 0;
    let have = 0;
    let all = 0;
    for (const t of info.tiles) {
      have += Waves.coverage(Waves.get(t.vid), 0, t.dur) * t.dur;
      all += t.dur;
    }
    return all ? have / all : 0;
  }

  // ---------------------------------------------------------------- 帯
  function fullRange() {
    if (!info?.tiles.length) return null;
    const a = Math.min(...info.tiles.map(realStart));
    const b = Math.max(...info.tiles.map(realEnd));
    const pad = (b - a) * 0.01;
    return { from: a - pad, to: b + pad };
  }

  /** 波形のある範囲 (全部の枠をまとめて。少し余白を付ける)。まだどこにも無ければ、配信の全部が入る範囲 */
  function fitRange() {
    let a = Infinity;
    let b = -Infinity;
    for (const t of info?.tiles || []) {
      const v = Waves.get(t.vid);
      if (!v) continue;
      let first = -1;
      let last = -1;
      for (let k = 0; k < v.length; k++) {
        if (!v[k]) continue;
        if (first < 0) first = k;
        last = k;
      }
      if (first < 0) continue;
      const off = offOf(t.i);
      a = Math.min(a, t.start + (first * Waves.STEP - off) * 1000);
      b = Math.max(b, t.start + ((last + 1) * Waves.STEP - off) * 1000);
    }
    if (!(b > a)) return fullRange();
    const pad = Math.max(5000, (b - a) * 0.02);
    return { from: a - pad, to: b + pad };
  }

  /** 同期の調整パネルの「〰 波形」の点灯を、今出しているグループに合わせる */
  function markButtons() {
    for (const sec of document.querySelectorAll('.dock-group')) {
      const on = Number(sec.dataset.g) === g;
      const btn = sec.querySelector('.dg-wave');
      if (!btn) continue;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  function toggle(group) {
    if (g === group) close();
    else open(group);
  }

  function open(group) {
    if (g !== group) {
      stopScan(); // 前に出していたグループの測定はやめる (新しいグループで、足りなければ測り直す)
      autoFor = '';
    }
    g = group;
    rulerMode = UiPrefs.get('waveRuler') === 'clock' ? 'clock' : 'elapsed';
    selected.clear();
    info = Sync.waveGroup(g);
    view = null;
    rowsKey = '';
    document.body.classList.add('wave-open');
    root().hidden = false;
    update();
    // 最初は波形のある範囲に合わせる (読み終えてから)。足りないところがあれば、下見を自動で始める (TK さん、2026-11-27)
    if (info)
      Promise.all(info.tiles.map((t) => Waves.ensure(t.vid))).then(() => {
        if (g !== group) return;
        view = fitRange();
        queueDraw();
        autoFor = info.tiles.map((t) => t.vid).join();
        if (!scan && progress() < 0.99) startScan();
      });
    clearInterval(timer);
    timer = setInterval(update, 500);
    Sync.dockChanged();
    markButtons();
  }

  function close() {
    stopScan();
    clearInterval(timer);
    timer = 0;
    g = null;
    info = null;
    document.body.classList.remove('wave-open');
    document.documentElement.style.removeProperty('--wave-h');
    selected.clear();
    autoFor = '';
    dispatchEvent(new Event('resize'));
    const el = root();
    el.hidden = true;
    el.replaceChildren();
    rows.clear();
    rowsKey = '';
    Sync.dockChanged();
    markButtons();
  }

  /** グループの様子を読み直して、行を作り直す (枠が変わったとき) か、描き直す */
  function update() {
    if (g == null) return;
    info = Sync.waveGroup(g);
    if (!info) {
      close();
      return;
    }
    if (!view) view = fullRange();
    const key = info.tiles.map((t) => `${t.i}:${t.vid}`).join() + `|${info.ref}`;
    if (key !== rowsKey) {
      build(key);
      const vids = info.tiles.map((t) => t.vid).join();
      if (vids !== autoFor && !scan) {
        autoFor = vids;
        Promise.all(info.tiles.map((t) => Waves.ensure(t.vid))).then(() => {
          if (g != null && !scan && progress() < 0.99) startScan();
        });
      }
    }
    render();
  }

  function build(key) {
    rowsKey = key;
    rows.clear();
    const el = root();
    const head = mk(
      'div',
      { class: 'wv-head' },
      mk('span', { class: 'wv-title', style: `--g: ${Sync.groupColor(g)}` }, tr('waveTitle', g)),
      mk('button', { type: 'button', class: 'wv-play', onclick: () => Sync.togglePause(g) }),
      mk('span', { class: 'wv-progress' }),
      mk('span', { class: 'wv-hint' }, tr('waveHint')),
      mk('button', { type: 'button', class: 'wv-fit', textContent: tr('waveFit'), title: tr('waveFitTitle'), onclick: () => ((view = fitRange()), queueDraw()) }),
      mk('button', { type: 'button', class: 'wv-close', textContent: '✕', title: tr('waveClose'), 'aria-label': tr('waveClose'), onclick: close }),
    );
    const ruler = mk('canvas', { class: 'wv-ruler-canvas', title: tr('waveRulerTitle') });
    bindRuler(ruler);
    // 目盛りの切り替え: 「経過時間」「時刻」の 2 つから選ぶ (選んでいる方を ON の色と aria-pressed で示す。デザインガイド 4 章)
    const modeBtn = (mode, key, titleKey) =>
      mk('button', {
        type: 'button',
        class: 'wv-ruler-mode',
        dataset: { mode },
        textContent: tr(key),
        title: tr(titleKey),
        onclick: () => {
          rulerMode = mode;
          UiPrefs.set('waveRuler', rulerMode);
          render();
        },
      });
    const rulerRow = mk(
      'div',
      { class: 'wv-ruler' },
      mk('div', { class: 'wv-label wv-ruler-label' }, modeBtn('elapsed', 'waveRulerElapsed', 'waveRulerElapsedTitle'), modeBtn('clock', 'waveRulerClock', 'waveRulerClockTitle')),
      ruler,
    );
    const grip = mk('div', { class: 'wv-resize', title: tr('waveResizeTitle') });
    bindResize(grip);
    const list = mk('div', { class: 'wv-rows' });
    for (const t of info.tiles) {
      const isRef = t.i === info.ref;
      const canvas = mk('canvas', { class: 'wv-canvas' + (isRef ? ' is-ref' : ''), title: tr(isRef ? 'waveRefTitle' : 'waveRowTitle') });
      if (isRef) selected.delete(t.i); // 基準の枠は選べない (補正が 0 に決まっていて動かないため)
      bindCanvas(canvas, t.i);
      const row = mk(
        'div',
        { class: 'wv-row', dataset: { i: String(t.i) } },
        mk(
          'div',
          { class: 'wv-label' },
          mk('img', { class: 'wv-thumb', src: thumbUrl(t.vid), alt: '', loading: 'lazy' }),
          isRef ? mk('span', { class: 'wv-lock', title: tr('syncRefLockTitle') }, '🔒') : null,
          mk('span', { class: 'wv-name' }, mk('span', { class: 'wv-num' }, String(t.i + 1)), tileName(t.i) || t.vid, isRef ? mk('span', { class: 'wv-ref' }, tr('waveRef')) : null),
        ),
        canvas,
      );
      // 行の左 (サムネイル・名前) を押しても選べる (行全体で選べるように)
      row.querySelector('.wv-label').addEventListener('click', (e) => toggleSelect(t.i, e));
      rows.set(t.i, { el: row, canvas });
      list.append(row);
    }
    el.replaceChildren(head, rulerRow, list);
    paintSelection();
    for (const i of [...selected]) if (!info.tiles.some((t) => t.i === i)) selected.delete(i);
    el.prepend(grip);
    setHeight(UiPrefs.get('waveH') || Math.min(HEAD_H + RULER_H + info.tiles.length * ROW_H + 8, Math.round(innerHeight * 0.45)));
  }

  // 枠ごとの高さの目盛り: 記録のある値の 10% 〜 99.5% の幅を、帯の高さいっぱいに広げる (配信ごとに音の大きさが違っても形が見えるように)
  const levelCache = new Map(); // vid -> {n, lo, hi}
  function levels(vid, vals) {
    let n = 0;
    for (let k = 0; k < vals.length; k++) if (vals[k]) n++;
    const c = levelCache.get(vid);
    if (c && Math.abs(c.n - n) < Math.max(200, c.n * 0.05)) return c;
    const hist = new Uint32Array(256);
    for (let k = 0; k < vals.length; k++) if (vals[k]) hist[vals[k]]++;
    const at = (p) => {
      let acc = 0;
      for (let v = 1; v < 256; v++) if ((acc += hist[v]) >= p * n) return v;
      return 255;
    };
    const lo = at(0.1);
    const hi = Math.max(lo + 10, at(0.995));
    const next = { n, lo, hi };
    levelCache.set(vid, next);
    return next;
  }

  /** 帯の高さを h ドットにする (画面の 70% まで)。枠の並び・同期の調整パネルは、その上で終わる */
  function setHeight(h) {
    const v = Math.round(Math.max(MIN_H, Math.min(innerHeight * 0.7, h)));
    document.documentElement.style.setProperty('--wave-h', `${v}px`);
    dispatchEvent(new Event('resize')); // 同期の調整パネルの小窓を置き直す
    return v;
  }
  /** 帯の上の端をつかんで、高さを変える (覚えておく) */
  function bindResize(grip) {
    let start = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      capture(grip, e);
      start = { y: e.clientY, h: root().offsetHeight };
      document.body.classList.add('wave-resizing'); // 枠の iframe にマウスを取られないように
    });
    grip.addEventListener('pointermove', (e) => {
      if (start) setHeight(start.h + (start.y - e.clientY));
    });
    const end = () => {
      if (!start) return;
      start = null;
      document.body.classList.remove('wave-resizing');
      UiPrefs.set('waveH', root().offsetHeight);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /** 選んだ行の見た目 */
  function paintSelection() {
    for (const [i, r] of rows) r.el.classList.toggle('is-selected', selected.has(i));
  }
  /** 行を選ぶ / 外す (基準の行は選べない) */
  /**
   * 行を押したときの選び方 (デザインガイド 4 章「行を押して選ぶもの」): 押すとその行だけを選ぶ (その行だけを選んでいれば外す)。
   * Shift か Ctrl を押しながらなら、その行を足す / 外す (ほかはそのまま)。基準の行は選べない
   */
  function toggleSelect(i, e) {
    if (i === info?.ref) return;
    const add = !!(e && (e.shiftKey || e.ctrlKey || e.metaKey));
    if (add) {
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
    } else if (selected.size === 1 && selected.has(i)) selected.clear();
    else {
      selected.clear();
      selected.add(i);
    }
    paintSelection();
    root().focus({ preventScroll: true });
  }
  /** ← →: 選んだ行の補正を動かす (→ で波が右へ。ドラッグと同じ向き)。Shift で 0.01 秒・Ctrl で 1 秒、ふだんは 0.1 秒。Esc で選択を外す */
  function onKey(e) {
    if (e.target.closest('input, select, textarea, button')) return;
    if (e.key === 'Escape' && selected.size) {
      selected.clear();
      paintSelection();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.size) {
      const step = e.ctrlKey || e.metaKey ? 1 : e.shiftKey ? 0.01 : 0.1;
      const d = e.key === 'ArrowRight' ? -step : step; // 右へずらす = 補正を減らす
      for (const i of selected) if (i !== info?.ref) Sync.setOffset(i, Math.round((Sync.offOf(i) + d) * 100) / 100);
      queueDraw();
    } else return;
    e.preventDefault();
    e.stopPropagation(); // 上の操作 (矢印キーで音の枠を移すなど) にしない
  }

  function render() {
    const el = root();
    if (g == null || !el) return;
    const btn = el.querySelector('.wv-play');
    if (btn) {
      // 同期の調整パネルのグループの ⏸ と同じ (デザインガイド 4 章: 止めると「再開」に変わる)
      const playing = !!info?.playing;
      const label = tr(playing ? 'syncGroupPauseLabel' : 'syncGroupPlayLabel');
      if (btn.textContent !== label) btn.textContent = label;
      btn.title = tr(playing ? 'syncGroupPause' : 'syncGroupPlay');
    }
    for (const mb of el.querySelectorAll('.wv-ruler-mode')) {
      const on = mb.dataset.mode === rulerMode;
      mb.classList.toggle('on', on);
      mb.setAttribute('aria-pressed', String(on));
    }
    const pr = el.querySelector('.wv-progress');
    if (pr) {
      const pct = Math.floor(progress() * 100);
      pr.textContent = scan ? tr('waveScanProgress', pct) : pct >= 100 ? '' : tr('waveHave', pct);
      pr.title = tr('waveScanTitle');
    }
    queueDraw();
  }

  function queueDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }

  /** canvas の大きさを、表示の大きさ × 画面の倍率に合わせて、描く準備をする */
  function prep(c) {
    const dpr = devicePixelRatio || 1;
    const W = Math.max(1, Math.round(c.clientWidth * dpr));
    const H = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H, dpr };
  }

  let hatch = null; // まだ取っていない区間の斜線
  function hatchOf(ctx, dpr) {
    if (hatch?.dpr === dpr) return hatch.p;
    const s = Math.round(8 * dpr);
    const c = new OffscreenCanvas(s, s);
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.lineWidth = dpr;
    x.beginPath();
    x.moveTo(0, s);
    x.lineTo(s, 0);
    x.stroke();
    hatch = { dpr, p: ctx.createPattern(c, 'repeat') };
    return hatch.p;
  }

  /** 経過時間の目盛りの 0:00 (基準の枠の配信の始まり。実際の時刻のミリ秒)。時刻の目盛り・基準が無いときは null */
  function rulerZero() {
    if (rulerMode !== 'elapsed') return null;
    const t = info?.tiles.find((x) => x.i === info.ref);
    return t ? realStart(t) : null;
  }
  /** 目盛りの文字: 経過時間「1:23:45」(基準より前は −) か、実際の時刻「23:05」 */
  function rulerText(ms, sec) {
    const zero = rulerZero();
    if (zero == null) return clock(ms, sec);
    // 上部バー・同期の調整パネルと同じ形 (1 時間未満は「54:56」、それより上は「1:05:00」)。分ごとの目盛りでも秒まで書く
    // (「0:55」が 55 秒と読めないように)
    const d = (ms - zero) / 1000;
    const a = Math.abs(sec ? Math.round(d) : Math.round(d / 60) * 60);
    const h = Math.floor(a / 3600);
    const m = Math.floor((a % 3600) / 60);
    const s2 = String(a % 60).padStart(2, '0');
    return (d < -0.5 ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}`);
  }

  /** 時刻 (実際の時刻のミリ秒) → 「23:05」「23:05:30」 */
  const clock = (ms, sec) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });

  function draw() {
    if (!info || !view) return;
    const css = getComputedStyle(root());
    const band = css.getPropertyValue('--wv-band').trim() || 'rgba(255,255,255,0.08)';
    const nowColor = css.getPropertyValue('--wv-now').trim() || '#fff';
    const muted = css.getPropertyValue('--muted').trim() || '#9a9aa6';
    const color = Sync.groupColor(g);
    const span = view.to - view.from;
    // ---- 時刻の目盛り (押せるように見せる: 地の色・今の時刻のつまみ・乗せた位置の線と時刻)
    const rc = root().querySelector('.wv-ruler-canvas');
    if (rc) {
      const { ctx, W, H, dpr } = prep(rc);
      const pxPerMs = W / span;
      ctx.fillStyle = getComputedStyle(rc).getPropertyValue('--wv-ruler-bg').trim() || 'rgba(255,255,255,0.07)'; // 乗せている間は明るく (CSS の :hover)
      ctx.fillRect(0, 0, W, H);
      const steps = [10e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3];
      const step = steps.find((v) => v * pxPerMs >= 90 * dpr) || 3600e3;
      ctx.fillStyle = muted;
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const zero = rulerZero();
      const base = zero ?? -new Date(view.from).getTimezoneOffset() * -60e3; // 経過時間は基準の始まり、時刻はその日の 0:00 にそろえる
      for (let t = Math.ceil((view.from - base) / step) * step + base; t < view.to; t += step) {
        const x = Math.round((t - view.from) * pxPerMs);
        ctx.fillRect(x, H - 6 * dpr, Math.max(1, dpr), 6 * dpr);
        ctx.fillText(rulerText(t, step < 60e3), x + 3 * dpr, 3 * dpr);
      }
      if (hoverX != null) {
        const xh = hoverX * dpr;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(Math.round(xh), 0, Math.max(1, dpr), H);
        const label = rulerText(view.from + hoverX * dpr / pxPerMs, true);
        const tw = ctx.measureText(label).width + 8 * dpr;
        const lx = Math.min(W - tw, Math.max(0, xh + 4 * dpr));
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(lx, 2 * dpr, tw, H - 4 * dpr);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, lx + 4 * dpr, 4 * dpr);
      }
      if (info.now != null) {
        const xn = (info.now - view.from) * pxPerMs;
        if (xn >= 0 && xn <= W) {
          ctx.fillStyle = nowColor;
          ctx.fillRect(Math.round(xn) - dpr, 0, 2 * dpr, H);
          // つまみ (下向きの三角)
          const k = 6 * dpr;
          ctx.beginPath();
          ctx.moveTo(xn - k, 0);
          ctx.lineTo(xn + k, 0);
          ctx.lineTo(xn, k * 1.3);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // ---- 枠ごとの波
    for (const t of info.tiles) {
      const r = rows.get(t.i);
      if (!r) continue;
      const { ctx, W, H, dpr } = prep(r.canvas);
      const x = (R) => ((R - view.from) / span) * W;
      const a = Math.max(0, x(realStart(t)));
      const b = Math.min(W, x(realEnd(t)));
      if (b > a) {
        ctx.fillStyle = band;
        ctx.fillRect(a, 2 * dpr, b - a, H - 4 * dpr);
      }
      const vals = Waves.get(t.vid) || new Uint8Array(0);
      if (b > a) {
        const off = offOf(t.i);
        const mid = H / 2;
        const half = H / 2 - 3 * dpr;
        const { lo, hi } = vals.length ? levels(t.vid, vals) : { lo: 1, hi: 255 };
        const pat = hatchOf(ctx, dpr);
        let gapFrom = -1; // まだ取っていない区間の頭 (ドット)
        const flushGap = (px) => {
          if (gapFrom < 0) return;
          ctx.fillStyle = pat;
          ctx.fillRect(gapFrom, 2 * dpr, px - gapFrom, H - 4 * dpr);
          gapFrom = -1;
        };
        for (let px = Math.floor(a); px < Math.ceil(b); px++) {
          const R0 = view.from + (px / W) * span;
          const R1 = view.from + ((px + 1) / W) * span;
          const k0 = Math.max(0, Math.floor(((R0 - t.start) / 1000 + off) / Waves.STEP));
          const k1 = Math.floor(((R1 - t.start) / 1000 + off) / Waves.STEP);
          // 1 ドットに入る分の平均 (一番大きい値で描くと、縮めたときにどこも高くなって形が見えないため)
          let sum = 0;
          let n = 0;
          for (let k = k0; k <= k1 && k < vals.length; k++) {
            if (!vals[k]) continue;
            sum += vals[k];
            n++;
          }
          if (!n) {
            if (gapFrom < 0) gapFrom = px;
            continue;
          }
          flushGap(px);
          ctx.fillStyle = color;
          const f = Math.max(0, Math.min(1, (sum / n - lo) / (hi - lo)));
          const h = Math.max(dpr / 2, f * half); // 小さい音も細い線で見せる (取っていないところと見分ける)
          ctx.fillRect(px, mid - h, 1, h * 2);
        }
        flushGap(Math.ceil(b));
      }
      if (info.now != null) {
        const xn = x(info.now);
        if (xn >= 0 && xn <= W) {
          ctx.fillStyle = nowColor;
          ctx.fillRect(Math.round(xn), 0, Math.max(1, dpr), H);
        }
      }
    }
  }

  /** 見ている範囲を横に動かす・拡大する (ホイール。行と目盛りで共通) */
  function onWheel(e) {
    if (!view) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const span = view.to - view.from;
    const full = fullRange();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / rect.width) * span;
      view = { from: view.from + d, to: view.to + d };
    } else {
      const at = view.from + ((e.clientX - rect.left) / rect.width) * span;
      const k = Math.pow(1.2, e.deltaY / 100);
      const next = Math.max(10000, Math.min((full.to - full.from) * 1.5, span * k));
      view = { from: at - (at - view.from) * (next / span), to: at + (view.to - at) * (next / span) };
    }
    queueDraw();
  }

  const timeAt = (el, clientX) => {
    const rect = el.getBoundingClientRect();
    return view.from + ((clientX - rect.left) / rect.width) * (view.to - view.from);
  };
  const capture = (el, e) => {
    try {
      el.setPointerCapture(e.pointerId); // 帯の外まで動かしても追えるように
    } catch {
      /* つかめなくても、帯の上なら動かせる */
    }
  };

  /** 時刻の目盛り: 押す・なぞると、グループがその時刻へ動く */
  function bindRuler(c) {
    let scrub = false;
    let last = 0;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !view) return;
      capture(c, e);
      scrub = true;
      Sync.seekTo(g, timeAt(c, e.clientX));
      last = performance.now();
    });
    c.addEventListener('pointermove', (e) => {
      hoverX = e.clientX - c.getBoundingClientRect().left;
      queueDraw();
      if (!scrub || performance.now() - last < 150) return;
      last = performance.now();
      Sync.seekTo(g, timeAt(c, e.clientX));
    });
    const end = (e) => {
      if (!scrub) return;
      scrub = false;
      Sync.seekTo(g, timeAt(c, e.clientX));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => (scrub = false));
    c.addEventListener('pointerleave', () => {
      hoverX = null;
      queueDraw();
    });
    c.addEventListener('wheel', onWheel, { passive: false });
  }

  /**
   * 行: 横にドラッグすると、その枠の補正が変わる (基準の行は、見ている範囲を左右に動かす)。
   * 動かさずに押して離すと、グループがその時刻へ動く。少しのぶれで補正が変わらないように、DRAG_PX 動かしてからドラッグにする
   */
  const DRAG_PX = 6;
  function bindCanvas(canvas, i) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !view) return;
      capture(canvas, e);
      drag = { i, x0: e.clientX, off0: Sync.offOf(i), off: Sync.offOf(i), moved: false, view0: view };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.i !== i || !view) return;
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < DRAG_PX) return;
      drag.moved = true;
      const msPerPx = (drag.view0.to - drag.view0.from) / canvas.clientWidth;
      if (i === info?.ref) {
        view = { from: drag.view0.from - dx * msPerPx, to: drag.view0.to - dx * msPerPx };
      } else {
        // 右へずらす = その配信を実際の時刻の後ろへ = 補正を減らす
        drag.off = Math.round((drag.off0 - (dx * msPerPx) / 1000) * 10) / 10;
      }
      queueDraw();
    });
    const end = (e) => {
      if (!drag || drag.i !== i) return;
      const d = drag;
      drag = null;
      if (d.moved) {
        if (i !== info?.ref && d.off !== d.off0) Sync.setOffset(i, d.off);
      } else toggleSelect(i, e); // 動かさずに押したら、選ぶ / 外す (時刻へ動かすのは目盛りで)
      queueDraw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => ((drag = null), queueDraw()));
    canvas.addEventListener('wheel', onWheel, { passive: false });
  }

  window.addEventListener('message', onMessage);
  window.addEventListener('resize', queueDraw);
  // 帯の中のキー (選んだ行を ← → で動かす)。帯は tabindex で選べるようにしておく
  addEventListener('DOMContentLoaded', () => {
    const el = root();
    if (!el) return;
    el.tabIndex = -1;
    el.addEventListener('keydown', onKey);
  });
  Waves.onChange((vid) => {
    if (info?.tiles.some((t) => t.vid === vid)) queueDraw();
  });

  return {
    toggle,
    close,
    /** グループ group の帯を出しているか */
    isOpen: (group) => g === group,
  };
})();
