// hakomado: 同期の調整の帯 (画面の下。HAKO-39・HAKO-42)。同期しているグループごとの節を上から並べ (最後に「同期しない」)、
// 節ごとに、枠ごとの配信全編の音の大きさの波を目盛り (実際の時刻か、基準の枠の配信の経過時間) の上に並べる。
// - 節の見出し: ▸ / ▾ たたむ・番号の丸 (グループの色)・そろえ方・n 枠・⏸ / ⏯・↺ 0 に戻す・全体
// - 行の左: グループの選択・○ / 🔒 基準・サムネイル・番号・名前・経過時間・補正の秒数 (押すと入力欄)・✓ / ↻・⏸ 止めて待つ・↺
//   (同期の調整パネルの行と同じ操作。パネルは HAKO-41 の 4 回目で無くす)
// - 行の右 (波): 横にドラッグで補正、押して選び ← → (Shift / Ctrl で足す)。目盛りを押す・なぞるとグループの時刻を動かす。
//   ホイールで拡大・縮小、Shift + ホイールで左右。目盛り・見ている範囲は節ごと (グループごとに別の配信のため)
// - 帯を出している間は、開いている節の 🕒 グループの、波形がまだ無いところの音の大きさを自動で測る (閉じたらやめる):
//   枠とは別に、画面の外に測る用のプレイヤー (同じ視聴ページ + hakomado_scan=1) を開き、音を出さずに 16 倍速・一番低い画質で流して、
//   音の大きさを記録する (content/mix.js。✨ と同じ仕組み)。枠はそのまま見られる
// - 測るのは、グループの全部の枠の配信が始まっている時刻の頭から、そのグループのプレイヤーが同じ時刻を一緒に進む (進みすぎたものは止めて待つ)。
//   一緒の区間が終わったら、残り (先に始めた人の冒頭など) をそれぞれ取る。取ってある区間は飛ばし、通り過ぎた抜けも取り直す
// - 🎬 同時視聴の節は、この版では見出しと案内だけ (調整は同期の調整パネルで。HAKO-41 の 3 回目で帯へ)
// - 波形は Waves (waves.js) が動画ごとに持ち、IndexedDB に残す。grid.js の Sync・views・state・mk・tr などを使うのは
//   操作されてから (読み込みの時点では使わない) なので、grid.js より前に読み込んでよい
/* exported WaveStrip */
'use strict';

