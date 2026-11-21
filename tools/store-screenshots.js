// Chrome ウェブストアの掲載用スクリーンショット (1280×800) を、ダミーの配信で撮る。
//   node tools/store-screenshots.js [出力先フォルダ (既定: store-assets/screenshots/<lang>)] [--lang=ja|en]
// 小さいプロモーション タイル (440×280) は --promo を付ける (既定の出力先: store-assets/promo/<lang>)
//
// - E2E テストと同じく、extension/ を読み込んだ Chromium をまっさらなプロファイルで起動する
//   (ふだんの Chrome・YouTube アカウントには触れない。アドレスバーなども写らない)
// - YouTube への通信はすべて、この中で作ったダミー (映像の代わりの絵・チャット・RSS・視聴ページ) で返す。
//   他人の配信・サムネイル・チャンネルのアイコンは一切写らない (CHROMEWEBSTORE.md「スクリーンショットの決まり」)
// - チャンネル・配信のタイトルはすべて架空のもの
// - 同梱の Chromium が起動できない環境 (spawn UNKNOWN など) では E2E_CHANNEL=msedge で Edge を使う
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'extension');
const args = process.argv.slice(2);
const LANG = (args.find((a) => a.startsWith('--lang=')) || '--lang=ja').slice(7) === 'en' ? 'en' : 'ja';
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'store-assets', 'screenshots', LANG));
const W = 1280;
const H = 800;
const JA = LANG === 'ja';

// ---------------------------------------------------------------- 架空のチャンネルと配信
const now = Date.now();
const MIN = 60e3;
const id11 = (s) => (s + 'xxxxxxxxxxx').slice(0, 11);
const cid = (s) => ('UC' + s + 'x'.repeat(22)).slice(0, 24);

// scene = ダミーの映像の絵柄 (下の SCENES)
const CHANNELS = [
  { key: 'sora', name: JA ? '星見ソラ' : 'Sora Hoshimi', color: '#5b8cff', scene: 'night' },
  { key: 'mint', name: JA ? 'ミントの森ちゃんねる' : 'Mint Forest Ch.', color: '#2fbf8f', scene: 'forest' },
  { key: 'akane', name: JA ? '茜ゲームス' : 'Akane Games', color: '#ff6b5b', scene: 'game' },
  { key: 'umi', name: JA ? '波音うみ' : 'Umi Namine', color: '#29a9ff', scene: 'ocean' },
  { key: 'kuro', name: JA ? 'クロノ書房' : 'Chrono Books', color: '#9b7bff', scene: 'cafe' },
  { key: 'hana', name: JA ? '花咲ひより' : 'Hiyori Hanasaki', color: '#ff7ab8', scene: 'sunset' },
  { key: 'tetsu', name: JA ? '鉄道のある風景' : 'Rail Landscapes', color: '#f5a524', scene: 'city' },
  { key: 'yuki', name: JA ? '雪代ユキ' : 'Yuki Yukishiro', color: '#7fd6ff', scene: 'aurora' },
  { key: 'piano', name: JA ? 'よるのピアノ' : 'Night Piano', color: '#c48bff', scene: 'space' },
  { key: 'neko', name: JA ? 'ねこ日和' : 'Cat Days', color: '#ffb36b', scene: 'sunset' },
].map((c, i) => ({ ...c, channelId: cid(c.key), handle: '@' + c.key + 'demo', index: i }));

const T = JA
  ? {
      sora: '【雑談】星を見ながらまったり話そう🌙',
      mint: '【朝活】森の中で作業配信 / BGM あり',
      akane: '【初見】新作アクションを最後まで遊ぶ！',
      umi: '【歌枠】海の日なので海の歌を歌います🌊',
      kuro: '【読書会】今月の一冊をみんなで語る',
      hana: '【コラボ】夕暮れお絵かきリレー',
      tetsu: '【ライブカメラ】駅前の夜景 24 時間',
      yuki: '【耐久】オーロラが出るまで寝ない',
      piano: '【作業用】リクエストでピアノを弾く',
      neko: '【ゆる配信】ねこと一緒にお昼寝',
    }
  : {
      sora: 'Chill chat under the stars 🌙',
      mint: 'Morning study stream in the forest / BGM',
      akane: 'First playthrough of the new action game!',
      umi: 'Singing ocean songs for Ocean Day 🌊',
      kuro: 'Book club: this month’s pick',
      hana: 'Collab: sunset drawing relay',
      tetsu: 'Live camera: night view of the station, 24h',
      yuki: 'Staying up until the aurora shows up',
      piano: 'Piano requests for studying',
      neko: 'Lazy nap stream with my cats',
    };

