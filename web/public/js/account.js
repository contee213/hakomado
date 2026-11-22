// X でログイン (機能フラグ xLogin): 上部バーの右端に「X でログイン」か、ログインしている人のアイコン (自分の投稿へ) を出す。
// ログインしている人は /api/me で 1 回だけ読み、ほかの画面 (投稿・セット・自分の投稿) は ACCOUNT.me() で使う。
// X の規約に合わせ、ログインしている人には X の @ユーザー名・アイコン・X のロゴを出す
/* global api, el, t, FEAT */
/* exported ACCOUNT */
'use strict';

const ACCOUNT = (() => {
  const slot = document.getElementById('account');
  let pending = null;

  /** ログインしている人 ({ username, name, avatar }) か null */
  function me() {
    if (!FEAT.xLogin) return Promise.resolve(null);
    pending ||= api('/api/me')
      .then((r) => r.user || null)
      .catch(() => null);
    return pending;
  }

  /** X のログインへ (終わったら今の画面に戻る) */
  const loginUrl = () => `/auth/x/login?return=${encodeURIComponent(location.pathname + location.search)}`;

  async function render() {
    if (!FEAT.xLogin || !slot) return;
    const user = await me();
    if (user) {
      const avatar = user.avatar ? el('img', { class: 'avatar', src: user.avatar, alt: '', width: '26', height: '26' }) : el('span', { class: 'avatar' });
      slot.replaceChildren(el('a', { class: 'account-link', href: '/me', title: `@${user.username}`, 'aria-label': t('meH') }, avatar));
    } else {
      slot.replaceChildren(
        el('a', { class: 'btn', href: loginUrl(), 'aria-label': t('loginX') }, el('img', { class: 'x-logo', src: '/img/x-logo.svg', alt: '' }), el('span', { class: 'tb-label', text: t('loginX') })),
      );
    }
  }

  /** ログアウト・連携を消したあと: 読み直して上部バーを出し直す */
  function reset() {
    pending = null;
    return render();
  }

  // ログインに失敗して戻ってきた (/?login=failed)。知らせて、URL からは消す
  const params = new URLSearchParams(location.search);
  if (params.get('login') === 'failed') {
    const notice = document.getElementById('loginNotice');
    notice.textContent = t('loginFailed');
    notice.hidden = false;
    params.delete('login');
    const q = params.toString();
    history.replaceState(history.state, '', location.pathname + (q ? `?${q}` : ''));
  }

  render();
  return { me, reset, loginUrl };
})();
