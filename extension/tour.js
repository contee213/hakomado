// hakomado: 初めて使うときのツアー (画面の各部分を順に明るく切り抜き、吹き出しで説明する)。
// インストール直後だけ自動で始まり (background.js が tourPending を立てる)、バージョンアップでは出ない。
// 使い方 (📖) の画面から、いつでももう一度見られる。
// 吹き出し (説明) は対象の近くに出して矢印で指す。吹き出しでも暗い画面でも、どこを押しても次へ進む。
// 最後 (自動再生) だけは吹き出しの中にも「自動再生をはじめる」を置き、それと明るくしたボタン以外を押すと
// 「あとで」と同じく押さずに終わる。
// 最初のようこそだけは画面の真ん中に大きく出し、スキップ・次へも吹き出しの中に置く。
// 2 つめからは、進み具合と操作のボタン (戻る・次へ・スキップ) を右下の縦長のパネルに固定する。
// マウスを動かさずに「次へ」を押し続けられるように。
/* global tr, openFavorites, Sync */
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
        ['tourUseSyncT', 'tourUseSync', 'sync'], // 3 つ目 = 同期のコードが入っているときだけ (リリース版では出さない。HAKO-51)
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
  let heroNav = null;
  let heroNext = null;
  let actNav = null;
  let actBtn = null;
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
    audio.textContent = '🎧';
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

  /** 見せている画面の高さを、画面の下端の少し上までに収める (吹き出しは右に出す) */
  function fitScreen() {
    const d = screenEl();
    if (!d?.classList.contains('tour-preview')) return;
    const top = d.getBoundingClientRect().top;
    d.style.setProperty('--tour-screen-h', `${Math.max(240, Math.round(window.innerHeight - top - 24))}px`);
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
    // 画面 (暗い幕・吹き出し) のどこを押しても次へ。下の枠には届かせない (誤って枠を操作しないように)。
    // 押してもらう最後のステップでは、明るくしたボタンなら押す、それ以外なら「あとで」と同じく押さずに終わる
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('button, .tour-dock')) return;
      if (!STEPS[index].action) next();
      else if (e.target === spot) act();
      else finish();
    });
    spot = document.createElement('div');
    spot.className = 'tour-spot';

    // 吹き出し: 説明だけを入れ、対象の近くに出して矢印 (tail) で指す
    tip = document.createElement('div');
    tip.className = 'tour-tip';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-live', 'polite');
    const tail = document.createElement('div');
    tail.className = 'tour-tail';
    tipBody = document.createElement('div');
    // ようこそだけ: 吹き出しの中にスキップ・次へを置く
    heroNav = document.createElement('div');
    heroNav.className = 'tour-hero-nav';
    const heroSkip = stackButton(['tourSkip'], 'tour-skip', finish);
    setLabel(heroSkip, 'tourSkip');
    heroNext = stackButton(['tourNext'], 'primary', next);
    setLabel(heroNext, 'tourNext');
    heroNav.append(heroSkip, heroNext);
    // 最後 (押してもらうステップ) だけ: 吹き出しの中にも「自動再生をはじめる」を置く (吹き出ししか見ない人でも押せるように)
    actNav = document.createElement('div');
    actNav.className = 'tour-hero-nav tour-act-nav';
    actBtn = stackButton(['tourStart'], 'primary action', act);
    setLabel(actBtn, 'tourStart');
    actNav.appendChild(actBtn);
    tip.append(tail, tipBody, heroNav, actNav);

    // 進み具合と操作のパネル: 右下に縦長で固定し、どのステップでもボタンの位置を変えない (ようこその間は出さない)。
    // 上から「使い方ツアー ・ 何番目か」「ステップの一覧 (今のところを強調、押すとそこへ移る)」「戻る・次へ」「スキップ」
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
      else next();
    });
    nav.append(backBtn, nextBtn);
    row.append(nav, skipBtn);
    dock.append(head, stepsEl, row);

    root.append(spot, tip, dock);
    document.body.appendChild(root);
  }

  /** 次のステップへ (最後なら終わる) */
  function next() {
    if (index === STEPS.length - 1) finish();
    else go(index + 1);
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
    const hero = !step.target;
    tip.classList.toggle('hero', hero);
    heroNav.hidden = !hero;
    actNav.hidden = !step.action;
    dock.hidden = hero;
    if (hero) {
      const logo = document.createElement('img');
      logo.className = 'tour-logo';
      logo.src = 'icons/icon-128.png';
      logo.alt = '';
      parts.unshift(logo);
    }
    if (step.uses) {
      const list = document.createElement('ul');
      list.className = 'tour-uses';
      for (const [t, d, only] of step.uses) {
        if (only === 'sync' && !Sync.built) continue;
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
    (hero ? heroNext : step.action ? actBtn : nextBtn).focus({ preventScroll: true });
  }

  /** 明るくする範囲と吹き出しの位置を、今の画面に合わせて決める */
  function place() {
    if (!root) return;
    fitScreen();
    const r = targetRect(STEPS[index].target?.());
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 吹き出しは右下のパネルに重ねない
    const d = dock.hidden ? null : dock.getBoundingClientRect();
    const hitsDock = (l, t) => !!d && l + tw > d.left - EDGE && t + th > d.top - EDGE && l < d.right && t < d.bottom;
    if (!r) {
      // 対象が無い (ようこそ など): 画面全体を暗くして、真ん中に出す
      Object.assign(spot.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px' });
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
    const clampX = (l) => Math.min(Math.max(EDGE, l), vw - tw - EDGE);
    const clampY = (t) => Math.max(EDGE, Math.min(t, vh - th - EDGE));
    let left;
    let top;
    let side = 'none'; // 吹き出しから見て対象がある向き (その辺に矢印を出す)
    if (!r) {
      left = (vw - tw) / 2;
      top = (vh - th) / 2;
    } else {
      // 下 → 上 → 右 → 左 の順に、入るところへ出す。パネルに重なるなら、パネルを避けてずらす。
      // どこも無理なら対象の中 (大きい枠など)
      const out = PAD + GAP;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const cands = [];
      if (r.bottom + out + th <= vh - EDGE) cands.push([clampX(cx - tw / 2), r.bottom + out, 'up']);
      if (r.top - out - th >= EDGE) cands.push([clampX(cx - tw / 2), r.top - out - th, 'down']);
      if (r.right + out + tw <= vw - EDGE) cands.push([r.right + out, clampY(cy - th / 2), 'left']);
      if (r.left - out - tw >= EDGE) cands.push([r.left - out - tw, clampY(cy - th / 2), 'right']);
      for (const [l, t, s] of cands) {
        if (!hitsDock(l, t)) {
          [left, top, side] = [l, t, s];
          break;
        }
        // 上下に出すなら左へ、左右に出すなら上へずらして、パネルを避ける
        const [l2, t2] = s === 'up' || s === 'down' ? [d.left - EDGE * 2 - tw, t] : [l, d.top - EDGE * 2 - th];
        if (l2 >= EDGE && t2 >= EDGE && !hitsDock(l2, t2)) {
          [left, top, side] = [l2, t2, s];
          break;
        }
      }
      if (side === 'none') [left, top] = [cx - tw / 2, r.top + (r.height - th) / 2];
    }
    left = clampX(left);
    top = clampY(top);
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
    skipBtn = backBtn = nextBtn = stepsEl = countEl = heroNav = heroNext = actNav = actBtn = null;
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
