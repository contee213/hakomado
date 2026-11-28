// hakomado: 同時視聴の配信の画面のタイマーから、作品ごとの本編の位置を探す (HAKO-49)。マルチビュー画面の側。
// 〰 波形と同じく、枠とは別に画面の外に視聴ページ (hakomado_timer=1) を開き、中の content/timer-reader.js からの知らせを受け取って、
// 見つけた区間を MovieAnchors (動画ごとの本編の位置) に記録する。
// - 画質は 240p に固定する (通信量が 1080p の約 10 分の 1)。タイマーらしい所があったのに読めなかったときだけ、360p で 1 度だけ試し直す
// - 調べるのは 1 本ずつ順に (YouTube に負担をかけないため。短い間にシークを繰り返すと 503 が返る)
// - 見つからなかった配信は chrome.storage.session に覚えて、自動では二度調べない (Chrome を閉じると消える)
// - 題・概要欄に同時視聴らしい言葉があるのに、まばらに見て見つからなかったときは「最後まで詳しく調べますか？」と聞く (状態 'ask')。
//   聞いている状態も chrome.storage.session に覚え、開き直しても自動ではまばらに見直さない
// - 使う人がやめた配信は、この画面では自動で調べ直さない。同期をやめた・帯を閉じたときは、順番待ちも含めて全部やめる (cancelAll)
/* exported TimerScan */
'use strict';

