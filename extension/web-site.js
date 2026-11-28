// URL の枠 (YouTube 以外のサイト) で使う、サイトの範囲とヘッダー書き換えのルールの計算。
// サイトごとの処理は持たない (どのサイトにも同じ決まりを当てる)。画面 (grid.js) と service worker (background.js) の両方で読む。
// 画面に触らない純粋な関数だけを置く (tests/web-site.test.js)
/* exported WebSite */
'use strict';

const WebSite = (() => {
  // 国別のドメインの下の、登録の区切り (example.co.jp の co など)。この下の 1 つ上までを 1 つのサイトとみなす
  const SECOND_LEVEL = new Set(['co', 'ne', 'or', 'ac', 'go', 'ed', 'gr', 'lg', 'ad', 'com', 'net', 'org', 'gov', 'edu']);
  // いろいろな人が自分のサイトを置くドメイン (別の人のサイトをまとめて許可しないよう、ホスト名のまま使う)
  const SHARED_HOSTING = new Set([
    'github.io',
    'pages.dev',
    'workers.dev',
    'vercel.app',
    'netlify.app',
    'web.app',
    'firebaseapp.com',
    'appspot.com',
    'herokuapp.com',
    'blogspot.com',
    'cloudfront.net',
  ]);

  /**
   * ホスト名から、許可を求めるサイトの範囲 (登録されたドメイン) を出す。
   * 動画のサイトは、見るページ (live.example.jp など) と、ログインや再生の確認をするところ (api.example.jp など) が
   * 同じドメインの別のサブドメインにあることが多い。見るページのホスト名だけを許可すると、そちらへの通信が
   * 枠の中 (拡張機能のページの中) では Cookie 無しになり、再生できない。そのためドメインごと許可してもらう
   */
  function siteDomain(hostname) {
    const host = String(hostname || '')
      .toLowerCase()
      .replace(/\.$/, '');
    if (/^[\d.]+$/.test(host) || host.includes(':')) return host; // IP アドレス
    const labels = host.split('.');
    for (let n = 2; n < labels.length; n++) {
      if (SHARED_HOSTING.has(labels.slice(-n).join('.'))) return host;
    }
    if (labels.length <= 2) return host;
    const keep = labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
    return labels.slice(-keep).join('.');
  }

  /** URL の枠のサイトに求める任意のホスト権限 ('https://*.example.com/*'。サブドメインごと) */
  const pattern = (url) => `https://*.${siteDomain(url.hostname)}/*`;

  // サイトの XSS などへの対策になる CSP の指定。これを 1 つでも含む CSP は外さない
  // (*-src はすべての読み込み元の指定。frame-ancestors の値の中にたまたまある場合も、外さない側に倒す)
  const CSP_PROTECTIVE = ['*-src*', '*base-uri*', '*sandbox*', '*trusted-types*', '*form-action*', '*plugin-types*', '*navigate-to*'];

  /**
   * マルチビュー画面のタブ (tabIds) で、許可したサイト (domains) を枠に入れるための、ヘッダーを外すルール。
   *  - X-Frame-Options: 外す (ほかのサイトの中に入るのを断るだけのヘッダー)
   *  - Content-Security-Policy: 中身が「どこの中に入ってよいか (frame-ancestors)」と報告先などだけのときに限って外す。
   *    XSS 対策の指定 (CSP_PROTECTIVE) が入っている CSP はそのまま (サイトの対策は切らない。それで入らないサイトは入らない)
   * ids = [X-Frame-Options 用, CSP 用] のルール番号
   */
  function frameRules(domains, tabIds, ids) {
    if (!domains.length || !tabIds.length) return [];
    const base = { requestDomains: domains, resourceTypes: ['sub_frame'], tabIds };
    return [
      {
        id: ids[0],
        priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }] },
        condition: base,
      },
      {
        id: ids[1],
        priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'content-security-policy', operation: 'remove' }] },
        condition: {
          ...base,
          responseHeaders: [{ header: 'content-security-policy', values: ['*frame-ancestors*'] }],
          excludedResponseHeaders: [{ header: 'content-security-policy', values: CSP_PROTECTIVE }],
        },
      },
    ];
  }

  // ---- 動画だけを枠いっぱいに見せる (content/web-player.js)

  /**
   * ページの中の部分 r ({x, y, width, height}。ページの左上から) を、幅 w・高さ h の画面にぴったり映す拡大。
   * 縦横の比は変えず、はみ出さない大きさにして、余りは上下か左右に等しく分ける。
   * 返すのは、html にかける transform (translate(tx, ty) scale(s)、基準は左上) と、映す部分 (x, y, w, h)
   */
  function fitZoom(r, w, h) {
    const s = Math.min(w / r.width, h / r.height);
    return { s, tx: (w - r.width * s) / 2 - r.x * s, ty: (h - r.height * s) / 2 - r.y * s, x: r.x, y: r.y, w: r.width, h: r.height };
  }

  /**
   * 動画の要素 r の中で、映像が実際に映っている部分。要素の比が映像と違うと、映像は真ん中に縮めて置かれ、残りは黒い余白になる
   * (object-fit が contain・scale-down。Prime Video は縦に長い要素の真ん中に映す)。映像の大きさが分からない、
   * または引き伸ばし・切り抜き (fill・cover) なら要素のまま
   */
  function pictureRect(r, vw, vh, fit) {
    if (!(vw > 0 && vh > 0 && r.width > 0 && r.height > 0) || (fit !== 'contain' && fit !== 'scale-down')) return r;
    let s = Math.min(r.width / vw, r.height / vh);
    if (fit === 'scale-down') s = Math.min(s, 1);
    const width = vw * s;
    const height = vh * s;
    return { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height };
  }

  /**
   * 動画が画面のこれより小さいときは広げない (動画のページの中の、おすすめの小さな試聴など)。
   * 枠が狭いと、サイトによっては本編の動画も小さく置かれる (画面の 15% ほど) ので、それより小さくしておく
   */
  const MIN_SHARE = 0.08;

  /** 動画 vr が、幅 w・高さ h の画面で、広げる値打ちのある大きさか */
  const bigEnough = (vr, w, h) => w > 0 && h > 0 && vr.width * vr.height >= MIN_SHARE * w * h;

  return { siteDomain, pattern, frameRules, CSP_PROTECTIVE, fitZoom, pictureRect, bigEnough };
})();
