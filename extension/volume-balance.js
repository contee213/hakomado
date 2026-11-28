// hakomado: 🎚 音量バランス (HAKO-54)。上部バーの「🎚 音量」(V キー) で開くパネル (#volumeMenu) と、
// 枠に送る実際の音量の計算 (枠の音量 × 「大きさをそろえる」の自動の倍率 × 主役のときのほかの枠の割合)。
// - 枠の音量 (state.tiles[i].gain) は枠の 🎚 パネルと同じ値。ここでは書き換えない
// - 「大きさをそろえる」: 音を出している枠の動画ごとの音の大きさを出し、真ん中 (中央値) の大きさに合わせる倍率へ、
//   1 秒に STEP_DB までゆっくり近づける。大きさは無音・話の合間を除いた全体の平均なので、叫び声や一瞬の BGM では動かない
// - 大きさの元は、動画ごとの音の波形 (waves.js。〰 波形・✨ 自動補正と同じもの。IndexedDB に残る)。同じ音を二度取らない:
//   - 枠の中の音の記録 (envChunk) は、誰が始めたもの (✨ / 音量バランス) でも chunk で 1 回だけ波形に足す
//   - 保存してある波形に音のあるところが ENOUGH_SEC 秒あれば、その動画はもう測らない (次に開いたときも測らない)
//   - 足りない動画だけ、枠の中で記録を頼む (content/mix.js の level。✨ と同じ記録を使い、別に測る口は作らない)
//   - ライブ・Twitch は再生位置で波形に置けないので、この画面を開いている間だけ直近 LIVE_KEEP_SEC 秒ぶんを覚える
//   測るのは枠の音量を掛ける前の音なので、倍率を変えても大きさは変わらない (行ったり来たりしない)
// - 主役 (★): 主役の枠が音を出している間、ほかの音を出している枠を duck の割合にする。主役は枠の番号 (中身) で持つので、
//   並べ替えてもついていく。枠を空にしたら外す
// - 自動の倍率は保存しない (開き直すと、保存してある波形からすぐ決め直す)。auto・focus・duck は視聴セッション (state.volume) に残す
// grid.js の state・views・tr などを使うのは呼ばれてから (読み込みの時点では使わない) なので、grid.js より前に読み込んでよい
/* global Waves */
/* exported VolumeBalance */
'use strict';