const TimerScan = (() => {
  const ORIGIN = 'https://www.youtube.com';
  const QUALITY = 'small';
  const RETRY_QUALITY = 'medium';
  const MISS_KEY = 'timerScanMiss';
  const IDLE_MS = 90000; // 知らせがこれだけ来なければ、あきらめて次へ
  const HINT_RE = /同時視聴|同時試聴|watch[\s-]?along|視聴会|鑑賞会|上映会|話視聴|一緒に(見|観)よう/i;

  const states = new Map(); // vid -> {status: 'queued' | 'scanning' | 'ask' | 'none' | 'done', t0, full}
  const queue = []; // [{vid, full}]
  let cur = null; // {vid, box, frame, quality, full, lastAt, found}
  let miss = {}; // vid -> {at, ask?} 見つからなかった配信 (ask = 最後まで調べるかを聞いている)
  const stopped = new Set(); // 使う人がやめた配信 (この画面では自動で調べ直さない)

  const readMiss = (o) => (o?.[MISS_KEY] && typeof o[MISS_KEY] === 'object' ? o[MISS_KEY] : {});
  chrome.storage.session
    ?.get(MISS_KEY)
    .then((o) => (miss = { ...readMiss(o), ...miss }))
    .catch(() => {});

  /** 見つからなかった配信を覚える (ほかのタブが覚えた分を消さないよう、読み直して足す) */
  async function remember(vid, entry) {
    miss = { ...miss, [vid]: entry };
    try {
      const saved = readMiss(await chrome.storage.session?.get(MISS_KEY));
      miss = { ...saved, ...miss };
      await chrome.storage.session?.set({ [MISS_KEY]: miss });
    } catch {
      /* 覚えられなくても、この画面では覚えている */
    }
  }

  /** 題に同時視聴らしい言葉があるか (自動で探し始めるかの見当) */
  const hinted = (title) => HINT_RE.test(String(title || ''));

  /** vid の今の様子: {status, sec (探している秒数)} / 見つからなかった配信は {status: 'none'} / 何もしていなければ null */
  function stateOf(vid) {
    const st = states.get(vid);
    if (st) return { status: st.status, sec: st.t0 ? Math.floor((performance.now() - st.t0) / 1000) : 0 };
    return miss[vid] ? { status: miss[vid].ask ? 'ask' : 'none', sec: 0 } : null;
  }

  /** vid を調べる。auto = 自動で始めるとき (見つからなかった配信・調べた配信は調べ直さない)。full = まばらに見ずに最後まで */
  function request(vid, { auto = false, full = false } = {}) {
    if (!vid) return;
    if (cur?.vid === vid || queue.some((q) => q.vid === vid)) return;
    if (auto && (miss[vid] || states.has(vid) || stopped.has(vid))) return;
    stopped.delete(vid);
    states.set(vid, { status: 'queued', t0: 0, full });
    queue.push({ vid, full });
    pump();
  }

  /** やめる (調べている途中・順番待ち)。やめた配信は、この画面では自動で調べ直さない */
  function cancel(vid) {
    const qi = queue.findIndex((q) => q.vid === vid);
    if (qi >= 0) queue.splice(qi, 1);
    if (cur?.vid === vid) {
      cur.box.remove();
      cur = null;
    }
    if (states.get(vid)?.status === 'queued' || states.get(vid)?.status === 'scanning') stopped.add(vid);
    states.delete(vid);
    pump();
  }

  /** 全部やめる (同期をやめた・帯を閉じた・⏱ アーカイブ同期を OFF にした)。見つけた区間はそのまま */
  function cancelAll() {
    for (const q of queue.splice(0)) {
      stopped.add(q.vid);
      states.delete(q.vid);
    }
    if (cur) {
      stopped.add(cur.vid);
      states.delete(cur.vid);
      cur.box.remove();
      cur = null;
    }
  }

  function pump() {
    if (cur || !queue.length) return;
    const q = queue.shift();
    open(q.vid, QUALITY, q.full);
  }

  function open(vid, quality, full) {
    const box = document.createElement('div');
    box.className = 'timer-scan-box';
    box.setAttribute('aria-hidden', 'true');
    const frame = document.createElement('iframe');
    frame.allow = 'autoplay';
    frame.tabIndex = -1;
    frame.title = '';
    const p = new URLSearchParams({ v: vid, app: 'desktop', hakomado: '1', hakomado_muted: '1', hakomado_timer: '1', hakomado_quality: quality });
    if (full) p.set('hakomado_timer_full', '1');
    frame.src = `${ORIGIN}/watch?${p}`;
    box.append(frame);
    document.body.append(box);
    cur = { vid, box, frame, quality, full, lastAt: performance.now(), found: 0 };
    const st = states.get(vid) || { full };
    st.status = 'scanning';
    if (!st.t0) st.t0 = performance.now();
    states.set(vid, st);
  }

  /** 探し終えた。result: 'found' | 'none' | 'ask' */
  function finish(result) {
    const { vid } = cur;
    cur.box.remove();
    cur = null;
    if (result === 'found') states.set(vid, { status: 'done', t0: 0 });
    else {
      remember(vid, result === 'ask' ? { at: Date.now(), ask: true } : { at: Date.now() });
      states.delete(vid);
    }
    pump();
  }

  window.addEventListener('message', (e) => {
    if (!cur || e.origin !== ORIGIN || e.source !== cur.frame.contentWindow || e.data?.hakomado !== 'timerScan') return;
    const d = e.data;
    cur.lastAt = performance.now();
    if (d.ev === 'work' && d.work) {
      // 区間: [動き出した再生位置, そのときのタイマーの値] (動き出した位置 = 最初に表示が変わった瞬間 − 1 秒)
      const w = d.work;
      const tick = Number(w.tick);
      const v = Number(w.startValue ?? w.value ?? 0);
      if (Number.isFinite(tick) && Number.isFinite(v)) {
        cur.found++;
        MovieAnchors.addSections(cur.vid, [[tick - 1, v]]);
      }
    } else if (d.ev === 'done') {
      // 240p で、タイマーらしい所があったのに数字が読めなかった → 360p で 1 度だけ試し直す
      if (!cur.found && d.result === 'none' && cur.quality === QUALITY && d.cands > 0) {
        const { vid, full } = cur;
        cur.box.remove();
        cur = null;
        open(vid, RETRY_QUALITY, full);
        return;
      }
      finish(cur.found ? 'found' : d.result === 'ask' ? 'ask' : 'none');
    }
  });

  // 知らせが長く来なければ (視聴ページが開けない・止まった) あきらめる (帯は 0.5 秒ごとに stateOf を読み直すので、知らせは要らない)
  setInterval(() => {
    if (cur && performance.now() - cur.lastAt > IDLE_MS) finish(cur.found ? 'found' : 'none');
  }, 1000);

  return { request, cancel, cancelAll, stateOf, hinted };
})();
