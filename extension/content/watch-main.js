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

  // ---- この動画を見られるか (メンバー限定でメンバーではない、など) を親に知らせる
  //   ここ → watch.js : 'hukumado:playability' detail JSON {status, text}
  //   開始前の待機画面から配信が始まると状態が変わるので、その後も時々確かめて、変わったら知らせ直す
  const playerResponse = () => {
    try {
      return player()?.getPlayerResponse?.() || window.ytInitialPlayerResponse || null;
    } catch {
      return null;
    }
  };
  let lastStatus = '';
  const reportPlayability = () => {
    const ps = playerResponse()?.playabilityStatus;
    if (!ps?.status || ps.status === lastStatus) return !!ps?.status;
    lastStatus = ps.status;
    let text = '';
    try {
      text = JSON.stringify(ps).slice(0, 8000);
    } catch {
      /* ignore */
    }
    document.dispatchEvent(
      new CustomEvent('hukumado:playability', { detail: JSON.stringify({ status: String(ps.status), text }) }),
    );
    return true;
  };
  // 読み込み直後は 0.5 秒ごと (最初に分かったら終わり)、その後は 20 秒ごとに変化だけ見る
  let psTicks = 0;
  const psTimer = setInterval(() => {
    if (reportPlayability() || ++psTicks > 30) clearInterval(psTimer);
  }, 500);
  setInterval(reportPlayability, 20000);

  // ---- 配信・動画が終わったことを親に知らせる (自動再生中に枠を片付けるため)
  //   ここ → watch.js : 'hukumado:ended' detail 'played' | 'already'
  //   played  = 再生が最後まで行った (プレイヤーの状態 0 = 終了。開始前の待機画面の宣伝動画が終わったときは除く)
  //   already = 開いた時点でもう終わっていた配信 (liveBroadcastDetails に終了時刻があり、今は配信中ではない)。
  //             アーカイブを開いたときもこれになるので、親は自動再生で入れた枠にだけ使う
  const endedSent = new Set();
  const reportEnded = (reason) => {
    if (endedSent.has(reason)) return;
    endedSent.add(reason);
    document.dispatchEvent(new CustomEvent('hukumado:ended', { detail: reason }));
  };
  // 開始前の待機画面: 宣伝動画 (トレーラー) が流れることがあり、それが終わっても状態 0 になる。
  // そのときのプレイヤーの情報は「配信予定」(isUpcoming / LIVE_STREAM_OFFLINE) のままなので、それで見分ける
  const waitingRoom = () => {
    try {
      const pr = player()?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      if (!pr) return true; // 分からないときは終わったことにしない
      return !!pr.videoDetails?.isUpcoming || (pr.playabilityStatus?.status || 'OK') !== 'OK';
    } catch {
      return true;
    }
  };
  const alreadyEnded = () => {
    try {
      const pr = window.ytInitialPlayerResponse;
      const lbd = pr?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
      return !!(lbd && lbd.endTimestamp && lbd.isLiveNow === false && !pr?.videoDetails?.isUpcoming);
    } catch {
      return false;
    }
  };
  let endTicks = 0;
  let endHooked = false;
  const endTimer = setInterval(() => {
    const p = player();
    if (p && !endHooked) {
      endHooked = true;
      p.addEventListener('onStateChange', (s) => {
        if (s === 0 && !waitingRoom()) reportEnded('played');
      });
    }
    if (alreadyEnded()) reportEnded('already');
    if ((endHooked && window.ytInitialPlayerResponse) || ++endTicks > 60) clearInterval(endTimer);
  }, 1000);

  // ---- チャンネル登録・高評価 (親画面の枠のバーにあるボタンから操作する)
  //   ここ → watch.js : 'hukumado:social'     detail JSON {loggedIn, subscribed, liked, failed?}
  //   watch.js → ここ : 'hukumado:social-act' detail 'subscribe' | 'like' (する方だけ。解除・取り消しはしない)
  //   ボタンは枠内では隠している (watch.css の #below) が、YouTube 自身のボタンを押して操作する
  //   (登録状態の保存などは YouTube 側の処理に任せる)
  const textOf = (r) => r?.simpleText || (r?.runs || []).map((x) => x.text).join('') || '';
  const subRenderer = () => document.querySelector('ytd-watch-metadata #subscribe-button ytd-subscribe-button-renderer');
  const likeButton = () =>
    document.querySelector('ytd-watch-metadata #top-level-buttons-computed like-button-view-model button');
  const isSubscribed = () => {
    const r = subRenderer();
    const d = r?.data;
    if (!d) return null;
    // 表示中の文字 (「登録済み」/「チャンネル登録」) で判定。分からなければ読み込み時の値
    const shown = r.querySelector('yt-button-shape button')?.textContent.trim() || '';
    if (shown && shown === textOf(d.subscribedButtonText)) return true;
    if (shown && shown === textOf(d.unsubscribedButtonText)) return false;
    return !!d.subscribed;
  };
  const socialState = () => {
    let loggedIn = false;
    try {
      loggedIn = !!window.ytcfg?.get?.('LOGGED_IN');
    } catch {
      /* ignore */
    }
    const lb = likeButton();
    return { loggedIn, subscribed: isSubscribed(), liked: lb ? lb.getAttribute('aria-pressed') === 'true' : null };
  };
  let lastSocial = '';
  const reportSocial = (extra = null) => {
    const st = { ...socialState(), ...extra };
    const key = JSON.stringify(st);
    if (key === lastSocial && !extra) return;
    lastSocial = key;
    document.dispatchEvent(new CustomEvent('hukumado:social', { detail: key }));
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (find, ms = 3000) => {
    for (let t = 0; t < ms; t += 100) {
      const el = find();
      if (el) return el;
      await sleep(100);
    }
    return null;
  };
  // 登録・高評価をする (済んでいるときは何もしない。解除・取り消しはしない)
  document.addEventListener('hukumado:social-act', async (e) => {
    const act = e.detail;
    const before = socialState();
    const key = act === 'like' ? 'liked' : 'subscribed';
    if (!before.loggedIn || before[key] !== false) {
      reportSocial();
      return;
    }
    let ok = true;
    try {
      if (act === 'like') likeButton().click();
      else subRenderer().querySelector('yt-button-shape button').click();
      // 反映を待って、変わったかどうかを確かめる
      ok = !!(await waitFor(() => socialState()[key] === true || null, 4000));
    } catch {
      ok = false;
    }
    reportSocial(ok ? null : { failed: act });
  });

  // 状態を時々確かめて、変わったら知らせる (読み込み直後は 1 秒ごと、その後は 5 秒ごと)
  let socialTicks = 0;
  const socialTimer = setInterval(() => {
    reportSocial();
    if (++socialTicks > 20) {
      clearInterval(socialTimer);
      setInterval(reportSocial, 5000);
    }
  }, 1000);
})();
