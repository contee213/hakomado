// 上部バー (拡張機能の上部バーと同じく 1 行): ロゴ・検索・新着/人気・タグ・✕ (絞り込みの解除) … ＋ 投稿
// 上部バーは固定の枠で、その下の中身だけが入れ替わる (js/app.js)。バーが持つのは一覧の条件 (並び順・タグ・検索の語) で、
// 条件を変えると一覧に切り替わる。セットや投稿の画面でもバーには今の一覧の条件が出て、ロゴを押すとその一覧に戻る。
// 404 のページのように app.js の無いページでは、普通にページを移る。
// 検索は機能フラグ search、タグは tags がオンのときだけ出す。先に js/i18n.js と js/common.js を読み込んでおく
/* global api, el, t, FEAT, APP */
/* exported BAR */
'use strict';

const BAR = (() => {
  const LIST_KEY = 'hakomado-feed:list'; // このタブで最後に見た一覧の条件 (読み込み直したり、セットのリンクを直接開いたときに使う)

  function parse(search) {
    const p = new URLSearchParams(search);
    return {
      sort: p.get('sort') === 'popular' ? 'popular' : 'new',
      tag: FEAT.tags ? (p.get('tag') || '').trim() : '',
      q: FEAT.search ? (p.get('q') || '').trim() : '',
    };
  }
  function savedSearch() {
    try {
      const v = sessionStorage.getItem(LIST_KEY) || '';
      return /^\/(\?|$)/.test(v) ? v.slice(1) : '';
    } catch {
      return '';
    }
  }
  const state = parse(location.pathname === '/' ? location.search : savedSearch());

  /** 一覧の URL (今の条件に over を重ねたもの) */
  function listUrl(over = {}) {
    const s = { ...state, ...over };
    const p = new URLSearchParams();
    if (s.sort !== 'new') p.set('sort', s.sort);
    if (s.tag) p.set('tag', s.tag);
    if (s.q) p.set('q', s.q);
    const str = p.toString();
    return str ? `/?${str}` : '/';
  }
  const go = (over) => {
    const url = listUrl(over);
    if (typeof APP !== 'undefined') APP.go(url);
    else location.href = url;
  };

  const logo = document.querySelector('.top .brand');
  const nodes = [];

  let input = null;
  if (FEAT.search) {
    input = el('input', { type: 'search', id: 'barQ', maxlength: '100', placeholder: t('searchPlaceholder'), 'aria-label': t('searchLabel') });
    const form = el('form', { id: 'barSearch', class: 'search', role: 'search' }, input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      input.blur();
      go({ q: input.value.trim() });
    });
    nodes.push(form);
  }

  const tabs = ['new', 'popular'].map((s) => el('button', { type: 'button', role: 'tab', 'data-sort': s, text: t(s === 'new' ? 'sortNew' : 'sortPopular') }));
  for (const tb of tabs) tb.addEventListener('click', () => go({ sort: tb.dataset.sort }));
  nodes.push(el('div', { class: 'tabs', role: 'tablist', 'aria-label': t('sortLabel') }, ...tabs));

  let select = null;
  let topTags = [];
  const option = (value, label) => el('option', { value, text: label });
  /** タグの選択肢 (よく使われているタグ。絞り込み中のタグが上位に無くても出す) */
  function fillTags() {
    const list = topTags.map((x) => option(x.tag, `#${x.tag} (${x.count})`));
    if (state.tag && !topTags.some((x) => x.tag === state.tag)) list.unshift(option(state.tag, `#${state.tag}`));
    select.replaceChildren(option('', t('tagsAll')), ...list);
    select.value = state.tag;
  }
  if (FEAT.tags) {
    select = el('select', { id: 'barTag', class: 'tag-select', 'aria-label': t('tagsLabel') });
    select.addEventListener('change', () => go({ tag: select.value }));
    nodes.push(select);
    fillTags();
    api('/api/tags')
      .then(({ tags }) => {
        topTags = tags;
        fillTags();
      })
      .catch(() => {});
  }

  const clear = el('a', { id: 'barClear', class: 'btn icon-only', 'aria-label': t('filterClear'), title: t('filterClear'), text: '✕' });
  nodes.push(clear, el('span', { class: 'spacer' }));
  logo.after(...nodes);

  /**
   * バーの表示を今の条件に合わせる。onList = 一覧を出しているか
   * (一覧ではロゴは条件なしの一覧へ、ほかの画面では今の条件の一覧へ戻る)
   */
  function sync(onList) {
    if (input && document.activeElement !== input) input.value = state.q;
    for (const tb of tabs) tb.setAttribute('aria-selected', String(tb.dataset.sort === state.sort));
    if (select) fillTags();
    clear.hidden = !(state.tag || state.q);
    clear.href = listUrl({ tag: '', q: '' });
    logo.href = onList ? '/' : listUrl();
    logo.title = onList ? '' : t('backToList');
  }

  /** 一覧の URL の条件をバーに入れる (変わったら true) */
  function setFromSearch(search) {
    const next = parse(search);
    const changed = next.sort !== state.sort || next.tag !== state.tag || next.q !== state.q;
    Object.assign(state, next);
    try {
      sessionStorage.setItem(LIST_KEY, listUrl());
    } catch {
      // 覚えられなくても、このページを開いている間は使える
    }
    return changed;
  }

  sync(location.pathname === '/');
  return { state, listUrl, sync, setFromSearch };
})();