// 動画 (配信): ch = チャンネル, state = live / upcoming / ended
const VIDEOS = [
  { ch: 'sora', state: 'live', startAt: now - 52 * MIN, viewers: 3120 },
  { ch: 'mint', state: 'live', startAt: now - 95 * MIN, viewers: 842 },
  { ch: 'akane', state: 'live', startAt: now - 18 * MIN, viewers: 5610 },
  { ch: 'umi', state: 'live', startAt: now - 34 * MIN, viewers: 2275 },
  { ch: 'kuro', state: 'live', startAt: now - 7 * MIN, viewers: 410 },
  { ch: 'tetsu', state: 'live', startAt: now - 600 * MIN, viewers: 1290 },
  { ch: 'hana', state: 'upcoming', startAt: now + 25 * MIN },
  { ch: 'yuki', state: 'upcoming', startAt: now + 140 * MIN },
  { ch: 'piano', state: 'upcoming', startAt: now + 22 * 60 * MIN },
  { ch: 'neko', state: 'ended', startAt: now - 26 * 60 * MIN, views: 18400 },
].map((v) => {
  const c = CHANNELS.find((x) => x.key === v.ch);
  return { ...v, videoId: id11('demo' + v.ch), title: T[v.ch], channel: c };
});
const videoById = new Map(VIDEOS.map((v) => [v.videoId, v]));
const vid = (ch) => VIDEOS.find((v) => v.ch === ch).videoId;

// ---------------------------------------------------------------- ダミーの絵 (SVG)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function iconSvg(c) {
  const initial = [...c.name][0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.color}"/><stop offset="1" stop-color="#1b1f2a"/></linearGradient></defs><rect width="88" height="88" fill="url(#g)"/><text x="44" y="58" font-size="40" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">${esc(initial)}</text></svg>`;
}
const iconDataUrl = (c) => 'data:image/svg+xml;base64,' + Buffer.from(iconSvg(c)).toString('base64');

