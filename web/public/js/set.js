// セットのページ (/s/:id)
/* global api, el, layoutPreview, tagLinks, errorText, savedKeys, forgetKey, copyText, timeAgo, t */
'use strict';

const id = location.pathname.match(/^\/s\/([A-Za-z0-9]{8})\/?$/)?.[1];
const $ = (x) => document.getElementById(x);
let toastTimer = 0;

function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').textContent = ''), 3000);
}

function render(set) {
  document.title = `${set.name || set.videos[0]?.title || t('unnamed')} | ${t('titleSet')}`;
  $('preview').replaceChildren(layoutPreview(set.layoutId, set.ids, { big: true }));
  $('name').textContent = set.name || set.videos[0]?.title || t('unnamed');
  $('meta').textContent = [t('count', set.ids.length), set.layoutName, set.offsets ? t('syncPlay') : '', set.author, timeAgo(set.createdAt)]
    .filter(Boolean)
    .join(' · ');
  const tags = tagLinks(set.tags);
  $('tags').replaceChildren(...tags);
  $('tags').hidden = !tags.length;
  $('unlisted').hidden = set.listed !== false;
  $('dead').hidden = !set.dead;
  $('dead').textContent = set.dead ? t('deadNote', set.dead) : '';
  $('open').href = set.link;

  $('videos').replaceChildren(
    ...set.ids.map((vid, k) => {
      const v = set.videos[k] || {};
      const off = set.offsets ? set.offsets[k] : null;
      const sync = set.offsets ? (k === set.ref ? t('syncRef') : off ? t('syncOffset', `${off > 0 ? '+' : ''}${off}`) : '') : '';
      return el(
        'li',
        v.gone ? { class: 'gone' } : {},
        el('img', { src: `https://i.ytimg.com/vi/${vid}/default.jpg`, alt: '', loading: 'lazy', width: '96', height: '72' }),
        el(
          'div',
          {},
          el('a', { href: `https://www.youtube.com/watch?v=${vid}`, target: '_blank', rel: 'noopener', text: v.title || vid }),
          el('p', { class: 'sub', text: [v.gone ? t('goneVideo') : '', v.channel, sync].filter(Boolean).join(' · ') }),
        ),
      );
    }),
  );

  $('ownDelete').hidden = !savedKeys()[set.id];
  $('set').hidden = false;
  $('status').textContent = '';
}

async function remove(key) {
  if (!confirm(t('confirmDelete'))) return;
  try {
    await api(`/api/sets/${id}/delete`, { key });
    forgetKey(id);
    $('set').hidden = true;
    $('status').textContent = t('deleted');
  } catch (e) {
    toast(errorText(e.message));
  }
}

async function start() {
  if (!id) {
    $('status').textContent = t('notFound');
    return;
  }
  let set;
  try {
    set = await api(`/api/sets/${id}`);
  } catch (e) {
    $('status').textContent = e.message === 'not_found' ? t('notFoundGone') : errorText(e.message);
    return;
  }
  render(set);
  if (new URLSearchParams(location.search).has('existed')) {
    toast(t('existedToast'));
    history.replaceState(null, '', `/s/${id}`);
  }

  // 開いた回数 (人気順に使う)。待たずにそのまま開く
  $('open').addEventListener('click', () => {
    fetch(`/api/sets/${id}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', keepalive: true }).catch(() => {});
  });
  $('copyCode').addEventListener('click', async () => toast((await copyText(set.code)) ? t('copiedCode') : t('copyFail')));
  $('copyPage').addEventListener('click', async () => toast((await copyText(`${location.origin}/s/${id}`)) ? t('copiedPage') : t('copyFail')));
  $('deleteOwn').addEventListener('click', () => remove(savedKeys()[id]));
  $('keyDelete').addEventListener('submit', (e) => {
    e.preventDefault();
    remove($('deleteKey').value.trim());
  });
  $('report').addEventListener('click', async () => {
    if (!confirm(t('confirmReport'))) return;
    try {
      await api(`/api/sets/${id}/report`, {});
      toast(t('reported'));
    } catch (e) {
      toast(errorText(e.message));
    }
  });
}

start();
