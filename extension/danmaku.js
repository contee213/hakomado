// 弾幕 (右から左へ流れるコメント) の描画エンジン
// 1 枠につき 1 インスタンス。レーン (行) ごとに直前のコメントの位置を覚えておき、
// 重ならない行に流す。どの行も空いていなければ捨てる (溜めると遅れて流れて不自然なため)。

/* exported Danmaku */
class Danmaku {
  /**
   * @param {HTMLElement} layer 弾幕を描くレイヤー
   * @param {() => object} getSettings 現在の設定を返す関数
   */
  constructor(layer, getSettings) {
    this.layer = layer;
    this.getSettings = getSettings;
    this.lanes = []; // 各レーンの最後のコメント {startedAt, width, speed}
    this.active = 0;
  }

  /**
   * 弾幕を流す帯 (枠の高さに対する割合)。設定画面のプレビューや枠に重ねる帯の表示にも使う
   * @returns {{top: number, height: number}} 0〜1
   */
  static band(s) {
    const height = Math.min(1, Math.max(0.1, Number(s.area) || 1));
    const top = s.areaPos === 'bottom' ? 1 - height : s.areaPos === 'middle' ? (1 - height) / 2 : 0;
    return { top, height };
  }

  get enabled() {
    return !this.layer.classList.contains('off');
  }

  setEnabled(on) {
    this.layer.classList.toggle('off', !on);
    if (!on) this.clear();
  }

  clear() {
    this.layer.replaceChildren();
    this.lanes = [];
    this.active = 0;
  }

  /**
   * @param {{segments: Array<{text?: string, img?: string, alt?: string}>, author?: string,
   *          authorType?: string, paid?: {amount: string, color?: string}}} msg
   */
  add(msg) {
    if (!this.enabled || document.hidden) return;
    const s = this.getSettings();
    const W = this.layer.clientWidth;
    const H = this.layer.clientHeight;
    if (W < 50 || H < 50) return;
    if (this.active >= s.maxOnScreen) return;
    if (msg.paid && !s.showPaid) msg = { ...msg, paid: null };

    const fontSize = Math.round(Math.min(Math.max(H / 14, 12), 42) * s.fontScale);
    const laneHeight = Math.round(fontSize * 1.3);
    // 流す帯 (位置: 上寄せ / 中央 / 下寄せ、高さ: 画面の area 割)
    const band = Danmaku.band(s);
    const laneCount = Math.max(1, Math.floor((H * band.height) / laneHeight));
    const bandTop = H * band.top;
    const bandBottom = bandTop + H * band.height;

    const el = this.render(msg, s);
    el.style.fontSize = fontSize + 'px';
    el.style.opacity = String(s.opacity);
    el.style.visibility = 'hidden';
    el.style.transform = `translateX(${W}px)`;
    this.layer.appendChild(el);
    const width = el.offsetWidth;

    // 全コメント同じ速さ (画面幅を duration 秒で横切る) にすると、
    // 「前のコメントの末尾が画面に入りきったか」だけで追突しないか判定できる
    const speed = W / s.duration; // px/s
    const gap = fontSize; // コメント間の最低すき間
    const now = performance.now();

    let lane = -1;
    for (let i = 0; i < laneCount; i++) {
      const last = this.lanes[i];
      if (!last) { lane = i; break; }
      const travelled = ((now - last.startedAt) / 1000) * last.speed;
      if (travelled >= last.width + gap && last.speed >= speed) { lane = i; break; }
    }
    if (lane < 0) {
      el.remove();
      return;
    }

    this.lanes[lane] = { startedAt: now, width, speed };
    // 下寄せのときは下の行から埋める (画面の下の方にまとまって流れるように)
    const top = s.areaPos === 'bottom' ? bandBottom - (lane + 1) * laneHeight : bandTop + lane * laneHeight;
    el.style.top = Math.round(top) + 'px';
    el.style.visibility = '';
    this.active++;

    const distance = W + width;
    const anim = el.animate(
      [{ transform: `translateX(${W}px)` }, { transform: `translateX(${-width}px)` }],
      { duration: (distance / speed) * 1000, easing: 'linear' },
    );
    const done = () => {
      el.remove();
      this.active = Math.max(0, this.active - 1);
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  render(msg, s) {
    const el = document.createElement('div');
    el.className = 'dm';
    if (msg.authorType === 'owner') el.classList.add('owner');
    else if (msg.authorType === 'moderator') el.classList.add('moderator');

    if (msg.paid) {
      el.classList.add('paid');
      el.style.background = safeColor(msg.paid.color) || 'rgba(230, 33, 23, .85)';
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = msg.paid.amount;
      el.appendChild(amount);
    }

    if (s.showAuthor && msg.author) {
      const a = document.createElement('span');
      a.className = 'author';
      a.textContent = msg.author;
      el.appendChild(a);
    }

    for (const seg of msg.segments || []) {
      if (seg.img && isAllowedImage(seg.img)) {
        const img = document.createElement('img');
        if (seg.stamp) img.className = 'stamp';
        img.src = seg.img;
        img.alt = seg.alt || '';
        img.referrerPolicy = 'no-referrer';
        el.appendChild(img);
      } else if (seg.text || seg.alt) {
        el.appendChild(document.createTextNode(seg.text || seg.alt));
      }
    }
    return el;
  }
}

function isAllowedImage(src) {
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname.endsWith('.ggpht.com') ||
      u.hostname.endsWith('.googleusercontent.com') ||
      u.hostname.endsWith('.gstatic.com') ||
      u.hostname.endsWith('.ytimg.com')
    );
  } catch {
    return false;
  }
}

function safeColor(c) {
  if (typeof c !== 'string') return null;
  return /^(rgba?\([\d.,\s%]+\)|#[0-9a-fA-F]{3,8})$/.test(c.trim()) ? c.trim() : null;
}
