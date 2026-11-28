// セットの画面 (/s/:id)。画面の切り替えは js/app.js が SET_VIEW.enter を呼ぶ
/* global api, el, layoutPreview, tagLinks, errorText, savedKeys, forgetKey, copyText, timeAgo, t, thumbOf, pageOf, twitchName */
/* exported SET_VIEW */
'use strict';

const SET_VIEW = (() => {
  const $ = (x) => document.getElementById(x);
  let id = '';
  let set = null; // 出しているセット
  let run = 0; // 読み込みの回数 (別のセットに切り替えたら、前の読み込みの結果は捨てる)
  let toastTimer = 0;

  function toast(text) {
    $('setToast').textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('setToast').textContent = ''), 3000);
  }

  const titleOf = (s) => s.name || s.videos[0]?.title || t('unnamed');
  /** 本編の位置 (秒) を h:mm:ss / m:ss に (負なら − を付ける) */
  const hms = (sec) => {
    const a = Math.round(Math.abs(sec));
    const p2 = (n) => String(n).padStart(2, '0');
    const body = a >= 3600 ? `${Math.floor(a / 3600)}:${p2(Math.floor(a / 60) % 60)}:${p2(a % 60)}` : `${Math.floor(a / 60)}:${p2(a % 60)}`;
    return (sec < 0 ? '−' : '') + body;
  };

  function render(s) {
    document.title = `${titleOf(s)} | ${t('titleSet')}`;
    $('setPreview').replaceChildren(layoutPreview(s.layoutId, cellIds(s), { big: true }));
    $('name').textContent = titleOf(s);
    $('meta').textContent = [t('count', s.ids.length), s.layoutName, s.movie ? t('moviePlay') : s.offsets ? t('syncPlay') : '', s.author, timeAgo(s.createdAt)]
      .filter(Boolean)
      .join(' · ');
    const tags = tagLinks(s.tags);
    $('setTags').replaceChildren(...tags);
    $('setTags').hidden = !tags.length;
    $('setUnlisted').hidden = s.listed !== false;
    $('dead').hidden = !s.dead;
    $('dead').textContent = s.dead ? t('deadNote', s.dead) : '';
    $('open').href = s.link;

    $('videos').replaceChildren(
      ...s.ids.map((vid, k) => {
        const v = s.videos[k] || {};
        const off = s.offsets ? s.offsets[k] : null;
        const at = s.movie ? s.movie[k] : null;
        const sync = s.movie
          ? [k === s.ref ? t('syncRef') : '', at != null ? t('movieAt', hms(at)) : ''].filter(Boolean).join(' · ')
          : s.offsets
            ? k === s.ref
              ? t('syncRef')
              : off
                ? t('syncOffset', `${off > 0 ? '+' : ''}${off}`)
                : ''
            : '';
        return el(
          'li',
          v.gone ? { class: 'gone' } : {},
          thumbOf(vid)
            ? el('img', { src: thumbOf(vid), alt: '', loading: 'lazy', width: '96', height: '72' })
            : el('span', { class: 'thumb twitch', text: 'Twitch' }),
          el(
            'div',
            {},
            el('a', { href: pageOf(vid), target: '_blank', rel: 'noopener', text: v.title || v.channel || twitchName(vid) || vid }),
            el('p', { class: 'sub', text: [v.gone ? t('goneVideo') : '', v.channel, sync].filter(Boolean).join(' · ') }),
          ),
        );
      }),
      // 説明付きの空き枠 (開いた人が、ここに自分で本編などを入れる。HAKO-49)
      ...(s.notes || []).map((n) =>
        el('li', { class: 'note' }, el('span', { class: 'thumb note', text: '📝' }), el('div', {}, el('p', { text: n.text }), el('p', { class: 'sub', text: t('noteTile') }))),
      ),
    );

    // X でログインした人の投稿なら (own)、合言葉なしで消せる
    $('ownDelete').hidden = !(savedKeys()[s.id] || s.own);
    $('ownNote').textContent = s.own ? t('ownNoteX') : t('ownNote');
    $('set').hidden = false;
    $('setStatus').textContent = '';
  }

  async function remove(key) {
    if (!set || !confirm(t('confirmDelete'))) return;
    try {
      await api(`/api/sets/${id}/delete`, { key });
      forgetKey(id);
      set = null;
      $('set').hidden = true;
      $('setStatus').textContent = t('deleted');
    } catch (e) {
      toast(errorText(e.message));
    }
  }

  // ボタンは 1 回だけつなぎ、押されたときに出しているセット (id・set) に対して動く
  // 開いた回数 (人気順に使う)。待たずにそのまま開く
  $('open').addEventListener('click', () => {
    if (!id) return;
    fetch(`/api/sets/${id}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', keepalive: true }).catch(() => {});
  });
  $('copyCode').addEventListener('click', async () => set && toast((await copyText(set.code)) ? t('copiedCode') : t('copyFail')));
  $('copyPage').addEventListener('click', async () => id && toast((await copyText(`${location.origin}/s/${id}`)) ? t('copiedPage') : t('copyFail')));
  $('deleteOwn').addEventListener('click', () => remove(savedKeys()[id]));
  $('keyDelete').addEventListener('submit', (e) => {
    e.preventDefault();
    remove($('deleteKey').value.trim());
  });
  $('report').addEventListener('click', async () => {
    if (!set || !confirm(t('confirmReport'))) return;
    try {
      await api(`/api/sets/${id}/report`, {});
      toast(t('reported'));
    } catch (e) {
      toast(errorText(e.message));
    }
  });

  return {
    /** セットを出す。search に existed があれば「同じセットがもうあった」と知らせる (URL からは消す) */
    async enter(nextId, search) {
      const mine = ++run;
      id = nextId;
      set = null;
      $('set').hidden = true;
      $('manage').open = false;
      $('deleteKey').value = '';
      $('setToast').textContent = '';
      $('setStatus').textContent = t('loading');
      document.title = t('titleSet');
      let got;
      try {
        got = await api(`/api/sets/${id}`);
      } catch (e) {
        if (mine === run) $('setStatus').textContent = e.message === 'not_found' ? t('notFoundGone') : errorText(e.message);
        return;
      }
      if (mine !== run) return;
      set = got;
      render(set);
      if (new URLSearchParams(search).has('existed')) {
        toast(t('existedToast'));
        history.replaceState(history.state, '', `/s/${id}`);
      }
    },
  };
})();