// 映像の代わりの絵柄。どれも 1600×900 の SVG (枠いっぱいに広げる)
const SCENES = {
  night: (a) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset="1" stop-color="#2a2f6b"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${stars(70, 1)}
    <circle cx="1240" cy="210" r="90" fill="#fff6d5"/><circle cx="1280" cy="190" r="90" fill="#141a45"/>
    <path d="M0 720 Q300 600 620 690 T1200 650 T1600 700 V900 H0Z" fill="#141838"/>
    <path d="M0 800 Q400 720 800 790 T1600 770 V900 H0Z" fill="#0a0d24"/>
    ${a}`,
  forest: (a) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7f5e3"/><stop offset="1" stop-color="#7fd1a8"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    <circle cx="300" cy="180" r="110" fill="#fff8d0" opacity=".9"/>
    ${trees()}
    <rect y="780" width="1600" height="120" fill="#2e7d5b"/>
    ${a}`,
  game: (a) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a5b"/><stop offset="1" stop-color="#7b2ff7"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${grid()}
    <rect x="180" y="520" width="260" height="40" rx="8" fill="#ffd166"/><rect x="620" y="420" width="300" height="40" rx="8" fill="#06d6a0"/><rect x="1080" y="560" width="280" height="40" rx="8" fill="#ef476f"/>
    <circle cx="760" cy="370" r="44" fill="#fff"/><circle cx="774" cy="360" r="9" fill="#222"/>
    <rect x="60" y="50" width="420" height="34" rx="17" fill="#0006"/><rect x="66" y="56" width="300" height="22" rx="11" fill="#06d6a0"/>
    ${a}`,
  ocean: (a) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fe9ff"/><stop offset=".55" stop-color="#29a9ff"/><stop offset="1" stop-color="#0b4f8a"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    <circle cx="1200" cy="200" r="100" fill="#fffbe0"/>
    ${waves()}
    ${a}`,
  cafe: (a) => `
    <rect width="1600" height="900" fill="#3b2a2a"/>
    <rect x="0" y="600" width="1600" height="300" fill="#6b4a3a"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${120 + i * 70}" y="${180 + (i % 2) * 10}" width="54" height="${260 - (i % 3) * 30}" rx="6" fill="${['#e07a5f', '#81b29a', '#f2cc8f', '#3d405b', '#9b7bff', '#f4f1de'][i]}"/>`).join('')}
    <rect x="100" y="440" width="520" height="16" fill="#2a1d1d"/>
    <ellipse cx="1100" cy="640" rx="170" ry="34" fill="#2a1d1d"/>
    <rect x="1010" y="520" width="180" height="120" rx="20" fill="#f4f1de"/><path d="M1190 545 q60 10 0 70" stroke="#f4f1de" stroke-width="18" fill="none"/>
    <path d="M1060 500 q20 -40 0 -80 M1110 500 q20 -40 0 -80" stroke="#fff8" stroke-width="8" fill="none" stroke-linecap="round"/>
    <circle cx="1320" cy="160" r="160" fill="#ffd27a" opacity=".18"/>
    ${a}`,
  sunset: (a) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc1e0"/><stop offset=".5" stop-color="#ff9a8b"/><stop offset="1" stop-color="#ff6a88"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    <circle cx="800" cy="560" r="170" fill="#fff1c1"/>
    <path d="M0 620 L260 420 L480 600 L760 360 L1040 620 L1300 450 L1600 640 V900 H0Z" fill="#a8457a"/>
    <path d="M0 740 Q400 660 800 730 T1600 720 V900 H0Z" fill="#6a2c5a"/>
    ${a}`,
  city: (a) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1440"/><stop offset="1" stop-color="#5b3a8a"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${stars(30, 2)}
    ${city()}
    <rect y="760" width="1600" height="20" fill="#333"/><rect y="780" width="1600" height="120" fill="#15122a"/>
    <rect x="200" y="700" width="560" height="64" rx="14" fill="#e9ecef"/><rect x="200" y="726" width="560" height="10" fill="#f5a524"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${222 + i * 76}" y="708" width="54" height="16" rx="3" fill="#ffe8a3"/>`).join('')}
    ${a}`,
  aurora: (a) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03122b"/><stop offset="1" stop-color="#0d3b4f"/></linearGradient>
    <linearGradient id="au" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fffd4" stop-opacity="0"/><stop offset=".5" stop-color="#7fffd4" stop-opacity=".7"/><stop offset="1" stop-color="#b388ff" stop-opacity="0"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${stars(60, 3)}
    <path d="M0 260 C300 120 500 380 800 220 S1300 120 1600 260 L1600 480 C1300 360 1000 520 800 420 S300 380 0 480Z" fill="url(#au)"/>
    <path d="M0 760 L300 560 L520 720 L760 520 L1000 740 L1280 580 L1600 760 V900 H0Z" fill="#e8f4ff"/>
    <path d="M0 820 Q500 760 1000 820 T1600 810 V900 H0Z" fill="#c9dcef"/>
    ${a}`,
  space: (a) => `
    <rect width="1600" height="900" fill="#0a0620"/>
    ${stars(120, 4)}
    <circle cx="520" cy="470" r="200" fill="#c48bff"/><ellipse cx="520" cy="470" rx="330" ry="60" fill="none" stroke="#ffe0a3" stroke-width="16" transform="rotate(-14 520 470)"/>
    <circle cx="1250" cy="230" r="70" fill="#7fd6ff"/>
    ${a}`,
};

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}
function stars(n, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, () => `<circle cx="${r() * 1600}" cy="${r() * 560}" r="${1 + r() * 2.4}" fill="#fff" opacity="${0.4 + r() * 0.6}"/>`).join('');
}
function trees() {
  const r = rng(7);
  return Array.from({ length: 16 }, (_, i) => {
    const x = i * 105 + r() * 30;
    const h = 260 + r() * 200;
    const c = ['#1f6f50', '#2a8a62', '#3fa877'][i % 3];
    return `<rect x="${x + 36}" y="${780 - 60}" width="18" height="60" fill="#5b3a29"/><path d="M${x} ${780 - 50} L${x + 45} ${780 - h} L${x + 90} ${780 - 50}Z" fill="${c}"/>`;
  }).join('');
}
function grid() {
  let g = '';
  for (let x = 0; x <= 1600; x += 80) g += `<path d="M${x} 0 V900" stroke="#fff" stroke-opacity=".08"/>`;
  for (let y = 0; y <= 900; y += 80) g += `<path d="M0 ${y} H1600" stroke="#fff" stroke-opacity=".08"/>`;
  return g;
}
function waves() {
  return [0, 1, 2, 3]
    .map((i) => `<path d="M0 ${560 + i * 80} Q200 ${520 + i * 80} 400 ${560 + i * 80} T800 ${560 + i * 80} T1200 ${560 + i * 80} T1600 ${560 + i * 80} V900 H0Z" fill="#fff" opacity="${0.12 + i * 0.06}"/>`)
    .join('');
}
function city() {
  const r = rng(11);
  let s = '';
  for (let x = 0; x < 1600; ) {
    const w = 70 + r() * 90;
    const h = 180 + r() * 360;
    s += `<rect x="${x}" y="${760 - h}" width="${w - 6}" height="${h}" fill="#241c4f"/>`;
    for (let wy = 760 - h + 20; wy < 740; wy += 34) {
      for (let wx = x + 12; wx < x + w - 24; wx += 24) if (r() > 0.45) s += `<rect x="${wx}" y="${wy}" width="12" height="16" fill="#ffd27a" opacity="${0.5 + r() * 0.5}"/>`;
    }
    x += w;
  }
  return s;
}

