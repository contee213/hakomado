// hukumado: 初めて使うときのツアー (画面の各部分を順に明るく切り抜き、吹き出しで説明する)。
// インストール直後だけ自動で始まり (background.js が tourPending を立てる)、バージョンアップでは出ない。
// 使い方 (?) の画面から、いつでももう一度見られる。
/* global tr */
/* exported Tour */
const Tour = (() => {
  'use strict';

  // target = 明るくする要素 (関数で返す。配列なら全部を囲む範囲。無ければ画面の真ん中に吹き出しだけ出す)
  const STEPS = [
    { key: 'tourWelcome' },
    { key: 'tourPick', target: () => [firstTile()?.querySelector('.url-input'), firstTile()?.querySelector('.empty-actions')] },
    // 枠の操作バーはマウスを乗せないと出ないので、ツアー中は見本のバーを枠の上に出して見せる
    { key: 'tourTile', target: () => mockBar, enter: showMockBar, leave: hideMockBar },
    { key: 'tourMore', target: () => ['openNotices', 'openChannels', 'openFavorites', 'gridFullscreen', 'openSettings', 'openHelp'].map((id) => document.getElementById(id)) },
    // 最後は自動再生のボタンを実際に押してもらう (押すとツアーを閉じて自動再生が始まる)。
    // 途中で押すとレイアウトや空き枠が変わって説明と合わなくなるので、最後の一歩にする
    { key: 'tourAuto', target: () => document.getElementById('autoMode'), action: true },
  ];
  const PAD = 6; // 明るくする範囲の余白
  const GAP = 14; // 対象と吹き出しの間

  const firstTile = () => [...document.querySelectorAll('#grid .tile')].find((t) => !t.hidden);

  let root = null;
  let spot = null;
  let tip = null;
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
    tip = document.createElement('div');
    tip.className = 'tour-tip';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-live', 'polite');
    root.append(spot, tip);
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

    const dots = document.createElement('div');
    dots.className = 'tour-dots';
    STEPS.forEach((_, k) => {
      const d = document.createElement('i');
      if (k === index) d.className = 'on';
      dots.appendChild(d);
    });

    const nav = document.createElement('div');
    nav.className = 'tour-nav';
    // 最後 (押してもらうステップ) は「あとで」で、押さずに終わることもできる
    const skip = button(step.action ? tr('tourLater') : tr('tourSkip'), 'tour-skip', finish);
    const back = button(tr('tourBack'), '', () => go(index - 1));
    back.hidden = index === 0;
    const next = step.action
      ? button(tr('tourStart'), 'primary', act)
      : button(last ? tr('tourDone') : tr('tourNext'), 'primary', () => (last ? finish() : go(index + 1)));
    nav.append(skip, back, next);

    const count = document.createElement('span');
    count.className = 'tour-count';
    count.textContent = `${index + 1} / ${STEPS.length}`;

    // 最初のようこそはアイコン付きで大きく出す
    tip.classList.toggle('hero', !step.target);
    const parts = [count, title, body, dots, nav];
    if (!step.target) {
      const logo = document.createElement('img');
      logo.className = 'tour-logo';
      logo.src = 'icons/icon-128.png';
      logo.alt = '';
      parts.unshift(logo);
    }
    tip.replaceChildren(...parts);
    place();
    next.focus({ preventScroll: true });
  }

  function button(text, cls, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    return b;
  }

  /** 明るくする範囲と吹き出しの位置を、今の画面に合わせて決める */
  function place() {
    if (!root) return;
    const r = targetRect(STEPS[index].target?.());
    const vw = window.innerWidth;
    const vh = window.innerHeight;
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
    let left;
    let top;
    if (!r) {
      left = (vw - tw) / 2;
      top = (vh - th) / 2;
    } else {
      left = r.left + r.width / 2 - tw / 2;
      // 下に入れば下、入らなければ上、どちらも無理なら対象の中 (大きい枠など)
      if (r.bottom + PAD + GAP + th <= vh - 8) top = r.bottom + PAD + GAP;
      else if (r.top - PAD - GAP - th >= 8) top = r.top - PAD - GAP - th;
      else top = Math.max(8, r.top + (r.height - th) / 2);
    }
    left = Math.min(Math.max(12, left), vw - tw - 12);
    top = Math.min(Math.max(8, top), vh - th - 8);
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
    root = spot = tip = null;
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
