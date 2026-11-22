// 一覧 (新着 / 人気)。タグでの絞り込み (?tag=) と検索 (?q=) は機能フラグ tags・search がオンのときだけ
/* global api, el, setCard, errorText, t, FEAT */
'use strict';

const grid = document.getElementById('grid');
const status = document.getElementById('status');
const more = document.getElementById('more');
const tabs = [...document.querySelectorAll('[data-sort]')];
const params = new URLSearchParams(location.search);

let sort = params.get('sort') === 'popular' ? 'popular' : 'new';
const tag = FEAT.tags ? (params.get('tag') || '').trim() : '';
const q = FEAT.search ? (params.get('q') || '').trim() : '';
let page = 0;
let loading = 0; // 読み込みの回数 (並び順を切り替えたら、前の読み込みの結果は捨てる)

/** 今の条件の URL (並び順・タグ・検索の語) */
function pageUrl() {
  const p = new URLSearchParams();
  if (sort !== 'new') p.set('sort', sort);
  if (tag) p.set('tag', tag);
  if (q) p.set('q', q);
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

async function load(reset) {
  const run = ++loading;
  if (reset) {
    page = 0;
    grid.replaceChildren();
  }
  more.hidden = true;
  status.textContent = t('loading');
  const p = new URLSearchParams({ sort, page: String(page) });
  if (tag) p.set('tag', tag);
  if (q) p.set('q', q);
  try {
    const data = await api(`/api/sets?${p}`);
    if (run !== loading) return;
    grid.append(...data.sets.map(setCard));
    status.textContent = grid.children.length ? '' : t(tag || q ? 'noResults' : 'empty');
    more.hidden = !data.more;
    page++;
  } catch (e) {
    if (run === loading) status.textContent = errorText(e.message);
  }
}

function selectTab() {
  for (const tb of tabs) tb.setAttribute('aria-selected', String(tb.dataset.sort === sort));
}

/** よく使われているタグ (押すとそのタグで絞り込む) */
async function loadTags() {
  if (!FEAT.tags) return;
  try {
    const { tags } = await api('/api/tags');
    const box = document.getElementById('tags');
    box.replaceChildren(
      ...tags.map((x) =>
        el('a', { class: `tag${x.tag === tag ? ' on' : ''}`, href: `/?tag=${encodeURIComponent(x.tag)}`, text: `#${x.tag}` }, el('span', { class: 'n', text: String(x.count) })),
      ),
    );
  } catch {
    // タグが読めなくても一覧は出す
  }
}

for (const tb of tabs) {
  tb.addEventListener('click', () => {
    if (tb.dataset.sort === sort) return;
    sort = tb.dataset.sort;
    selectTab();
    history.replaceState(null, '', pageUrl());
    load(true);
  });
}
more.addEventListener('click', () => load(false));

// 絞り込みの表示と、検索の欄
if (tag || q) {
  document.getElementById('filter').hidden = false;
  document.getElementById('filterText').textContent = [tag && t('filterTag', tag), q && t('filterQuery', q)].filter(Boolean).join(' · ');
}
const qEl = document.getElementById('q');
qEl.value = q;
document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = qEl.value.trim();
  const p = new URLSearchParams();
  if (v) p.set('q', v);
  if (tag) p.set('tag', tag);
  location.href = p.toString() ? `/?${p}` : '/';
});

selectTab();
load(true);
loadTags();