function sceneSvg(v, { label = true } = {}) {
  const scene = SCENES[v.channel.scene] || SCENES.night;
  // 左下に配信のタイトルを小さく (配信の画面の中のテロップのつもり)
  const caption = label
    ? `<rect x="40" y="790" rx="14" width="${Math.min(1520, 60 + [...v.title].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x2000 ? 19 : 34), 0))}" height="70" fill="#000" opacity=".45"/><text x="70" y="838" font-size="34" font-family="'Noto Sans JP','Yu Gothic UI','Meiryo',sans-serif" font-weight="700" fill="#fff">${esc(v.title)}</text>`
    : '';
  const size = label ? "" : ' width="1280" height="720"';
  return `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 1600 900" preserveAspectRatio="xMinYMid slice">${scene(caption)}</svg>`;
}

// ---------------------------------------------------------------- ダミーの YouTube のページ
// 視聴ページ: 枠に入る (iframe) ときは絵を出し、拡張機能が状態を調べに取りに来た (fetch) ときも同じ HTML を返す。
// 中に ytInitialPlayerResponse と、プレイヤー API を真似た #movie_player を置く (content/watch-main.js が読む)
function playerResponse(v) {
  const iso = (t) => new Date(t).toISOString();
  return {
    playabilityStatus: { status: v.state === 'upcoming' ? 'LIVE_STREAM_OFFLINE' : 'OK' },
    videoDetails: {
      videoId: v.videoId,
      title: v.title,
      author: v.channel.name,
      channelId: v.channel.channelId,
      viewCount: String(v.views || v.viewers || 0),
      isLive: v.state === 'live',
      isUpcoming: v.state === 'upcoming',
      isLiveContent: true,
    },
    microformat: {
      playerMicroformatRenderer: {
        publishDate: iso(v.startAt),
        liveBroadcastDetails: {
          isLiveNow: v.state === 'live',
          startTimestamp: iso(v.startAt),
          ...(v.state === 'ended' ? { endTimestamp: iso(v.startAt + 90 * MIN) } : {}),
        },
      },
    },
  };
}

