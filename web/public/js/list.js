// 一覧 (新着 / 人気)。タグでの絞り込み (?tag=) と検索 (?q=) は機能フラグ tags・search がオンのときだけ
// カードはマルチビュー画面の枠のように画像で画面を埋め、上の段ほど大きく並べる:
// 大 (1 段)・中 (2 段)・それ以降は小。1 段に何枚入るかは画面の幅で決まるので、幅が変わったら並べ直す
// 条件 (並び順・タグ・検索の語) と上部バーの操作は js/bar.js (BAR)。画面の切り替えは js/app.js が LIST.enter を呼ぶ
/* global api, setCard, errorText, t, BAR */
/* exported LIST */
'use strict';

const LIST = (() => {
  const tiers = document.getElementById('grid');
  const [bigGrid, midGrid, smallGrid] = tiers.querySelectorAll('.grid');
  const status = document.getElementById('listStatus');
  const more = document.getElementById('more');
  const { state } = BAR;
  let page = 0;
  let loading = 0; // 読み込みの回数 (並び順を切り替えたら、前の読み込みの結果は捨てる)
  let cards = []; // 読み込んだカード (並び順のまま)
  let loaded = false; // 一度でも読み込んだか (一覧は隠しても残しておき、同じ条件で戻ったら読み直さない)

  /** その段の 1 行に入る枚数 (CSS の --min = カードのいちばん小さい幅) */
  function columns(grid) {
    const cs = getComputedStyle(grid);
    const min = parseFloat(cs.getPropertyValue('--min')) || 240;
    const gap = parseFloat(cs.columnGap) || 0;
    return Math.max(1, Math.floor((tiers.clientWidth + gap) / (min + gap)));
  }

  /** カードを大・中・小の段に振り分ける (大は 1 段、中は 2 段ぶん) */
  function arrange() {
    if (!tiers.clientWidth) return; // 隠している間は、出したときに並べる (ResizeObserver)
    const nBig = columns(bigGrid);
    const nMid = columns(midGrid) * 2;
    const place = (grid, list) => {
      if (list.length !== grid.children.length || list.some((c, i) => grid.children[i] !== c)) grid.replaceChildren(...list);
    };
    place(bigGrid, cards.slice(0, nBig));
    place(midGrid, cards.slice(nBig, nBig + nMid));
    place(smallGrid, cards.slice(nBig + nMid));
    // 大・中の段は大きく出すので、粗くならないよう大きいサムネイルにする (一度替えたらそのまま)
    for (const img of tiers.querySelectorAll('.big img, .mid img')) {
      if (img.src.endsWith('/mqdefault.jpg')) img.src = img.src.replace('/mqdefault.jpg', '/hqdefault.jpg');
    }
  }

  // 並べ直すのは幅が変わったときだけ (カードが増えて高さが変わったときは load が並べる)
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (!tiers.clientWidth || tiers.clientWidth === lastWidth) return; // 隠している間 (幅 0) は並べ直さない
    lastWidth = tiers.clientWidth;
    arrange();
  }).observe(tiers);

  async function load(reset) {
    const run = ++loading;
    if (reset) {
      page = 0;
      cards = [];
      arrange();
    }
    more.hidden = true;
    status.textContent = t('loading');
    const p = new URLSearchParams({ sort: state.sort, page: String(page) });
    if (state.tag) p.set('tag', state.tag);
    if (state.q) p.set('q', state.q);
    try {
      const data = await api(`/api/sets?${p}`);
      if (run !== loading) return;
      cards.push(...data.sets.map(setCard));
      arrange();
      status.textContent = cards.length ? '' : t(state.tag || state.q ? 'noResults' : 'empty');
      more.hidden = !data.more;
      page++;
    } catch (e) {
      if (run === loading) status.textContent = errorText(e.message);
    }
  }

  more.addEventListener('click', () => load(false));

  return {
    /** 一覧を出す (search = 一覧の URL の ?…)。条件が変わったか、まだ読んでいなければ読み込む。読み込んだら true */
    enter(search) {
      const changed = BAR.setFromSearch(search);
      if (loaded && !changed) return false;
      loaded = true;
      load(true);
      return true;
    },
  };
})();
