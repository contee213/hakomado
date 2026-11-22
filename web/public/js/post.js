// 投稿: コード・リンクを貼る (または共有画像の QR を読む) → 形を確かめて見せる → 送る
/* global api, layoutPreview, errorText, saveKey, copyText, parseShareCode, parseShareLink, LAYOUTS, jsQR, turnstile, t, CONFIG, FEAT */
'use strict';

const $ = (x) => document.getElementById(x);
const AUTHOR = 'hakomado-sets:author';
let turnstileToken = '';
let needTurnstile = false;
let sending = false;

/** 貼られたテキストを読む (サーバーと同じ読み方。送る前に形を見せるため) */
function parse(text) {
  const got = parseShareCode(text) || parseShareLink(text);
  if (!got || !got.ids.length) return { error: text.trim() ? 'not_found' : '' };
  if (!LAYOUTS.some((l) => l.id === got.layoutId)) return { error: 'bad_layout' };
  return { set: got };
}

function update() {
  const { set, error } = parse($('text').value);
  $('parseMsg').textContent = error ? errorText(error) : set ? `${t('count', set.ids.length)} · ${LAYOUTS.find((l) => l.id === set.layoutId).name}${set.name ? ` · ${set.name}` : ''}` : '';
  $('parseMsg').classList.toggle('bad', !!error);
  $('preview').hidden = !set;
  $('preview').replaceChildren(set ? layoutPreview(set.layoutId, set.ids) : '');
  $('submit').disabled = !set || sending || (needTurnstile && !turnstileToken);
}

/** 画像 (Blob) の中の QR を読む。読めなければ null (拡張機能の readQrFromImage と同じ試し方を小さくしたもの) */
async function readQr(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    const W = bmp.width;
    const H = bmp.height;
    const fit = Math.min(1, 1600 / Math.max(W, H));
    // 全体 (縮めたもの・元の大きさ)、右半分を拡大したもの (QR は右下にある)、全体を少し縮めたもの
    const tries = [
      [[0, 0, 1, 1], fit],
      [[0, 0, 1, 1], 1],
      [[0.5, 0, 0.5, 1], Math.min(2, 1600 / Math.max(W / 2, H))],
      [[0, 0, 1, 1], fit * 0.75],
    ];
    const seen = new Set();
    for (const [[rx, ry, rw, rh], k] of tries) {
      const sx = Math.round(W * rx);
      const sy = Math.round(H * ry);
      const sw = Math.round(W * rw);
      const sh = Math.round(H * rh);
      const w = Math.round(sw * k);
      const h = Math.round(sh * k);
      const key = `${sx},${sy},${w},${h}`;
      if (seen.has(key) || w < 50 || h < 50) continue;
      seen.add(key);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
      const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (hit?.data) return hit.data;
    }
    return null;
  } finally {
    bmp.close();
  }
}

async function useImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  $('parseMsg').textContent = t('readingQr');
  $('parseMsg').classList.remove('bad');
  let text = null;
  try {
    text = await readQr(file);
  } catch {
    text = null;
  }
  if (text && parse(text).set) {
    $('text').value = text;
    update();
  } else {
    $('parseMsg').textContent = t('qrFail');
    $('parseMsg').classList.add('bad');
  }
}

function setupTurnstile() {
  const key = CONFIG.turnstileSiteKey; // /config.js (読めなくても投稿は試せる。サーバーが確かめる)
  if (!key) return;
  needTurnstile = true;
  update();
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.onload = () =>
    turnstile.render('#turnstile', {
      sitekey: key,
      theme: 'dark',
      callback: (t) => {
        turnstileToken = t;
        update();
      },
      'expired-callback': () => {
        turnstileToken = '';
        update();
      },
    });
  document.head.append(s);
}

async function submit(e) {
  e.preventDefault();
  if (sending || !parse($('text').value).set) return;
  sending = true;
  update();
  $('postMsg').textContent = t('sending');
  $('postMsg').classList.remove('bad');
  const author = $('author').value.trim();
  try {
    localStorage.setItem(AUTHOR, author);
  } catch {
    // 名前を覚えられなくても投稿はできる
  }
  try {
    const body = { text: $('text').value, author, turnstile: turnstileToken };
    if (FEAT.tags) body.tags = $('tagsIn').value;
    if (FEAT.unlisted) body.unlisted = $('unlisted').checked;
    const r = await api('/api/sets', body);
    if (r.existed) {
      location.href = `/s/${r.id}?existed=1`;
      return;
    }
    saveKey(r.id, r.deleteKey);
    $('form').hidden = true;
    $('done').hidden = false;
    $('doneLink').href = `/s/${r.id}`;
    $('doneKey').value = r.deleteKey;
  } catch (err) {
    $('postMsg').textContent = errorText(err.message);
    $('postMsg').classList.add('bad');
    if (needTurnstile && typeof turnstile !== 'undefined') {
      turnstileToken = '';
      turnstile.reset('#turnstile'); // 確認は 1 回しか使えない
    }
  } finally {
    sending = false;
    update();
  }
}

$('text').addEventListener('input', update);
$('form').addEventListener('submit', submit);
$('image').addEventListener('change', (e) => useImage(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  useImage(e.dataTransfer.files[0]);
});
$('copyKey').addEventListener('click', async () => {
  if (!(await copyText($('doneKey').value))) $('doneKey').select();
});
try {
  $('author').value = localStorage.getItem(AUTHOR) || '';
} catch {
  // 何もしない
}

update();
setupTurnstile();
