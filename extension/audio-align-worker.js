// hakomado: ✨ 自動補正の計算 (audio-align.js) を、画面とは別のスレッドで動かす Worker。
// 枠が多いと計算に何秒もかかるので、その間に画面や同期の処理が止まらないように (sync.js の AudioSync から使う)。
// 受け取る: {id, items, ref} (items は AudioAlign.analyze と同じ。track.bins は Float32Array)
// 返す: {id, res} / {id, error}
/* global AudioAlign */
'use strict';

importScripts('audio-align.js');

self.onmessage = async (e) => {
  const { id, items, ref } = e.data || {};
  try {
    const res = await AudioAlign.analyze(items, ref, { yieldFn: () => Promise.resolve() });
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
