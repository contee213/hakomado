// 画面の切り替え。上部バーは固定の枠で、その下の中身 (一覧・セット・投稿) だけを入れ替える (ページは読み込み直さない)。
// - 一覧は隠しても残しておくので、セットを見て戻っても、読み込んだ所 (もっと見る) とスクロールの位置がそのまま
// - URL は今までどおり (/ ・ /s/:id ・ /post)。ブラウザの戻る・進むも使え、どの URL を直接開いても同じ画面になる
// - このサイトの中のリンク (<a href>) は、ここで受けて中身を入れ替える。ほかのサイトへのリンクと新しいタブはそのまま
/* global BAR, LIST, SET_VIEW, POST_VIEW, ME_VIEW, t */
/* exported APP */
'use strict';

const APP = (() => {
  const views = {
    list: document.getElementById('viewList'),
    set: document.getElementById('viewSet'),
    post: document.getElementById('viewPost'),
    me: document.getElementById('viewMe'),
    notFound: document.getElementById('viewNotFound'),
  };
  let current = '';
  let listScroll = 0; // 一覧を離れたときのスクロールの位置 (同じ条件で戻ったら戻す)

  /** URL がどの画面か (このサイトの画面でなければ null) */
  function match(url) {
    if (url.origin !== location.origin) return null;
    if (url.pathname === '/') return { view: 'list' };
    const m = url.pathname.match(/^\/s\/([A-Za-z0-9]{8})\/?$/);
    if (m) return { view: 'set', id: m[1] };
    if (/^\/post\/?$/.test(url.pathname)) return { view: 'post' };
    if (/^\/me\/?$/.test(url.pathname)) return { view: 'me' };
    return null;
  }

  function show(url) {
    const route = match(url) || { view: 'notFound' };
    if (current === 'list' && route.view !== 'list') listScroll = scrollY;
    for (const [name, view] of Object.entries(views)) view.hidden = name !== route.view;
    current = route.view;
    if (route.view === 'list') {
      document.title = t('titleIndex');
      const reloaded = LIST.enter(url.search);
      scrollTo(0, reloaded ? 0 : listScroll);
    } else {
      scrollTo(0, 0);
      if (route.view === 'set') SET_VIEW.enter(route.id, url.search);
      else if (route.view === 'post') POST_VIEW.enter();
      else if (route.view === 'me') ME_VIEW.enter();
      else document.title = t('title404');
    }
    BAR.sync(route.view === 'list');
  }

  /** このサイトの中の URL へ (中身を入れ替える)。ほかのサイトならページごと移る */
  function go(href, { replace = false } = {}) {
    const url = new URL(href, location.href);
    if (!match(url)) {
      location.href = url.href;
      return;
    }
    const path = url.pathname + url.search;
    if (path === location.pathname + location.search && current === 'list') {
      scrollTo(0, 0); // 今の一覧と同じ (ロゴなど) なら、いちばん上へ
      return;
    }
    if (path !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', path);
    show(url);
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (!match(url)) return;
    e.preventDefault();
    go(url.href);
  });
  addEventListener('popstate', () => show(new URL(location.href)));
  history.scrollRestoration = 'manual'; // 一覧のスクロールの位置は自分で戻す

  show(new URL(location.href));
  return { go };
})();
