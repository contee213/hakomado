// hakomado: 初めて使うときのツアー (画面の各部分を順に明るく切り抜き、吹き出しで説明する)。
// インストール直後だけ自動で始まり (background.js が tourPending を立てる)、バージョンアップでは出ない。
// 使い方 (?) の画面から、いつでももう一度見られる。
// 吹き出し (説明) は対象の近くに出して矢印で指し、操作のボタン (スキップ・戻る・次へ) は
// 画面の下の真ん中に固定する。マウスを動かさずに「次へ」を押し続けられるように。
/* global tr, openFavorites */
/* exported Tour */
const Tour = (() => {
  'use strict';

  // key = 吹き出しの文言 (key + 'T' が見出し)、short = 下のバーのステップ一覧に出す短い名前
  // target = 明るくする要素 (関数で返す。配列なら全部を囲む範囲。無ければ画面の真ん中に吹き出しだけ出す)
  // uses = ようこそで並べる、代表的な使い方 ([見出し, 説明] の組)
  const STEPS = [
    {
      key: 'tourWelcome',
      short: 'tourWelcomeS',
      uses: [
        ['tourUseLiveT', 'tourUseLive'],
        ['tourUseSyncT', 'tourUseSync'],
        ['tourUseLeaveT', 'tourUseLeave'],
      ],
    },
    { key: 'tourPick', short: 'tourPickS', target: () => [firstTile()?.querySelector('.url-input'), firstTile()?.querySelector('.empty-actions')] },
    // 枠の操作バーはマウスを乗せないと出ないので、ツアー中は見本のバーを枠の上に出して見せる
    { key: 'tourTile', short: 'tourTileS', target: () => mockBar, enter: showMockBar, leave: hideMockBar },
    { key: 'tourLayout', short: 'tourLayoutS', target: () => ['openLayout', 'addTile', 'removeTile'].map((id) => document.getElementById(id)) },
    // チャンネル・ライブラリは、その画面を実際に開いて見せる (見せるだけで、ツアー中は押せない)
    { key: 'tourChannels', short: 'tourChannelsS', target: screenEl, enter: () => showScreen('channels'), leave: hideScreen },
    { key: 'tourLibrary', short: 'tourLibraryS', target: screenEl, enter: () => showScreen('library'), leave: hideScreen },
    // 最後は自動再生のボタンを実際に押してもらう (押すとツアーを閉じて自動再生が始まる)。
    // 途中で押すとレイアウトや空き枠が変わって説明と合わなくなるので、最後の一歩にする
    { key: 'tourAuto', short: 'tourAutoS', target: () => document.getElementById('autoMode'), action: true },
  ];
  const PAD = 6; // 明るくする範囲の余白
  const GAP = 18; // 対象と吹き出しの間 (吹き出しの矢印が入る分)
  const EDGE = 8; // 画面の端と吹き出しの間
  const TAIL_MIN = 22; // 吹き出しの角から矢印までの最小の距離

  const firstTile = () => [...document.querySelectorAll('#grid .tile')].find((t) => !t.hidden);

  let root = null;
  let spot = null;
  let tip = null;
  let tipBody = null;
  let dock = null;
  let skipBtn = null;
  let backBtn = null;
  let nextBtn = null;
  let stepsEl = null;
  let countEl = null;
  let index = 0;
  let onDone = null;
  let mockBar = null;
  let entered = null; // enter() を呼んだステップ (離れるときに leave() を呼ぶ)

  /** 本物と同じ部品で作った見本の操作バーを、枠 1 の上に出す (見せるだけで押せない) */
  function showMockBar() {
    const tile = firstTile();
    const tpl = document.getElementById('tileTemplate')?.content.querySelector('.bar');
    if (!tile || !tpl) return;
    mockBar = tpl.cloneNode(true);
    mockBar.classList.add('tour-mock-bar');
    mockBar.removeAttribute('draggable');
    mockBar.querySelector('.index').textContent = '1';
    mockBar.querySelector('.tile-name').textContent = tr('tourMockName');
    const audio = mockBar.querySelector('[data-act="audio"]');
    audio.textContent = '🔊';
    audio.classList.add('on', 'tour-pulse-btn');
    mockBar.querySelector('[data-act="danmaku"]')?.classList.add('on');
    for (const b of mockBar.querySelectorAll('.social')) b.remove();
    tile.querySelector('.stage').appendChild(mockBar);
  }

  function hideMockBar() {
    mockBar?.remove();
    mockBar = null;
  }

  // チャンネル / ライブラリの画面 (grid.js の openFavorites で開く、同じ 1 つのダイアログ)
  function screenEl() {
    const d = document.getElementById('favorites');
    return d?.open ? d : null;
  }

  /** 画面を、ツアーの暗い幕の下に普通に開く (モーダルで開くと最前面に出て、ツアーのボタンが押せなくなる) */
  function showScreen(view) {
    if (typeof openFavorites !== 'function') return;
    openFavorites(null, view, { modal: false });
    document.getElementById('favorites')?.classList.add('tour-preview');
  }

  function hideScreen() {
    const d = document.getElementById('favorites');
    if (!d) return;
    d.classList.remove('tour-preview');
    d.style.removeProperty('--tour-screen-h');
    if (d.open) d.close();
  }

  /** 見せている画面の高さを、下の操作バーの上までに収める (吹き出しは右に出す) */
  function fitScreen() {
    const d = screenEl();
    if (!d?.classList.contains('tour-preview')) return;
    const top = d.getBoundingClientRect().top;
    d.style.setProperty('--tour-screen-h', `${Math.max(240, Math.round(dock.getBoundingClientRect().top - top - 24))}px`);
  }

  /**
   * 文字が変わるボタン: 使う文字を全部重ねて入れ、今の 1 つだけ見せる。
   * ボタンの幅がいちばん長い文字に合うので、ステップや言語が変わっても隣のボタンの位置がずれない
   */
  function stackButton(keys, cls, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    const stack = document.createElement('span');
    stack.className = 'tour-label-stack';
    for (const key of keys) {
      const s = document.createElement('span');
      s.dataset.key = key;
      s.textContent = tr(key);
      stack.appendChild(s);
    }
    b.appendChild(stack);
    b.addEventListener('click', fn);
    return b;
  }

  function setLabel(b, key) {
    for (const s of b.querySelectorAll('.tour-label-stack > span')) s.classList.toggle('on', s.dataset.key === key);
  }

  function build() {
    root = document.createElement('div');
    root.className = 'tour';
    // 背景のクリックはツアー中は止める (誤って枠を操作しないように)
    root.addEventListener('click', (e) => e.stopPropagation());
    spot = document.createElement('div');
    spot.className = 'tour-spot';
    // 押してもらうステップでは、明るくしたボタンだけ押せる
    spot.addEventListener('click', () => {
      if (STEPS[index]?.action) act();
    });

    // 吹き出し: 説明だけを入れ、対象の近くに出して矢印 (tail) で指す
    tip = document.createElement('div');
    tip.className = 'tour-tip';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-live', 'polite');
    const tail = document.createElement('div');
    tail.className = 'tour-tail';
    tipBody = document.createElement('div');
    tip.append(tail, tipBody);

    // 操作のバー: 画面の下寄りの真ん中に固定し、どのステップでもボタンの位置を変えない。
    // 上から「使い方ツアー ・ 何番目か」「ステップの一覧 (今のところを強調、押すとそこへ移る)」「スキップ … 戻る・次へ」
    dock = document.createElement('div');
    dock.className = 'tour-dock';
    dock.setAttribute('role', 'navigation');
    dock.setAttribute('aria-label', tr('tourName'));
    const head = document.createElement('div');
    head.className = 'tour-head';
    const name = document.createElement('span');
    name.className = 'tour-name';
    const icon = document.createElement('img');
    icon.src = 'icons/icon-32.png';
    icon.alt = '';
    name.append(icon, tr('tourName'));
    countEl = document.createElement('span');
    countEl.className = 'tour-count';
    head.append(name, countEl);

    stepsEl = document.createElement('ol');
    stepsEl.className = 'tour-steps';
    STEPS.forEach((s, k) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const num = document.createElement('span');
      num.className = 'tour-step-num';
      num.textContent = String(k + 1);
      b.append(num, tr(s.short));
      b.addEventListener('click', () => go(k));
      li.appendChild(b);
      stepsEl.appendChild(li);
    });

    const row = document.createElement('div');
    row.className = 'tour-row';
    skipBtn = stackButton(['tourSkip', 'tourLater'], 'tour-skip', finish);
    const nav = document.createElement('div');
    nav.className = 'tour-nav';
    backBtn = stackButton(['tourBack'], '', () => go(index - 1));
    nextBtn = stackButton(['tourNext', 'tourDone', 'tourStart'], 'primary', () => {
      if (STEPS[index].action) act();
      else if (index === STEPS.length - 1) finish();
      else go(index + 1);
    });
    nav.append(backBtn, nextBtn);
    row.append(skipBtn, nav);
    dock.append(head, stepsEl, row);

    root.append(spot, tip, dock);
    document.body.appendChild(root);
  }

  function render() {
    const step = STEPS[index];
    if (entered !== step) {
      entered?.leave?.();
      step.enter?.();
      entered = step;
    }
    const last = index === STEPS.length - 1;
    spot.classList.toggle('action', !!step.action);

    const title = document.createElement('h3');
    title.textContent = tr(step.key + 'T');
    const body = document.createElement('p');
    body.textContent = tr(step.key);
    const parts = [title, body];
    // 最初のようこそは大きなアイコン付きで大きく出し、代表的な使い方を並べる
    tip.classList.toggle('hero', !step.target);
    if (!step.target) {
      const logo = document.createElement('img');
      logo.className = 'tour-logo';
      logo.src = 'icons/icon-128.png';
      logo.alt = '';
      parts.unshift(logo);
    }
    if (step.uses) {
      const list = document.createElement('ul');
      list.className = 'tour-uses';
      for (const [t, d] of step.uses) {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = tr(t);
        const span = document.createElement('span');
        span.textContent = tr(d);
        li.append(b, span);
        list.appendChild(li);
      }
      parts.push(list);
    }
    tipBody.replaceChildren(...parts);
    // ステップが変わるたびに、ふわっと出る動きをもう一度
    tip.classList.remove('enter');
    void tip.offsetWidth;
    tip.classList.add('enter');

    // 最後 (押してもらうステップ) は「あとで」で、押さずに終わることもできる
    setLabel(skipBtn, step.action ? 'tourLater' : 'tourSkip');
    setLabel(backBtn, 'tourBack');
    setLabel(nextBtn, step.action ? 'tourStart' : last ? 'tourDone' : 'tourNext');
    // 最初は戻れないが、場所は残す (次へ の位置を動かさない)
    backBtn.classList.toggle('placeholder', index === 0);
    backBtn.disabled = index === 0;
    nextBtn.classList.toggle('action', !!step.action);
    // ステップの一覧: 済んだところ・今のところ・この先 を見分けられるように
    [...stepsEl.children].forEach((li, k) => {
      li.classList.toggle('done', k < index);
      li.classList.toggle('on', k === index);
      const b = li.firstChild;
      if (k === index) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.querySelector('.tour-step-num').textContent = k < index ? '✓' : String(k + 1);
    });
    countEl.textContent = `${index + 1} / ${STEPS.length}`;

    place();
    nextBtn.focus({ preventScroll: true });
  }

  /** 明るくする範囲と吹き出しの位置を、今の画面に合わせて決める */
  function place() {
    if (!root) return;
    fitScreen();
    const r = targetRect(STEPS[index].target?.());
    const vw = window.innerWidth;
    // 吹き出しは下の操作バーに重ねない
    const floor = Math.min(window.innerHeight, dock.getBoundingClientRect().top) - EDGE;
    if (!r) {
      // 対象が無い (ようこそ など): 画面全体を暗くして、真ん中に出す
      Object.assign(spot.style, { left: `${vw / 2}px`, top: `${floor / 2}px`, width: '0px', height: '0px' });
      spot.classList.add('none');
    } else {
      spot.classList.remove('none');
      Object.assign(spot.style, {
        left: `${r.left - PAD}px`,
        top: `${r.top - PAD}px`,
        width: `${r.width + PAD * 2}px`,
        height: `${r.height + PAD * 2}px`,
      });
    }
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left;
    let top;
    let side = 'none'; // 吹き出しから見て対象がある向き (その辺に矢印を出す)
    if (!r) {
      left = (vw - tw) / 2;
      top = (floor - th) / 2;
    } else {
      // 下 → 上 → 右 → 左 の順に、入るところへ出す。どこも無理なら対象の中 (大きい枠など)
      const out = PAD + GAP;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (r.bottom + out + th <= floor) [left, top, side] = [cx - tw / 2, r.bottom + out, 'up'];
      else if (r.top - out - th >= EDGE) [left, top, side] = [cx - tw / 2, r.top - out - th, 'down'];
      else if (r.right + out + tw <= vw - EDGE) [left, top, side] = [r.right + out, cy - th / 2, 'left'];
      else if (r.left - out - tw >= EDGE) [left, top, side] = [r.left - out - tw, cy - th / 2, 'right'];
      else [left, top] = [cx - tw / 2, r.top + (r.height - th) / 2];
    }
    left = Math.min(Math.max(EDGE, left), vw - tw - EDGE);
    top = Math.max(EDGE, Math.min(top, floor - th));
    if (r && side !== 'none') {
      // 矢印は対象の真ん中を指す (吹き出しの角には寄せすぎない)
      const vertical = side === 'up' || side === 'down';
      const along = vertical ? r.left + r.width / 2 - left : r.top + r.height / 2 - top;
      const size = vertical ? tw : th;
      tip.style.setProperty('--tail', `${Math.round(Math.min(Math.max(TAIL_MIN, along), size - TAIL_MIN))}px`);
    }
    tip.dataset.side = side;
    Object.assign(tip.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  }

  /** 対象 (1 つか配列) を囲む範囲。見えている要素が無ければ null */
  function targetRect(t) {
    const rects = [].concat(t || []).filter((el) => el && el.getClientRects().length).map((el) => el.getBoundingClientRect());
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function go(k) {
    index = Math.max(0, Math.min(STEPS.length - 1, k));
    render();
  }

  function onKey(e) {
    if (!root) return;
    // ツアー中は画面のキー操作 (数字キーなど) を止める
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < STEPS.length - 1) go(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    }
  }

  /** 押してもらうステップ: ツアーを閉じて、明るくしていたボタンを押す */
  function act() {
    const el = STEPS[index].target?.();
    finish();
    el?.click();
  }

  function finish() {
    if (!root) return;
    entered?.leave?.();
    entered = null;
    root.remove();
    root = spot = tip = tipBody = dock = null;
    skipBtn = backBtn = nextBtn = stepsEl = countEl = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    onDone?.();
    onDone = null;
  }

  /** ツアーを始める (表示中なら最初から) */
  function start({ done } = {}) {
    if (root) finish();
    onDone = done || null;
    index = 0;
    build();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    render();
  }

  return { start };
})();