function watchPage(v) {
  const pr = playerResponse(v);
  // 拡張機能の parseWatchPage が読む形 (videoDetails の並び・scheduledStartTime・og:title)
  const details = `"videoDetails":{"videoId":"${v.videoId}","title":${JSON.stringify(v.title)},"author":${JSON.stringify(v.channel.name)},"channelId":"${v.channel.channelId}","isLive":${v.state === 'live'},"isUpcoming":${v.state === 'upcoming'},"isLiveContent":true}`;
  const extra = `"liveBroadcastDetails":{"startTimestamp":"${new Date(v.startAt).toISOString()}"},"scheduledStartTime":"${Math.round(v.startAt / 1000)}"`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta property="og:title" content="${esc(v.title)}"><title>${esc(v.title)}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#movie_player{position:fixed;inset:0}#movie_player svg{width:100%;height:100%;display:block}
.drift{animation:drift 14s ease-in-out infinite alternate}@keyframes drift{from{transform:scale(1.02) translate(0,0)}to{transform:scale(1.08) translate(-1.5%,-1%)}}</style>
<script>var ytInitialPlayerResponse = ${JSON.stringify(pr)};/* ${details} ${extra} */</script></head>
<body><div id="movie_player"><div class="drift" style="width:100%;height:100%">${sceneSvg(v)}</div></div>
<div id="view-count-holder"><ytd-watch-metadata><span id="view-count" aria-label="${v.viewers || 0} watching"></span></ytd-watch-metadata></div>
<script>
(() => {
  const p = document.getElementById('movie_player');
  const pr = window.ytInitialPlayerResponse;
  let muted = new URLSearchParams(location.search).get('hakomado_muted') !== '0';
  let vol = 100, t = ${v.state === 'ended' ? 1800 : 0};
  const startedAt = performance.now();
  Object.assign(p, {
    mute() { muted = true; }, unMute() { muted = false; }, isMuted() { return muted; },
    getVolume() { return vol; }, setVolume(x) { vol = x; },
    getPlayerResponse() { return pr; },
    getVideoData() { return { video_id: ${JSON.stringify(v.videoId)}, isLive: ${v.state === 'live'}, title: pr.videoDetails.title, author: pr.videoDetails.author }; },
    getCurrentTime() { return t + (performance.now() - startedAt) / 1000; }, getDuration() { return ${v.state === 'ended' ? 5400 : 0}; },
    getPlayerState() { return 1; }, playVideo() {}, pauseVideo() {}, seekTo(x) { t = x; },
    getPlaybackRate() { return 1; }, setPlaybackRate() {}, getAvailablePlaybackRates() { return [1]; },
  });
})();
</script></body></html>`;
}

// ライブチャット: content/chat.js が読む形 (yt-live-chat-item-list-renderer #items に yt-live-chat-text-message-renderer を足していく)
const CHAT_JA = [
  'こんばんは〜', 'きた！', 'わこつ', '888888', 'かわいい', 'ナイス！', 'それな', 'ｗｗｗｗｗ', 'たすかる', 'すごい！',
  '今日も楽しみにしてた', '同時視聴してます', '神回', 'おつかれさま', 'えらい', '草', '天才か？', 'ここすき', '初見です！', 'がんばれ〜',
  '音きれい', 'BGM いいね', 'その手があったか', '待ってました', '今北', 'ありがとう！', 'うますぎる', 'ほっこりする', '明日も見る', '😂😂😂',
];
const CHAT_EN = [
  'hi!!', 'lets go', 'LOL', 'so cute', 'nice!', 'gg', 'hello from Japan', 'first time here', 'clutch', 'that was amazing',
  'here for the stream', 'watching both POVs', 'W', 'otsu~', 'hype', 'so good', 'wow', 'love this song', 'good morning', '😂😂😂',
  'clean', 'BGM is nice', 'big brain', 'finally', 'just got here', 'thank you!', 'insane', 'so relaxing', 'see you tomorrow', '👏👏👏',
];
const NAMES = ['Mika', 'たろう', 'Ren', 'しずく', 'Kai', 'nana', 'Leo', 'ゆず', 'Haru', 'Sam', 'こはく', 'Aoi', 'Nico', 'みどり', 'Ash', 'Rin'];

function chatPage(seed) {
  const msgs = JA ? CHAT_JA : CHAT_EN;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0f0f0f;color:#fff;font:13px/1.5 'Noto Sans JP','Yu Gothic UI',Roboto,sans-serif;overflow:hidden}
.head{height:44px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #ffffff1f;font-size:15px}
yt-live-chat-item-list-renderer{display:block;position:absolute;top:45px;bottom:56px;left:0;right:0;overflow:hidden}
#items{position:absolute;bottom:0;left:0;right:0}
yt-live-chat-text-message-renderer{display:flex;gap:12px;padding:4px 16px;align-items:flex-start}
#author-photo{width:24px;height:24px;border-radius:50%;flex:none}
#author-name{color:#ffffffb3;margin-right:8px;font-weight:500}
.input{position:absolute;bottom:0;left:0;right:0;height:56px;border-top:1px solid #ffffff1f;display:flex;align-items:center;padding:0 16px}
.input span{flex:1;height:30px;border-radius:15px;background:#ffffff1a;color:#ffffff80;display:flex;align-items:center;padding:0 12px}
</style></head><body>
<div class="head">${JA ? '上位チャット' : 'Top chat'} ▾</div>
<yt-live-chat-item-list-renderer><div id="items"></div></yt-live-chat-item-list-renderer>
<div class="input"><span>${JA ? 'チャット...' : 'Chat...'}</span></div>
<script>
(() => {
  const msgs = ${JSON.stringify(msgs)}, names = ${JSON.stringify(NAMES)};
  const colors = ['#5b8cff','#2fbf8f','#ff6b5b','#f5a524','#c48bff','#ff7ab8','#29a9ff'];
  let s = ${seed + 1} * 7919;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const items = document.getElementById('items');
  function add() {
    const el = document.createElement('yt-live-chat-text-message-renderer');
    const photo = document.createElement('div'); photo.id = 'author-photo'; photo.style.background = pick(colors);
    const body = document.createElement('div');
    const a = document.createElement('span'); a.id = 'author-name'; a.textContent = pick(names);
    const m = document.createElement('span'); m.id = 'message'; m.textContent = pick(msgs);
    body.append(a, m); el.append(photo, body); items.append(el);
    while (items.children.length > 40) items.firstChild.remove();
  }
  for (let i = 0; i < 25; i++) add();
  (function loop() { add(); setTimeout(loop, 250 + rand() * 900); })();
})();
</script></body></html>`;
}

