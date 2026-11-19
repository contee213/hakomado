// hukumado: 枠に入れた watch ページの「ページ側」(MAIN world) で動くスクリプト。
// YouTube プレイヤー自身の API (mute / unMute / onVolumeChange) を使ってミュートを操作する。
// 動画要素を直接ミュートするとプレイヤーのスピーカー表示と食い違うため、必ずプレイヤー経由で切り替える。
// 拡張機能側 (watch.js) とは document 上の CustomEvent でやりとりする:
//   watch.js → ここ : 'hukumado:set-muted'  detail '1' | '0'
//   ここ → watch.js : 'hukumado:user-audio' detail JSON {muted}  (枠内のプレイヤーで直接操作されたとき)
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (window.top === window || params.get('hukumado') !== '1') return;

  let desired = params.get('hukumado_muted') !== '0'; // 親が望むミュート状態
  let selfUntil = 0; // この時刻までの音量変化は自分の操作によるもの
  let lastInput = -Infinity; // 枠内での最後のクリック / キー操作

  for (const type of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(type, () => (lastInput = performance.now()), true);
  }

  // プレイヤー API でミュートすると YouTube の音量設定 (localStorage) に保存され、
  // 普段 YouTube を見るときまでミュートで始まってしまうことがあるので、元の値に戻しておく
  const VOLUME_KEY = 'yt-player-volume';
  let savedVolume = null;
  try {
    savedVolume = localStorage.getItem(VOLUME_KEY);
  } catch {
    /* ignore */
  }
  const restoreVolumeSetting = () =>
    setTimeout(() => {
      try {
        if (savedVolume == null) localStorage.removeItem(VOLUME_KEY);
        else localStorage.setItem(VOLUME_KEY, savedVolume);
      } catch {
        /* ignore */
      }
    }, 0);

  const player = () => {
    const p = document.getElementById('movie_player');
    return p && typeof p.mute === 'function' && typeof p.isMuted === 'function' ? p : null;
  };
  const video = () => document.querySelector('#movie_player video');

  let hooked = null;
  function hook(p) {
    if (hooked === p) return;
    hooked = p;
    p.addEventListener('onVolumeChange', (d) => {
      const muted = !!(d && (d.muted || d.volume === 0));
      if (muted === desired || performance.now() < selfUntil) return;
      if (performance.now() - lastInput > 1500) {
        // 操作していないのに変わった (YouTube が読み込み時に音量を戻した等) → 親の指定に戻す
        apply();
        return;
      }
      // 枠内のプレイヤーで直接ミュートを切り替えた → 親に知らせる
      desired = muted;
      restoreVolumeSetting();
      document.dispatchEvent(new CustomEvent('hukumado:user-audio', { detail: JSON.stringify({ muted }) }));
    });
  }

  function apply() {
    const p = player();
    const v = video();
    if (!p) {
      // プレイヤーの準備前: 一瞬でも音が出ないよう、ミュート指定なら動画だけ先に消音
      if (v && desired) v.muted = true;
      return;
    }
    hook(p);
    const actual = p.isMuted() || (v ? v.muted : false);
    if (actual === desired) return;
    selfUntil = performance.now() + 600;
    if (desired) {
      p.mute();
    } else {
      p.unMute();
      if (v) v.muted = false;
      if (typeof p.getPlayerState === 'function' && p.getPlayerState() === 2) p.playVideo?.();
    }
    restoreVolumeSetting();
  }

  document.addEventListener('hukumado:set-muted', (e) => {
    desired = e.detail === '1';
    apply();
  });

  // 動画要素が作られた瞬間に音が出ないよう見張る
  const mo = new MutationObserver(() => {
    if (video()) {
      apply();
      if (player()) mo.disconnect();
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 読み込み直後は YouTube が音量を戻すことがあるので、しばらく指定を当て直す
  let ticks = 0;
  const timer = setInterval(() => {
    apply();
    if (++ticks > 40) clearInterval(timer);
  }, 300);
})();