const WaveStrip = (() => {
  const SCAN_RATE = 16;
  const LEAD_MS = 30000; // 測るとき、一番遅いプレイヤーよりこれ以上先へ行ったら止めて待つ (実際の時刻)
  const MAX_PLAYERS = 8; // 同時に開く測る用のプレイヤーの数 (全部のグループで。PC が重くなりすぎないように)
  const LOAD_MS = 20000; // 開いてから知らせが来なければ開き直す
  const LAG_SEC = 40; // 16 倍速で、音の記録が届くまでに進む再生位置の幅 (1 秒ごとに送られるので 16 秒 + 余裕)
  const HEAD_H = 34;
  const SEC_HEAD_H = 32;
  const RULER_H = 24;
  const ROW_H = 51;
  const MIN_H = 90;
  const DRAG_PX = 6;

  let shown = false;
  let model = null; // Sync.stripModel()
  const secs = new Map(); // g -> {view, rows: Map(i -> row), ruler, hoverX}
  const folded = new Set(); // たたんだ節 (グループの番号)
  let structKey = '';
  let drag = null; // {g, i, x0, off0, off, moved, view0}
  const selected = new Set(); // 選んだ行 (枠の番号)。← → で補正を動かす
  let timer = 0;
  let drawQueued = false;
  let autoFor = ''; // 自動で測り始めた枠の組 (動画 ID を並べたもの)。同じ組では一度だけ
  let rulerMode = 'elapsed'; // 目盛りの出し方 (帯の見出しで、全部のグループまとめて): 'elapsed' (経過時刻。基準の枠の配信の始まりを 0:00) / 'clock' (配信時刻。実際の時刻)
  const orders = new Map(); // g -> 行の並び (枠の番号。見た目だけで保存しない)

  const root = () => document.getElementById('waveStrip');
  const groupOf = (g) => model?.groups.find((G) => G.g === g) || null;
  /** 波を描ける節 (同期できる 🕒 コラボ配信のグループ) */
  const drawable = (G) => !!G && G.active && !G.movie;
  /** 波を描ける枠 (YouTube のアーカイブ) */
  const waveTiles = (G) => (drawable(G) ? G.tiles.filter((t) => t.youtube && t.movable && t.start != null) : []);
  const offOf = (t) => (drag?.i === t.i ? drag.off : t.off || 0);
  const realStart = (t) => t.start - offOf(t) * 1000;
  const realEnd = (t) => t.start + (t.dur - offOf(t)) * 1000;
  const refTile = (G) => G?.tiles.find((t) => t.i === G.ref) || null;

  // ---------------------------------------------------------------- 音の大きさを測る
  let scan = null; // {players: Map(vid -> p), box, timer, tries}

  /** 測る枠: 開いている節の 🕒 グループの YouTube のアーカイブ (グループの番号付き) */
  function scanTiles() {
    if (!model) return [];
    return model.groups.filter((G) => drawable(G) && !folded.has(G.g)).flatMap((G) => waveTiles(G).map((t) => ({ ...t, g: G.g })));
  }
  /** グループ g の全員が始まっている時刻 */
  const rcOf = (g) => Math.max(...waveTiles(groupOf(g)).map(realStart));

  function frameUrl(vid, pos) {
    const p = new URLSearchParams({ v: vid, app: 'desktop', hakomado: '1', hakomado_muted: '1', hakomado_scan: '1', t: `${Math.max(0, Math.floor(pos))}s` });
    return `${YT}/watch?${p}`;
  }
  const send = (p, msg) => p.frame?.contentWindow?.postMessage({ hakomado: msg.hakomado, ...msg }, YT);

  /** プレイヤー p の、次に取るところ (自分の再生位置の秒)。無ければ null。区間は [全員が始まった位置, 終わり] → [0, 全員が始まった位置] */
  function nextGap(p, from) {
    const vals = Waves.get(p.vid);
    const t = scanTiles().find((x) => x.vid === p.vid);
    if (!t) return null;
    const rc = Math.max(0, (rcOf(t.g) - t.start) / 1000 + (t.off || 0));
    const segs = [
      [rc, t.dur],
      [0, Math.min(rc, t.dur)],
    ];
    for (const [a, b] of segs) {
      if (b - a < 1) continue;
      const lo = from != null && from >= a && from < b ? from : a;
      const seg = a === rc ? 'common' : 'head';
      const gap = Waves.firstGap(vals, lo, b);
      if (gap != null && b - gap >= 1) return { pos: gap, seg, end: b, g: t.g };
      // 先に無ければ、通り過ぎたところの抜け (音が届かなかった所など) を取り直す。
      // 今の位置の直前 LAG_SEC は、まだ記録が送られてくる途中なので見ない
      const behind = Math.max(a, lo - LAG_SEC);
      const back = behind > a ? Waves.firstGap(vals, a, behind) : null;
      // 何度戻っても埋まらない抜けは、あきらめる (同じ所を行き来し続けないように)
      if (back != null && behind - back >= 1 && !p.giveUp?.has(Math.round(back))) return { pos: back, seg, end: b, g: t.g };
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

  /** 音の大きさを測り始める (帯を開いたとき・測る枠の組が変わったときに、足りなければ自動で) */
  function startScan() {
    stopScan();
    const tiles = scanTiles();
    if (!tiles.length) return;
    const box = mk('div', { class: 'wave-scan-box' });
    box.setAttribute('aria-hidden', 'true');
    document.body.append(box);
    scan = { players: new Map(), box, timer: 0, tries: new Map() };
    Promise.all(tiles.map((t) => Waves.ensure(t.vid))).then(() => {
      if (!scan) return;
      fillPlayers();
      if ([...scan.players.values()].every((p) => p.done)) {
        stopScan(); // どの枠も、もう測ってある
        return;
      }
      scan.timer = setInterval(stepScan, 1000);
      render();
    });
    render();
  }

  /** 空きがあれば、まだ開いていない枠の測る用のプレイヤーを開く */
  function fillPlayers() {
    for (const t of scanTiles()) {
      const running = [...scan.players.values()].filter((p) => !p.done).length;
      if (running >= MAX_PLAYERS) break;
      if (scan.players.has(t.vid)) continue;
      const p = { vid: t.vid, frame: null, done: false, paused: false };
      scan.players.set(t.vid, p);
      openPlayer(p);
    }
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

  /** 測る用のプレイヤーからの知らせ */
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
    const tiles = scanTiles();
    if (!tiles.length) {
      stopScan();
      return;
    }
    // 枠を入れ替えた・グループから外した・節をたたんだ動画は、測るのもやめる
    const vids = new Set(tiles.map((t) => t.vid));
    for (const [vid, p] of scan.players) {
      if (vids.has(vid)) continue;
      p.frame?.remove();
      scan.players.delete(vid);
    }
    fillPlayers();
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
    // 一緒の区間を取っているプレイヤーは、グループごとに同じ時刻を一緒に進む (進みすぎたものは止めて待つ)
    const byVid = new Map(tiles.map((t) => [t.vid, t]));
    const common = live.filter((p) => !p.done && p.ready && p.t != null && p.target?.seg === 'common' && byVid.has(p.vid));
    const groupsOfCommon = new Set(common.map((p) => byVid.get(p.vid).g));
    for (const g of groupsOfCommon) {
      const mine = common.filter((p) => byVid.get(p.vid).g === g);
      const realOfP = (p) => {
        const t = byVid.get(p.vid);
        return t.start + (p.t - (t.off || 0)) * 1000;
      };
      if (mine.length >= 2) {
        const R = new Map(mine.map((p) => [p, realOfP(p)]));
        const min = Math.min(...R.values());
        for (const p of mine) {
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
        for (const p of mine.filter((x) => x.paused)) {
          p.paused = false;
          send(p, { hakomado: 'playback', play: true });
        }
      }
    }
    if (tiles.every((t) => scan.players.get(t.vid)?.done)) {
      const failed = [...scan.players.values()].some((p) => p.failed);
      stopScan();
      notify(tr(failed ? 'waveScanSomeFailed' : 'waveScanDone'));
      return;
    }
    render();
  }

  /** 波形のある割合 (測る枠の配信の長さに対して。0〜1) */
  function progress() {
    const tiles = scanTiles();
    let have = 0;
    let all = 0;
    for (const t of tiles) {
      have += Waves.coverage(Waves.get(t.vid), 0, t.dur) * t.dur;
      all += t.dur;
    }
    return all ? have / all : 1;
  }

  // ---------------------------------------------------------------- 範囲
  /** グループ G の配信のある範囲 (前後に 1% の余白) */
  function fullRange(G) {
    const ts = waveTiles(G);
    if (!ts.length) return null;
    const a = Math.min(...ts.map(realStart));
    const b = Math.max(...ts.map(realEnd));
    const pad = (b - a) * 0.01;
    return { from: a - pad, to: b + pad };
  }
  /** グループ G の波形のある範囲 (少し余白を付ける)。まだどこにも無ければ、配信の全部が入る範囲 */
  function fitRange(G) {
    let a = Infinity;
    let b = -Infinity;
    for (const t of waveTiles(G)) {
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
      a = Math.min(a, t.start + (first * Waves.STEP - offOf(t)) * 1000);
      b = Math.max(b, t.start + ((last + 1) * Waves.STEP - offOf(t)) * 1000);
    }
    if (!(b > a)) return fullRange(G);
    const pad = Math.max(5000, (b - a) * 0.02);
    return { from: a - pad, to: b + pad };
  }

  // ---------------------------------------------------------------- 出す・しまう
  /** 同期の調整パネルの「〰 波形」の点灯を、帯で開いている節に合わせる */
  function markButtons() {
    for (const sec of document.querySelectorAll('.dock-group')) {
      const on = isOpen(Number(sec.dataset.g));
      const btn = sec.querySelector('.dg-wave');
      if (!btn) continue;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
  const isOpen = (g) => shown && !folded.has(g);

  /** パネルの「〰 波形」: 帯でそのグループの節を開いていれば帯をしまう。そうでなければ帯を出して、その節を開く */
  function toggle(g) {
    if (isOpen(g)) close();
    else {
      folded.delete(g);
      structKey = '';
      open();
      root()
        .querySelector(`.wv-sec[data-g="${g}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  function open() {
    if (!shown) {
      shown = true;
      rulerMode = UiPrefs.get('waveRuler') === 'clock' ? 'clock' : 'elapsed';
      selected.clear();
      document.body.classList.add('wave-open');
      root().hidden = false;
      clearInterval(timer);
      timer = setInterval(update, 500);
    }
    update();
    Sync.dockChanged();
    markButtons();
  }

  function close() {
    if (!shown) return;
    stopScan();
    clearInterval(timer);
    timer = 0;
    shown = false;
    model = null;
    secs.clear();
    selected.clear();
    structKey = '';
    autoFor = '';
    document.body.classList.remove('wave-open');
    document.documentElement.style.removeProperty('--wave-h');
    dispatchEvent(new Event('resize'));
    const el = root();
    el.hidden = true;
    el.replaceChildren();
    Sync.highlight(null);
    Sync.dockChanged();
    markButtons();
  }

  /** 同期の様子を読み直して、形が変わっていれば作り直し、数字を書き換えて描き直す */
  function update() {
    if (!shown) return;
    model = Sync.stripModel();
    if (!model || (!model.groups.length && !model.rest.length)) {
      close();
      return;
    }
    const key = JSON.stringify([
      [...folded].sort(),
      model.groups.map((G) => [G.g, G.mode, G.active, G.ref, G.tiles.map((t) => [t.i, t.vid, t.group, t.movable, t.youtube, t.live])]),
      model.rest.map((t) => [t.i, t.vid, t.group]),
    ]);
    // 補正の数字を入れている途中は作り直さない (入れている文字が消えないように)
    const typing = root().querySelector('.wv-off-input');
    if (key !== structKey && !typing) build(key);
    // 測る枠の組が変わったら、足りなければ自動で測り始める (同じ組では一度だけ。開けない枠があっても繰り返さない)
    const tiles = scanTiles();
    const vids = tiles.map((t) => t.vid).join();
    if (vids !== autoFor && !scan) {
      autoFor = vids;
      if (tiles.length)
        Promise.all(tiles.map((t) => Waves.ensure(t.vid))).then(() => {
          if (shown && !scan && progress() < 0.99) startScan();
          for (const G of model?.groups || []) {
            const s = secs.get(G.g);
            if (s && !s.fitted && drawable(G)) {
              s.view = fitRange(G);
              s.fitted = true;
            }
          }
          queueDraw();
        });
    }
    render();
  }

  // ---------------------------------------------------------------- 作る
  /** 目盛りの出し方 (帯の見出しの「経過時刻 | 配信時刻」。全部のグループで同じ) */
  const modeOf = () => rulerMode;
  /** 帯の見出しの「経過時刻 | 配信時刻」(2 つから選ぶ。選んでいる方を ON の色と aria-pressed で示す) */
  const rulerModeBtn = (mode, k, titleKey) =>
    mk('button', {
      type: 'button',
      class: 'wv-ruler-mode',
      dataset: { mode },
      textContent: tr(k),
      title: tr(titleKey),
      onclick: () => {
        rulerMode = mode;
        UiPrefs.set('waveRuler', mode);
        render();
      },
    });

  /** 見た目の並び順 (グループの中で行を入れ替えた順。保存しない) に並べる */
  function ordered(g, tiles) {
    const order = orders.get(g) || [];
    const pos = (t) => {
      const k = order.indexOf(t.i);
      return k < 0 ? 1e6 + t.no : k;
    };
    return [...tiles].sort((a, b) => pos(a) - pos(b));
  }

  function build(key) {
    structKey = key;
    const el = root();
    const keep = new Map([...secs].map(([g, s]) => [g, { view: s.view, fitted: s.fitted }]));
    secs.clear();
    // ---- 帯の見出し
    const head = mk(
      'div',
      { class: 'wv-head' },
      mk('span', { class: 'wv-title' }, tr('stripTitle')),
      mk('span', { class: 'wv-modes' }, rulerModeBtn('elapsed', 'waveRulerElapsed', 'waveRulerElapsedTitle'), rulerModeBtn('clock', 'waveRulerClock', 'waveRulerClockTitle')),
      mk('span', { class: 'wv-hint' }, tr('waveHint')),
      mk('button', { type: 'button', class: 'wv-close', textContent: '✕', title: tr('waveClose'), 'aria-label': tr('waveClose'), onclick: close }),
    );
    const grip = mk('div', { class: 'wv-resize', title: tr('waveResizeTitle') });
    bindResize(grip);
    const body = mk('div', { class: 'wv-body' });
    let rows = 0;
    let heads = 0;
    let rulers = 0;
    // グループ 1〜4 は空でもいつも出す (行をドラッグして移せるように)
    for (let g = 1; g <= SyncGroups.MAX; g++) {
      const G = groupOf(g);
      const s = { view: keep.get(g)?.view || null, fitted: !!keep.get(g)?.fitted, rows: new Map(), ruler: null, hoverX: null, head: {} };
      if (G && !s.view && drawable(G)) s.view = fullRange(G);
      secs.set(g, s);
      body.append(G ? sectionEl(G, s) : emptyEl(g, s));
      heads++;
      if (G && !folded.has(g)) {
        rows += G.tiles.length;
        if (drawable(G)) rulers++;
      }
    }
    if (model.rest.length) {
      const s = { rows: new Map(), head: {} };
      secs.set(0, s);
      body.append(restEl(model.rest, s));
      heads++;
      if (!folded.has(0)) rows += model.rest.length;
    }
    el.replaceChildren(grip, head, body);
    for (const i of [...selected]) if (!model.groups.some((G) => G.ref !== i && G.tiles.some((t) => t.i === i && drawable(G)))) selected.delete(i);
    paintSelection();
    const want = HEAD_H + heads * SEC_HEAD_H + rows * ROW_H + rulers * RULER_H + 8;
    setHeight(UiPrefs.get('waveH') || Math.min(want, Math.round(innerHeight * 0.45)));
  }

  /** グループの見出しの ▸ / ▾ */
  function foldBtn(g) {
    const isFolded = folded.has(g);
    return mk('button', {
      type: 'button',
      class: 'wv-fold',
      textContent: isFolded ? '▸' : '▾',
      title: tr(isFolded ? 'syncGroupUnfold' : 'syncGroupFold'),
      'aria-expanded': String(!isFolded),
      onclick: () => {
        if (folded.has(g)) folded.delete(g);
        else folded.add(g);
        update();
        markButtons();
      },
    });
  }

  function sectionEl(G, s) {
    const color = Sync.groupColor(G.g);
    const modeSel = mk(
      'select',
      { class: 'wv-mode', title: tr('syncModeTitle') },
      mk('option', { value: 'time', selected: !G.movie }, tr('syncModeTime')),
      mk('option', { value: 'movie', selected: G.movie }, tr('syncModeMovie')),
    );
    modeSel.addEventListener('change', () => {
      modeSel.blur();
      Sync.setMode(G.g, modeSel.value);
      update();
    });
    s.head.progress = drawable(G) ? mk('span', { class: 'wv-progress', title: tr('waveScanTitle') }) : null;
    s.head.play = G.active ? mk('button', { type: 'button', class: 'wv-play', onclick: () => (Sync.togglePause(G.g), update()) }) : null;
    s.head.reset =
      G.active && !G.movie
        ? mk('button', { type: 'button', class: 'wv-reset', textContent: tr('stripResetLabel'), title: tr('syncResetGroupTitle', G.g), onclick: () => (Sync.resetGroup(G.g), update()) })
        : null;
    // グループの再生速度 (超低速の 0.1× から。0.1× は YouTube の枠だけのグループで選べる)。ライブの入ったグループは等速のまま
    s.head.speed = null;
    if (G.active && !G.speedLocked) {
      const allYouTube = G.tiles.every((t) => t.youtube);
      const sel = mk(
        'select',
        { class: 'wv-speed', title: tr('stripSpeedTitle', G.g), 'aria-label': tr('stripSpeedTitle', G.g) },
        STRIP_SPEEDS.map((r) => mk('option', { value: String(r), disabled: r < 0.25 && !allYouTube }, `${r}×`)),
      );
      sel.addEventListener('change', () => {
        sel.blur();
        Sync.setStripSpeed(G.g, Number(sel.value));
        update();
      });
      s.head.speed = sel;
    }
    const head = mk(
      'div',
      { class: 'wv-sec-head' },
      foldBtn(G.g),
      mk('span', { class: 'wv-num-dot', style: `--g: ${color}`, title: tr('syncGroupN', G.g) }, String(G.g)),
      modeSel,
      mk('span', { class: 'wv-count' }, tr('syncGroupCount', G.tiles.length)),
      s.head.progress,
      s.head.play,
      s.head.speed,
      s.head.reset,
    );
    s.head.note = mk('div', { class: 'wv-sec-note' });
    const kids = [head, s.head.note];
    if (!folded.has(G.g)) {
      if (drawable(G)) {
        // 目盛りの行の左: 拡大率 (右寄せ)
        // 拡大率: 🔍 全体表示・− ・スライダー・+ (スライダーの左端は目盛りが 1 時間ごと、右端は 1 秒ごと)
        const fit = mk('button', {
          type: 'button',
          class: 'wv-fit',
          textContent: tr('waveFit'),
          title: tr('waveFitTitle'),
          onclick: () => {
            s.view = fitRange(G);
            queueDraw();
          },
        });
        const zoom = mk('input', { type: 'range', class: 'wv-zoom', min: 0, max: ZOOM_MAX, step: 1, title: tr('waveZoomTitle'), 'aria-label': tr('waveZoomTitle') });
        zoom.addEventListener('input', () => zoomTo(G.g, Number(zoom.value)));
        zoom.addEventListener('pointerdown', () => (s.zooming = true));
        zoom.addEventListener('pointerup', () => (s.zooming = false));
        zoom.addEventListener('blur', () => (s.zooming = false));
        const zoomBtn = (d, text, titleKey) =>
          mk('button', { type: 'button', class: 'wv-zoom-btn', textContent: text, title: tr(titleKey), onclick: () => zoomTo(G.g, zoomLevel(s) + d) });
        s.zoom = zoom;
        const ruler = mk('canvas', { class: 'wv-ruler-canvas', title: tr('waveRulerTitle') });
        bindRuler(ruler, G.g);
        s.ruler = ruler;
        kids.push(
          mk(
            'div',
            { class: 'wv-ruler' },
            mk(
              'div',
              { class: 'wv-label wv-ruler-label' },
              mk('span', { class: 'wv-zoombox' }, fit, zoomBtn(-ZOOM_STEP, '−', 'waveZoomOutTitle'), zoom, zoomBtn(ZOOM_STEP, '+', 'waveZoomInTitle')),
            ),
            ruler,
          ),
        );
      }
      for (const t of ordered(G.g, G.tiles)) kids.push(rowEl(G, t, s));
    }
    return mk('section', { class: 'wv-sec' + (folded.has(G.g) ? ' is-folded' : ''), dataset: { g: String(G.g) }, style: `--g: ${color}` }, kids);
  }

  /** まだ枠の無いグループ (行をドラッグして入れられる) */
  function emptyEl(g) {
    const color = Sync.groupColor(g);
    const head = mk(
      'div',
      { class: 'wv-sec-head' },
      mk('span', { class: 'wv-fold' }),
      mk('span', { class: 'wv-num-dot', style: `--g: ${color}`, title: tr('syncGroupN', g) }, String(g)),
      mk('span', { class: 'wv-sec-title is-empty' }, tr('syncModeTime')),
      mk('span', { class: 'wv-count' }, tr('syncGroupCount', 0)),
    );
    return mk('section', { class: 'wv-sec is-empty', dataset: { g: String(g) }, title: tr('stripEmptyGroupTitle'), style: `--g: ${color}` }, head);
  }

  function restEl(list, s) {
    const head = mk('div', { class: 'wv-sec-head' }, foldBtn(0), mk('span', { class: 'wv-sec-title' }, tr('syncGroupNone')), mk('span', { class: 'wv-count' }, tr('syncGroupCount', list.length)));
    const kids = [head];
    if (!folded.has(0)) for (const t of ordered(0, list)) kids.push(rowEl(null, t, s));
    return mk('section', { class: 'wv-sec wv-rest' + (folded.has(0) ? ' is-folded' : ''), dataset: { g: '0' } }, kids);
  }

  function rowEl(G, t, s) {
    const isRef = !!G && G.ref === t.i;
    const r = { t };
    const tuned = !!G && G.active && !G.movie;
    // 一番左: 基準の選択 (○ を押すと基準にする。基準は 🔒 (🕒。補正は 0 のまま) / ◉ (🎬))
    const refBtn = G
      ? mk('button', {
          type: 'button',
          class: 'wv-refbtn' + (isRef ? ' on' : ''),
          textContent: isRef ? (G.movie ? '◉' : '🔒') : '○',
          title: tr(isRef ? (G.movie ? 'syncRefBadgeTitle' : 'syncRefLockTitle') : 'syncSetRefTitle'),
          disabled: isRef,
          onclick: (e) => {
            e.stopPropagation();
            Sync.setReference(t.i);
            update();
          },
        })
      : mk('span', { class: 'wv-refbtn is-none' });
    // 1 行に並べる。列の幅は固定 (名前が長くても、補正が ±99999.99 秒でも、縦の罫線から右の位置は動かない)
    // 左 (ドラッグで並べ替え・移す): サムネイル (乗せると動画名)・枠番号・チャンネル名・基準選択・基準マーク
    const thumbTitle = t.title || t.name;
    const thumb = t.youtube
      ? mk('img', { class: 'wv-thumb', src: thumbUrl(t.vid), alt: '', loading: 'lazy', draggable: false, title: thumbTitle })
      : mk('span', { class: 'wv-thumb', title: thumbTitle });
    // 基準マーク (黄色の「基準」。基準の行だけ。ほかの行は同じ幅の空き)
    const refMark = mk('span', { class: 'wv-refmark' }, isRef ? mk('span', { class: 'wv-ref' }, tr('waveRef')) : null);
    const label = mk(
      'div',
      { class: 'wv-label', title: tr('stripRowLabelTitle') },
      thumb,
      mk('span', { class: 'wv-num' }, String(t.no)),
      mk('span', { class: 'wv-name', title: t.name }, t.name),
      refBtn,
      refMark,
    );
    bindRowDrag(label, G ? G.g : 0, t.i);
    // 罫線の右: 経過時間・補正の秒数 (押すと入力欄。Enter で決める・Esc でやめる)・✓ / ↻・⏸ 止めて待つ・↶ 元に戻す
    const tune = mk('div', { class: 'wv-tune' });
    r.elapsed = mk('span', { class: 'wv-elapsed', title: tr('syncElapsedTitle') });
    if (tuned) {
      r.off = mk('button', { type: 'button', class: 'wv-off', title: tr('stripOffsetTitle'), disabled: isRef || !t.movable });
      r.off.addEventListener('click', (e) => {
        e.stopPropagation();
        editOffset(r, t);
      });
      r.dot = mk('span', { class: 'dr-dot' });
      // 🔊 / 🔇: この枠の音を出す / 消す (止めて待つの左)
      r.audio = mk('button', { type: 'button', class: 'wv-audio', onclick: (e) => (e.stopPropagation(), Sync.toggleAudio(t.i), update()) });
      r.wait = t.movable ? mk('button', { type: 'button', class: 'wv-wait', disabled: isRef, onclick: (e) => (e.stopPropagation(), Sync.toggleWait(t.i), update()) }) : mk('span', { class: 'wv-slot' });
      // 元に戻す (この枠の補正を、ひとつ前の値に)。基準の行も列をそろえるために置く (押せない)
      r.undo = t.movable ? mk('button', { type: 'button', class: 'wv-undo', textContent: '↶', disabled: isRef, onclick: (e) => (e.stopPropagation(), undoOffset(t.i)) }) : null;
      tune.append(r.elapsed, r.off, r.dot, r.audio, r.wait, r.undo || mk('span', { class: 'wv-slot' }));
      // 罫線と波の間を押しても、行を選ぶ (行の左を押したときと同じ)
      tune.addEventListener('click', (e) => {
        if (!e.target.closest('button, input')) toggleSelect(G, t.i, e);
      });
    } else {
      tune.append(mk('span', { class: 'wv-why' }, tr(G ? (G.movie ? 'stripMovieInPanel' : 'syncGroupNeedArchive') : 'syncWhyRow_' + (t.why || 'alone'))));
    }
    let right;
    if (G && drawable(G) && t.youtube && t.movable) {
      right = mk('canvas', { class: 'wv-canvas' + (isRef ? ' is-ref' : ''), title: tr('waveRowTitle') });
      bindCanvas(right, G.g, t.i);
      r.canvas = right;
    } else right = mk('div', { class: 'wv-nowave' }, G && drawable(G) ? tr('stripNoWave') : '');
    // 基準の行は、波に半透明の覆いを乗せて触れないようにする (ホイールの拡大・縮小だけは通す)。
    // 罫線の右の補正・止めて待つは、基準の行では押せない形 (disabled) にしてある
    let cover = null;
    if (isRef && tuned) {
      cover = mk('div', { class: 'wv-cover', title: tr('stripRefCoverTitle') });
      cover.addEventListener('wheel', (e) => onWheel(e, G.g), { passive: false });
    }
    r.el = mk('div', { class: 'wv-row' + (isRef ? ' is-ref' : ''), dataset: { i: String(t.i), g: String(G ? G.g : 0) } }, label, tune, right, cover);
    r.el.addEventListener('mouseenter', () => Sync.highlight(t.i));
    r.el.addEventListener('mouseleave', () => Sync.highlight(null));
    s.rows.set(t.i, r);
    return r.el;
  }

  // ---------------------------------------------------------------- 行をドラッグ (並べ替え・ほかのグループへ移す)
  /**
   * 行の左を上下にドラッグする: 同じグループの行の上で放すと、そこへ並べ替える (見た目だけ。保存しない)。
   * ほかのグループ (見出し・行・空のグループ・同期しない) の上で放すと、そのグループへ移す (同期の調整パネルの「グループ」と同じ)。
   * 動かさずに押して離すと、その行を選ぶ (波を押したときと同じ)
   */
  function bindRowDrag(label, g, i) {
    let d = null;
    label.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, select, input')) return;
      d = { y0: e.clientY, moved: false, pointerId: e.pointerId };
    });
    label.addEventListener('pointermove', (e) => {
      if (!d) return;
      if (!d.moved && Math.abs(e.clientY - d.y0) < DRAG_PX) return;
      if (!d.moved) {
        d.moved = true;
        capture(label, e);
        label.closest('.wv-row')?.classList.add('is-dragging');
        document.body.classList.add('wave-resizing'); // 枠の iframe にマウスを取られないように
      }
      paintDrop(dropAt(e.clientX, e.clientY, i));
    });
    const end = (e) => {
      if (!d) return;
      const moved = d.moved;
      d = null;
      label.closest('.wv-row')?.classList.remove('is-dragging');
      document.body.classList.remove('wave-resizing');
      paintDrop(null);
      if (!moved) {
        if (g) toggleSelect(groupOf(g), i, e);
        return;
      }
      const at = dropAt(e.clientX, e.clientY, i);
      if (!at) return;
      if (at.g === g) {
        // 同じグループ: 並べ替える (見た目だけ)
        const list = ordered(g, g ? groupOf(g)?.tiles || [] : model.rest).map((t) => t.i).filter((x) => x !== i);
        const k = at.before != null ? list.indexOf(at.before) : list.length;
        list.splice(k < 0 ? list.length : k, 0, i);
        orders.set(g, list);
        structKey = '';
        update();
      } else {
        Sync.moveTile(i, String(at.g));
        update();
      }
    };
    label.addEventListener('pointerup', end);
    label.addEventListener('pointercancel', () => {
      d = null;
      label.closest('.wv-row')?.classList.remove('is-dragging');
      document.body.classList.remove('wave-resizing');
      paintDrop(null);
    });
  }

  /** ドラッグしている位置の落とし先: {g, before (この行の前へ。無ければ最後へ), el} */
  function dropAt(x, y, self) {
    const hit = document.elementFromPoint(x, y);
    const sec = hit?.closest?.('.wv-sec');
    if (!sec || !root().contains(sec)) return null;
    const g = Number(sec.dataset.g);
    const row = hit.closest('.wv-row');
    if (row && Number(row.dataset.i) !== self) {
      const rect = row.getBoundingClientRect();
      const after = y > rect.top + rect.height / 2;
      const next = after ? row.nextElementSibling?.closest?.('.wv-row') : row;
      return { g, before: next ? Number(next.dataset.i) : null, el: next || row, after: !next, sec };
    }
    return { g, before: null, el: null, sec };
  }
  function paintDrop(at) {
    for (const x of root().querySelectorAll('.drop-before, .drop-after, .drop-into')) x.classList.remove('drop-before', 'drop-after', 'drop-into');
    if (!at) return;
    if (at.el) at.el.classList.add(at.after ? 'drop-after' : 'drop-before');
    else at.sec.classList.add('drop-into');
  }

  // ---------------------------------------------------------------- 元に戻す (枠ごと)
  // 補正が変わるたびに、その前の値を積んでおく。↶ を押すたびに 1 つずつ戻り、最初の値 (帯で見始めたときの値。例えば実際の時刻の 0) まで戻れる。
  // 続けて変わった分 (← → を続けて押した・ドラッグした) は、ひとまとまりにする
  const UNDO_GAP_MS = 1500;
  const UNDO_MAX = 100;
  const history = new Map(); // i -> {vid, known: 今の値, stack: 前の値 (古い順), at: 最後に変わった時刻}
  const prevOf = (h) => (h?.stack.length ? h.stack[h.stack.length - 1] : null);
  function trackOffsets() {
    const now = performance.now();
    for (const G of model.groups) {
      if (!G.active || G.movie) continue;
      for (const t of G.tiles) {
        const h = history.get(t.i);
        const v = t.off || 0;
        if (!h || h.vid !== t.vid) {
          history.set(t.i, { vid: t.vid, known: v, stack: [], at: 0 });
          continue;
        }
        if (v === h.known) continue;
        if (now - h.at > UNDO_GAP_MS || !h.stack.length) {
          h.stack.push(h.known);
          if (h.stack.length > UNDO_MAX) h.stack.shift();
        }
        h.known = v;
        h.at = now;
        // 戻った先が積んである一つ前の値と同じなら、その分は積まない (行ったり来たりで同じ値が並ばないように)
        if (h.stack.length && h.stack[h.stack.length - 1] === v) h.stack.pop();
      }
    }
  }
  function undoOffset(i) {
    const h = history.get(i);
    const back = prevOf(h);
    if (back == null) return;
    h.stack.pop();
    h.known = back;
    h.at = 0;
    Sync.setOffset(i, back);
    update();
  }

  /** 補正の数字を入力欄にする (パネルの入力欄と同じ読み方)。Enter・欄を離れると決める、Esc でやめる */
  function editOffset(r, t) {
    if (!r.off || r.off.disabled) return;
    const input = mk('input', { type: 'text', class: 'wv-off-input sync-input', inputMode: 'decimal', spellcheck: false, value: r.off.textContent, title: tr('syncInputTitle') });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) Sync.commitOffsetText(t.i, input.value);
      input.replaceWith(r.off);
      update();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    r.off.replaceWith(input);
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------- 数字の書き換え
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);

  /** グループ G の波形のある割合 (0〜1) */
  function progressOf(G) {
    let have = 0;
    let all = 0;
    for (const t of waveTiles(G)) {
      have += Waves.coverage(Waves.get(t.vid), 0, t.dur) * t.dur;
      all += t.dur;
    }
    return all ? have / all : 1;
  }

  function render() {
    const el = root();
    if (!shown || !el || !model) return;
    trackOffsets();
    for (const mb of el.querySelectorAll('.wv-ruler-mode')) {
      const on = mb.dataset.mode === modeOf();
      mb.classList.toggle('on', on);
      mb.setAttribute('aria-pressed', String(on));
    }
    for (const G of model.groups) {
      const s = secs.get(G.g);
      if (!s) continue;
      if (s.head.speed && document.activeElement !== s.head.speed) {
        const v = String(G.speed);
        if (s.head.speed.value !== v) s.head.speed.value = v;
      }
      if (s.head.progress) {
        // 取得率 (このグループの枠の音の大きさを、どれだけ測ったか)。全部そろえば「取得完了」
        const pct = Math.floor(progressOf(G) * 100);
        // 99% 以上は取得完了とする (自動で測り始めるのも 99% 未満のときだけ。広告の切れ目など、測れない細かな抜けが残るため)
        const txt = pct >= 99 ? tr('stripProgressDone') : tr('stripProgress', pct);
        if (s.head.progress.textContent !== txt) s.head.progress.textContent = txt;
        s.head.progress.classList.toggle('is-measuring', !!scan && pct < 100 && !folded.has(G.g));
      }
      if (s.head.play) {
        // 同期の調整パネルのグループの ⏸ と同じ (デザインガイド 4 章: 止めると「再開」に変わる)
        const label = tr(G.playing ? 'syncGroupPauseLabel' : 'syncGroupPlayLabel');
        if (s.head.play.textContent !== label) s.head.play.textContent = label;
        s.head.play.title = tr(G.playing ? 'syncGroupPause' : 'syncGroupPlay');
      }
      if (s.head.reset) s.head.reset.disabled = !G.canReset;
      const note = G.movie ? tr('stripMovieInPanel') : G.note;
      if (s.head.note.textContent !== note) s.head.note.textContent = note;
      s.head.note.hidden = !note;
      for (const t of G.tiles) {
        const r = s.rows.get(t.i);
        if (!r) continue;
        r.t = t;
        if (r.elapsed.textContent !== t.elapsed) r.elapsed.textContent = t.elapsed;
        if (r.off && r.off.isConnected) {
          const txt = signed(t.off || 0);
          if (r.off.textContent !== txt) r.off.textContent = txt;
        }
        if (r.dot) {
          const st = t.drift;
          r.dot.className = 'dr-dot is-' + st;
          r.dot.textContent = st === 'ok' ? '✓' : st === 'fix' ? '↻' : '';
          r.dot.title = tr('syncDot_' + st);
        }
        if (r.audio) {
          const txt = t.muted ? '🔇' : '🔊';
          if (r.audio.textContent !== txt) r.audio.textContent = txt;
          r.audio.title = tr(t.muted ? 'infoAudioOn' : 'infoAudioOff');
          r.audio.classList.toggle('on', !t.muted);
          r.audio.setAttribute('aria-pressed', String(!t.muted));
        }
        if (r.wait) {
          r.wait.textContent = t.waiting ? '▶' : '⏸';
          r.wait.title = tr(t.waiting ? 'syncWaitResumeTitle' : 'syncWaitTitle');
          r.wait.classList.toggle('is-waiting', t.waiting);
        }
        if (r.undo) {
          const h = history.get(t.i);
          const back = prevOf(h);
          r.undo.disabled = back == null || t.waiting || t.i === G.ref; // 基準の補正は 0 のまま
          r.undo.title = back == null ? tr('stripUndoNone') : tr('stripUndoTitle', signed(back), h.stack.length);
        }
      }
    }
    queueDraw();
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

  // ---------------------------------------------------------------- 選ぶ・← →
  function paintSelection() {
    for (const s of secs.values()) for (const [i, r] of s.rows) r.el.classList.toggle('is-selected', selected.has(i));
  }
  /**
   * 行を押したときの選び方 (デザインガイド 4 章「行を押して選ぶもの」): 押すとその行だけを選ぶ (その行だけを選んでいれば外す)。
   * Shift か Ctrl を押しながらなら、その行を足す / 外す (ほかはそのまま)。基準の行は選べない
   */
  function toggleSelect(G, i, e) {
    if (!G || i === G.ref) return;
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
      for (const i of selected) {
        const G = model?.groups.find((x) => x.tiles.some((t) => t.i === i));
        if (!drawable(G) || i === G.ref) continue;
        Sync.setOffset(i, Math.round((Sync.offOf(i) + d) * 100) / 100);
      }
      update();
    } else return;
    e.preventDefault();
    e.stopPropagation(); // 上の操作 (矢印キーで音の枠を移すなど) にしない
  }

  // ---------------------------------------------------------------- 描く
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
  function rulerZero(G) {
    if (modeOf(G.g) !== 'elapsed') return null;
    const t = refTile(G);
    return t && t.start != null ? realStart(t) : null;
  }
  /** 目盛りの文字: 経過時間「1:23:45」(基準より前は −) か、実際の時刻「23:05」 */
  function rulerText(G, ms, sec) {
    const zero = rulerZero(G);
    if (zero == null) return clock(ms, sec);
    // 上部バーと同じ形 (1 時間未満は「54:56」、それより上は「1:05:00」)。分ごとの目盛りでも秒まで書く (「0:55」が 55 秒と読めないように)
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
    if (!shown || !model) return;
    const css = getComputedStyle(root());
    const band = css.getPropertyValue('--wv-band').trim() || 'rgba(255,255,255,0.08)';
    const nowColor = css.getPropertyValue('--wv-now').trim() || '#fff';
    const muted = css.getPropertyValue('--muted').trim() || '#9a9aa6';
    for (const G of model.groups) {
      const s = secs.get(G.g);
      if (!s || !s.view || folded.has(G.g) || !drawable(G)) continue;
      drawSection(G, s, { band, nowColor, muted });
    }
  }

  function drawSection(G, s, { band, nowColor, muted }) {
    const view = s.view;
    const span = view.to - view.from;
    const color = Sync.groupColor(G.g);
    // ---- 目盛り (押せるように見せる: 地の色・今の時刻のつまみ・乗せた位置の線と時刻)
    const rc = s.ruler;
    if (rc?.isConnected) {
      const { ctx, W, H, dpr } = prep(rc);
      const pxPerMs = W / span;
      ctx.fillStyle = getComputedStyle(rc).getPropertyValue('--wv-ruler-bg').trim() || 'rgba(255,255,255,0.07)'; // 乗せている間は明るく (CSS の :hover)
      ctx.fillRect(0, 0, W, H);
      const steps = [1e3, 2e3, 5e3, 10e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3];
      const step = steps.find((v) => v * pxPerMs >= TICK_PX * dpr * 0.999) || 3600e3;
      // 拡大率のスライダーを今の縮尺に合わせる (動かしている間はそのまま)
      if (s.zoom && !s.zooming) s.zoom.value = String(Math.round(zoomLevel(s)));
      ctx.fillStyle = muted;
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const zero = rulerZero(G);
      const base = zero ?? new Date(view.from).getTimezoneOffset() * 60e3; // 経過時間は基準の始まり、時刻はその日の 0:00 にそろえる
      // 数字の間を 10 等分した細かい目盛り (短い線)
      const minor = step / 10;
      for (let t = Math.ceil((view.from - base) / minor) * minor + base; t < view.to; t += minor) {
        const x = Math.round((t - view.from) * pxPerMs);
        ctx.fillRect(x, H - 3 * dpr, Math.max(1, dpr), 3 * dpr);
      }
      for (let t = Math.ceil((view.from - base) / step) * step + base; t < view.to; t += step) {
        const x = Math.round((t - view.from) * pxPerMs);
        ctx.fillRect(x, H - 7 * dpr, Math.max(1, dpr), 7 * dpr);
        ctx.fillText(rulerText(G, t, step < 60e3), x + 3 * dpr, 3 * dpr);
      }
      if (s.hoverX != null) {
        const xh = s.hoverX * dpr;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(Math.round(xh), 0, Math.max(1, dpr), H);
        const label = rulerText(G, view.from + xh / pxPerMs, true);
        const tw = ctx.measureText(label).width + 8 * dpr;
        const lx = Math.min(W - tw, Math.max(0, xh + 4 * dpr));
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(lx, 2 * dpr, tw, H - 4 * dpr);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, lx + 4 * dpr, 4 * dpr);
      }
      if (G.now != null) {
        const xn = (G.now - view.from) * pxPerMs;
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
    for (const t of waveTiles(G)) {
      const r = s.rows.get(t.i);
      if (!r?.canvas?.isConnected) continue;
      const { ctx, W, H, dpr } = prep(r.canvas);
      const x = (R) => ((R - view.from) / span) * W;
      const a = Math.max(0, x(realStart(t)));
      const b = Math.min(W, x(realEnd(t)));
      if (b > a) {
        ctx.fillStyle = band;
        ctx.fillRect(a, 2 * dpr, b - a, H - 4 * dpr);
        const vals = Waves.get(t.vid) || new Uint8Array(0);
        const off = offOf(t);
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
      if (G.now != null) {
        const xn = x(G.now);
        if (xn >= 0 && xn <= W) {
          ctx.fillStyle = nowColor;
          ctx.fillRect(Math.round(xn), 0, Math.max(1, dpr), H);
        }
      }
    }
  }

  // ---------------------------------------------------------------- 拡大率
  // 目盛りの線は TICK_PX ドット以上あけて引く。拡大率は「目盛りの刻み」で決める:
  // スライダーの左端 (0) は 1 時間ごと、右端 (ZOOM_MAX) は 1 秒ごとの縮尺。間は対数で (どこでも同じ割合で拡大する)
  const TICK_PX = 90;
  const STRIP_SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]; // グループの再生速度 (超低速の 0.1× も)
  const ZOOM_MAX = 1000;
  const ZOOM_STEP = 100; // − / + 1 回分 (約 2.3 倍)
  const ZOOM_WIDE = 3600e3; // 左端の刻み (ミリ秒)
  const ZOOM_NEAR = 1e3; // 右端の刻み
  const zoomWidth = (s) => s?.ruler?.clientWidth || 600;
  /** 拡大率 (0〜ZOOM_MAX) → 見ている範囲の長さ (ミリ秒) */
  const spanFor = (s, z) => (zoomWidth(s) / TICK_PX) * ZOOM_WIDE * Math.pow(ZOOM_NEAR / ZOOM_WIDE, z / ZOOM_MAX);
  /** 今の拡大率 (0〜ZOOM_MAX) */
  function zoomLevel(s) {
    if (!s?.view) return 0;
    const z = (ZOOM_MAX * Math.log((s.view.to - s.view.from) / spanFor(s, 0))) / Math.log(ZOOM_NEAR / ZOOM_WIDE);
    return Math.max(0, Math.min(ZOOM_MAX, z));
  }
  /**
   * 拡大率 z にする。今の再生位置 (グループの時計) を真ん中にして広げる / 縮める (拡大して今の位置が見えなくならないように)。
   * 今の位置が分からなければ、見ている範囲の真ん中のまま
   */
  function zoomTo(g, z) {
    const s = secs.get(g);
    if (!s?.view) return;
    const view = s.view;
    const next = spanFor(s, Math.max(0, Math.min(ZOOM_MAX, z)));
    const now = groupOf(g)?.now;
    const c = Number.isFinite(now) ? now : (view.from + view.to) / 2;
    s.view = { from: c - next / 2, to: c + next / 2 };
    queueDraw();
  }

  // ---------------------------------------------------------------- 目盛り・行の操作
  /** 見ている範囲を横に動かす・拡大する (ホイール。節の行と目盛りで共通) */
  function onWheel(e, g) {
    const s = secs.get(g);
    const G = groupOf(g);
    if (!s?.view || !G) return;
    e.preventDefault();
    const view = s.view;
    const rect = e.currentTarget.getBoundingClientRect();
    const span = view.to - view.from;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / rect.width) * span;
      s.view = { from: view.from + d, to: view.to + d };
      queueDraw();
    } else {
      // 拡大・縮小はスライダーと同じ幅の中で (スライダーと同じく、今の再生位置を真ん中に)
      const k = Math.pow(1.2, e.deltaY / 100);
      zoomTo(g, zoomLevel(s) + (ZOOM_MAX * Math.log(k)) / Math.log(ZOOM_WIDE / ZOOM_NEAR));
    }
  }

  const timeAt = (view, el, clientX) => {
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

  /** 目盛りで選んだ時刻を、見ている範囲とグループの配信のある範囲 (一番早い始まり〜一番遅い終わり) の中に収める (HAKO-40) */
  function seekTime(g, c, clientX) {
    const s = secs.get(g);
    const R = timeAt(s.view, c, clientX);
    const all = fullRange(groupOf(g));
    const pad = all ? (all.to - all.from) / 102 : 0; // fullRange は前後に 1% の余白を足しているので、その分を戻す
    const lo = Math.max(s.view.from, all ? all.from + pad : -Infinity);
    const hi = Math.min(s.view.to, all ? all.to - pad : Infinity);
    return hi > lo ? Math.max(lo, Math.min(hi, R)) : R;
  }

  /** 目盛り: 押す・なぞると、グループがその時刻へ動く (帯の外までなぞっても、配信のある範囲の中で止まる) */
  function bindRuler(c, g) {
    let scrub = false;
    let last = 0;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !secs.get(g)?.view) return;
      capture(c, e);
      scrub = true;
      Sync.seekTo(g, seekTime(g, c, e.clientX));
      last = performance.now();
    });
    c.addEventListener('pointermove', (e) => {
      const s = secs.get(g);
      if (!s) return;
      // 乗せた位置の線と時刻も、目盛りの中に収める
      s.hoverX = Math.max(0, Math.min(c.clientWidth, e.clientX - c.getBoundingClientRect().left));
      queueDraw();
      if (!scrub || performance.now() - last < 150) return;
      last = performance.now();
      Sync.seekTo(g, seekTime(g, c, e.clientX));
    });
    const end = (e) => {
      if (!scrub) return;
      scrub = false;
      Sync.seekTo(g, seekTime(g, c, e.clientX));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => (scrub = false));
    c.addEventListener('pointerleave', () => {
      const s = secs.get(g);
      if (s) s.hoverX = null;
      queueDraw();
    });
    c.addEventListener('wheel', (e) => onWheel(e, g), { passive: false });
  }

  /**
   * 行の波: 横にドラッグすると、その枠の補正が変わる (基準の行は覆いがあって触れない。もし届いたら見ている範囲を左右に動かす)。
   * 動かさずに押して離すと、その行を選ぶ。少しのぶれで補正が変わらないように、DRAG_PX 動かしてからドラッグにする
   */
  function bindCanvas(canvas, g, i) {
    canvas.addEventListener('pointerdown', (e) => {
      const s = secs.get(g);
      const t = groupOf(g)?.tiles.find((x) => x.i === i);
      if (e.button !== 0 || !s?.view || !t) return;
      capture(canvas, e);
      drag = { g, i, x0: e.clientX, off0: t.off || 0, off: t.off || 0, moved: false, view0: s.view };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.i !== i) return;
      const s = secs.get(g);
      const G = groupOf(g);
      if (!s || !G) return;
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < DRAG_PX) return;
      drag.moved = true;
      const msPerPx = (drag.view0.to - drag.view0.from) / canvas.clientWidth;
      if (i === G.ref) s.view = { from: drag.view0.from - dx * msPerPx, to: drag.view0.to - dx * msPerPx };
      // 右へずらす = その配信を実際の時刻の後ろへ = 補正を減らす
      else drag.off = Math.round((drag.off0 - (dx * msPerPx) / 1000) * 10) / 10;
      queueDraw();
    });
    const end = (e) => {
      if (!drag || drag.i !== i) return;
      const d = drag;
      drag = null;
      const G = groupOf(g);
      if (d.moved) {
        if (G && i !== G.ref && d.off !== d.off0) Sync.setOffset(i, d.off);
        update();
      } else toggleSelect(G, i, e); // 動かさずに押したら、選ぶ / 外す (時刻へ動かすのは目盛りで)
      queueDraw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => ((drag = null), queueDraw()));
    canvas.addEventListener('wheel', (e) => onWheel(e, g), { passive: false });
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
    if (model?.groups.some((G) => G.tiles.some((t) => t.vid === vid))) queueDraw();
  });

  return {
    toggle,
    open,
    close,
    /** グループ g の節を帯で開いているか */
    isOpen,
  };
})();