function feedXml(channelId) {
  const items = VIDEOS.filter((v) => v.channel.channelId === channelId);
  const entries = items
    .map(
      (v) => `<entry><yt:videoId>${v.videoId}</yt:videoId><title>${esc(v.title)}</title><published>${new Date(v.startAt - 3 * 3600e3).toISOString()}</published>
<media:group><media:community><media:statistics views="${v.state === 'upcoming' ? 0 : v.views || v.viewers || 1}"/></media:community></media:group></entry>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
}

async function routeFakeYouTube(context) {
  await context.route(/^https?:/, async (route) => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    if (host === 'www.youtube.com') {
      if (url.pathname === '/watch') {
        const v = videoById.get(url.searchParams.get('v'));
        if (v) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: watchPage(v) });
      }
      if (url.pathname === '/live_chat') {
        const v = videoById.get(url.searchParams.get('v'));
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: chatPage(v ? v.channel.index : 1) });
      }
      if (url.pathname === '/feeds/videos.xml') {
        const list = url.searchParams.get('playlist_id') || '';
        const c = CHANNELS.find((x) => 'UULV' + x.channelId.slice(2) === list);
        if (c) return route.fulfill({ contentType: 'application/xml', body: feedXml(c.channelId) });
      }
      if (url.pathname === '/oembed') {
        const id = (url.searchParams.get('url') || '').match(/v=([\w-]{11})/)?.[1];
        const v = videoById.get(id);
        if (v) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: v.title, author_name: v.channel.name }) });
      }
    }
    if (host === 'i.ytimg.com') {
      const id = url.pathname.split('/')[2];
      const v = videoById.get(id);
      if (v) return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: sceneSvg(v, { label: false }) });
    }
    return route.abort();
  });
}

// ---------------------------------------------------------------- 保存データ
function tile(ch, extra = {}) {
  const v = VIDEOS.find((x) => x.ch === ch);
  return { input: v.videoId, videoId: v.videoId, chat: false, danmaku: true, muted: true, auto: false, queue: false, fill: false, label: v.channel.name, pan: 0, gain: 1, ...extra };
}

async function seed(worker, session) {
  await worker.evaluate(
    async ({ favorites, session }) => {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('session:')));
      await chrome.storage.local.set({
        tourPending: false,
        presetVersion: 999,
        presetsDeclined: true,
        favorites,
        ...(session ? { ['session:shot' + Date.now()]: { dmAuto: true, updatedAt: Date.now(), ...session } } : {}),
      });
    },
    {
      favorites: CHANNELS.map((c) => ({ channelId: c.channelId, handle: c.handle, name: c.name, icon: iconDataUrl(c), ...(['sora', 'umi'].includes(c.key) ? { star: true } : {}) })),
      session,
    },
  );
}

// ---------------------------------------------------------------- 小さいプロモーション タイル (440×280)
// ロゴ・名前・ひとこと と、右に 16 枠 (4×4) の絵。拡張機能は読み込まない
async function promoTile() {
  const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'store-assets', 'promo', LANG));
  fs.mkdirSync(out, { recursive: true });
  const logo = fs.readFileSync(path.join(EXTENSION, 'icons', 'icon.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  // 枠の色 (ダミーの映像の絵柄と同じ系統)。5 番目 (2 行目の 2 つ目) は音が出ている枠として線を付ける
  const fills = [
    ['#0b1030', '#2a2f6b'], ['#ff9a5b', '#7b2ff7'], ['#8fe9ff', '#0b4f8a'], ['#d7f5e3', '#2e7d5b'],
    ['#ffc1e0', '#ff6a88'], ['#1a1440', '#5b3a8a'], ['#3b2a2a', '#6b4a3a'], ['#03122b', '#2a8a7a'],
    ['#0a0620', '#c48bff'], ['#ffd27a', '#e07a5f'], ['#29a9ff', '#1b5f91'], ['#2fbf8f', '#0d3b4f'],
    ['#ff7ab8', '#5b8cff'], ['#7fd6ff', '#9b7bff'], ['#f5a524', '#a8457a'], ['#e8f4ff', '#6fcbff'],
  ];
  const cells = fills
    .map(([a, b], i) => `<i style="background:linear-gradient(135deg,${a},${b})"${i === 5 ? ' class="on"' : ''}></i>`)
    .join('');
  const [line1, line2] = JA ? ['配信を最大 16 枠で', '同時視聴'] : ['Watch up to', '16 streams at once'];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:440px;height:280px;overflow:hidden}
body{background:radial-gradient(120% 140% at 0% 0%,#1f3550 0%,#16161b 55%,#0e0e12 100%);color:#fff;
  font-family:'Segoe UI','Yu Gothic UI','Meiryo',sans-serif;position:relative}
.left{position:absolute;left:28px;top:0;bottom:0;width:200px;display:flex;flex-direction:column;justify-content:center;gap:10px}
.left svg{width:64px;height:64px;filter:drop-shadow(0 6px 14px #29a9ff55)}
.name{font-size:30px;font-weight:700;letter-spacing:.5px;line-height:1}
.tag{font-size:${JA ? 19 : 18}px;font-weight:700;line-height:1.35;color:#cfe9ff}
.tag b{color:#6fcbff;font-size:1.25em}
.grid{position:absolute;right:10px;top:62px;width:236px;display:grid;grid-template-columns:repeat(4,1fr);gap:5px;
  transform:perspective(600px) rotateY(-16deg) rotateX(6deg);transform-origin:right center}
.grid i{aspect-ratio:16/9;border-radius:5px;box-shadow:0 4px 10px #0008;opacity:.92}
.grid i.on{outline:2px solid #8fe9ff;box-shadow:0 0 14px #29a9ffaa;opacity:1}
</style></head><body>
<div class="grid">${cells}</div>
<div class="left">${logo}<div class="name">Hakomado</div>
<div class="tag">${line1.replace('16', '<b>16</b>')}<br>${line2.replace('16', '<b>16</b>')}</div></div>
</body></html>`;
  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || 'chromium' });
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const file = path.join(out, 'small-promo-tile-440x280.png');
  await page.screenshot({ path: file });
  console.log('saved', file);
  await browser.close();
}

