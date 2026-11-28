// hakomado: 動画ごとの全編の音の大きさの波形 (同期の調整の「〰 波形」の帯。HAKO-39)。
// 枠や下見用のプレイヤーの中の content/mix.js が送ってくる音の記録 (envChunk。✨ 自動補正と同じ形) を、
// 動画の再生位置 0.1 秒ごとにまとめて、0〜255 の 1 バイトで持つ (0 = まだ無い。3 時間で約 108KB)。
// - 下見 (16 倍速) でも等速でも、記録の印 (marks) の再生位置で置くので、同じ位置に入る
// - 同じ位置に新しい記録が来たら、この画面で集めた分の平均で書き直す
// - 保存は IndexedDB `hakomado-cache` の wave (IdbCache)。取り直せるのでバックアップには入れない。外へは送らない
/* exported Waves */
'use strict';

const Waves = (() => {
  const STEP = 0.1; // 秒
  const MAX_SEC = 24 * 3600;
  const FLOOR_DB = -60; // これより小さい音は 1 (いちばん小さい) にする
  const SAVE_MS = 5000;
  const GAP_SEC = 2; // これより短い抜け (広告の切れ目・読み込み待ちなど) は、無いところとみなさない

  /** 音の大きさ (|x| の平均、0〜1) → 1〜255 (dB で並べる。0 は「まだ無い」に使うので使わない) */
  function quantize(level) {
    if (!(level > 0)) return 1;
    const db = 20 * Math.log10(level);
    const f = Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
    return 1 + Math.round(f * 254);
  }

  /**
   * 音の記録 1 回分 → 再生位置 STEP 秒ごとの {合計, 個数}。
   * 記録 = {sr, per, bins: 包絡 (per サンプルごとの |x| の平均), marks: [[累計サンプル数, 再生位置 (秒), 速度], ...]}。
   * 送る直前に印を付けているので、最後の印がこの記録の終わり。各ビンの位置は、すぐ後ろの印から速度で戻して求める
   * @returns {Map<number, [number, number]>} 位置の番号 (再生位置 / STEP) → [合計, 個数]
   */
  function stepsOf(chunk, step = STEP) {
    const out = new Map();
    const { sr, per, bins, marks } = chunk || {};
    if (!(sr > 0) || !(per > 0) || !bins?.length || !marks?.length) return out;
    const s0 = marks[marks.length - 1][0] - bins.length * per;
    let m = 0;
    for (let j = 0; j < bins.length; j++) {
      const s = s0 + (j + 0.5) * per;
      while (m < marks.length - 1 && marks[m][0] < s) m++;
      const [ms, mt, mr] = marks[m];
      const t = mt - ((mr || 1) * (ms - s)) / sr;
      if (!(t >= 0) || t >= MAX_SEC || !Number.isFinite(bins[j])) continue;
      const k = Math.floor(t / step);
      const e = out.get(k);
      if (e) {
        e[0] += bins[j];
        e[1]++;
      } else out.set(k, [bins[j], 1]);
    }
    return out;
  }

  /** 枠から届いた音の記録が、扱える形か (大きすぎる・形の違う記録で重くならないように。AudioSync.chunk と同じ確かめ方) */
  function validChunk(d) {
    const sr = Number(d?.sr);
    const per = Number(d?.per);
    if (!(sr >= 8000 && sr <= 192000) || !Number.isInteger(per) || per < 1 || per > 1000) return false;
    if (!(d.bins instanceof Float32Array) || d.bins.length > 200000 || !Array.isArray(d.marks) || !d.marks.length || d.marks.length > 20000) return false;
    return d.marks.every((m) => Array.isArray(m) && Number.isFinite(m[0]) && Number.isFinite(m[1]));
  }

  /** vals の [from, to) 秒のうち、記録のある割合 (0〜1) */
  function coverage(vals, from, to, step = STEP) {
    const a = Math.max(0, Math.floor(from / step));
    const b = Math.floor(to / step);
    if (!(b > a)) return 1;
    let have = 0;
    for (let k = a; k < b; k++) if (vals && k < vals.length && vals[k]) have++;
    return have / (b - a);
  }

  /** vals の [from, to) 秒で、最初の「GAP_SEC 秒以上続く抜け」の頭 (秒)。抜けが無ければ null */
  function firstGap(vals, from, to, step = STEP, gapSec = GAP_SEC) {
    const a = Math.max(0, Math.floor(from / step));
    const b = Math.floor(to / step);
    const need = Math.max(1, Math.round(gapSec / step));
    let run = 0;
    for (let k = a; k < b; k++) {
      if (vals && k < vals.length && vals[k]) run = 0;
      else if (++run >= need || k === b - 1) return (k - run + 1) * step;
    }
    return null;
  }

  // ---- この画面で持っている分 (videoId → {vals, sum, cnt, dirty})
  const mem = new Map();
  const loading = new Map();
  const listeners = new Set();
  let saveTimer = 0;

  /** 保存してある分を読む (済んでいれば何もしない) */
  function ensure(id) {
    if (mem.has(id)) return Promise.resolve(mem.get(id));
    if (!loading.has(id)) {
      loading.set(
        id,
        (async () => {
          let saved = null;
          try {
            saved = await IdbCache.getWave(id);
          } catch (e) {
            console.warn('hakomado: 波形を読めませんでした', e);
          }
          const vals = saved?.vals instanceof Uint8Array ? saved.vals : new Uint8Array(0);
          const w = { vals, sum: null, cnt: null, dirty: false };
          mem.set(id, w);
          loading.delete(id);
          return w;
        })(),
      );
    }
    return loading.get(id);
  }

  function grow(w, n) {
    if (n <= w.vals.length) return;
    const size = Math.min(Math.ceil(MAX_SEC / STEP), Math.max(n, Math.ceil(w.vals.length * 1.5), 6000));
    const v = new Uint8Array(size);
    v.set(w.vals);
    w.vals = v;
    if (w.sum) {
      const s = new Float32Array(size);
      s.set(w.sum);
      w.sum = s;
      const c = new Uint16Array(size);
      c.set(w.cnt);
      w.cnt = c;
    }
  }

  /** 音の記録を足す (読み込みを待ってから) */
  async function feed(id, chunk) {
    if (!id) return;
    const steps = stepsOf(chunk);
    if (!steps.size) return;
    const w = await ensure(id);
    grow(w, Math.max(...steps.keys()) + 1);
    if (!w.sum) {
      w.sum = new Float32Array(w.vals.length);
      w.cnt = new Uint16Array(w.vals.length);
    }
    for (const [k, [s, n]] of steps) {
      if (w.cnt[k] > 60000) continue;
      w.sum[k] += s;
      w.cnt[k] += n;
      w.vals[k] = quantize(w.sum[k] / w.cnt[k]);
    }
    w.dirty = true;
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_MS);
    for (const f of listeners) f(id);
  }

  /** 保存してある波形 saved のうち、この画面でまだ無いところを w に足す (足したら true) */
  function adopt(w, saved) {
    let changed = false;
    if (saved.length > w.vals.length) grow(w, saved.length);
    for (let k = 0; k < saved.length; k++) {
      if (!w.vals[k] && saved[k]) {
        w.vals[k] = saved[k];
        changed = true;
      }
    }
    return changed;
  }

  /**
   * 変わった分を保存する (末尾のまだ無いところは切って持つ)。丸ごと書くので、ほかのタブが同じ動画に足した分を先に取り込む
   * (読んでから書くまでの間に割り込まれないよう、タブをまたいで 1 つずつ)
   */
  async function save() {
    saveTimer = 0;
    for (const [id, w] of mem) {
      if (!w.dirty) continue;
      w.dirty = false;
      const write = async () => {
        const saved = await IdbCache.getWave(id);
        if (saved?.vals instanceof Uint8Array && adopt(w, saved.vals)) for (const f of listeners) f(id);
        let end = w.vals.length;
        while (end > 0 && !w.vals[end - 1]) end--;
        await IdbCache.putWave(id, w.vals.slice(0, end));
      };
      try {
        if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('hakomado-wave', write);
        else await write();
      } catch (e) {
        console.warn('hakomado: 波形を保存できませんでした', e);
      }
    }
  }

  // 画面を閉じるときに、まだ保存していない分を書く (16 倍速では 5 秒で 1 分以上ぶんになるため)
  if (typeof addEventListener === 'function') addEventListener('pagehide', () => save());

  return {
    STEP,
    quantize,
    stepsOf,
    validChunk,
    coverage,
    firstGap,
    ensure,
    feed,
    save,
    /** 持っている波形 (読んでいなければ null) */
    get: (id) => mem.get(id)?.vals || null,
    /** 波形が変わったら呼ぶ (videoId を渡す) */
    onChange: (f) => listeners.add(f),
  };
})();
