// hakomado: 画面のタイマーから、同時視聴の本編の位置 (作品ごとのタイマーの動き出し) を探す (HAKO-49)
// マルチビュー画面 (timer-scan.js) が画面の外に開いた視聴ページ (hakomado_timer=1。240p) でだけ動き、見つけるたびに親へ知らせる。
// やり方 (文字認識の部品は使わない):
//  0. 題と概要欄に同時視聴らしい言葉があるかを見る。配信の 10%・30%・50%・70%・90% の所だけ先に見て、動いているタイマーが
//     どこにも無ければ終える (言葉があれば「最後まで詳しく調べますか？」と親に聞かせる。hakomado_timer_full=1 なら最後まで調べる)
//  1. 頭から 10 分おきに、1 秒後・5 秒後には変わり 10 秒後には同じ絵に戻る所 (= 動いているタイマーの 1 の位) を探す
//  2. その 10 分前との間を二分探索して、動き出した瞬間をコマ単位まで絞る
//  3. 動き出しの直後 11 秒の 1 の位から 0〜9 の形を覚え (10 の位が繰り上がる所が 0)、同じ形を左へ探して桁の位置を決めて数字を読む。
//     本編の 0:00 = 動き出した瞬間 − そのときの値
//  4. 2 作品目以降は 10 分おきに数字を読み、「再生位置 − 表示の値」が変わった所を探す (次の作品 = 00:00:00 から / 続き = 途中の値から)
// 画面の外の別 origin の iframe では、描画が止められ (コマが描かれた知らせが来ない)、待ち時間 (setTimeout) も 1 秒単位に間引かれる。
// なので、シークが済んだ知らせ (seeked) ですぐ絵を取る
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (window.top === window || params.get('hakomado_timer') !== '1') return;
  const PARENT_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
  const post = (msg) => window.parent.postMessage({ hakomado: 'timerScan', ...msg }, PARENT_ORIGIN);
  const S = { done: false, err: null, seeks: 0, works: [], phase: 'init' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const L = () => {}; // 調べるときの記録 (ふだんは捨てる)
  const FULL = params.get('hakomado_timer_full') === '1';
  const SPARSE_AT = [0.1, 0.3, 0.5, 0.7, 0.9];
  const HINT_RE = /同時視聴|同時試聴|watch[\s-]?along|視聴会|鑑賞会|上映会|話視聴|一緒に(見|観)よう/i;
  /** 題と概要欄に同時視聴らしい言葉があるか */
  const hintOf = () => {
    let text = document.querySelector('meta[name="title"]')?.content || document.title || '';
    for (const s of document.scripts) {
      const m = s.textContent.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (m) {
        text += '\n' + m[1];
        break;
      }
    }
    return HINT_RE.test(text);
  };
  const pushWork = (w) => {
    S.works.push(w);
    post({ ev: 'work', work: w });
  };
  (async () => {
    try {
      let v;
      // 視聴ページは、前回の続きの位置でサムネイルを出したまま動画を読み込まないことがある (そのままではシークが終わらない)。
      // 音を消して一度再生させ、コマが出るまで待ってから止める
      for (let i = 0; i < 600; i++) {
        v = document.querySelector('video.html5-main-video');
        if (v && v.readyState >= 2 && v.duration > 0) break;
        if (v && v.paused) { v.muted = true; v.play().catch(() => {}); }
        await sleep(100);
      }
      if (!v) throw new Error('no video');
      v.muted = true;
      v.pause();
      S.hint = hintOf();
      const D = v.duration;
      S.duration = D;
      const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d', { willReadFrequently: true }), w, h }; };
      const SM = mk(160, 90), MD = mk(640, 360);
      async function seek(t) {
        t = Math.max(0, Math.min(D - 0.1, t));
        for (let k = 0; k < 4; k++) {
          await seek1(t);
          if (Math.abs(v.currentTime - t) < 0.3) return;
          S.reseeks = (S.reseeks || 0) + 1;
          await sleep(300);
        }
      }
      let rvfc = null; // コマが描かれた知らせが来るか (null = まだ分からない)
      async function seek1(t) {
        await new Promise((res) => {
          let done = false;
          const fin = () => { if (!done) { done = true; res(); } };
          // 画面の外の別 origin の iframe では描画が止められ、コマが描かれた知らせ (requestVideoFrameCallback) が来ない。
          // そのうえ待ち時間 (setTimeout) も 1 秒単位に間引かれる。一度来なかったら、以後はシークが済んだ知らせですぐ絵を取る
          v.addEventListener('seeked', () => {
            if (v.requestVideoFrameCallback && rvfc !== false) {
              v.requestVideoFrameCallback(() => { rvfc = true; fin(); });
              setTimeout(() => { if (!done && rvfc == null) { rvfc = false; L('no frame callback: take the frame on seeked'); } fin(); }, 600);
            } else fin();
          }, { once: true });
          v.currentTime = t;
          setTimeout(fin, 15000);
        });
        if (!v.paused) v.pause();
        S.seeks++;
        if (S.seeks % 20 === 0) post({ ev: 'progress', phase: S.phase, t: Math.round(v.currentTime), d: Math.round(D) });
      }
      const gray = (d, n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return a; };
      const small = () => { SM.g.drawImage(v, 0, 0, 160, 90); return gray(SM.g.getImageData(0, 0, 160, 90).data, 160 * 90); };
      const mid = () => MD.g.drawImage(v, 0, 0, 640, 360);
      const crop = (b) => gray(MD.g.getImageData(b.x, b.y, b.w, b.h).data, b.w * b.h);
      const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
      const cropAt = async (t, b) => { await seek(t); mid(); return crop(b); };
      const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
      const clampBox = (b) => { const x = Math.max(0, b.x), y = Math.max(0, b.y); return { x, y, w: Math.min(640 - x, b.w), h: Math.min(360 - y, b.h) }; };
      const excluded = [];

      // ones digit of a running timer: changes over 1 s, same again after 10 s
      async function detect(t) {
        await seek(t); const f0 = small();
        await seek(t + 1); const f1 = small();
        await seek(t + 5); const f5 = small();
        await seek(t + 10); const f10 = small();
        const m = new Uint8Array(160 * 90);
        for (let i = 0; i < m.length; i++) m[i] = (Math.abs(f1[i] - f0[i]) > 20 || Math.abs(f5[i] - f0[i]) > 20) && Math.abs(f10[i] - f0[i]) < 10 ? 1 : 0;
        const seen = new Uint8Array(m.length);
        let best = null;
        for (let i = 0; i < m.length; i++) {
          if (!m[i] || seen[i]) continue;
          const q = [i]; seen[i] = 1;
          let n = 0, x0 = 999, y0 = 999, x1 = -1, y1 = -1;
          while (q.length) {
            const j = q.pop(); n++;
            const x = j % 160, y = (j / 160) | 0;
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= 160 || yy >= 90) continue;
              const k = yy * 160 + xx;
              if (m[k] && !seen[k]) { seen[k] = 1; q.push(k); }
            }
          }
          const w = x1 - x0 + 1, h = y1 - y0 + 1;
          if (n >= 6 && w <= 25 && h <= 30 && h >= 4 && w >= 2) {
            const box = clampBox({ x: x0 * 4 - 4, y: y0 * 4 - 4, w: w * 4 + 8, h: h * 4 + 8 });
            if (excluded.some((e) => overlap(e, box))) continue;
            // how exactly the box comes back after 10 s, versus how much it changes after 1 s
            let s1 = 0, s5 = 0, s10 = 0, c = 0;
            for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { const k = yy * 160 + xx; s1 += Math.abs(f1[k] - f0[k]); s5 += Math.abs(f5[k] - f0[k]); s10 += Math.abs(f10[k] - f0[k]); c++; }
            const score = (Math.min(s1, s5) / c) / (s10 / c + 1);
            if (score < 2) continue;
            if (!best || score > best.score) best = { ...box, n, score: +score.toFixed(1) };
          }
        }
        L('detect', t.toFixed(0), best ? JSON.stringify(best) : 'none');
        return best;
      }
      // shrink the box to the columns/rows that change in 1 s or 5 s but come back after 10 s (ones digit only)
      async function tighten(t, b) {
        const ex = clampBox({ x: b.x - 12, y: b.y - 8, w: b.w + 24, h: b.h + 16 });
        const c0 = await cropAt(t, ex), c1 = await cropAt(t + 1, ex), c5 = await cropAt(t + 5, ex), c10 = await cropAt(t + 10, ex);
        const colA = new Float32Array(ex.w), colB = new Float32Array(ex.w), rowA = new Float32Array(ex.h);
        for (let y = 0; y < ex.h; y++) for (let x = 0; x < ex.w; x++) {
          const i = y * ex.w + x;
          const ch = Math.max(Math.abs(c1[i] - c0[i]), Math.abs(c5[i] - c0[i]));
          colA[x] += ch / ex.h; colB[x] += Math.abs(c10[i] - c0[i]) / ex.h;
        }
        const good = [];
        for (let x = 0; x < ex.w; x++) good.push(colA[x] > 6 && colB[x] < colA[x] * 0.35);
        // longest run of good columns (allow 2-px gaps)
        let best = null, st = -1, gap = 0;
        for (let x = 0; x <= ex.w; x++) {
          if (x < ex.w && good[x]) { if (st < 0) st = x; gap = 0; }
          else if (st >= 0) { gap++; if (gap > 2 || x === ex.w) { const en = x - gap; if (!best || en - st > best[1] - best[0]) best = [st, en]; st = -1; gap = 0; } }
        }
        if (!best || best[1] - best[0] < 3) return b;
        const x0 = best[0], x1 = best[1];
        for (let y = 0; y < ex.h; y++) for (let x = x0; x <= x1; x++) { const i = y * ex.w + x; rowA[y] += Math.max(Math.abs(c1[i] - c0[i]), Math.abs(c5[i] - c0[i])); }
        let y0 = 0, y1 = ex.h - 1;
        const rmax = Math.max(...rowA);
        while (y0 < y1 && rowA[y0] < rmax * 0.1) y0++;
        while (y1 > y0 && rowA[y1] < rmax * 0.1) y1--;
        const nb = clampBox({ x: ex.x + x0 - 2, y: ex.y + y0 - 2, w: x1 - x0 + 5, h: y1 - y0 + 5 });
        L('tighten', JSON.stringify(b), '->', JSON.stringify(nb));
        return nb;
      }
      async function running(t, b) {
        const a = await cropAt(t, b), c = await cropAt(t + 1, b), e = await cropAt(t + 10, b);
        const d1 = mad(a, c), d10 = mad(a, e);
        return d1 > 8 && d10 < d1 * 0.4;
      }
      async function refine(lo, hi, b) {
        const ref = await cropAt(lo, b);
        let a = lo, z = hi + 1.6;
        while (z - a > 0.02) { const m = (a + z) / 2; if (mad(await cropAt(m, b), ref) > 8) z = m; else a = m; }
        return z;
      }

      // 時刻 t に、動いているタイマーの 1 の位らしい所を探す (候補を安く確かめて、通ったものを返す)
      async function findCandidate(t) {
        for (let tries = 0; tries < 4; tries++) {
          const b0 = await detect(t);
          if (!b0) return null;
          const b = await tighten(t, b0);
          if (b !== b0) excluded.push(b0);
          // cheap check: same again after 20 s, different after 3 s
          const a = await cropAt(t, b), c = await cropAt(t + 20, b), e = await cropAt(t + 3, b), f = await cropAt(t + 2, b);
          const d20 = mad(a, c), d3 = mad(a, e), d2 = mad(a, f), d23 = mad(e, f);
          L('quick', JSON.stringify(b), 'd2', d2.toFixed(1), 'd3', d3.toFixed(1), 'd23', d23.toFixed(1), 'd20', d20.toFixed(1));
          if (d3 > 8 && d2 > 8 && d23 > 8 && d20 < Math.min(d2, d3) * 0.3) { S.cands = (S.cands || 0) + 1; return b; }
          excluded.push(b);
        }
        return null;
      }

            let box = null, zero = null, tm = null, pos = null, thr = null;
      // ---- 先に配信のまばらな所だけ見る。どこにも動いているタイマーが無ければ、最後まで見ずに終える
      if (!FULL) {
        S.phase = 'sparse';
        for (const f of SPARSE_AT) {
          const b = await findCandidate(Math.max(30, Math.min(D - 25, f * D)));
          if (b) {
            box = b;
            break;
          }
        }
        // 題・概要欄に同時視聴らしい言葉があるなら、まばらな所がたまたま作品の外だっただけかもしれない → 使う人に聞く
        if (!box) throw new Error(S.hint ? 'ask' : 'none');
      }

      // ---- 1st work
      S.phase = 'first';
      let t = 30;
      while (zero === null) {
        let prev = null, hit = null;
        for (; t < D - 12; t += 600) {
          if (box) { if (await running(t, box)) { hit = t; break; } }
          else {
            const found = await findCandidate(t);
            if (found) { box = found; hit = t; break; }
          }
          prev = t;
        }
        if (hit === null) throw new Error('no running timer found');
        let lo = prev ?? Math.max(0, hit - 600), hi = hit;
        while (hi - lo > 0.5) { const m = (lo + hi) / 2; if (await running(m, box)) hi = m; else lo = m; }
        // hi is in [S, S+0.5] (S = the timer starts running), so hi+0.3 still shows the start value
        // and the first tick is within (hi+0.3, hi+1.6]
        const tick = await refine(hi + 0.3, hi, box);
        // 11 frames: j=0 at tick-0.5 shows V0, j at tick+j-0.5 shows V0+j
        const band = { x: 0, y: box.y, w: Math.min(640, box.x + box.w), h: box.h };
        const frames = [];
        for (let j = 0; j <= 10; j++) { await seek(tick + j - 0.5); mid(); frames.push(MD.g.getImageData(band.x, band.y, band.w, band.h)); }
        const cropF = (j, x) => { const d = frames[j].data, w = band.w, a = new Float32Array(box.w * box.h); for (let y = 0; y < box.h; y++) for (let xx = 0; xx < box.w; xx++) { const i = (y * w + x + xx) * 4; a[y * box.w + xx] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; } return a; };
        const ones = frames.map((_, j) => cropF(j, box.x));
        const th = 12;
        // positions: where some ones-template matches along the row
        const scores = [];
        for (let x = 0; x <= box.x; x++) { const c = cropF(0, x); let m = 1e9; for (let j = 0; j <= 10; j++) m = Math.min(m, mad(c, ones[j])); scores.push(m); }
        const mins = [];
        for (let x = 0; x < scores.length; x++) {
          if (scores[x] > th) continue;
          const lo2 = Math.max(0, x - 4), hi2 = Math.min(scores.length - 1, x + 4);
          let isMin = true;
          for (let k = lo2; k <= hi2; k++) if (scores[k] < scores[x]) { isMin = false; break; }
          if (isMin && (!mins.length || x - mins[mins.length - 1] >= box.w * 0.5)) mins.push(x);
        }
        // contiguous run ending at ones position
        const run = [box.x];
        for (let i = mins.length - 1; i >= 0; i--) {
          const x = mins[i];
          if (x >= run[0]) continue;
          if (run[0] - x <= box.w * 2.6) run.unshift(x); else break;
        }
        // checks that this is really a timer
        const std = (a) => { let m = 0; for (const x of a) m += x; m /= a.length; let s = 0; for (const x of a) s += (x - m) ** 2; return Math.sqrt(s / a.length); };
        let minPair = 1e9;
        for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) minPair = Math.min(minPair, mad(ones[i], ones[j]));
        // carry: the tens digit changes exactly once in the 10 transitions; there the ones digit becomes 0
        let carryAt = -1, carries = 0;
        if (run.length >= 2) {
          const tx = run[run.length - 2];
          for (let j = 1; j <= 10; j++) if (mad(cropF(j - 1, tx), cropF(j, tx)) > th) { carries++; carryAt = j; }
        }
        const contrast = std(ones[0]);
        L('first-candidate', tick.toFixed(2), 'digits', run.length, 'minPair', minPair.toFixed(1), 'contrast', contrast.toFixed(1), 'carries', carries, 'at', carryAt);
        if (run.length >= 4 && run.length <= 6 && contrast > 20 && minPair > Math.max(8, th) && carries === 1) {
          // label: frame carryAt shows ones = 0, so frame j shows (j - carryAt) mod 10
          const tms = new Array(10);
          for (let j = 0; j <= 10; j++) { const lab = (((j - carryAt) % 10) + 10) % 10; if (!tms[lab]) tms[lab] = ones[j]; }
          tm = tms; pos = run; thr = th;
          const r0 = await read(tick - 0.5);
          const V0 = r0.V;
          zero = tick - (V0 + 1);
          pushWork({ kind: 'start', startValue: V0, timerStart: +(tick - 1).toFixed(2), zero: +zero.toFixed(2), tick: +tick.toFixed(2), seeks: S.seeks });
          S.box = box; S.pos = pos;
        } else {
          excluded.push(box); box = null; t = hit;
          L('excluded candidate (not a timer)');
        }
      }

      // ---- remaining works: read digits, virtual zero = t - value
      S.phase = 'rest';
      async function read(t2) {
        await seek(t2); mid();
        let V = 0, ok = true, maxd = 0;
        const digs = [];
        for (const x of pos) {
          const c = crop({ x, y: box.y, w: box.w, h: box.h });
          let bi = -1, bd = 1e9;
          for (let k = 0; k < 10; k++) { const d = mad(c, tm[k]); if (d < bd) { bd = d; bi = k; } }
          digs.push(bi); maxd = Math.max(maxd, bd);
          if (bd > thr * 1.5) ok = false;
        }
        const r = digs.slice().reverse(); // s1 s10 m1 m10 h1 h10
        const pw = [1, 10, 60, 600, 3600, 36000];
        for (let i = 0; i < r.length; i++) V += r[i] * pw[i];
        return { V, ok, maxd };
      }
      let cur = zero, lastGood = S.works[0].tick + 0.5;
      t = S.works[0].tick + 600;
      while (t < D - 3) {
        const r = await read(t);
        if (r.ok && Math.abs(t - r.V - cur) <= 1.5) { lastGood = t; t += 600; continue; }
        const r2 = r.ok ? await read(t + 1.5) : null;
        const runningNew = r.ok && r2 && r2.ok && r2.V !== r.V && Math.abs(t + 1.5 - r2.V - (t - r.V)) <= 1.5;
        if (!runningNew) { t += 60; continue; }
        const o = t - r.V;
        let lo = lastGood, hi = t;
        while (hi - lo > 0.5) { const m = (lo + hi) / 2; const rm = await read(m); if (rm.ok && Math.abs(m - rm.V - o) <= 1.5) hi = m; else lo = m; }
        // reset (new work) or resume (same work continues)?
        const vh = (await read(hi)).V;
        const isStart = vh <= 3;
        const vb = isStart ? 0 : (await read(lo)).V;
        // first time the display shows vb+1 .. vb+3
        let a2 = hi - 2, z2 = hi + 2.5;
        while (z2 - a2 > 0.02) { const m = (a2 + z2) / 2; const rm = await read(m); if (rm.ok && rm.V >= vb + 1 && rm.V <= vb + 3) z2 = m; else a2 = m; }
        const tick = z2;
        const z = tick - (vb + 1);
        pushWork({ kind: isStart ? 'start' : 'resume', zero: +z.toFixed(2), tick: +tick.toFixed(2), value: vb, seeks: S.seeks });
        cur = z; lastGood = tick + 0.1; t = tick + 600;
      }
      S.N = S.works.filter((w) => w.kind === 'start').length;
    } catch (e) {
      S.err = String(e && e.stack || e);
    } finally {
      S.done = true;
      post({ ev: 'done', result: S.works.length ? 'found' : /ask/.test(S.err || '') ? 'ask' : 'none', err: S.err, cands: S.cands || 0, seeks: S.seeks });
    }
  })();
})();