const VolumeBalance = (() => {
  const MAX_EFFECTIVE = 4; // 枠に送る音量の上限。content/mix.js の MAX_GAIN と合わせる
  const AUTO_MIN = 0.25;
  const AUTO_MAX = 4;
  const STEP_DB = 1; // 自動の倍率を 1 秒に動かす上限 (dB)
  const FLOOR_DB = -60; // 波形の一番小さい値 (waves.js の FLOOR_DB)
  const SILENT_DB = -50; // 0.1 秒の大きさがこれより小さいところは無音として数えない
  const GATE_DB = 20; // 音のあるところの真ん中より、これだけ小さいところは数えない (話の合間)
  const READY_SEC = 3; // 音のあるところがこれだけあれば、そろえる相手に入れる
  const ENOUGH_SEC = 60; // 波形に音のあるところがこれだけあれば、もう測らない
  const LIVE_KEEP_SEC = 600; // ライブ・Twitch で覚えておく長さ
  const STEP_SEC = 0.1; // 波形の 1 つ (waves.js の STEP)
  const DEFAULT_DUCK = 0.3;

  const tiles = new Map(); // 枠の番号 → { vid, auto, blocked }
  const sentLevel = new Map(); // 枠の番号 → 最後に送った level
  const liveSteps = new Map(); // ライブ・Twitch の動画 → 0.1 秒ごとの大きさ (0.1 dB の目盛り) の並び
  const stats = new Map(); // 動画 → { db, sec } (波形・ライブの並びから出した大きさ)
  const dirty = new Set(); // 大きさを出し直す動画
  let hooked = false;
  let timer = 0;
  let el = null;
  let anchorBtn = null;
  let rowKey = '';

  const pct = (g) => Math.round(g * 100);
  const toDb = (g) => 20 * Math.log10(g);
  const fromDb = (d) => 10 ** (d / 20);
  const BINS = -FLOOR_DB * 10 + 1; // 0.1 dB の目盛り (FLOOR_DB〜0 dB)
  const binOf = (db) => Math.max(0, Math.min(BINS - 1, Math.round((db - FLOOR_DB) * 10)));

  /** 保存してある値を、使える形にそろえる (applySession から) */
  function normalize(v) {
    const o = v && typeof v === 'object' ? v : {};
    const duck = Number(o.duck);
    const focus = Number.isInteger(o.focus) && o.focus >= 0 && o.focus < MAX_TILES ? o.focus : null;
    return { auto: o.auto === true, focus, duck: Number.isFinite(duck) ? Math.max(0, Math.min(1, Math.round(duck * 20) / 20)) : DEFAULT_DUCK };
  }

  const conf = () => state.volume;

  /** 枠ごとの自動の倍率など。別の動画にしたら作り直す */
  function rec(i) {
    const vid = state.tiles[i].videoId || '';
    let r = tiles.get(i);
    if (!r || r.vid !== vid) {
      r = { vid, auto: 1, blocked: false };
      tiles.set(i, r);
    }
    return r;
  }

  /** 音量を変えられる枠か (YouTube・Twitch。URL の枠・ファイルの枠は枠の中の音の経路が無い) */
  const mixable = (i) => !!state.tiles[i].videoId;
  const audible = (i) => isVisible(i) && tileFilled(state.tiles[i]) && !state.tiles[i].muted;
  const hasWaves = () => typeof Waves !== 'undefined';

  /** 大きさを波形 (再生位置ごと。保存する) に置く動画: YouTube のアーカイブ・動画 */
  function waveId(i) {
    const id = state.tiles[i].videoId || '';
    return hasWaves() && /^[\w-]{11}$/.test(id) && ['archive', 'video'].includes(tileKind(i)) ? id : null;
  }
  /** 大きさをこの画面の間だけ覚える動画: ライブ・Twitch (VOD も) */
  function memId(i) {
    const id = state.tiles[i].videoId || '';
    return id && !waveId(i) && ['live', 'archive', 'video'].includes(tileKind(i)) ? id : null;
  }

  /** 0.1 dB の目盛りの数え上げ → 無音・話の合間を除いた平均 (dB) と、使った長さ (秒) */
  function summarize(hist) {
    const lo = binOf(SILENT_DB);
    let n = 0;
    for (let b = lo; b < BINS; b++) n += hist[b];
    if (!n) return { db: 0, sec: 0 };
    let med = lo;
    for (let c = 0; med < BINS; med++) if ((c += hist[med]) * 2 >= n) break;
    let sum = 0;
    let cnt = 0;
    for (let b = Math.max(lo, med - GATE_DB * 10); b < BINS; b++) {
      sum += hist[b] * (b / 10 + FLOOR_DB);
      cnt += hist[b];
    }
    return { db: sum / cnt, sec: cnt * STEP_SEC };
  }
  function histOfWave(vals) {
    const hist = new Float64Array(BINS);
    // 波形の値 1〜255 は FLOOR_DB〜0 dB を等分したもの (waves.js の quantize)
    for (let k = 0; k < vals.length; k++) if (vals[k]) hist[binOf(FLOOR_DB + ((vals[k] - 1) / 254) * -FLOOR_DB)]++;
    return hist;
  }
  function histOfList(list) {
    const hist = new Float64Array(BINS);
    for (const b of list) hist[b]++;
    return hist;
  }

  /** 枠の動画の大きさ { db, sec }。まだ分からなければ null (波形を読み込み中など) */
  function statOf(i) {
    const w = waveId(i);
    if (w) {
      if (!hooked) {
        hooked = true;
        Waves.onChange((id) => dirty.add(id)); // 〰 波形の下見・✨・音量バランスのどれで足されても出し直す
      }
      const vals = Waves.get(w);
      if (!vals) {
        Waves.ensure(w)
          .then(() => dirty.add(w))
          .catch(() => {});
        return null;
      }
      if (!stats.has(w) || dirty.has(w)) {
        dirty.delete(w);
        stats.set(w, summarize(histOfWave(vals)));
      }
      return stats.get(w);
    }
    const m = memId(i);
    if (!m) return null;
    if (!stats.has(m) || dirty.has(m)) {
      dirty.delete(m);
      stats.set(m, summarize(histOfList(liveSteps.get(m) || [])));
    }
    return stats.get(m);
  }
  const ready = (i) => (statOf(i)?.sec || 0) >= READY_SEC;

  function autoOf(i) {
    return conf().auto && mixable(i) ? rec(i).auto : 1;
  }
  function duckOf(i) {
    const f = conf().focus;
    if (f == null || f === i || !audible(f)) return 1;
    return conf().duck;
  }

  /** 枠に送る実際の音量 */
  function gainOf(i) {
    return Math.min(MAX_EFFECTIVE, state.tiles[i].gain * autoOf(i) * duckOf(i));
  }
  /** 枠の中で音の記録を頼むか: 「大きさをそろえる」が ON で音を出していて、その動画の大きさがまだ足りないときだけ */
  function levelOn(i) {
    if (!conf().auto || !mixable(i) || !audible(i)) return false;
    if (memId(i)) return true; // ライブ・Twitch は、いつも新しい音なので聞き続ける
    if (!waveId(i)) return false; // 種類がまだ分からない
    const st = statOf(i);
    return !!st && st.sec < ENOUGH_SEC; // 波形を読み込み中なら、読めるまで待つ
  }

  function apply(i) {
    const t = state.tiles[i];
    if (!t.videoId) return;
    const level = levelOn(i);
    sentLevel.set(i, level);
    postToFrame(views[i].player, { hakomado: 'mix', pan: t.pan, gain: gainOf(i), delay: t.delay, level });
  }
  function applyAll() {
    for (let i = 0; i < MAX_TILES; i++) apply(i);
  }

  /**
   * 枠の中から届いた音の記録 (envChunk。✨ 自動補正・音量バランスのどちらが始めたものでも、ここで 1 回だけ足す)。
   * YouTube のアーカイブ・動画は、その動画の波形 (〰 と同じ。保存する) に、ライブ・Twitch はこの画面の間だけ覚える
   */
  function chunk(i, d) {
    if (!state.tiles[i]?.videoId || !hasWaves()) return;
    rec(i).blocked = false;
    const w = waveId(i);
    if (w) {
      Waves.feed(w, d).catch(() => {});
      return;
    }
    const m = memId(i);
    if (!m) return;
    const list = liveSteps.get(m) || [];
    for (const [s, n] of Waves.stepsOf(d).values()) if (n > 0 && s > 0) list.push(binOf(toDb(s / n)));
    const keep = LIVE_KEEP_SEC / STEP_SEC;
    if (list.length > keep) list.splice(0, list.length - keep);
    liveSteps.set(m, list);
    dirty.add(m);
  }

  /** 枠の中で音の記録を始められなかった (ブラウザが音の処理を止めているなど) */
  function onLevel(i, data) {
    if (data.ok !== false || !conf().auto) return;
    const r = rec(i);
    if (!r.blocked) {
      r.blocked = true;
      render();
    }
  }

  /** 1 秒ごと: 自動の倍率を、そろえたい値へ少しずつ近づける。記録を頼むかが変わった枠には知らせ直す */
  function tick() {
    if (!conf().auto) return;
    const list = visibleIndexes().filter((i) => mixable(i) && audible(i) && ready(i));
    let target = null;
    if (list.length >= 2) {
      const dbs = list.map((i) => statOf(i).db).sort((a, b) => a - b);
      const m = dbs.length >> 1;
      target = dbs.length % 2 ? dbs[m] : (dbs[m - 1] + dbs[m]) / 2;
    }
    let changed = false;
    for (const i of list) {
      const r = rec(i);
      const want = target == null ? 1 : Math.max(AUTO_MIN, Math.min(AUTO_MAX, fromDb(target - statOf(i).db)));
      const cur = toDb(r.auto);
      const step = Math.max(-STEP_DB, Math.min(STEP_DB, toDb(want) - cur));
      if (Math.abs(step) < 0.05) continue;
      r.auto = fromDb(cur + step);
      apply(i);
      changed = true;
    }
    for (let i = 0; i < MAX_TILES; i++) {
      if (state.tiles[i].videoId && (sentLevel.get(i) ?? false) !== levelOn(i)) apply(i);
    }
    if (changed || el?.matches(':popover-open')) render();
  }

  function setAuto(on) {
    conf().auto = !!on;
    clearInterval(timer);
    timer = 0;
    if (conf().auto) timer = setInterval(tick, 1000);
    else for (const r of tiles.values()) r.auto = 1;
    applyAll();
    save();
    refresh();
  }
  function setFocus(i) {
    conf().focus = conf().focus === i ? null : i;
    applyAll();
    save();
    refresh();
  }
  function setDuck(v) {
    conf().duck = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    applyAll();
    save();
    refresh();
  }

  /** 枠の音・中身・並びが変わったとき (updateNowPlaying から): 主役の見直し・ボタンとパネルの書き換え */
  function refresh() {
    const c = conf();
    if (!c) return;
    if (c.focus != null && !tileFilled(state.tiles[c.focus])) {
      c.focus = null;
      applyAll();
      save();
    }
    if (c.auto && !timer) timer = setInterval(tick, 1000);
    const btn = document.getElementById('openVolume');
    if (btn) btn.classList.toggle('on', c.auto || c.focus != null);
    render();
  }

  // ---- パネル
  function setup() {
    el = document.getElementById('volumeMenu');
    const head = document.createElement('div');
    head.className = 'vol-head';
    head.textContent = tr('volHead');
    const top = document.createElement('div');
    top.className = 'vol-top';
    const auto = document.createElement('button');
    auto.type = 'button';
    auto.className = 'vol-auto';
    auto.textContent = tr('volAuto');
    auto.title = tr('volAutoTitle');
    auto.addEventListener('click', () => setAuto(!conf().auto));
    const duckWrap = document.createElement('label');
    duckWrap.className = 'vol-duck-wrap';
    duckWrap.title = tr('volDuckTitle');
    const duck = document.createElement('input');
    duck.type = 'range';
    duck.className = 'vol-duck';
    duck.min = '0';
    duck.max = '100';
    duck.step = '5';
    duck.addEventListener('input', () => setDuck(Number(duck.value) / 100));
    const duckValue = document.createElement('span');
    duckValue.className = 'vol-duck-value';
    duckWrap.append(tr('volDuck'), duck, duckValue);
    top.append(auto, duckWrap);
    const rows = document.createElement('div');
    rows.className = 'vol-rows';
    const empty = document.createElement('div');
    empty.className = 'vol-empty';
    empty.textContent = tr('volEmpty');
    el.append(head, top, rows, empty);

    rows.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      const i = Number(b?.closest('.vol-row')?.dataset.i);
      if (!b || !Number.isInteger(i)) return;
      if (b.classList.contains('vol-star')) setFocus(i);
      else if (b.classList.contains('vol-mute')) setAudio(i, { on: state.tiles[i].muted });
    });
    rows.addEventListener('input', (e) => {
      const range = e.target.closest('.vol-gain');
      const i = Number(range?.closest('.vol-row')?.dataset.i);
      if (range && Number.isInteger(i)) setMix(i, { gain: Number(range.value) / 100 });
    });
    el.addEventListener('toggle', (e) => {
      if (e.newState === 'open') {
        rowKey = '';
        render();
        return;
      }
      anchorBtn?.style.removeProperty('anchor-name');
      anchorBtn = null;
    });
  }

  /**
   * 上部バーの 🎚 音量 / V キー: 開く ⇄ 閉じる。
   * ボタンで開いているときに押すと、外側のクリックとしてボタンを離した時点で先に閉じるので、
   * 押し始め (pointerdown) に開いていたかを覚えておき、開いていたなら開き直さない (もう一度押したら閉じる)
   */
  function toggle({ wasOpen = false } = {}) {
    if (!el) return;
    if (el.matches(':popover-open')) {
      el.hidePopover();
      return;
    }
    if (wasOpen) return;
    const btn = document.getElementById('openVolume');
    anchorBtn = btn;
    btn.style.setProperty('anchor-name', '--volume-anchor');
    el.showPopover();
  }

  function buildRow(i) {
    const row = document.createElement('div');
    row.className = 'vol-row';
    row.dataset.i = String(i);
    const num = document.createElement('b');
    num.className = 'vol-num';
    const name = document.createElement('span');
    name.className = 'vol-name';
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'vol-star';
    star.textContent = '★';
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'vol-mute';
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'vol-gain';
    range.min = '0';
    range.max = '200';
    range.step = '5';
    const value = document.createElement('span');
    value.className = 'vol-value';
    row.append(num, name, star, mute, range, value);
    return row;
  }

  function render() {
    if (!el?.matches(':popover-open')) return;
    const c = conf();
    const auto = el.querySelector('.vol-auto');
    auto.classList.toggle('on', c.auto);
    auto.setAttribute('aria-pressed', String(c.auto));
    const duck = el.querySelector('.vol-duck');
    if (document.activeElement !== duck) duck.value = String(pct(c.duck));
    duck.disabled = c.focus == null;
    el.querySelector('.vol-duck-value').textContent = `${pct(c.duck)}%`;

    const list = visibleIndexes().filter((i) => tileFilled(state.tiles[i]));
    const rows = el.querySelector('.vol-rows');
    const key = list.join(',');
    if (key !== rowKey) {
      rowKey = key;
      rows.replaceChildren(...list.map(buildRow));
    }
    el.querySelector('.vol-empty').hidden = list.length > 0;
    for (const row of rows.children) {
      const i = Number(row.dataset.i);
      const t = state.tiles[i];
      const ok = mixable(i);
      row.querySelector('.vol-num').textContent = String(displayNumber(i));
      const name = row.querySelector('.vol-name');
      name.textContent = tileName(i) || tr('loadingName');
      name.title = name.textContent;
      row.classList.toggle('muted', t.muted);
      const star = row.querySelector('.vol-star');
      const isFocus = c.focus === i;
      star.classList.toggle('on', isFocus);
      star.setAttribute('aria-pressed', String(isFocus));
      star.disabled = !ok;
      star.title = ok ? tr(isFocus ? 'volStarOffTitle' : 'volStarTitle') : tr('volNoMix');
      const mute = row.querySelector('.vol-mute');
      mute.textContent = t.muted ? '🔇' : '🔊';
      mute.classList.toggle('on', !t.muted);
      mute.title = tr(t.muted ? 'volUnmuteTitle' : 'volMuteTitle');
      const range = row.querySelector('.vol-gain');
      if (document.activeElement !== range) range.value = String(pct(t.gain));
      range.disabled = !ok;
      range.title = ok ? tr('volGainTitle') : tr('volNoMix');
      const value = row.querySelector('.vol-value');
      value.title = '';
      if (!ok) {
        value.textContent = '';
        continue;
      }
      const r = rec(i);
      let text = `${pct(t.gain)}%`;
      if (c.auto && !t.muted && r.blocked && !ready(i)) {
        text += ` ${tr('volBlocked')}`;
        value.title = tr('volBlockedTitle');
      } else if (c.auto && !t.muted && !ready(i)) {
        text += ` ${tr('volMeasuring')}`;
      } else {
        const eff = gainOf(i);
        if (pct(eff) !== pct(t.gain)) text += ` → ${pct(eff)}%`;
      }
      value.textContent = text;
    }
  }

  return { normalize, gainOf, levelOn, chunk, onLevel, refresh, setup, toggle };
})();
