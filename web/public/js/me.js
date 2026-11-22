// 自分の投稿 (/me。X でログインした人だけ)。限定公開・通報で隠れたものも出す。ログアウトと「X との連携を消す」もここ。
// 画面の切り替えは js/app.js が ME_VIEW.enter を呼ぶ
/* global api, el, setCard, errorText, t, ACCOUNT, APP */
/* exported ME_VIEW */
'use strict';

const ME_VIEW = (() => {
  const $ = (x) => document.getElementById(x);
  let page = 0;
  let run = 0;

  function card(set) {
    const c = setCard(set);
    const badges = [set.listed === false ? t('badgeUnlisted') : '', set.hidden ? t('badgeHidden') : ''].filter(Boolean);
    if (badges.length) c.querySelector('.card-title').append(...badges.map((b) => el('span', { class: 'card-badge', text: b })));
    return c;
  }

  async function load(mine) {
    $('meMore').hidden = true;
    $('meListStatus').textContent = t('loading');
    try {
      const r = await api(`/api/me/sets?page=${page}`);
      if (mine !== run) return;
      $('meGrid').append(...r.sets.map(card));
      $('meMore').hidden = !r.more;
      $('meListStatus').textContent = $('meGrid').children.length ? '' : t('meEmpty');
    } catch (e) {
      if (mine === run) $('meListStatus').textContent = errorText(e.message);
    }
  }

  $('meMore').addEventListener('click', () => {
    page++;
    load(run);
  });
  $('logout').addEventListener('click', async () => {
    try {
      await api('/auth/logout', {});
    } catch {
      // 失敗しても上部バーを出し直す (Cookie が残っていればログインのまま)
    }
    await ACCOUNT.reset();
    APP.go('/');
  });
  $('unlink').addEventListener('click', async () => {
    if (!confirm(t('confirmUnlink'))) return;
    try {
      await api('/api/me/unlink', {});
      await ACCOUNT.reset();
      alert(t('unlinked'));
      APP.go('/');
    } catch (e) {
      alert(errorText(e.message));
    }
  });

  return {
    async enter() {
      const mine = ++run;
      document.title = `${t('meH')} | Hakomado`;
      $('meBox').hidden = true;
      $('meGrid').replaceChildren();
      $('meStatus').textContent = t('loading');
      const user = await ACCOUNT.me();
      if (mine !== run) return;
      if (!user) {
        // ログインしていない: X のログインへ (終わったらここに戻る)
        $('meStatus').replaceChildren(el('a', { class: 'btn', href: ACCOUNT.loginUrl() }, el('img', { class: 'x-logo', src: '/img/x-logo.svg', alt: '' }), ` ${t('loginX')}`));
        return;
      }
      $('meStatus').textContent = '';
      $('meAvatar').src = user.avatar || '';
      $('meAvatar').hidden = !user.avatar;
      $('meName').textContent = user.name || user.username;
      $('meHandle').textContent = `@${user.username}`;
      $('meHandle').href = `https://x.com/${encodeURIComponent(user.username)}`;
      $('meBox').hidden = false;
      page = 0;
      load(mine);
    },
  };
})();