// ---------------------------------------------------------------- 撮影
async function main() {
  if (args.includes('--promo')) return promoTile();
  fs.mkdirSync(OUT, { recursive: true });
  const context = await chromium.launchPersistentContext('', {
    channel: process.env.E2E_CHANNEL || 'chromium',
    locale: JA ? 'ja-JP' : 'en-US',
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, `--lang=${JA ? 'ja' : 'en-US'}`],
  });
  await routeFakeYouTube(context);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(worker.url()).host;
  const errors = [];

  async function open(session) {
    for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
    await seed(worker, session);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${extId}/grid.html`);
    const start = page.locator('#startDialog');
    if (session) {
      await start.waitFor({ state: 'visible', timeout: 10000 });
      await start.locator('#startChoices button').first().click();
      await start.waitFor({ state: 'hidden' });
    }
    await page.mouse.move(W - 2, H - 2);
    return page;
  }
  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('saved', path.join(OUT, name));
  };

  // 1) 2×2 で 4 枠、弾幕
  {
    const page = await open({
      layoutId: 'u2x2',
      tiles: [tile('sora'), tile('akane'), tile('umi'), tile('mint')],
      audible: [0],
    });
    await page.waitForTimeout(8000);
    await shot(page, '1-grid-danmaku.png');
  }

  // 2) メイン + サブ。メイン枠の横にチャット欄
  {
    const page = await open({
      layoutId: 'tl-m1s3-sw',
      fit: 'fill',
      tiles: [tile('akane', { chat: true, danmaku: false }), tile('sora'), tile('umi'), tile('kuro')],
      audible: [0],
    });
    await page.waitForTimeout(8000);
    await shot(page, '2-main-sub-chat.png');
  }

  // 3) チャンネルの一覧 (配信中・予定)
  {
    const page = await open({
      layoutId: 'u2x2',
      tiles: [tile('sora'), tile('akane'), tile('umi'), tile('mint')],
      audible: [0],
    });
    await page.locator('#openChannels').click();
    await page.locator('#favorites').waitFor({ state: 'visible' });
    await page.locator('#libScope [data-scope="all"]').click();
    await page.waitForTimeout(20000);
    await page.mouse.move(W - 2, H - 2);
    await shot(page, '3-channels.png');
  }

  // 4) 音の左右と音量 (コラボの 2 視点を左右に分ける)
  {
    const page = await open({
      layoutId: 'u1x2',
      tiles: [tile('hana', { pan: -1 }), tile('sora', { pan: 1, gain: 0.8 })],
      audible: [0, 1],
    });
    await page.waitForTimeout(6000);
    const t = page.locator('#grid .tile:not([hidden])').nth(1);
    await t.hover();
    await t.locator('.mix-btn').click();
    await page.waitForTimeout(800);
    await shot(page, '4-audio-mix.png');
  }

  // 5) 共有
  {
    const page = await open({
      layoutId: 'u2x2',
      tiles: [tile('sora'), tile('akane'), tile('umi'), tile('mint')],
      audible: [0],
    });
    await page.waitForTimeout(4000);
    await page.locator('#openShare').click();
    await page.locator('#shareDialog').waitFor({ state: 'visible' });
    await page.waitForTimeout(2500);
    await shot(page, '5-share.png');
  }
  if (errors.length) console.warn('page errors:\n' + errors.join('\n'));
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
