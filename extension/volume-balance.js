// hakomado: 🎚 音量バランス (HAKO-54)。上部バーの「🎚 音量」(V キー) で開くパネル (#volumeMenu) と、
// 枠に送る実際の音量の計算 (枠の音量 × 「大きさをそろえる」の自動の倍率 × 主役のときのほかの枠の割合)。
// - 枠の音量 (state.tiles[i].gain) は枠の 🎚 パネルと同じ値。ここでは書き換えない
// - 「大きさをそろえる」: ON の間、音を出している枠の音の大きさを枠の中で測り (content/mix.js の level)、
//   音を出している枠の真ん中 (中央値) の大きさに合わせる倍率を、1 秒に STEP_DB までゆっくり近づける。
//   大きさは長い平均で見て、無音・話の合間は数えないので、叫び声や一瞬の BGM では動かない。
//   測るのは枠の音量を掛ける前の音なので、倍率を変えても測る値は変わらない (行ったり来たりしない)
// - 主役 (★): 主役の枠が音を出している間、ほかの音を出している枠を duck の割合にする。主役は枠の番号 (中身) で持つので、
//   並べ替えてもついていく。枠を空にしたら外す
// - 自動の倍率は保存しない (開き直すと 1 から測り直す)。auto・focus・duck は視聴セッション (state.volume) に残す
// grid.js の state・views・tr などを使うのは呼ばれてから (読み込みの時点では使わない) なので、grid.js より前に読み込んでよい
/* exported VolumeBalance */
'use strict';

const VolumeBalance = (() => {
  const MAX_EFFECTIVE = 4; // 枠に送る音量の上限。content/mix.js の MAX_GAIN と合わせる
  const AUTO_MIN = 0.25;
  const AUTO_MAX = 4;
  const STEP_DB = 1; // 自動の倍率を 1 秒に動かす上限 (dB)
  const SILENT_DB = -55; // これより小さい 1 秒は無音として数えない
  const GATE_DB = 20; // 今の見積もりよりこれだけ小さい 1 秒は数えない (話の合間)
  const READY_SEC = 3; // これだけ測れたら、そろえる相手に入れる
  const SLOW_SEC = 15; // 長い平均の重さ (およそ秒)
  const DEFAULT_DUCK = 0.3;

  const recs = new Map(); // 枠の番号 → { vid, db, sec, auto, blocked }
  let timer = 0;
  let el = null;
  let anchorBtn = null;
  let rowKey = '';

  const pct = (g) => Math.round(g * 100);
  const toDb = (g) => 20 * Math.log10(g);
  const fromDb = (d) => 10 ** (d / 20);

  /** 保存してある値を、使える形にそろえる (applySession から) */
  function normalize(v) {
    const o = v && typeof v === 'object' ? v : {};
    const duck = Number(o.duck);
    const focus = Number.isInteger(o.focus) && o.focus >= 0 && o.focus < MAX_TILES ? o.focus : null;
    return { auto: o.auto === true, focus, duck: Number.isFinite(duck) ? Math.max(0, Math.min(1, Math.round(duck * 20) / 20)) : DEFAULT_DUCK };
  }

  const conf = () => state.volume;

  /** 枠の測った記録。別の動画にしたら作り直す */
  function rec(i) {
    const vid = state.tiles[i].videoId || '';
    let r = recs.get(i);
    if (!r || r.vid !== vid) {
      r = { vid, db: 0, sec: 0, auto: 1, blocked: false };
      recs.set(i, r);
    }
    return r;
  }

  /** 音量を変えられる枠か (YouTube・Twitch。URL の枠・ファイルの枠は枠の中の音の経路が無い) */
  const mixable = (i) => !!state.tiles[i].videoId;
  const audible = (i) => isVisible(i) && tileFilled(state.tiles[i]) && !state.tiles[i].muted;

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
  /** 枠の中で音の大きさを測るか */
  function levelOn(i) {
    return conf().auto && mixable(i) && audible(i);
  }

  function apply(i) {
    const t = state.tiles[i];
    if (!t.videoId) return;
    postToFrame(views[i].player, { hakomado: 'mix', pan: t.pan, gain: gainOf(i), delay: t.delay, level: levelOn(i) });
  }
  function applyAll() {
    for (let i = 0; i < MAX_TILES; i++) apply(i);
  }

  /** 枠の中から届いた 1 秒ぶんの音の大きさ */
  function onLevel(i, data) {
    if (!conf().auto) return;
    const r = rec(i);
    if (data.ok === false) {
      if (!r.blocked) {
        r.blocked = true;
        render();
      }
      return;
    }
    r.blocked = false;
    const ms = Number(data.ms);
    if (!(ms > 0)) return;
    const db = 10 * Math.log10(ms);
    if (db < SILENT_DB) return;
    if (r.sec >= READY_SEC && db < r.db - GATE_DB) return;
    const w = r.sec < SLOW_SEC ? 1 / (r.sec + 1) : 1 / SLOW_SEC;
    r.db = r.sec ? r.db + w * (db - r.db) : db;
    r.sec++;
  }

  /** 1 秒ごと: 自動の倍率を、そろえたい値へ少しずつ近づける */
  function tick() {
    if (!conf().auto) return;
    const ready = visibleIndexes().filter((i) => levelOn(i) && rec(i).sec >= READY_SEC);
    let target = null;
    if (ready.length >= 2) {
      const dbs = ready.map((i) => rec(i).db).sort((a, b) => a - b);
      const m = dbs.length >> 1;
      target = dbs.length % 2 ? dbs[m] : (dbs[m - 1] + dbs[m]) / 2;
    }
    let changed = false;
    for (const i of ready) {
      const r = rec(i);
      const want = target == null ? 1 : Math.max(AUTO_MIN, Math.min(AUTO_MAX, fromDb(target - r.db)));
      const cur = toDb(r.auto);
      const step = Math.max(-STEP_DB, Math.min(STEP_DB, toDb(want) - cur));
      if (Math.abs(step) < 0.05) continue;
      r.auto = fromDb(cur + step);
      apply(i);
      changed = true;
    }
    if (changed || el?.matches(':popover-open')) render();
  }

  function setAuto(on) {
    conf().auto = !!on;
    clearInterval(timer);
    timer = 0;
    if (conf().auto) timer = setInterval(tick, 1000);
    else for (const r of recs.values()) r.auto = 1;
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
      if (c.auto && !t.muted && r.blocked) {
        text += ` ${tr('volBlocked')}`;
        value.title = tr('volBlockedTitle');
      } else if (c.auto && !t.muted && r.sec < READY_SEC) {
        text += ` ${tr('volMeasuring')}`;
      } else {
        const eff = gainOf(i);
        if (pct(eff) !== pct(t.gain)) text += ` → ${pct(eff)}%`;
      }
      value.textContent = text;
    }
  }

  return { normalize, gainOf, levelOn, onLevel, refresh, setup, toggle };
})();
