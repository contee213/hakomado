// hakomado: 枠に入れた watch ページの「ページ側」(MAIN world) で動くスクリプト。
// YouTube プレイヤー自身の API (mute / unMute / onVolumeChange) を使ってミュートを操作する。
// 動画要素を直接ミュートするとプレイヤーのスピーカー表示と食い違うため、必ずプレイヤー経由で切り替える。
// 拡張機能側 (watch.js) とは document 上の CustomEvent でやりとりする:
//   watch.js → ここ : 'hakomado:set-muted'  detail '1' | '0' | '0q' ('0q' = 消音を外すだけで、止まっていても再生し直さない。
//                     🎧 音で合わせるで、同期が止めている枠の消音を外すため)
//   ここ → watch.js : 'hakomado:user-audio' detail JSON {muted}  (枠内のプレイヤーで直接操作されたとき)
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (window.top === window || params.get('hakomado') !== '1') return;

  let desired = params.get('hakomado_muted') !== '0'; // 親が望むミュート状態
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
      document.dispatchEvent(new CustomEvent('hakomado:user-audio', { detail: JSON.stringify({ muted }) }));
    });
  }

  // resume = ミュートを外したとき、止まっていれば再生し直す (親から音を出す指示が来たとき。見張りで直すときはしない)
  function apply({ resume = true } = {}) {
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
      // まとめて一時停止している間は、音を出す枠を変えても再生し直さない
      if (resume && !pausedByParent && typeof p.getPlayerState === 'function' && p.getPlayerState() === 2) p.playVideo?.();
    }
    restoreVolumeSetting();
  }

  document.addEventListener('hakomado:set-muted', (e) => {
    desired = e.detail === '1';
    apply({ resume: e.detail !== '0q' });
  });

  // ---- まとめて一時停止 / 再開 (親の上部バーのボタン・Space キー)
  //   watch.js → ここ : 'hakomado:playback' detail 'pause' | 'play'
  // 再開するとき、ライブ配信は止めていた位置ではなく最新の位置に戻す (遅れたまま見ないように)
  let pausedByParent = false;
  document.addEventListener('hakomado:playback', (e) => {
    const p = player();
    pausedByParent = e.detail === 'pause';
    if (!p) return;
    if (pausedByParent) {
      p.pauseVideo?.();
      return;
    }
    const live = !!p.getVideoData?.()?.isLive;
    if (live) {
      if (typeof p.seekToLiveHead === 'function') p.seekToLiveHead();
      else {
        const v = video();
        if (v && v.seekable.length) v.currentTime = v.seekable.end(v.seekable.length - 1);
      }
    }
    p.playVideo?.();
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

  // その後も 2 秒ごとに、実際のミュート状態が親の指定とずれていないか確かめて直す。
  // YouTube のプレイヤーは、広告の前後やライブ配信のつなぎ直しなどで中身を作り直すとき、保存されている音量設定
  // (別の枠がミュートにしたときの値) でミュートになることがあり、そのときは onVolumeChange が来ない
  // (音を出しているはずのメイン枠が、別の枠を足したあとで勝手にミュートになる)。
  // 枠内で操作した直後 (自分でミュートを切り替えた可能性がある) は触らない
  setInterval(() => {
    if (performance.now() - lastInput > 3000) apply({ resume: false });
  }, 2000);

  // ---- この動画を見られるか (メンバー限定でメンバーではない、など) を親に知らせる
  //   ここ → watch.js : 'hakomado:playability' detail JSON {status, text}
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
      new CustomEvent('hakomado:playability', { detail: JSON.stringify({ status: String(ps.status), text }) }),
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
  //   ここ → watch.js : 'hakomado:ended' detail 'played' | 'already'
  //   played  = 再生が最後まで行った (プレイヤーの状態 0 = 終了)。次のときは終わったことにしない:
  //             - 開始前の待機画面の宣伝動画が終わった
  //             - 広告が終わった (広告の再生中・広告の後に本編が始まった)
  //             - ライブ配信の一時中断 (配信者の回線切れなど): 少し待って、本編が再生に戻っていれば終わっていない
  //             少し待つ間に YouTube が次の動画に自動で移ったときは、終わったことにする
  //   already = 開いた時点でもう終わっていた配信 (liveBroadcastDetails に終了時刻があり、今は配信中ではない)。
  //             アーカイブを開いたときもこれになるので、親は自動再生で入れた枠にだけ使う
  const endedSent = new Set();
  const reportEnded = (reason) => {
    if (endedSent.has(reason)) return;
    endedSent.add(reason);
    document.dispatchEvent(new CustomEvent('hakomado:ended', { detail: reason }));
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
  const myVideoId = params.get('v') || '';

  // ---- ライブ配信中か (親が枠に「LIVE」の印を付ける)。開始前の待機画面は配信中にしない
  //   ここ → watch.js : 'hakomado:live' detail '1' | '0' (変わったときだけ)
  let liveSent = null;
  setInterval(() => {
    if (!player()) return;
    const live = !!videoData().isLive && !waitingRoom();
    if (live === liveSent) return;
    liveSent = live;
    document.dispatchEvent(new CustomEvent('hakomado:live', { detail: live ? '1' : '0' }));
  }, 1000);

  // ---- ライブ配信のアーカイブ: チャットのリプレイを出せるよう、親に知らせ、再生位置を送り続ける
  //   ここ → watch.js : 'hakomado:replay' detail リプレイを開く鍵 (continuation) / 'hakomado:progress' detail 再生位置 (秒)
  // 親は live_chat_replay?continuation=… を枠に読み込み、YouTube の視聴ページと同じ形で再生位置を渡す (チャットがその位置まで進む)。
  // リプレイは動画 ID では開けず、視聴ページのデータに入っている continuation が要る (チャットを切っていた配信には無い)
  const replayContinuation = () => {
    try {
      const bar = window.ytInitialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
      const c = bar?.continuations?.[0]?.reloadContinuationData?.continuation;
      return typeof c === 'string' && /^[\w%=-]{10,2000}$/.test(c) ? c : '';
    } catch {
      return '';
    }
  };
  let replaySent = false;
  setInterval(() => {
    if (!alreadyEnded()) return;
    if (!replaySent) {
      const c = replayContinuation();
      if (!c) return;
      replaySent = true;
      document.dispatchEvent(new CustomEvent('hakomado:replay', { detail: c }));
    }
    const t = player()?.getCurrentTime?.();
    if (typeof t === 'number' && Number.isFinite(t)) document.dispatchEvent(new CustomEvent('hakomado:progress', { detail: String(t) }));
  }, 500);
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
  const videoData = () => {
    try {
      return player()?.getVideoData?.() || {};
    } catch {
      return {};
    }
  };
  // 状態 0 になってから確かめ直すまでの時間。ライブ配信は一時中断から戻るのを長めに待つ
  const CONFIRM_VOD_MS = 5000;
  const CONFIRM_LIVE_MS = 60000;
  let endCheck = 0;
  const onPlayerState = (s) => {
    if (s !== 0 || endCheck || adShowing() || waitingRoom()) return;
    const wait = videoData().isLive ? CONFIRM_LIVE_MS : CONFIRM_VOD_MS;
    endCheck = setTimeout(() => {
      endCheck = 0;
      if (adShowing() || waitingRoom()) return;
      const id = videoData().video_id || '';
      const movedOn = !!id && !!myVideoId && id !== myVideoId; // 次の動画に自動で移った
      if (movedOn || player()?.getPlayerState?.() === 0) reportEnded('played');
    }, wait);
  };
  let endTicks = 0;
  let endHooked = false;
  const endTimer = setInterval(() => {
    const p = player();
    if (p && !endHooked) {
      endHooked = true;
      p.addEventListener('onStateChange', onPlayerState);
    }
    if (alreadyEnded()) reportEnded('already');
    if ((endHooked && window.ytInitialPlayerResponse) || ++endTicks > 60) clearInterval(endTimer);
  }, 1000);

  // ---- チャンネル登録・高評価 (親画面の枠のバーにあるボタンから操作する)
  //   ここ → watch.js : 'hakomado:social'     detail JSON {loggedIn, subscribed, liked, failed?}
  //   watch.js → ここ : 'hakomado:social-act' detail 'subscribe' | 'like' (する方だけ。解除・取り消しはしない)
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
    document.dispatchEvent(new CustomEvent('hakomado:social', { detail: key }));
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
  document.addEventListener('hakomado:social-act', async (e) => {
    const act = e.detail;
    const before = socialState();
    const key = act === 'like' ? 'liked' : 'subscribed';
    if (!before.loggedIn || before[key] !== false) {
      reportSocial();
      return;
    }
    let nowId = '';
    try {
      nowId = player()?.getVideoData?.().video_id || '';
    } catch {
      /* ignore */
    }
    if (nowId !== params.get('v')) {
      reportSocial({ failed: act });
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

  // ---- アーカイブの同期再生 (コラボの各視点を、同じ瞬間にそろえて見る)
  //   ここ → watch.js : 'hakomado:archive'    detail JSON {start, end, dur} (配信の実際の開始・終了時刻 (ミリ秒) と長さ (秒)。1 度だけ)
  //   ここ → watch.js : 'hakomado:sync-state' detail JSON {t, ps, ad, r, up, sk} (再生位置・プレイヤーの状態・広告中か・速度・
  //                     枠の中でユーザーが一時停止したか・枠の中でユーザーがシークした回数・位置を読んだ時刻。0.5 秒ごと)
  //   watch.js → ここ : 'hakomado:sync'       detail JSON {op: 'seek' | 'play' | 'pause' | 'rate', t?, r?}
  // 終わった配信のアーカイブを開いたときだけ動く (ライブ配信中・ふつうの動画は同期しない)
  let archiveSent = false;
  // 今の一時停止が、枠の中でのユーザーの操作によるものか (親の指示による一時停止と見分ける。同期中に「止めて待つ」ため)
  let userPaused = false;
  document.addEventListener('pause', () => (userPaused = performance.now() - lastInput < 1000), true);
  document.addEventListener('play', () => (userPaused = false), true);
  // 枠の中でユーザーがシークした回数 (シークバー・← → キーなど。親の指示によるシークは数えない)。
  // 'seeked' でなく 'seeking' で数える (再生位置は seeking の時点で新しくなるので、位置と回数が同じ知らせで届くように)
  let userSeeks = 0;
  let lastAct = -Infinity; // シークバーは押してから離すまで長いことがあるので、離したときも数える
  for (const type of ['pointerdown', 'pointerup', 'keydown']) {
    document.addEventListener(type, () => (lastAct = performance.now()), true);
  }
  document.addEventListener(
    'seeking',
    () => {
      if (performance.now() - lastAct < 1500) userSeeks++;
    },
    true,
  );
  setInterval(() => {
    if (!alreadyEnded()) {
      sendLivePos();
      return;
    }
    const p = player();
    if (!p) return;
    let t;
    let ps;
    try {
      t = Number(p.getCurrentTime?.());
      ps = Number(p.getPlayerState?.());
    } catch {
      return;
    }
    if (!archiveSent) {
      const lbd = window.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
      const start = Date.parse(lbd?.startTimestamp || '');
      const end = Date.parse(lbd?.endTimestamp || '');
      const dur = Number(p.getDuration?.());
      const id = videoData().video_id || '';
      if (!Number.isFinite(start) || !(dur > 0) || (id && id !== myVideoId)) return;
      archiveSent = true;
      const detail = JSON.stringify({ start, end: Number.isFinite(end) ? end : start + dur * 1000, dur });
      document.dispatchEvent(new CustomEvent('hakomado:archive', { detail }));
    }
    if (!Number.isFinite(t)) return;
    // ts = 位置を読んだ時刻 (どのページでも同じ物差しの時刻)。親に届くまでの遅れの揺れで、位置の見積もりがぶれないように
    const ts = performance.timeOrigin + performance.now();
    const detail = JSON.stringify({ t, ps, ad: adShowing(), r: video()?.playbackRate || 1, up: ps === 2 && userPaused, sk: userSeeks, ts });
    document.dispatchEvent(new CustomEvent('hakomado:sync-state', { detail }));
  }, 500);
  // ライブ配信中: 画面に出ている瞬間の、配信開始からの経過 (秒) を知らせる (🎬 本編モードでライブを基準にするため)。
  //   ここ → watch.js : 'hakomado:live-pos' detail JSON {pos, ps}
  // getMediaReferenceTime () = 今出ている映像が配信された実際の時刻 (秒)。見ている人の遅れ (数秒〜) によらないので、
  // 共有した本編の位置がほかの人の環境でもずれない。配信がアーカイブになったときの再生位置と同じ物差しになる
  function sendLivePos() {
    const p = player();
    if (!p || !p.getVideoData?.()?.isLive) return;
    let ref;
    let ps;
    try {
      ref = Number(p.getMediaReferenceTime?.());
      ps = Number(p.getPlayerState?.());
    } catch {
      return;
    }
    const lbd = window.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
    const start = Date.parse(lbd?.startTimestamp || '');
    if (!(ref > 1e9) || !Number.isFinite(start)) return;
    const pos = ref - start / 1000;
    if (pos < 0) return;
    document.dispatchEvent(new CustomEvent('hakomado:live-pos', { detail: JSON.stringify({ pos, ps }) }));
  }

  document.addEventListener('hakomado:sync', (e) => {
    let c;
    try {
      c = JSON.parse(e.detail);
    } catch {
      return;
    }
    const p = player();
    if (!p || !archiveSent) return;
    if (c.op === 'seek' && Number.isFinite(c.t)) p.seekTo?.(Math.max(0, c.t), true);
    else if (c.op === 'play') p.playVideo?.();
    else if (c.op === 'pause') p.pauseVideo?.();
    else if (c.op === 'rate' && Number.isFinite(c.r)) {
      // 少しのずれは速度をわずかに変えて吸収する (シークすると読み込みで止まるため)。
      // 枠の速度 (base) に掛ける補正で、プレイヤーの速度設定は変えない
      corr = Math.min(1.25, Math.max(0.75, c.r));
      applyRate();
    }
  });

  // ---- 再生速度 (枠のバーの速度ボタン・上部バーの ⏩・< > キー。同期中のグループはグループの速度)
  //   watch.js → ここ : 'hakomado:speed'      detail '1.5' など (この枠の速度)
  //   ここ → watch.js : 'hakomado:user-speed' detail '1.5' など (枠の中のプレイヤーの ⚙ やキーで変えたとき)
  // 速度はプレイヤーの API で決め (YouTube の表示とそろえる)、同期の補正 (corr) は動画要素に直接掛ける
  let base = 1;
  let corr = 1;
  let rateSelfUntil = 0;
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 4;
  const near = (a, b) => Math.abs(a - b) < 0.001;
  let rateHooked = null;
  // 少し前に自分で動画要素に掛けた速度 (補正の分も含む)。YouTube がそれを知らせてきても、ユーザーの操作と取り違えないように
  let applied = [];
  const mine = (r) => applied.some((a) => near(a.r, r) && performance.now() - a.at < 3000);
  function applyRate() {
    const p = player();
    const v = video();
    if (!p) return;
    hookRate(p);
    if (typeof p.setPlaybackRate === 'function' && !near(Number(p.getPlaybackRate?.()) || 1, base)) {
      rateSelfUntil = performance.now() + 800;
      p.setPlaybackRate(base);
    }
    if (v && !near(v.playbackRate, base * corr)) {
      v.playbackRate = base * corr;
      applied = [...applied.filter((a) => performance.now() - a.at < 3000), { r: base * corr, at: performance.now() }];
    }
  }
  function hookRate(p) {
    if (rateHooked === p) return;
    rateHooked = p;
    p.addEventListener('onPlaybackRateChange', (r) => {
      r = Number(r);
      if (!Number.isFinite(r) || near(r, base) || near(r, base * corr) || mine(r) || adShowing()) return;
      if (performance.now() < rateSelfUntil || performance.now() - lastInput > 1500) {
        // 操作していないのに変わった (YouTube が読み込み・広告のあとで戻した等) → 親の指定に戻す
        applyRate();
        return;
      }
      // 枠の中のプレイヤーで速度を変えた → 親に知らせる (同期中ならグループ全部の速度になる)
      base = Math.min(SPEED_MAX, Math.max(SPEED_MIN, r));
      document.dispatchEvent(new CustomEvent('hakomado:user-speed', { detail: String(base) }));
    });
  }
  document.addEventListener('hakomado:speed', (e) => {
    const r = Number(e.detail);
    if (!Number.isFinite(r)) return;
    base = Math.min(SPEED_MAX, Math.max(SPEED_MIN, r));
    applyRate();
  });
  // 広告のあとや画質の切り替えで動画要素の速度が戻ることがあるので、ときどき確かめて直す (広告中はそのまま)
  setInterval(() => {
    const v = video();
    if (v && !adShowing() && !near(v.playbackRate, base * corr) && performance.now() - lastInput > 1500) applyRate();
  }, 1000);

  // ---- 枠の情報 (親の「ℹ 枠の情報」の一覧と、アーカイブ同期ボタンが使えない理由の表示用)
  //   ここ → watch.js : 'hakomado:info'     detail JSON {kind, viewers, views, start, end, publish, dur, t}
  //   watch.js → ここ : 'hakomado:info-req' (一覧を開いている間だけ、親が数秒ごとに求める)
  //   kind = 'live' (ライブ配信中) | 'upcoming' (配信前) | 'archive' (配信のアーカイブ) | 'video' (ふつうの動画) | '' (まだ分からない)
  //   種類が変わったときは、求められなくても知らせる (親が同期ボタンの理由を出せるように)
  //   今の視聴者数は、隠している説明欄 (#below) の「◯人が視聴中」を読む (YouTube が数秒ごとに更新している)
  const kindNow = () => {
    const pr = playerResponse();
    if (!pr || !player()) return '';
    if (pr.videoDetails?.isUpcoming) return 'upcoming';
    if (videoData().isLive) return waitingRoom() ? 'upcoming' : 'live';
    if (alreadyEnded()) return 'archive';
    return pr.videoDetails?.isLiveContent ? '' : 'video'; // 配信が終わった直後などは、アーカイブになるまで分からない
  };
  const numOrNull = (v) => (Number.isFinite(v) ? v : null);
  const viewersNow = () => {
    const label = document.querySelector('ytd-watch-metadata #view-count')?.getAttribute('aria-label') || '';
    const digits = label.replace(/\D/g, '');
    if (digits) return Number(digits);
    try {
      const rs = window.ytInitialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
      const vc = rs.find((c) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer?.viewCount?.videoViewCountRenderer;
      return vc?.isLive ? numOrNull(Number(vc.originalViewCount)) : null;
    } catch {
      return null;
    }
  };
  const infoNow = () => {
    const kind = kindNow();
    const pr = playerResponse();
    const mf = window.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer;
    const lbd = mf?.liveBroadcastDetails;
    const p = player();
    let dur = null;
    let t = null;
    if (kind === 'archive' || kind === 'video') {
      try {
        dur = numOrNull(Number(p?.getDuration?.()));
        t = numOrNull(Number(p?.getCurrentTime?.()));
      } catch {
        /* ignore */
      }
    }
    return {
      kind,
      viewers: kind === 'live' ? viewersNow() : null,
      views: numOrNull(Number(pr?.videoDetails?.viewCount ?? NaN)),
      start: numOrNull(Date.parse(lbd?.startTimestamp || '')),
      end: numOrNull(Date.parse(lbd?.endTimestamp || '')),
      publish: numOrNull(Date.parse(mf?.publishDate || '')),
      dur,
      t,
    };
  };
  const reportInfo = () => {
    const id = videoData().video_id || '';
    if (id && myVideoId && id !== myVideoId) return; // 次の動画に自動で移った (読み込み時の情報は前の動画のもの)
    document.dispatchEvent(new CustomEvent('hakomado:info', { detail: JSON.stringify(infoNow()) }));
  };
  document.addEventListener('hakomado:info-req', reportInfo);
  let kindSent = null;
  setInterval(() => {
    const kind = kindNow();
    if (kind === kindSent) return;
    kindSent = kind;
    reportInfo();
  }, 2000);

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
