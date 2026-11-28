// 枠の中の音の経路 (extension/content/mix.js): ほかの拡張機能などが先に動画の音を使っていて、音を通せないとき (HAKO-58)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

/** 音の部品の小さな代わり。createMediaElementSource は、taken に入っている video では InvalidStateError を投げる */
function setup() {
  const posted = [];
  const taken = new Set();
  let createCalls = 0;
  const intervals = [];
  const param = () => ({ setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {} });
  const node = () => ({ connect: (n) => n, disconnect() {}, pan: param(), gain: param(), delayTime: param() });
  class AudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = node();
    }
    addEventListener() {}
    async resume() {}
    async close() {}
    createMediaElementSource(v) {
      createCalls++;
      if (taken.has(v)) throw new Error('InvalidStateError: already connected');
      return node();
    }
  }
  const globals = {
    window: { parent: { postMessage: (msg) => posted.push(msg) }, addEventListener() {} },
    AudioContext,
    StereoPannerNode: function () { return node(); },
    GainNode: function () { return node(); },
    DelayNode: function () { return node(); },
    MediaStreamAudioDestinationNode: function () {
      return { ...node(), stream: { getAudioTracks: () => [{ clone: () => ({ stop() {} }) }] } };
    },
    MediaStreamTrackProcessor: function () {
      return { readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) } };
    },
    setInterval: (fn) => intervals.push(fn) && intervals.length,
    clearInterval() {},
  };
  const env = load(['content/mix.js'], { globals });
  let current = { id: 1, muted: false, volume: 1 };
  const mix = env.get('HakomadoMix')({
    video: () => current,
    adShowing: () => false,
    setMuted() {},
    unmuteQuietly() {},
    parentOrigin: 'chrome-extension://test',
  });
  return {
    mix,
    posted,
    taken,
    intervals,
    calls: () => createCalls,
    swap: (v) => {
      current = v;
    },
    video: () => current,
  };
}

test('ふだんは左右・音量・遅延を変えられ、ok を返す', async () => {
  const s = setup();
  await s.mix.set(0.5, 1, 0);
  assert.deepEqual(plain(s.posted), [{ hakomado: 'mix', ok: true }]);
});

test('音を通せない枠は、理由 (taken) を付けて ok: false を返す。試すのは 1 回だけ', async () => {
  const s = setup();
  s.taken.add(s.video());
  await s.mix.set(0.5, 1, 0);
  await s.mix.set(-0.5, 1, 0);
  assert.deepEqual(plain(s.posted), [
    { hakomado: 'mix', ok: false, reason: 'taken' },
    { hakomado: 'mix', ok: false, reason: 'taken' },
  ]);
  assert.equal(s.calls(), 1, '断られた動画に作り直しを試さない (エラーを出し続けない)');
});

test('✨ 自動補正・🎚 音量バランスの記録も、理由を付けて始められなかったと返す (待ったままにしない)', async () => {
  const s = setup();
  s.taken.add(s.video());
  s.mix.measure(true, false);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(s.posted), [{ hakomado: 'measure', ok: false, reason: 'taken' }]);
  s.posted.length = 0;
  await s.mix.set(0, 1, 0, true); // 🎚 が記録を求める
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(s.posted.filter((m) => m.hakomado === 'level')), [{ hakomado: 'level', ok: false, reason: 'taken' }]);
});

test('動画が差し替わって音を通せなくなったら、一度だけ知らせる (2 秒ごとの見張りでエラーを出し続けない)', async () => {
  const s = setup();
  const before = s.intervals.length; // 作ったときの見張り (プレイヤーの音量のつまみ)
  await s.mix.set(0.5, 1, 0);
  assert.equal(s.intervals.length, before + 1, 'つないだら、差し替わりの見張りを始める');
  const watch = s.intervals.at(-1);
  const next = { id: 2, muted: false, volume: 1 };
  s.taken.add(next);
  s.swap(next);
  s.posted.length = 0;
  for (let k = 0; k < 5; k++) watch();
  assert.deepEqual(plain(s.posted), [{ hakomado: 'mix', ok: false, reason: 'taken' }]);
  assert.equal(s.calls(), 2, '最初の動画と、差し替わった動画で 1 回ずつ');
});
