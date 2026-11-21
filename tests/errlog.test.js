// エラーの記録 (extension/errlog.js): まとめる・件数の上限・古いものを捨てる・届いたものを確かめる
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const ticks = async () => {
  for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r));
};

/** service worker として記録を始めた ErrLog (console は本物を汚さないよう仮のもの) */
function setup() {
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const env = load(['errlog.js'], {
    globals: { console: quiet, setTimeout: (fn) => (queueMicrotask(fn), 1), document: undefined },
  });
  let onMessage = null;
  env.chrome.runtime.onMessage = { addListener: (fn) => (onMessage = fn) };
  env.get("ErrLog.install('background')");
  const list = async () => {
    await ticks();
    return plain(await env.get('ErrLog.list()'));
  };
  return { env, quiet: env.get('console'), send: (msg, sender) => onMessage(msg, sender), list };
}

test('「hakomado:」の警告と console.error を記録し、同じものは 1 件にまとめて数える', async () => {
  const { quiet, list } = setup();
  for (let k = 0; k < 3; k++) quiet.warn('hakomado: 取得に失敗', new Error('HTTP 503'));
  quiet.warn('ほかの警告は記録しない');
  quiet.error('こわれた', { a: 1 });
  const got = await list();
  assert.equal(got.length, 2);
  const warn = got.find((e) => e.kind === 'warn');
  assert.equal(warn.n, 3);
  assert.equal(warn.src, 'background');
  assert.match(warn.msg, /^hakomado: 取得に失敗 Error: HTTP 503/);
  assert.equal(got.find((e) => e.kind === 'error').msg, 'こわれた {"a":1}');
});

test('長いメッセージは切り、新しい順に 100 件まで、7 日より古いものは捨てる', async () => {
  const { env, quiet, list } = setup();
  await env.chrome.storage.local.set({ errorLog: [{ src: 'grid', kind: 'warn', msg: '古い', t: Date.now() - 8 * 86400000, n: 1 }] });
  quiet.warn('hakomado: ' + 'x'.repeat(2000));
  for (let k = 0; k < 120; k++) quiet.warn(`hakomado: ${k}`);
  const got = await list();
  assert.equal(got.length, 100);
  assert.ok(!got.some((e) => e.msg === '古い'));
  assert.ok(got.every((e) => e.msg.length <= 500));
  for (let k = 1; k < got.length; k++) assert.ok(got[k - 1].t >= got[k].t);
});

test('ほかの場所から届いた記録は、形を確かめてから足す (枠の中からは grid / background を名乗れない)', async () => {
  const { send, list } = setup();
  const yt = { id: 'test', url: 'https://www.youtube.com/watch?v=x' };
  send(
    {
      type: 'hakomado-errlog',
      entries: [
        null,
        { src: 'watch', kind: 'exception', msg: '枠の例外', t: 1e15 },
        { src: 'grid', kind: 'warn', msg: '名乗り' },
        { src: 'chat', kind: 'bad', msg: '種類が違う' },
        { src: 'chat', kind: 'warn', msg: 42 },
      ],
    },
    yt,
  );
  send({ type: 'hakomado-errlog', entries: [{ src: 'grid', kind: 'warn', msg: '画面から' }] }, { id: 'test', url: 'chrome-extension://test/grid.html' });
  send({ type: 'hakomado-errlog', entries: [{ src: 'watch', kind: 'warn', msg: 'ほかの拡張機能' }] }, { id: 'other', url: yt.url });
  const got = await list();
  assert.deepEqual(got.map((e) => e.msg).sort(), ['枠の例外', '画面から'].sort());
  assert.ok(got.every((e) => e.t <= Date.now()));
});
