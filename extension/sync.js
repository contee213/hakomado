// hakomado: ⏱ アーカイブ同期 (実験的な機能。HAKO-50) の中心: Sync (同期の時計・グループ) と AudioSync (✨ 自動補正)。
// HAKO-51 で grid.js から分けた。リリース版のビルド (tools/build.js) ではこのファイルを入れず、同じ窓口を何もしない形で持つ
// sync-off.js に差し替える (同期の帯 wave-strip.js・波形 waves.js・グループ分け sync-groups.js・音の突き合わせ audio-align*.js も抜く)。
// grid.js が使う窓口を足したら、sync-off.js にも足す (tests/sync-off.test.js が確かめる)。
// grid.js の state・views・tr などを使うのは呼ばれてから (読み込みの時点では使わない) なので、grid.js より前に読み込んでよい
/* global SyncGroups, SyncOffsets, MovieAnchors, AudioAlign, Waves, WaveStrip */
/* exported Sync, AudioSync, GRADE_MARK */
'use strict';

// ---------------------------------------------------------------- ⏱ アーカイブの同期再生
// コラボ配信を、参加者それぞれの視点のアーカイブで、同じ瞬間にそろえて見る。
// - そろえる基準は実際の時刻: 各アーカイブの 0 秒 = その配信が始まった時刻 (動画の liveBroadcastDetails.startTimestamp)。
//   ずれ (配信の遅延の違いなど) は、同期の調整の帯 (画面の下。wave-strip.js) で直せる (波形のドラッグ・← → キー・秒数を直接入れる)。
//   ずれは動画ごとに記録する (SyncOffsets)。別の枠に入れても、次に開いても、視聴セットで人に渡しても同じ値を使う
// - 同期グループ: A・B と C・D のように、別々の組でそろえられる (最大 4 組)。時間帯が重なるアーカイブどうしを自動でまとめ
//   (SyncGroups)、帯で行をドラッグして手で付け替えられる (手で決めた分は、その枠の中身が変わるまで保つ。「自動で分け直す」で戻す)。
//   グループごとに、そろえ方 (🕒 実際の時刻 / 🎬 本編)・基準の枠・「同期の時計」・一時停止・つまみを持つ
// - 時計は基準の枠の再生位置に合わせて進む (基準の枠の中で一時停止・シークすると、同じグループのほかの枠もついてくる)。
//   ほかの枠は時計に合わせてシーク・一時停止・再生・速度の微調整 (少しのずれは速度で吸収し、大きくずれたときだけシーク) を受ける
// - 実際の時刻のグループでは、基準の枠と配信の時間帯 (開始〜終了) が重ならないアーカイブは同期しない (手で入れたときだけ起きる)。
//   まだ始まっていない / もう終わっている時刻の枠は止めて、そのことを枠に出す
// - 広告中の枠は待たずに進め、広告が終わったら追いつかせる
// - 上部バーのつまみは、音を出している枠のグループ (無ければ番号の小さいグループ) を動かす。各グループのつまみはパネルにある
// - 基準の枠は、グループができたときに音を出している枠 (複数ならレイアウトで一番前、無ければ先頭)。その後は音を切り替えても
//   変わらない (音を聞き比べるたびに基準が黙って変わらないように)。基準の枠には「基準」の印を付け、パネルの ◉ で選び直せる。
//   基準の枠を閉じたら、同じ決め方で選び直して知らせる
// - 「止めて待つ」: 先に進んでいる枠を止めて、ほかが追いつくのを待ってから再生すると、そこでずれが決まる。
//   基準でない枠は、枠の中のプレイヤーで一時停止するだけでよい (同期が再生し直さず待つ)。基準の枠を含め、パネルの ⏸ でもできる
//   (基準の枠をプレイヤーで一時停止したときは、これまでどおりグループ全部が止まる)。待っている間は、時計は基準の枠に合わせず進む
// - 基準でない枠を、枠の中のプレイヤーでシーク (シークバー・← → キー) すると、引き戻さずに、その位置でずれを決める
//   (進みすぎた枠をシークバーで戻す、など)。基準の枠をシークしたときは、これまでどおりほかの枠がついてくる
// ON / OFF は保存しない (開き直したら OFF。視聴セットを開いたときは、ずれが入っていれば自動で ON にする)
//
// 🎬 本編モード (パネルのグループの見出しで「🕒 実際の時刻 / 🎬 本編」を切り替える): 時間のずれた同時視聴 (先月のアーカイブと今のライブなど) を、
// 見ている作品 (映画など) の同じ場面でそろえる。実際の時刻は使わない
// - 動画ごとに「本編 0:00 に当たる再生位置」(MovieAnchors) を持つ。パネルの「🚩 開始位置」か「⏲ 画面タイマー」で決める。
//   ライブは配信開始からの経過で表す (プレイヤーが知らせる、画面に出ている瞬間の実際の時刻から。見ている人の遅れによらない)
// - 時計 = 本編の時刻 (ミリ秒)。ほかの枠の目標位置 = 本編の位置 + 時計。シーク・速度・止めて待つなどは実際の時刻のときと同じ
// - 本編モードにしたグループは、そのときの枠を手で決めたことにする (自動のまとめ直しで崩れないように)。ライブは手で入れる
// - ライブは基準にだけできる (動かせないため)。ライブが基準なら、時計はライブの位置で進む (止められない)
// - 本編の位置を決めていない枠は動かさず、そのことを枠に出す。時間帯の重なりも配信の開始時刻も要らない
const Sync = (() => {
  const TICK_MS = 500;
  const SEEK_DRIFT = 2; // これ以上ずれたらシーク (秒)
  // 音を重ねて聞いても気にならないよう、数十ミリ秒までそろえる。少しのずれは速度をわずかに変えて詰める
  // (始める・やめるの幅を変えて、行ったり来たりしないように)
  const RATE_DRIFT = 0.04; // これ以上ずれたら速度で詰め始める (秒)
  const RATE_STOP = 0.012; // 詰めている途中は、ここまで詰める (秒)
  const FORCE_SEEK_DRIFT = 0.5; // ずれを変えた直後は、これ以上ずれていればシークする (細かな変更は速度で詰める)
  const SEEK_GAP_MS = 3000; // 同じ枠を続けてシークしない (読み込み中の位置で判断してシークし直さないように)
  const CMD_GAP_MS = 1500; // 再生・一時停止の指示を続けて送らない

  let on = false;
  let timer = 0;
  /**
   * @typedef {{g: number, mode: 'time'|'movie', ref: number|null, clock: {R0: number, at: number, playing: boolean},
   *   holdUntil: number, paused: boolean, init: boolean, lo: number, hi: number, dragging: boolean}} Group
   * mode: 'time' = 実際の時刻 / 'movie' = 🎬 本編。clock の R = 実際の時刻か本編の時刻 (ミリ秒)。
   * holdUntil: つまみで動かした直後は、基準の枠が追いつくまで時計を基準に合わせない。paused: パネルの ⏸ で止めた。
   * init: 時計をまだ基準の枠に合わせていない。lo / hi: つまみの範囲。
   * speed: グループの再生速度 (時計もこの速さで進む。グループの枠はみなこの速度にそろえる)。null = まだ決めていない (基準の枠の速度で始める)
   */
  /** @type {Map<number, Group>} */
  const groups = new Map();
  const manual = new Map(); // i -> {vid, g} 手で決めたグループ (0 = 同期しない)。枠の中身が変わったら捨てる
  let assigned = { groups: new Map(), excluded: new Map() }; // 今のグループ分け (SyncGroups.assign の結果)
  const sent = new Map(); // i -> {seekAt, cmd, cmdAt, rate}
  const forceSeek = new Set(); // ずれを微調整した枠 (速度で詰めず、すぐシークする)
  const waiting = new Map(); // i -> {paused} 「止めて待つ」中の枠 (paused = 止まったのを確かめた)
  const seenSeeks = new Map(); // i -> 最後に見た、枠の中でユーザーがシークした回数
  const drift = new Map(); // i -> 'ok' | 'fix' | 'ref' 追いつき具合 (パネルの点)
  // 「⏲ 画面タイマー」に値を入れようとしている枠: i -> {p: 入力欄を押した瞬間の再生位置 (秒), until: 同期に戻す時刻}
  // 入力にかかった時間がずれにならないよう、値は欄を押した瞬間の位置に対して決める。読む間は (基準でなければ) 同期から外す
  const reading = new Map();
  const READ_MS = 5 * 60e3;
  const driftSec = new Map(); // i -> 設定の位置との差 (秒。+ = 進んでいる)。'fix' の間の「あと何秒」に使う

  const now = () => performance.now();
  const newGroup = (g, mode = 'time') => ({ g, mode, ref: null, clock: { R0: 0, at: 0, playing: true }, holdUntil: 0, paused: false, init: true, lo: 0, hi: 1000, dragging: false, speed: null });
  const nowR = (G) => (G.clock.playing ? G.clock.R0 + (now() - G.clock.at) * (G.speed ?? 1) : G.clock.R0);
  const setClock = (G, R, playing) => (G.clock = { R0: R, at: now(), playing });
  const off = (i) => SyncOffsets.get(state.tiles[i].videoId);
  const anchor = (i) => (featureTile(i) ? 0 : MovieAnchors.get(state.tiles[i].videoId));
  const isMovie = (G) => G.mode === 'movie';
  /** 動かせる枠 (アーカイブ。再生位置と長さが分かる) */
  const movable = (i) => isVisible(i) && !!state.tiles[i].videoId && !!views[i].archive;
  /** 本編モードで基準にできるライブの枠 (位置の知らせが届いている) */
  const liveTile = (i) => isVisible(i) && !!state.tiles[i].videoId && !views[i].archive && !!views[i].lv;
  /**
   * 🎬 本編の動画の枠 (URL の枠・パソコンの動画ファイルの枠。Prime Video などで本編そのものを流す。HAKO-49):
   * 長さの決まった動画の位置の知らせが届いている。本編の 0:00 = その動画の 0 秒。🎬 のグループの基準になり、配信がその位置を追いかける
   */
  const featureTile = (i) => i != null && !!state.tiles[i] && isVisible(i) && isWebTile(state.tiles[i]) && !!views[i].web && views[i].web.d > 0;
  /** 同期に加われる枠 (グループに入れられる) */
  const candidate = (i) => movable(i) || liveTile(i) || featureTile(i);
  /** グループ G に加われる枠 (実際の時刻: アーカイブ / 本編: アーカイブ・ライブ・本編の動画の枠) */
  const fits = (G, i) => movable(i) || (isMovie(G) && (liveTile(i) || featureTile(i)));
  const vidOf = (i) => state.tiles[i].videoId;
  /**
   * 🎬 本編の枠 (同時視聴の配信が見ていた本編そのもの): 使う人が「本編にする」と決めた枠 (1 本だけのとき)。
   * 無ければ、枠の中のプレミア公開 (1 本だけのとき)。無ければ null
   */
  const mainOf = (list) => {
    const one = (f, kind = movable) => {
      const p = list.filter((i) => kind(i) && f(i));
      return p.length === 1 ? p[0] : null;
    };
    // 本編の動画の枠 (URL の枠など) があれば、それが本編
    return one(() => true, featureTile) ?? one((i) => MovieAnchors.isMain(vidOf(i))) ?? one((i) => views[i].archive.premiere);
  };
  /**
   * 本編の枠の本編の位置: 決めていなければ 0 (動画の 0 秒が本編 0:00)。プレミア公開はそのとおりなので決めた値に、
   * 手で本編にした枠 (ライブのアーカイブなど。始まる前の待機があることが多い) は見当にする
   */
  function ensureMainAnchor(list) {
    const m = mainOf(list);
    if (m != null && !featureTile(m) && anchor(m) == null) MovieAnchors.set(vidOf(m), 0, { guess: !views[m].archive.premiere });
  }
  /** 枠 k で本編 0:00 が流れた実際の時刻 (ミリ秒) */
  const movieZeroAt = (k) => views[k].archive.start + (anchor(k) - off(k)) * 1000;
  /** 枠 k の本編 0:00 が流れた時刻から、時間帯が重なる枠 j の本編の位置を求める (同じ時に配信していたので、実際の時刻でつながる) */
  const anchorVia = (k, j) => Math.round(((movieZeroAt(k) - views[j].archive.start) / 1000 + off(j)) * 100) / 100;
  /**
   * 🕒 コラボ配信でのそろい方を、決めていない枠の本編の位置 (見当) にする (本編の枠の本編 0:00 が流れた時刻を、各枠の位置に読み替える)。
   * 本編の枠と時間帯が重なる (= その時に本編を見ていた) アーカイブだけ。決めた枠の数を返す
   */
  function anchorsFromTime(list) {
    const m = mainOf(list);
    if (m == null || featureTile(m)) return 0; // 本編の動画の枠は時刻を持たない
    ensureMainAnchor(list);
    let n = 0;
    for (const j of list) {
      if (j === m || !movable(j) || anchor(j) != null || !overlapsTime(j, m)) continue;
      MovieAnchors.set(vidOf(j), anchorVia(m, j), { guess: true });
      n++;
    }
    return n;
  }
  /**
   * 見当の本編の位置を、時間帯が重なる (同じ時に配信していた) 枠の、使う人が決めた本編の位置から付け直す。
   * まだ位置の無い枠にも付ける。元にするのは本編の枠を優先 (無ければレイアウトで前の枠)。
   * 例: 本編 (ライブのアーカイブ) と、それを同じ時間に見ていた配信。配信のタイマーで配信の本編の位置を決めたら、本編の枠の位置も決まる
   */
  function guessFromOverlap(list) {
    const main = mainOf(list);
    const firm = list.filter((k) => movable(k) && anchor(k) != null && !MovieAnchors.isGuess(vidOf(k)));
    firm.sort((a, b) => (b === main) - (a === main));
    for (const j of list) {
      if (!movable(j) || firm.includes(j)) continue;
      const k = firm.find((x) => overlapsTime(j, x));
      if (k == null) continue;
      const v = anchorVia(k, j);
      const a = anchor(j);
      if (a == null || Math.abs(a - v) >= 0.05) MovieAnchors.set(vidOf(j), v, { guess: true });
    }
  }
  const timeRange = (i) => [views[i].archive.start, views[i].archive.start + views[i].archive.dur * 1000];
  const rangeOf = (G, i) => {
    if (isMovie(G)) {
      if (featureTile(i)) return [0, views[i].web.d * 1000];
      const a = anchor(i);
      if (a == null || !views[i].archive) return [-Infinity, Infinity];
      return [-a * 1000, (views[i].archive.dur - a) * 1000];
    }
    return timeRange(i);
  };
  const overlapsTime = (i, j) => {
    const [a, b] = timeRange(i);
    const [c, d] = timeRange(j);
    return a < d && c < b;
  };
  /** 今の再生位置 (秒)。最後に届いた位置から、再生中なら経った分を足す */
  const posOf = (i) => {
    const w = featureTile(i) ? views[i].web : null;
    if (w) return w.t + (w.paused ? 0 : ((now() - (w.at || now())) / 1000) * (w.rate || 1)); // 本編の動画の枠
    const lv = views[i].lv;
    if (lv && !views[i].archive) return lv.pos + (lv.ps === 1 ? (now() - lv.at) / 1000 : 0); // ライブ: 配信開始からの経過
    const ss = views[i].ss;
    if (!ss) return null;
    const moving = ss.ps === 1 && !ss.ad;
    return ss.t + (moving ? ((now() - ss.at) / 1000) * (ss.r || 1) : 0);
  };
  // 時計の時刻 R (実際の時刻か本編の時刻。ミリ秒) と、枠の再生位置 t (秒) の読み替え
  const realOf = (G, i, t) => (isMovie(G) ? (t - anchor(i)) * 1000 : views[i].archive.start + (t - off(i)) * 1000);
  const targetOf = (G, i, R) => (isMovie(G) ? anchor(i) + R / 1000 : (R - views[i].archive.start) / 1000 + off(i));

  // ---- グループ分け
  /** 今の枠でのグループ分けを求める (中身が変わった枠の手の決めごとは捨てる) */
  function computeAssign(prev) {
    for (const [i, m] of manual) if (state.tiles[i].videoId !== m.vid || !candidate(i)) manual.delete(i);
    const tiles = visibleIndexes()
      .filter(candidate)
      .map((i) => ({ i, range: movable(i) ? timeRange(i) : null }));
    return SyncGroups.assign(tiles, new Map([...manual].map(([i, m]) => [i, m.g])), prev);
  }
  /** グループ分けをし直して、グループの状態 (モード・基準・時計) を合わせる */
  function regroup() {
    const prev = new Map();
    for (const [g, list] of assigned.groups) for (const i of list) prev.set(i, g);
    const a = computeAssign(prev);
    joinMainGroup(a);
    for (const [g, list] of [...a.groups]) {
      if (!groups.has(g)) groups.set(g, newGroup(g));
      const G = groups.get(g);
      // 実際の時刻のグループに手で入れたライブは、加われない
      const ok = list.filter((i) => fits(G, i));
      for (const i of list) if (!ok.includes(i)) a.excluded.set(i, 'live');
      if (ok.length) a.groups.set(g, ok);
      else a.groups.delete(g);
    }
    for (const g of [...groups.keys()]) if (!a.groups.has(g)) groups.delete(g);
    assigned = a;
  }
  /**
   * 🎬 同時視聴のグループで本編の枠のあるものに、どのグループにも入らなかった枠 (時間のずれたアーカイブ・ライブ) を入れる
   * (同じ本編を見ていた、別の日の配信)。🕒 コラボ配信のグループには入れない (そろえ方は使う人が見出しで選ぶ)。
   * 手で「同期しない」にした枠は入れない。当てはまるグループが 2 つ以上なら、どこに入れるか決められないので入れない
   */
  function joinMainGroup(a) {
    const loose = [...a.excluded].filter(([, why]) => why === 'alone' || why === 'live').map(([i]) => i);
    if (!loose.length) return;
    // 本編の動画の枠 (URL の枠など) は、🎬 のグループが 1 つだけなら、そこに入れる (そのグループの本編になる)
    const movieGroups = [...a.groups].filter(([g]) => groups.get(g)?.mode === 'movie');
    const withMain = loose.some(featureTile) && movieGroups.length === 1 ? movieGroups : [...a.groups].filter(([g, list]) => groups.get(g)?.mode === 'movie' && mainOf(list) != null);
    if (withMain.length !== 1) return;
    const [, list] = withMain[0];
    for (const i of loose) {
      list.push(i);
      a.excluded.delete(i);
    }
    const order = visibleIndexes();
    list.sort((x, y) => order.indexOf(x) - order.indexOf(y));
  }
  const membersOf = (g) => assigned.groups.get(g) || [];
  /** 同期できるグループ (2 本以上で、動かせる枠がある) */
  const active = (G) => {
    const list = membersOf(G.g);
    return list.length >= 2 && list.some(movable);
  };
  const activeGroups = () => [...groups.values()].filter(active);
  /** 枠 i の入っているグループ (同期できないグループも含む) */
  function groupOfTile(i) {
    for (const [g, list] of assigned.groups) if (list.includes(i)) return groups.get(g);
    return null;
  }
  /** 共有・再生リストに使うグループ (番号の一番小さい、同期できるグループ) */
  const primary = () => (on ? (activeGroups()[0] ?? null) : null);
  const GROUP_COLORS = ['#f5b942', '#5ad19a', '#c08cff', '#ff8a5c'];
  const colorOf = (g) => GROUP_COLORS[(g - 1) % GROUP_COLORS.length];

  /**
   * 基準にする枠の初期値: 音を出している枠 (複数ならレイアウトで一番前)。無ければ先頭。
   * 本編モードでは、ライブがあればライブ (動かせないため)、無ければ本編の枠 (本編の位置が 0 に決まっているため)
   */
  function initialReference(G, list = membersOf(G.g)) {
    if (isMovie(G)) {
      const first = list.find(liveTile) ?? list.find(featureTile) ?? mainOf(list);
      if (first != null) return first;
    }
    return list.find((i) => !state.tiles[i].muted) ?? list[0] ?? null;
  }
  /** グループの基準の枠 (グループから外れていたら選び直す。閉じられていたら知らせる) */
  function reference(G) {
    const list = membersOf(G.g);
    const wantFeature = isMovie(G) && !list.some(liveTile) && list.some(featureTile) && !featureTile(G.ref);
    if (G.ref == null || !list.includes(G.ref) || (isMovie(G) && list.some(liveTile) && !liveTile(G.ref)) || wantFeature) {
      const prev = G.ref;
      G.ref = initialReference(G, list);
      if (on && prev != null && G.ref != null && !candidate(prev)) notify(tr('syncRefMoved', refLabel(G.ref)));
    }
    return G.ref;
  }
  const tileNo = (i) => visibleIndexes().indexOf(i) + 1;
  const refLabel = (i) => `${tileNo(i)} ${tileName(i) || ''}`.trim();

  /** 基準の枠を選び直す (時計はそのまま。新しい基準の枠も、今の時刻に合っているので飛ばない) */
  function setReference(i) {
    const G = on ? groupOfTile(i) : null;
    if (!G || i === G.ref || !fits(G, i) || (isMovie(G) && !liveTile(i) && membersOf(G.g).some(liveTile))) return;
    G.ref = i;
    if (G === primary()) playlistRefChanged(state.tiles[i].videoId);
    G.holdUntil = 0;
    forceSeek.delete(i);
    rate(i, 1);
    tick();
  }

  /** 同期を始められるか: 'time' = 時間帯の重なるアーカイブがある / 'movie' = 無いが、本編モードならできる / null */
  /** 実験的な機能のアーカイブ同期が ON か (設定。OFF なら同期を始めず、入口も出さない。HAKO-50) */
  const enabled = () => !!state.settings.expSync;

  function canStart() {
    if (on || !enabled()) return null;
    const a = computeAssign(new Map());
    for (const list of a.groups.values()) if (list.length >= 2) return 'time';
    const c = visibleIndexes().filter(candidate);
    return c.length >= 2 && c.some(movable) ? 'movie' : null;
  }

  function send(i, msg) {
    postToFrame(views[i].player, { hakomado: 'sync', ...msg });
  }
  function seek(i, t) {
    const s = sent.get(i) || {};
    if (now() - (s.seekAt || 0) < SEEK_GAP_MS) return;
    send(i, { op: 'seek', t });
    sent.set(i, { ...s, seekAt: now() });
  }
  function cmd(i, op) {
    const s = sent.get(i) || {};
    if (s.cmd === op && now() - (s.cmdAt || 0) < CMD_GAP_MS) return;
    send(i, { op });
    sent.set(i, { ...s, cmd: op, cmdAt: now() });
  }
  function rate(i, r) {
    const s = sent.get(i) || {};
    if (s.rate === r) return;
    send(i, { op: 'rate', r });
    sent.set(i, { ...s, rate: r });
  }

  const pad = (n) => String(n).padStart(2, '0');
  const clockText = (ms) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const spanText = (sec) => hms(Math.ceil(sec));
  /** 秒 → 「1:23:45」(負なら − を付ける) */
  const signedHms = (sec) => (sec < 0 ? '−' : '') + hms(Math.floor(Math.abs(sec)));
  /** 🕒 コラボ配信のグループの物差しの 0:00 = 基準の枠の配信の始まり (実際の時刻のミリ秒)。基準がアーカイブでなければ null */
  const refStartOf = (G) => {
    const r = G && !isMovie(G) ? reference(G) : null;
    return r != null && views[r]?.archive ? realOf(G, r, 0) : null;
  };
  /**
   * 🕒 コラボ配信の時刻 (ミリ秒) → 基準の枠の配信の経過時間「1:23:45」(HAKO-39)。基準より先に始めた配信の分は −、
   * 基準の配信が終わったあとも続く配信の分は、そのまま数え続ける。基準が決まらなければ実際の時刻
   */
  const elapsedText = (G, ms) => {
    const s = refStartOf(G);
    return s == null ? clockText(ms) : signedHms((ms - s) / 1000);
  };
  /** つまみの時刻の出し方 (🎬 は本編の時刻、🕒 は基準の枠の経過時間) */
  const timeTextOf = (G) => (isMovie(G) ? movieText : (ms) => elapsedText(G, ms));
  /** 本編の時刻 (ミリ秒) → 「本編 0:47:12」(本編の前なら − を付ける) */
  const movieText = (ms) => tr('movieClock', (ms < 0 ? '−' : '') + hms(Math.floor(Math.abs(ms) / 1000)));

  function overlay(i, text) {
    const el = views[i].el.querySelector('.sync-overlay');
    el.hidden = !text;
    if (text && el.textContent !== text) el.textContent = text;
  }

  function tick() {
    if (!on) return;
    regroup();
    const act = activeGroups();
    // 同期できるグループが無くなった (手で分けている途中は、そのまま待つ)
    if (!act.length && !manual.size) {
      stop();
      notify(tr('syncStopped'));
      return;
    }
    const touched = new Set();
    for (const G of act) {
      tickGroup(G);
      for (const i of membersOf(G.g)) touched.add(i);
    }
    // グループに入っていない (同期できないグループの) 枠は、ふつうに再生させる
    for (const i of visibleIndexes()) {
      if (touched.has(i)) continue;
      waiting.delete(i);
      drift.delete(i);
      if (movable(i)) rate(i, 1);
      overlay(i, '');
    }
    updateMarks();
    Dock.update();
    renderSpeeds();
  }

  /**
   * グループの速度を決めて、グループの枠をみなその速度にする。グループができたときは基準の枠の速度で始める。
   * ライブの入ったグループ (🎬 本編モード) は等速のまま (ライブは速さを変えられないため)
   */
  function groupSpeed(G, list, ref) {
    if (list.some(liveTile) || list.some(featureTile)) G.speed = 1; // 本編の動画の枠の入ったグループも等速 (サイトの速さに頼らない)
    else if (G.speed == null) G.speed = clampSpeed(state.tiles[ref]?.speed ?? 1);
    let changed = false;
    for (const i of list) {
      if (!movable(i)) continue;
      if (state.tiles[i].speed !== G.speed) {
        state.tiles[i].speed = G.speed;
        changed = true;
      }
      applySpeed(i);
    }
    if (changed) speedChanged();
  }
  /** 同期しているグループの枠なら、そのグループ ({g, tiles, locked}。locked = ライブが入っていて速さを変えられない) */
  function speedGroupOf(i) {
    const G = on ? groupOfTile(i) : null;
    if (!G || !active(G)) return null;
    const tiles = membersOf(G.g);
    return { g: G.g, tiles, locked: tiles.some(liveTile) };
  }
  /** 枠 i のグループの速度を変える (時計は今の時刻から新しい速さで進める) */
  function setGroupSpeed(i, r) {
    const G = on ? groupOfTile(i) : null;
    if (!G || !active(G) || membersOf(G.g).some(liveTile)) return;
    setClock(G, nowR(G), G.clock.playing);
    G.speed = clampSpeed(r);
    tick();
  }

  /** 時計を基準の枠に合わせ直す (グループができたとき・そろえ方を変えたとき) */
  function initClock(G) {
    const ref = reference(G);
    const p = posOf(ref);
    const R0 = isMovie(G) ? (anchor(ref) != null && p != null ? realOf(G, ref, p) : 0) : p != null ? realOf(G, ref, p) : rangeOf(G, ref)[0];
    setClock(G, R0, !pausedAll && !G.paused);
    G.init = false;
  }

  /**
   * 基準の枠の補正をいつも 0 にする (実際の時刻のグループ)。基準を変えたとき・基準の補正が 0 でないまま始めたときに、
   * グループの全部の枠の補正から基準の補正を引く。そろい方は補正どうしの差で決まるので、見え方は変わらない
   * (どの枠も同じ位置のまま。シークもしない)
   */
  function zeroRef(G) {
    const ref = G.ref;
    if (isMovie(G) || ref == null || !movable(ref)) return;
    const r = off(ref);
    if (!r) return;
    for (const j of membersOf(G.g)) {
      if (movable(j)) storeOffset(false, j, Math.round((off(j) - r) * 100) / 100);
    }
  }

  function tickGroup(G) {
    const list = membersOf(G.g);
    const ref = reference(G);
    zeroRef(G);
    groupSpeed(G, list, ref);
    const movie = isMovie(G);
    if (movie) {
      ensureMainAnchor(list);
      guessFromOverlap(list);
    }
    if (G.init) initClock(G);
    // 時計を基準の枠に合わせる (基準の枠が配信の時間帯の中で、知らせが新しく、広告中でないとき)
    const rs = views[ref].ss;
    let playing = !pausedAll && !G.paused;
    let R = nowR(G);
    if (movie && featureTile(ref)) {
      // 本編の動画の枠が基準: 時計は本編の動画の位置で進む (つまみで動かした直後は、本編の枠を時計に合わせる)
      // (止まっている動画は位置の知らせが来なくなるので、止まっていれば古い知らせでも合わせる)
      const w = views[ref].web;
      if (now() > G.holdUntil && (w.paused || now() - (w.at || 0) < 3000)) {
        R = posOf(ref) * 1000;
        playing = !w.paused && !pausedAll && !G.paused;
      }
    } else if (movie && liveTile(ref)) {
      // ライブが基準: 時計はライブの位置で進む (止められない)。本編の位置を決めるまでは、時計はそのまま
      const lv = views[ref].lv;
      if (anchor(ref) != null && now() - lv.at < 3000) {
        R = realOf(G, ref, posOf(ref));
        playing = lv.ps === 1;
      }
    } else if (now() > G.holdUntil && !waiting.has(ref) && rs && !rs.ad && now() - rs.at < 2000 && (!movie || anchor(ref) != null)) {
      const [s, e] = rangeOf(G, ref);
      const Rref = realOf(G, ref, posOf(ref));
      if (Rref >= s && Rref < e - 1000) {
        R = Rref;
        if (rs.ps === 2) playing = false; // 基準の枠の中で一時停止した → グループ全部止める
      }
    }
    setClock(G, R, playing);

    // 本編モードで基準の枠の本編の位置がまだ無ければ、時計が決まらないので、ほかの枠も動かさない
    const idle = movie && anchor(ref) == null;
    for (const i of list) {
      // 「⏲ 画面タイマー」に値を入れようとしている枠: 同期から外して、自由に動かせるようにする (タイマーなどが見える所まで)
      if (movie && i !== ref && reading.has(i)) {
        if (now() > reading.get(i).until) reading.delete(i);
        else {
          sawUserSeek(i); // 枠の中でシークしても、そこで位置を決めない
          rate(i, 1);
          overlay(i, tr('movieReadingOverlay'));
          drift.delete(i);
          continue;
        }
      }
      if (idle && i !== ref && anchor(i) != null) {
        overlay(i, tr('movieNeedRefAnchor'));
        if (!liveTile(i)) rate(i, 1);
        drift.delete(i);
        continue;
      }
      if (movie && anchor(i) == null) {
        overlay(i, tr('movieNeedAnchor')); // 本編の位置を決めるまでは動かさない
        if (!liveTile(i)) rate(i, 1);
        drift.delete(i);
        continue;
      }
      if (movie && featureTile(i)) {
        // 本編の動画の枠: ふだんは動かさない (ほかが追いかける)。つまみで動かした直後・グループで止めた / 再生したときだけ合わせる
        overlay(i, '');
        drift.set(i, i === ref ? 'ref' : 'ok');
        const w = views[i].web;
        if (now() < G.holdUntil && Math.abs(posOf(i) - R / 1000) > 1) seek(i, Math.max(0, R / 1000));
        if (!playing && !w.paused) cmd(i, 'pause');
        else if (playing && w.paused && now() < G.holdUntil) cmd(i, 'play');
        continue;
      }
      if (movie && liveTile(i)) {
        overlay(i, i === ref ? '' : tr('movieLiveRefOnly')); // ライブは動かせない
        if (i === ref) drift.set(i, 'ref');
        else drift.delete(i);
        continue;
      }
      const userSeek = sawUserSeek(i);
      const inRange = movie || i === ref || overlapsTime(i, ref);
      if (waiting.has(i) && inRange) {
        tickWaiting(G, i);
        continue;
      }
      if (!inRange) {
        // 時間帯が重ならない (手で入れた枠): 同期しない (ふつうに再生させる)
        overlay(i, tr('syncNoOverlap'));
        rate(i, 1);
        drift.delete(i);
        continue;
      }
      // 基準の枠は動かさない (つまみで動かした直後だけ、ほかと同じように合わせる)
      if (i === ref && now() > G.holdUntil) {
        overlay(i, '');
        drift.set(i, 'ref');
        rate(i, 1);
        continue;
      }
      const ss = views[i].ss;
      const [s, e] = rangeOf(G, i);
      if (R < s) {
        overlay(i, movie ? tr('movieStartsLater', hms(Math.ceil(s / 1000))) : tr('syncStartsIn', spanText((s - R) / 1000)));
        cmd(i, 'pause');
        if (ss && ss.t > 1) seek(i, 0);
        drift.delete(i);
        continue;
      }
      if (R >= e) {
        overlay(i, tr('syncEnded'));
        cmd(i, 'pause');
        drift.delete(i);
        continue;
      }
      overlay(i, '');
      if (!ss || ss.ad) continue; // 広告中は待たずに進める (終わったら追いつかせる)
      // 枠の中のプレイヤーでシークした → 引き戻さず、その位置でずれを決める
      if (userSeek) {
        adoptOffset(G, i, R);
        continue;
      }
      // 枠の中のプレイヤーで一時停止した → 再生し直さず、ほかが追いつくのを待つ
      if (playing && ss.ps === 2 && ss.up && now() - ss.at < 2000) {
        beginWait(i, true);
        continue;
      }
      const target = targetOf(G, i, R);
      const d = posOf(i) - target;
      if (!playing) {
        rate(i, 1);
        if (ss.ps === 1 || ss.ps === 3) cmd(i, 'pause');
        if (Math.abs(d) > 0.5) seek(i, target);
        drift.set(i, Math.abs(d) > 0.5 ? 'fix' : 'ok');
        driftSec.set(i, d);
        continue;
      }
      if (ss.ps !== 1 && ss.ps !== 3) cmd(i, 'play');
      const ad = Math.abs(d);
      const correcting = (sent.get(i)?.rate ?? 1) !== 1;
      if (ad > SEEK_DRIFT || (forceSeek.has(i) && ad > FORCE_SEEK_DRIFT)) {
        forceSeek.delete(i);
        rate(i, 1);
        seek(i, target + 0.2 * G.speed); // 読み込みに掛かる分、少し先へ (速度で詰め始めるずれより小さく)
        drift.set(i, 'fix');
        driftSec.set(i, d);
      } else if (ad > RATE_DRIFT || (correcting && ad > RATE_STOP)) {
        // 3 秒ほどで詰め終わる速さ (1〜10% 速く / 遅く。0.5% 単位で丸めて、指示を送り直しすぎないように)。
        // 遅い速度 (超低速の 0.1× など) では同じ割合だと詰まらないので、速度に合わせて強める (50% まで)
        forceSeek.delete(i);
        const sp = G.speed ?? 1;
        const kMax = sp < 1 ? Math.min(0.5, 0.1 / sp) : 0.1;
        const k = Math.round(Math.min(kMax, Math.max(0.01, ad / (3 * Math.min(1, sp)))) * 200) / 200;
        rate(i, d > 0 ? 1 - k : 1 + k);
        drift.set(i, 'fix');
        driftSec.set(i, d);
      } else {
        forceSeek.delete(i);
        rate(i, 1);
        drift.set(i, 'ok');
      }
    }
    groupRange(G, list);
  }

  /** つまみの範囲: グループの枠の時間帯を全部まとめた範囲 (本編モードは 0:00 から、一番長く続く枠の終わりまで) */
  function groupRange(G, list) {
    const ranges = list.map((i) => rangeOf(G, i)).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    // 本編モードで本編の位置を決めた枠が無いと、範囲も今の時刻も決まらない (つまみは使えなくして、時刻は出さない)
    G.known = ranges.length > 0;
    G.lo = isMovie(G) ? Math.min(0, ...ranges.map((r) => r[0])) : Math.min(...ranges.map((r) => r[0]));
    G.hi = ranges.length ? Math.max(...ranges.map((r) => r[1])) : G.lo + 1000;
  }

  /** つまみ (上部バーかパネル) を、グループ G の今に合わせる */
  function fillSeek(input, nowEl, endEl, G) {
    const text = timeTextOf(G);
    input.dataset.g = String(G.g);
    input.dataset.lo = String(G.lo);
    input.max = String(Math.max(1, Math.round((G.hi - G.lo) / 1000)));
    input.disabled = isMovie(G) && ((G.ref != null && liveTile(G.ref)) || G.known === false); // ライブが基準なら動かせない
    if (isMovie(G) && G.known === false) {
      input.value = '0';
      nowEl.textContent = tr('movieClock', '—');
      endEl.textContent = '';
      return;
    }
    if (!G.dragging) {
      input.value = String(Math.round((nowR(G) - G.lo) / 1000));
      nowEl.textContent = text(nowR(G));
    }
    endEl.textContent = text(G.hi);
    // 🕒 は、乗せると実際の時刻も分かるようにする
    nowEl.title = isMovie(G) ? '' : tr('syncClockAt', clockText(nowR(G)));
    endEl.title = isMovie(G) ? '' : tr('syncClockAt', clockText(G.hi));
  }
  /** つまみを動かしている途中 (時刻だけ出す) と、放したとき (グループ全部をその時刻へ) */
  function bindSeek(input, nowEl) {
    const groupOf = () => groups.get(Number(input.dataset.g));
    input.addEventListener('input', () => {
      const G = groupOf();
      if (!G) return;
      G.dragging = true;
      nowEl.textContent = timeTextOf(G)(Number(input.dataset.lo) + Number(input.value) * 1000);
    });
    input.addEventListener('change', () => {
      const G = groupOf();
      input.blur();
      if (!G) return;
      G.dragging = false;
      seekGroup(G, Number(input.dataset.lo) + Number(input.value) * 1000);
    });
  }
  /** グループ全部を、時計の時刻 R へ動かす (基準の枠が追いつくまで、時計は基準の枠に合わせない) */
  function seekGroup(G, R) {
    setClock(G, R, !pausedAll && !G.paused);
    G.holdUntil = now() + 4000;
    for (const i of membersOf(G.g)) sent.delete(i);
    tick();
  }

  /** グループの一時停止 / 再開 (パネルの ⏸)。止めて待っている枠は止めたまま */
  function togglePauseGroup(G) {
    G.paused = !G.paused;
    for (const i of membersOf(G.g)) {
      if (!G.paused && waiting.has(i)) continue;
      postToFrame(views[i].player, { hakomado: 'playback', play: !G.paused && !pausedAll });
    }
    tick();
  }

  function start() {
    const how = canStart();
    if (!how) return;
    groups.clear();
    manual.clear();
    assigned = { groups: new Map(), excluded: new Map() };
    // 時間帯の重なるアーカイブが無ければ、全部を 1 つの本編モードのグループにする
    if (how === 'movie') pin(visibleIndexes().filter(candidate), 1, 'movie');
    sent.clear();
    on = true;
    regroup();
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    tick();
    notifyStarted();
    Dock.autoShow();
    refresh();
  }
  function notifyStarted() {
    const act = activeGroups();
    const n = act.reduce((s, G) => s + membersOf(G.g).length, 0);
    if (act.length > 1) notify(tr('syncOnGroups', act.length, n));
    else if (act[0]) notify(movieOnText(act[0]));
  }

  /** 枠をまとめてグループ g に手で入れる (mode を渡すと、そのそろえ方にする) */
  function pin(list, g, mode) {
    if (!groups.has(g)) groups.set(g, newGroup(g, mode || 'time'));
    const G = groups.get(g);
    if (mode && G.mode !== mode) {
      G.mode = mode;
      G.init = true;
    }
    for (const i of list) if (state.tiles[i].videoId) manual.set(i, { vid: state.tiles[i].videoId, g });
  }

  /** グループのそろえ方 (実際の時刻 / 本編) を切り替える。そのときの枠は、手で決めたことにする */
  function setMode(G, m) {
    if (!on || m === G.mode) return;
    const list = membersOf(G.g);
    // 🕒 → 🎬: 今のそろい方を、決めていない枠の本編の位置にして引き継ぐ (本編の枠があるとき)。基準は本編の枠に
    const main = m === 'movie' ? mainOf(list) : null;
    const filled = m === 'movie' ? anchorsFromTime(list) : 0;
    pin(list, G.g, m);
    for (const i of list) {
      waiting.delete(i);
      sent.delete(i);
      forceSeek.delete(i);
      drift.delete(i);
    }
    G.holdUntil = 0;
    G.init = true;
    regroup();
    notify(movieOnText(G, filled));
    if (main != null) setReference(main); // 基準は本編の枠に (本編の位置が 0 に決まっているため。ライブがあれば選べない)
    tick();
  }
  /** そろえ始めた知らせ。本編の枠があれば、位置の見当を付けたことと ✨ 自動補正を伝える */
  function movieOnText(G, filled = 0) {
    const n = membersOf(G.g).length;
    if (!isMovie(G)) return tr('syncOn', n);
    const main = mainOf(membersOf(G.g));
    return main == null ? tr('movieOn', n) : tr(filled ? 'movieOnMainGuessed' : 'movieOnMain', tileName(main) || state.tiles[main].videoId, n);
  }

  /** 枠 i を別のグループへ (g = 'auto' は自動に戻す、0 は同期しない、1〜4 はそのグループ。無ければ作る) */
  function moveTile(i, g) {
    const vid = state.tiles[i].videoId;
    if (!on || !vid) return;
    if (g === 'auto') manual.delete(i);
    else {
      // 新しいグループ: ライブを入れるなら本編モード (実際の時刻ではライブは加われない)
      if (g > 0 && !groups.has(g)) groups.set(g, newGroup(g, liveTile(i) ? 'movie' : 'time'));
      manual.set(i, { vid, g });
    }
    waiting.delete(i);
    sent.delete(i);
    drift.delete(i);
    forceSeek.add(i);
    if (movable(i)) rate(i, 1);
    overlay(i, '');
    tick();
  }

  function stop() {
    on = false;
    groups.clear();
    manual.clear();
    assigned = { groups: new Map(), excluded: new Map() };
    waiting.clear();
    seenSeeks.clear();
    drift.clear();
    reading.clear();
    clearInterval(timer);
    timer = 0;
    for (let i = 0; i < MAX_TILES; i++) {
      if (!views[i]) continue;
      if (views[i].archive) send(i, { op: 'rate', r: 1 });
      overlay(i, '');
    }
    sent.clear();
    Dock.hide();
    refresh();
    renderSpeeds();
  }

  /** ボタン・つまみ・枠の印の表示を今の状態に合わせる (枠の中身が変わったとき・アーカイブだと分かったとき) */
  function refresh() {
    if (views.length < MAX_TILES) return;
    // 実験的な機能が OFF: 同期の入口 (上部バーの ⏱・☰、ヘルプの「同期」) を隠し、同期していればやめる
    const ok = enabled();
    document.body.classList.toggle('sync-off', !ok); // 枠の情報の「アーカイブ同期」の列も隠す (grid.css)
    document.getElementById('syncToggle').hidden = !ok;
    for (const b of document.querySelectorAll('[data-help="sync"]')) b.hidden = !ok;
    if (!ok) {
      pending = null;
      clearTimeout(pendingTimer);
      if (on) stop();
      document.getElementById('syncBar').hidden = true;
      return;
    }
    if (pending) checkPending();
    for (const i of [...waiting.keys()]) if (!candidate(i)) waiting.delete(i); // 閉じた・別の動画にした枠は待つのをやめる
    if (on) {
      tick();
      if (!on) return; // 同期できる枠が無くなって止めた
    }
    // ボタンはいつも出す (アーカイブを並べるまで隠れていると、機能に気づけないため)。使えないときは薄くして、理由を出す
    const can = on || !!canStart();
    const btn = document.getElementById('syncToggle');
    const off = !can;
    btn.classList.toggle('unavailable', off);
    btn.setAttribute('aria-disabled', String(off));
    btn.title = off ? [tr('syncTitle'), '', ...whyNot()].join('\n') : tr('syncTitle');
    setToggle(btn, on);
    document.getElementById('syncBar').hidden = !on;
    if (!on) updateMarks();
  }

  /** 同期できないときの理由 (ボタンのツールチップ・押したときのお知らせ)。1 行目は使える条件、続けて今の枠で足りないこと */
  function whyNot() {
    const kinds = visibleIndexes().map(tileKind).filter((k) => k !== 'empty');
    const count = (k) => kinds.filter((x) => x === k).length;
    const lines = [tr('syncWhyNeed')];
    if (!kinds.length) return [...lines, tr('syncWhyEmpty')];
    if (count('archive') >= 2) return [...lines, tr('syncWhyNoOverlap')];
    lines.push(tr('syncWhyArchives', count('archive')));
    if (count('live')) lines.push(tr('syncWhyLive', count('live')));
    if (count('upcoming')) lines.push(tr('syncWhyUpcoming', count('upcoming')));
    if (count('video')) lines.push(tr('syncWhyVideo', count('video')));
    if (count('blocked')) lines.push(tr('syncWhyBlocked', count('blocked')));
    if (count('loading')) lines.push(tr('syncWhyLoading', count('loading')));
    return lines;
  }

  /** 枠ごとの同期の状態 (「ℹ 枠の情報」の一覧用): {ok: 同期中・同期できる, text} */
  function tileStatus(i) {
    const kind = tileKind(i);
    if (kind === 'archive' && !movable(i)) return { ok: false, text: tr('infoSync_loading') }; // 配信の時刻がまだ届いていない
    const G = on ? groupOfTile(i) : null;
    if (G && active(G) && fits(G, i)) {
      const text = tr(i === G.ref ? 'infoSyncRef' : 'infoSyncOn');
      return { ok: true, text: activeGroups().length > 1 ? `${text} · ${tr('syncGroupN', G.g)}` : text };
    }
    if (kind === 'archive') {
      if (on) return { ok: false, text: tr('infoSyncNoOverlap') };
      const others = visibleIndexes().filter((j) => j !== i && movable(j));
      if (others.some((j) => overlapsTime(i, j))) return { ok: true, text: tr('infoSyncCan') };
      return { ok: false, text: tr(others.length ? 'infoSyncNoOverlap' : 'infoSyncAlone') };
    }
    return { ok: false, text: tr('infoSync_' + kind) };
  }

  let marksKey = '';
  /** 枠の印: 「基準」(グループが 2 つ以上なら、グループの番号と色も) (同期の処理のたびにも呼ぶ。変わったときだけ書き換える) */
  function updateMarks() {
    const act = activeGroups();
    const multi = act.length > 1;
    const key = JSON.stringify([on, LANG, [...assigned.groups], act.map((G) => [G.g, G.ref])]);
    if (key !== marksKey) {
      marksKey = key;
      for (let i = 0; i < MAX_TILES; i++) {
        const G = on ? groupOfTile(i) : null;
        const inSync = !!G && active(G);
        const isRef = inSync && i === G.ref;
        const badge = views[i].el.querySelector('.sync-ref-badge');
        badge.hidden = !(isRef || (inSync && multi));
        badge.textContent = multi && inSync ? (isRef ? `${G.g} ${tr('syncRefShort')}` : String(G.g)) : tr('syncRefShort');
        badge.title = isRef ? tr('syncRefBadgeTitle') : multi && inSync ? tr('syncGroupN', G.g) : '';
        badge.classList.toggle('is-member', inSync && !isRef);
        if (inSync && multi) views[i].el.style.setProperty('--g', colorOf(G.g));
        else views[i].el.style.removeProperty('--g');
        views[i].el.classList.toggle('sync-grouped', inSync && multi);
        if (!on || !candidate(i)) overlay(i, '');
      }
    }
  }

  /** 「止めて待つ」を始める (paused = もう止まっている。パネルのボタンからなら、止める指示を送る) */
  function beginWait(i, paused) {
    if (!on || waiting.has(i)) return;
    waiting.set(i, { paused });
    rate(i, 1);
    if (!paused) cmd(i, 'pause');
    overlay(i, '');
    showToast(i, tr('syncWaitStart'));
    Dock.update();
  }
  /** 「止めて待つ」を終える: 今の再生位置が今の時刻に合うように、ずれを決める */
  function endWait(G, i) {
    if (!waiting.delete(i)) return;
    adoptOffset(G, i, nowR(G));
  }
  /** 今の再生位置が時刻 R に合うずれ (秒、0.01 秒単位。本編は本編の位置、0.1 秒単位)。位置が分からなければ null */
  function offsetAt(G, i, R) {
    const p = posOf(i);
    if (p == null) return null;
    if (isMovie(G)) return Math.round((p - R / 1000) * 100) / 100;
    if (!views[i].archive) return null;
    return Math.round((p - (R - views[i].archive.start) / 1000) * 100) / 100;
  }
  /** ずれ (実際の時刻) か本編の位置 (本編) を書き込む。v = null は本編の位置を消す */
  function storeOffset(movie, i, v) {
    const vid = state.tiles[i].videoId;
    if (movie) {
      if (v == null) MovieAnchors.remove(vid);
      else MovieAnchors.set(vid, v);
    } else {
      SyncOffsets.set(vid, v);
      playlistOffsetChanged(vid, v);
    }
  }
  /** 今の再生位置のまま合うように、ずれを決める (「止めて待つ」の再生・枠の中でのシーク) */
  function adoptOffset(G, i, R) {
    const v = offsetAt(G, i, R);
    if (v == null) return Dock.update();
    storeOffset(isMovie(G), i, v);
    sent.delete(i);
    forceSeek.delete(i);
    rate(i, 1);
    showToast(i, isMovie(G) ? tr('movieAnchorSet', hms(Math.max(0, Math.round(v)))) : tr('syncOffsetSet', signedSec(v)));
    Dock.update();
  }
  /** 前の確認のあとで、枠の中でユーザーがシークしたか (同期を始めて最初に見たときは、数を覚えるだけ) */
  function sawUserSeek(i) {
    const sk = views[i].ss?.sk;
    if (sk == null) return false;
    const prev = seenSeeks.get(i);
    seenSeeks.set(i, sk);
    return prev != null && sk !== prev;
  }
  /** 待っている枠: 止まったのを確かめたあと、再生されたら (枠の中のプレイヤーでもパネルでも) そこでずれを決める */
  function tickWaiting(G, i) {
    const w = waiting.get(i);
    const ss = views[i].ss;
    if (!ss) return;
    if (ss.ps === 2) w.paused = true;
    else if (w.paused && ss.ps === 1 && now() - ss.at < 2000) {
      endWait(G, i);
      return;
    }
    if (!w.paused) cmd(i, 'pause');
  }
  /** パネルの「止めて待つ / ここで合わせる」 */
  function toggleWait(i) {
    if (!waiting.has(i)) return beginWait(i, false);
    const w = waiting.get(i);
    if (!w.paused) {
      waiting.delete(i); // まだ止まっていない: 取りやめる
      Dock.update();
      return;
    }
    send(i, { op: 'play' }); // 再生が始まったら tickWaiting がずれを決める
    w.paused = true;
  }

  // 視聴セットを開いたあと、アーカイブだと分かりしだい同期を始める ({tiles, ref, until, at, mode})
  let pending = null;
  let pendingTimer = 0;
  /**
   * tiles の枠がアーカイブだと分かったら (最長 30 秒待って、分かった分だけで)、ref の枠を基準にして同期を始める。
   * at (同期の時計。実際の時刻のミリ秒) を渡すと、始めたあとにその時刻へ動かす (再生リストの続きから)。
   * mode = 'movie' なら、tiles を 1 つの本編モードのグループにまとめる
   */
  /**
   * then: 始めたあとに、基準の枠のグループの番号 (同期できなければ null) を渡して呼ぶ。
   * timeOnly: 時間帯の重なるアーカイブの組 (🕒) になるときだけ始める (⏱ 開いて同期。重ならなければ本編モードで始めず null)
   */
  function startWhenReady(tiles, ref, { at = null, mode: m = 'time', then = null, timeOnly = false } = {}) {
    if (!enabled()) return; // 実験的な機能が OFF: 枠はふつうに入れ、同期は始めない (再開・共有コード・再生リスト・⏱ 開いて同期)
    pending = { tiles, ref, until: now() + 30000, at, mode: m, then, timeOnly };
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(refresh, 30500);
    setTimeout(refresh, 0); // もう読み込んである動画だけなら、すぐ始める
  }
  function checkPending() {
    const { tiles, ref, until, at, mode: m, then, timeOnly } = pending;
    const ready = tiles.every((i) => movable(i) || (m === 'movie' && liveTile(i)) || !state.tiles[i].videoId);
    if (!ready && now() < until) return;
    pending = null;
    clearTimeout(pendingTimer);
    setTimeout(() => {
      if (!on && (timeOnly ? canStart() === 'time' : canStart())) start();
      if (!on) return void then?.(null);
      if (timeOnly) {
        // 入れた枠が 2 本以上、同じ 🕒 のグループに入ったときだけ (本編モードのグループは切り替えない)
        const G0 = groupOfTile(ref);
        if (!G0 || isMovie(G0) || membersOf(G0.g).filter((i) => tiles.includes(i)).length < 2) return void then?.(null);
      }
      if (m === 'movie') {
        // 視聴セットの枠を 1 つの本編モードのグループに (基準の枠のグループの番号を使う)
        const g = groupOfTile(ref)?.g ?? [1, 2, 3, 4].find((x) => !groups.has(x)) ?? 1;
        pin(tiles.filter(candidate), g, 'movie');
        tick();
      }
      const G = groupOfTile(ref);
      if (!G) return void then?.(null);
      // 時刻で合わせた視聴セットは 🕒 に
      if (m === 'time' && isMovie(G)) setMode(G, 'time');
      setReference(ref);
      if (at && !isMovie(G)) seekGroup(G, at);
      then?.(G.g);
    }, 0);
  }
  /** 今どこを見ているか ({at: 時計, pos: 基準の動画の再生位置 (秒)})。同期していなければ null (共有と同じく、番号の小さいグループ) */
  function resumePoint() {
    const G = primary();
    if (!G || isMovie(G)) return null;
    const ref = reference(G);
    if (ref == null) return null;
    const R = nowR(G);
    return { at: Math.round(R), pos: Math.max(0, targetOf(G, ref, R)) };
  }
  /** ほかのタブなどで動画のずれが変わった */
  function offsetsChanged(ids) {
    for (const i of visibleIndexes()) {
      if (!ids.includes(state.tiles[i].videoId)) continue;
      sent.delete(i);
      forceSeek.add(i);
    }
    if (on) Dock.update();
  }

  /** +1.25 / -300.00 のような符号付きの秒 (0.01 秒単位) */
  const signedSec = (v) => (v > 0 ? '+' : '') + v.toFixed(2);


  /** 「⏲ 画面タイマー」(h:mm:ss / m:ss / 秒。頭に − も可) を秒に。読めなければ null */
  function parseClock(text) {
    const t = String(text).trim().replace(/^[−-]/, '-');
    const neg = t.startsWith('-');
    const body = neg ? t.slice(1) : t;
    if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(body)) return null;
    const v = body.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
    return neg ? -v : v;
  }
  /** 「⏲ 画面タイマー」の欄を押した: その瞬間の位置を覚え、(基準でなければ) この枠を同期から外す (タイマーなどが見える所まで動かせるように) */
  function startReading(i) {
    const p = posOf(i);
    reading.set(i, { p, until: now() + READ_MS });
    tick();
  }
  /** 読むのをやめる (値を入れた・Esc)。枠を同期に戻す */
  function stopReading(i) {
    if (!reading.delete(i)) return;
    sent.delete(i);
    forceSeek.add(i);
    overlay(i, '');
    tick();
  }
  /**
   * 枠 i を本編にする / やめる (on)。本編にすると、同じグループのほかの枠の「本編にした」印は外し、
   * 基準をこの枠にする (ライブがあればライブのまま)。ほかの枠の本編の位置の見当は、実際の時刻から付ける。
   * 🎬 同時視聴のグループだけ (🕒 コラボ配信では印を出さず、そろえ方も変えない)
   */
  function setMain(i, on) {
    const G = on ? groupOfTile(i) : null;
    MovieAnchors.setMain(vidOf(i), on);
    if (!on) return tick();
    for (const j of membersOf(G?.g)) if (j !== i && MovieAnchors.isMain(vidOf(j))) MovieAnchors.setMain(vidOf(j), false);
    if (!G) return tick();
    if (!isMovie(G)) return tick();
    const filled = anchorsFromTime(membersOf(G.g));
    notify(movieOnText(G, filled));
    setReference(i);
    tick();
  }

  /** この枠のずれ (本編モードなら本編の位置) を v にして、すぐ合わせ直す */
  function setOffset(i, v) {
    const G = groupOfTile(i);
    storeOffset(!!G && isMovie(G), i, v);
    sent.delete(i);
    forceSeek.add(i); // 速度で詰めず、すぐ合わせ直す
    tick();
  }
  /** ✨ 自動補正の結果など、いくつかの枠のずれをまとめて変える */
  function applyOffsets(pairs) {
    for (const [i, v] of pairs) setOffset(i, v);
  }
  /** グループの枠のずれを全部 0 に戻す (実際の時刻だけでそろえ直す) */
  function resetGroup(G) {
    const pairs = membersOf(G.g)
      .filter((i) => movable(i) && off(i) !== 0)
      .map((i) => [i, 0]);
    if (!pairs.length) return;
    applyOffsets(pairs);
    notify(tr('syncResetDone', pairs.length));
  }
  // ---------------------------------------------------------------- 同期の調整 (画面の下の帯。HAKO-48 でパネルを無くした)
  // 同期の調整は画面の下の帯 (wave-strip.js の WaveStrip) だけ。ここでは出す / しまうの決まりだけ持つ:
  // - 上部バーのボタンで同期を ON にしたとき・☰ を押したときは出す
  // - 自動で同期を始めたとき (再開・⏱ 開いて同期など) は、帯の ✕ で閉じていなければ出す
  const Dock = (() => {
    let wanted = true; // 帯の ✕ で閉じたら false (自動で始めたときは出さない)
    const toggleBtn = () => document.getElementById('syncDockToggle');
    function show() {
      if (!on) return;
      wanted = true;
      WaveStrip.open();
      mark();
    }
    function hide() {
      WaveStrip.close();
      mark();
    }
    /** ☰ の点灯を、帯を出しているかに合わせる */
    function mark() {
      const b = toggleBtn();
      if (!b) return;
      const open = WaveStrip.isShown();
      b.classList.toggle('on', open);
      b.setAttribute('aria-pressed', String(open));
    }
    function setup() {
      toggleBtn().addEventListener('click', (e) => {
        e.currentTarget.blur();
        if (WaveStrip.isShown()) {
          wanted = false;
          hide();
        } else show();
      });
    }
    return {
      show,
      hide,
      update: mark,
      setup,
      autoShow: () => wanted && show(),
      /** 帯の ✕ で閉じた (次に自動で同期を始めたときは出さない) */
      closedByUser: () => {
        wanted = false;
        mark();
      },
    };
  })();

  function setup() {
    SyncOffsets.onChange(offsetsChanged);
    MovieAnchors.onChange(offsetsChanged);
    document.getElementById('syncToggle').addEventListener('click', (e) => {
      e.currentTarget.blur(); // Space キーでボタンが押し直されないように
      if (on) stop();
      else if (canStart()) {
        start();
        // ボタンで ON にしたときは、✕ で閉じていた同期の調整の帯も開き直す
        if (on) Dock.show();
      } else notify(whyNot().join('\n'));
    });
    Dock.setup();
  }

  /**
   * グループの様子 (✨ 自動補正用): {ref, tiles, movie, active, paused, later}。無ければ null。
   * later = 配信の時間帯がまだ始まっていない枠 (始まるまで止めて待っている。🕒 コラボ配信のグループだけ)
   */
  function groupInfo(g) {
    const G = on ? groups.get(g) : null;
    if (!G) return null;
    const tiles = membersOf(g);
    const movie = isMovie(G);
    const R = G.init ? null : nowR(G); // 時計がまだ決まっていない (同期を始めた直後) ときは、分からないので空にする
    const later = movie || R == null ? [] : tiles.filter((i) => views[i]?.archive && R < timeRange(i)[0]);
    return { ref: reference(G), tiles, movie, active: active(G), paused: G.paused, later };
  }

  /**
   * 「⏱ 開いて同期」用: tiles (グループに入った枠) の配信が全部始まっている時刻 (一番遅い開始) より前にいれば、グループをそこへ進める (HAKO-34)。
   * もう全部始まっている・全部がそろう時刻が無い (一番遅い開始より前に終わる配信がある) ・時計がまだ決まっていないときは動かさない。進めたら true
   */
  function seekToAllStarted(g, tiles) {
    const G = on ? groups.get(g) : null;
    if (!G || G.init || isMovie(G)) return false;
    const members = membersOf(g);
    const mine = tiles.filter((i) => members.includes(i) && views[i]?.archive);
    if (mine.length < 2) return false;
    const start = Math.max(...mine.map((i) => timeRange(i)[0]));
    const end = Math.min(...mine.map((i) => timeRange(i)[1]));
    if (!(nowR(G) < start && start < end)) return false;
    seekGroup(G, start);
    return true;
  }

  return {
    setup,
    refresh,
    startWhenReady,
    offsetsChanged,
    isOn: () => on,
    /** 共有・再生リスト用 (番号の一番小さいグループ): 本編モードか・基準の枠 */
    isMovie: () => !!primary() && isMovie(primary()),
    refIfOn: () => (primary() ? reference(primary()) : null),
    tileStatus,
    resumePoint,
    isWaiting: (i) => on && waiting.has(i),
    groupInfo,
    seekToAllStarted,
    /** 枠 i を同期しないにする (✨ 自動補正で、ほかの枠と音が合わなかった枠) */
    excludeTile: (i) => moveTile(i, 0),
    /** 同期の調整の帯を出す (✕ で閉じていても) */
    showDock: () => Dock.show(),
    /** 手で決めたグループを全部やめて、自動 (時間帯が重なる枠をまとめる) に戻す (帯の「自動で分け直す」。パネルの行の「自動」の代わり) */
    autoRegroup() {
      if (!on || !manual.size) return;
      for (const i of [...manual.keys()]) moveTile(i, 'auto');
    },
    /** 手で決めたグループがあるか */
    hasManualGroups: () => manual.size > 0,
    /** 同期の調整の帯を ✕ で閉じた (次に自動で同期を始めたときは出さない) */
    stripClosedByUser: () => Dock.closedByUser(),
    speedGroupOf,
    setGroupSpeed,
    /** 🎬 🚩 開始位置: 今の再生位置を本編 0:00 にする (パネルの「🚩 開始位置」と同じ) */
    movieHere(i) {
      const p = posOf(i);
      if (p != null) setOffset(i, Math.round(p * 100) / 100);
    },
    /** 🎬 ⏲ 画面タイマー: 欄を押した瞬間の位置で読み始める (読む間は同期から外す) */
    movieTimerStart: (i) => startReading(i),
    movieTimerCancel: (i) => stopReading(i),
    /** 🎬 ⏲ 画面タイマー: 画面に出ている本編の時刻 text を入れて決める。読めなければ false */
    movieTimerCommit(i, text) {
      const c = parseClock(text);
      const p = reading.get(i)?.p ?? posOf(i);
      if (c == null || p == null) {
        showToast(i, tr('movieBadClock'));
        return false;
      }
      stopReading(i);
      setOffset(i, Math.round((p - c) * 100) / 100);
      return true;
    },
    /** 🎬 ✕: 本編の位置を消す */
    movieClear: (i) => setOffset(i, null),
    /** 🎬 画面のタイマーから見つけた作品 n を選ぶ: その作品の 0:00 を本編の位置にして、グループを本編の 0:00 へ移す (HAKO-49) */
    movieSelectWork(i, n) {
      if (MovieAnchors.select(vidOf(i), n) == null) return;
      sent.delete(i);
      forceSeek.add(i);
      const G = groupOfTile(i);
      if (G && isMovie(G)) seekGroup(G, 0);
      else tick();
    },
    /** 🎬 本編の印: on = この枠を本編にする / false = 本編をやめる */
    setMain: (i, on) => setMain(i, on),
    /** 同期の調整の帯のグループの ✨ 自動補正 */
    toggleAudioSync: (g) => AudioSync.toggle(g),
    /** 同期の調整の帯に出す ✨ の箱 ({el, paint} / null) */
    audioResultEl: (g) => AudioSync.resultEl(g),
    /** 同期の調整の帯の行の 🔊 / 🔇: その枠だけ音を出す / 消す (ほかの枠はそのまま。枠の情報の 🔊 と同じ) */
    toggleAudio(i) {
      setAudio(i, { solo: false });
    },
    /** 同期の調整の帯のグループの 🔊 / 🔇: グループの中に音の出ている枠があれば全部消す。全部消えていれば全部出す (ほかのグループの枠はそのまま) */
    toggleGroupAudio(g) {
      const list = membersOf(g).filter((i) => tileFilled(state.tiles[i]));
      if (!list.length) return;
      const anyOn = list.some((i) => !state.tiles[i].muted);
      for (const i of list) state.tiles[i].muted = anyOn;
      refreshAudio();
    },
    /** 同期の調整の帯のグループの速度 (グループの速さを変えられる枠から変える) */
    setStripSpeed(g, r) {
      const G = groups.get(g);
      const i = G ? membersOf(g).find((j) => speedAdjustable(j)) : null;
      if (i != null) setTileSpeed(i, r);
    },
    offOf: off,
    applyOffsets,
    setOffset,
    groupColor: (g) => colorOf(g),
    dockChanged: () => (Dock.update(), WaveStrip.update()),
    /**
     * 同期の調整の帯用 (HAKO-42): 全部のグループ (番号順) と、どのグループにも入っていない枠。同期していなければ null。
     * グループ: {g, mode, movie, active, ref, now, playing, lo, hi, note, canReset, speed, speedLocked (ライブが入っていて速さを変えられない), tiles}。
     * 枠: {i, vid, no, name, youtube, start, dur, movable, live, off, drift, waiting, group (グループの選択の値), why, elapsed}
     */
    stripModel() {
      if (!on) return null;
      const tileOf = (i, G) => {
        const vid = vidOf(i) || '';
        const arch = views[i]?.archive;
        let elapsed = '';
        if (G && active(G) && !isMovie(G) && movable(i) && !G.init) {
          const t = targetOf(G, i, nowR(G));
          elapsed = t > arch.dur + 1 ? tr('syncElapsedEnded') : signedHms(t);
        }
        return {
          i,
          vid,
          no: tileNo(i),
          name: tileName(i) || vid,
          title: views[i]?.meta?.title || '',
          muted: !!state.tiles[i]?.muted,
          // ✨ 自動補正の候補: {v, grade, prelim} / false (決められなかった) / null。suspect = 同じコラボではないかもしれない
          cand: G && active(G) && !isMovie(G) ? AudioSync.candidateFor(i) : null,
          suspect: G && active(G) && !isMovie(G) ? AudioSync.isSuspect(i) : false,
          youtube: /^[\w-]{11}$/.test(vid),
          // 🎬 同時視聴のグループでは、時計の時刻 = 本編の時刻 (0:00 が本編の始まり)。波は「動画の 0 秒 = 本編の −(本編の位置)」に置くので、
          // 始まりを 0 にして、補正の代わりに本編の位置 (この動画で本編 0:00 に当たる再生位置。決まっていなければ null) を渡す (HAKO-47)
          start: arch ? (G && isMovie(G) ? 0 : arch.start) : null,
          dur: arch ? arch.dur : null,
          movable: movable(i),
          live: liveTile(i),
          off: G && isMovie(G) ? anchor(i) : off(i),
          // 🎬: 本編の枠か (main)・手で本編にしたか (mainMarked)・この動画の今の再生位置 (秒)
          main: !!G && isMovie(G) && mainOf(membersOf(G.g)) === i,
          mainMarked: MovieAnchors.isMain(vid),
          pos: G && isMovie(G) ? posOf(i) : null,
          drift: waiting.has(i) ? 'wait' : drift.get(i) || 'none',
          waiting: waiting.has(i),
          paused: !!waiting.get(i)?.paused,
          group: manual.has(i) ? String(manual.get(i).g) : 'auto',
          why: G ? null : assigned.excluded.get(i) || 'alone',
          elapsed,
        };
      };
      const list = [...groups.values()]
        .sort((a, b) => a.g - b.g)
        .map((G) => {
          const ok = active(G);
          const tiles = membersOf(G.g);
          const note = !ok
            ? tr(tiles.length < 2 ? 'syncGroupNeedMore' : 'syncGroupNeedArchive')
            : isMovie(G) && anchor(reference(G)) == null
              ? tr('syncGroupNeedAnchor')
              : '';
          return {
            g: G.g,
            mode: G.mode,
            movie: isMovie(G),
            active: ok,
            ref: ok ? reference(G) : G.ref,
            now: G.init ? null : nowR(G),
            playing: G.clock.playing && !G.paused,
            lo: G.lo,
            hi: G.hi,
            note,
            canReset: tiles.some((i) => movable(i) && off(i) !== 0),
            speed: G.speed ?? 1,
            speedLocked: tiles.some(liveTile),
            // ✨ 自動補正 (パネルのグループの ✨ と同じ): 文字・測っているか・目立たせるか・一番初めの候補の目印
            audio: (() => {
              const a = AudioSync.progressText(G.g);
              return {
                label: a || tr('syncAudioLabel'),
                measuring: !!a,
                suggest: !a && !AudioSync.hasOutput(G.g) && tiles.every((i) => !movable(i) || off(i) === 0),
                candidateKey: AudioSync.candidateKey(G.g),
              };
            })(),
            tiles: tiles.map((i) => tileOf(i, G)),
          };
        });
      const rest = [...assigned.excluded.keys()]
        .filter((i) => !groupOfTile(i))
        .sort((a, b) => tileNo(a) - tileNo(b))
        .map((i) => tileOf(i, null));
      // audioKey: ✨ の箱の形が変わる目印 (測り始めた・結果が出た・合わせ方を変えた・閉じた)。変わったら帯の節を作り直す
      return { groups: list, rest, audioKey: JSON.stringify(AudioSync.resultKey()) };
    },
    /** 帯の操作 (パネルと同じ動き。HAKO-42) */
    setReference: (i) => setReference(i),
    moveTile: (i, v) => moveTile(i, v === 'auto' ? 'auto' : Number(v)),
    toggleWait: (i) => toggleWait(i),
    setMode(g, m) {
      const G = on ? groups.get(g) : null;
      if (G) setMode(G, m === 'movie' ? 'movie' : 'time');
    },
    resetGroup(g) {
      const G = on ? groups.get(g) : null;
      if (G) resetGroup(G);
    },
    /** 補正の秒数を文字で入れる (パネルの入力欄と同じ読み方。🎬 は本編 0:00 の位置を h:mm:ss でも)。読めなければ枠に知らせる */
    commitOffsetText(i, text) {
      const G = on ? groupOfTile(i) : null;
      const s = String(text || '').trim();
      if (!G || !s) return;
      if (isMovie(G)) {
        const v = parseClock(s);
        if (v == null) showToast(i, tr('movieBadClock'));
        else setOffset(i, Math.round(v * 100) / 100);
        return;
      }
      const v = Number(s.replace('−', '-').replace(/^\+/, ''));
      if (Number.isFinite(v)) setOffset(i, v);
    },
    /** 枠 i を光らせる (帯の行に乗せたとき。null で消す) */
    highlight(i) {
      for (const v of views) v?.el?.classList.remove('sync-hl');
      if (i != null) views[i]?.el?.classList.add('sync-hl');
    },
    /** グループ g を一時停止 / 再生する (同期の調整の帯の ⏸) */
    togglePause(g) {
      const G = on ? groups.get(g) : null;
      if (G && active(G)) togglePauseGroup(G);
    },
    /** グループ g を実際の時刻 R (ミリ秒) へ動かす */
    /** 同期の調整の帯のグループのつまみ (上部バーのつまみと同じ動き・同じ時刻の出し方) */
    bindGroupSeek: (input, nowEl) => bindSeek(input, nowEl),
    fillGroupSeek(g, input, nowEl, endEl) {
      const G = on ? groups.get(g) : null;
      if (G && active(G) && !G.init) fillSeek(input, nowEl, endEl, G);
    },
    /** 実験的な機能のアーカイブ同期が ON か (HAKO-50) */
    enabled: () => enabled(),
    /** 同期のコードが入っているビルドか (sync-off.js は false。HAKO-51) */
    built: true,
    seekTo(g, R) {
      const G = on ? groups.get(g) : null;
      // グループの時間帯 (つまみの範囲) の外へは動かさない (HAKO-40)
      if (G && !G.init && Number.isFinite(R)) seekGroup(G, Math.max(G.lo, Math.min(G.hi, R)));
    },
  };
})();

// ---------------------------------------------------------------- ✨ 自動補正 (今は音で合わせる。アーカイブの同期再生のずれを、音で測って直す)
// コラボの各視点には通話の声が共通して入っているので、同期しているグループの枠の音を最大 180 秒聞いて突き合わせ、ずれを求める。
// - 同期の調整の帯のグループの「✨ 自動補正」で始める (いくつものグループを同時に測れる)。今の位置からそのまま再生しながら測る
//   (基準の枠が再生している間だけ数える)。もう一度押すとやめる
// - 測っている間は、各枠の中 (content/watch.js の Mix) が音の大きさを記録して送ってくる。消音中の枠もプレイヤーの消音を外して
//   Web Audio 側で消音するので、聞こえ方は変わらない。終わったら元の消音に戻す
// - 計算は audio-align.js を Worker (audio-align-worker.js) で動かす (枠が多いと何秒もかかるので、画面と同期を止めないように)。
//   Worker が使えなければ、この画面で計算する
// - 35 秒たったら 10 秒ごとに、それまでの分で計算する。計算ごとの結果は全部取っておき、枠ごとに「一番よかった値」
//   (確かさが一番高く、ほかの計算でも同じ値が多く出たもの) を途中の結果として出す (パネルの行と図に薄く)。
//   黙っている区間があると、そこで一時的に決められなくなる (—) ので、最後の計算だけでなく、一番よかった値を採る
//   (途中の結果が 2 回続けて同じ値なら、確かさを 1 段上げる)
// - どの枠も ◎ で、2 回以上同じ値が出たら、切り上げを提案する (決めるのは使う人。「ここで決める」)。
//   180 秒まで聞いたら、そこまでで一番よかった値で終える
// - 結果は確かさ (◎ 確か / ○ たぶん / △ 怪しい) と一緒に、パネルの各行と図 (反映したあとの位置の印) に出し、「反映」で各枠のずれ
//   (SyncOffsets) に書き込む。基準の枠のずれはそのまま
// - 2 枠のときは「中間 (映像がそろう)」が既定。それぞれの人の声に合わせる値も選べる (通話の遅れのぶん、もう一人の声はずれる)
// - 声が少ない区間などで決められなければ、パネルにそう出して、「測り直す」で別の場面から測り直してもらう
// - 🎬 同時視聴のグループでは使わない (同時視聴の配信には本編の音が入っていないことが多い。画面のタイマーなどで合わせる)
/** ✨ 自動補正の確かさの記号 (1 = △ 怪しい / 2 = ○ たぶん / 3 = ◎ 確か) */
const GRADE_MARK = [null, '△', '○', '◎'];
const AudioSync = (() => {
  const MEASURE_SEC = 180;
  const PRELIM_FIRST = 35; // 途中の結果を出し始める (計算には 30 秒分の記録が要る)
  const PRELIM_EVERY = 10;
  const SUGGEST_MIN = 90; // これより前には、切り上げを提案しない (大きいずれは、長く聞かないと確かめられない。実測: 63 秒)
  const STABLE_SEC = 0.02; // ほかの計算の値とこれ以内なら「同じ値」
  const MOVING_SEC = 0.05; // 前の計算の値からこれより変わっていたら、確かさを下げる
  // グループごとに持つ (いくつものグループを同時に測れる。HAKO-43)。
  // 測っている間: g -> {g, tiles, ref, offs, ids, tracks, blocked, played, last, timer, closed, busy, nextPrelim,
  //   history: 計算ごとの結果 [{sec, tiles, res, grade, streak}], best: 一番よかった値 (bestOf), suggested: 切り上げを提案した, n}
  const runs = new Map();
  // 結果の候補: g -> {g, tiles, ref, offs, ids, pick: Map, two, choice, n, tried: 試している間は試す前の補正 (Map i -> 秒) / null}
  const results = new Map();
  const failures = new Map(); // 決められなかった: g -> {g, ref, ids, reason, n}
  let seq = 0;
  let starts = 0; // 測り始めた回数
  const runOfTile = (i) => [...runs.values()].find((r) => r.tiles.includes(i)) || null;

  function toggle(g) {
    if (runs.has(g)) cancel(runs.get(g));
    else start(g);
  }

  function start(g) {
    if (runs.has(g)) return;
    const info = Sync.groupInfo(g);
    if (!info || !info.active || info.movie) return;
    const { ref, tiles } = info;
    if (ref == null || tiles.length < 2) return;
    if (pausedAll || info.paused || views[ref].ss?.ps === 2) {
      notify(tr('syncAudioNeedPlay'));
      return;
    }
    results.delete(g);
    failures.delete(g);
    starts++;
    const run = {
      g,
      tiles,
      ref,
      offs: new Map(tiles.map((i) => [i, Sync.offOf(i)])),
      ids: new Map(tiles.map((i) => [i, state.tiles[i].videoId])),
      tracks: new Map(),
      blocked: new Set(),
      played: 0,
      last: performance.now(),
      closed: false,
      busy: false,
      nextPrelim: PRELIM_FIRST,
      history: [],
      best: null,
      suggested: false,
      n: ++seq,
    };
    runs.set(g, run);
    for (const i of tiles) postToFrame(views[i].player, { hakomado: 'measure', on: true, muted: !!state.tiles[i].muted });
    run.timer = setInterval(() => progress(run), 500);
    notify(tr('syncAudioStart', MEASURE_SEC));
    Sync.dockChanged();
  }

  const live = (r) => runs.get(r.g) === r; // まだ測っている (やめた・測り直したら false)

  function progress(run) {
    const t = performance.now();
    const dt = (t - run.last) / 1000;
    run.last = t;
    // 同期が止まった・本編モードにした・グループの枠が変わった → やめる
    const info = Sync.groupInfo(run.g);
    if (!info || info.movie || run.tiles.some((i) => !info.tiles.includes(i) || state.tiles[i].videoId !== run.ids.get(i))) {
      cancel(run);
      return;
    }
    // 基準の枠が再生している (広告でない) 間だけ数える
    const ss = views[run.ref]?.ss;
    if (ss && ss.ps === 1 && !ss.ad && !pausedAll && !info.paused) run.played += dt;
    if (run.played >= MEASURE_SEC) return void finish(run);
    if (!run.busy && run.played >= run.nextPrelim) {
      run.nextPrelim = run.played + PRELIM_EVERY;
      prelim(run);
    }
    Sync.dockChanged();
  }

  const stopFrames = (tiles) => {
    for (const i of tiles) postToFrame(views[i]?.player, { hakomado: 'measure', on: false });
  };

  function cancel(run, msg = tr('syncAudioCancelled')) {
    if (!run || !live(run)) return;
    clearInterval(run.timer);
    stopFrames(run.tiles);
    runs.delete(run.g);
    releaseWorker();
    Sync.dockChanged();
    notify(msg);
  }

  // ---- 計算 (Worker で)
  let worker = null;
  let noWorker = false;
  let workerAnswered = false; // 一度でも答えが返った (読み込めている)
  let jobSeq = 0;
  const jobs = new Map(); // id -> {resolve, items, ref}
  /** 計算を Worker に頼む。Worker が使えなければ、この画面で計算する。計算できなければ null */
  function compute(items, ref) {
    if (!worker && !noWorker) {
      try {
        worker = new Worker('audio-align-worker.js');
        worker.onmessage = (e) => {
          const { id, res, error } = e.data || {};
          const job = jobs.get(id);
          if (!job) return;
          jobs.delete(id);
          workerAnswered = true;
          if (error) console.warn('hakomado: ✨ 自動補正の計算に失敗しました', error);
          job.resolve(error ? null : res);
          releaseWorker();
        };
        worker.onerror = (e) => {
          // 読み込めなかった: 以後はこの画面で計算する (待っているものも)。
          // 動いていたのに落ちた (メモリが足りないなど): 待っているものは決められなかったことにする
          // (同じ計算をこの画面でやり直すと、画面と同期が止まるため)。次に計算するときに作り直す
          e.preventDefault?.();
          const loadFailed = !workerAnswered;
          console.warn('hakomado: ✨ 自動補正の Worker が止まりました', loadFailed ? '(読み込めないので、この画面で計算します)' : '', e.message || e);
          if (loadFailed) noWorker = true;
          worker?.terminate();
          worker = null;
          const left = [...jobs.values()];
          jobs.clear();
          for (const job of left) (loadFailed ? local(job.items, job.ref) : Promise.resolve(null)).then(job.resolve);
        };
      } catch (e) {
        console.warn('hakomado: ✨ 自動補正の Worker を作れませんでした', e);
        noWorker = true;
        worker = null;
      }
    }
    if (!worker) return local(items, ref);
    return new Promise((resolve) => {
      const id = ++jobSeq;
      jobs.set(id, { resolve, items, ref });
      worker.postMessage({ id, items, ref });
    });
  }
  /** 測り終えて計算も残っていなければ Worker を閉じる (計算に使ったメモリを返す。次に測るときにまた作る) */
  function releaseWorker() {
    if (runs.size || jobs.size || !worker) return;
    worker.terminate();
    worker = null;
  }
  function local(items, ref) {
    return AudioAlign.analyze(items, ref).catch((e) => {
      console.warn('hakomado: ✨ 自動補正の計算に失敗しました', e);
      return null;
    });
  }

  /** 今までの記録で計算する: {tiles, res, sec} (計算できなければ res = null) */
  async function analyzeRun(r) {
    const sec = Math.floor(r.played);
    const tiles = r.tiles.filter((i) => !r.blocked.has(i) && r.tracks.has(i) && views[i].archive);
    const refK = tiles.indexOf(r.ref);
    if (refK < 0 || tiles.length < 2) return { tiles, res: { ok: false, reason: 'short' }, sec };
    const items = tiles.map((i) => {
      const tk = r.tracks.get(i);
      return {
        track: { sr: tk.sr, per: tk.per, bins: Float32Array.from(tk.bins), marks: tk.marks.map((m) => m.slice()) },
        startMs: views[i].archive.start,
        off: r.offs.get(i),
      };
    });
    return { tiles, res: await compute(items, refK), sec };
  }

  /**
   * 枠ごとの確かさ (grade: Map i -> 1〜3) と、途中の結果が続けて同じ値になった回数 (streak: Map i -> 回数) を、cur に書き込む。
   * 計算の確かさに、前の途中の結果 (prev) からの変わり方を加える:
   * - 大きく変わった枠は、まだ定まっていない (途中の結果は △、最後の結果は ○ まで)
   * - 途中の結果で、比べるものが無ければ ○ まで (1 回しか見ていない)
   * - 2 回続けて同じ値 (streak ≥ 2) なら 1 段上げる (聞き足しても動かない)
   */
  function gradesOf(cur, prev, isPrelim) {
    cur.grade = new Map();
    cur.streak = new Map();
    cur.tiles.forEach((i, k) => {
      const d = cur.res.deltas[k];
      if (d == null || i === cur.ref) return;
      let gr = cur.res.grade?.[k] ?? 1;
      const pk = prev ? prev.tiles.indexOf(i) : -1;
      const pd = pk >= 0 ? prev.res.deltas[pk] : null;
      const streak = pd != null && Math.abs(pd - d) <= STABLE_SEC ? (prev.streak?.get(i) ?? 0) + 1 : 0;
      if (pd == null) {
        if (isPrelim) gr = Math.min(gr, 2);
      } else if (Math.abs(pd - d) > MOVING_SEC) gr = Math.min(gr, isPrelim ? 1 : 2);
      else if (streak >= 2) gr = Math.min(3, gr + 1);
      cur.grade.set(i, gr);
      cur.streak.set(i, streak);
    });
    return cur;
  }

  /**
   * 計算ごとの結果から、一番よかった値を選ぶ。枠ごとにばらばらに選ぶと、別々の計算の値が混ざってそろわなくなる
   * (実測: 基準との組の決まり方で、全部の枠が 0.11 秒そろって動く) ので、1 回の計算をまとめて採る:
   * 枠ごとの確かさの合計が一番大きい計算。同じなら、ほかの計算でも同じ値 (STABLE_SEC 以内) が多く出たもの、それも同じなら新しいもの。
   * その計算で決まらなかった枠だけ、ほかの計算からその枠の一番よい値を採る。
   * @returns {{tiles: number[], ref: number, pick: Map<number, {d: number, grade: number, sec: number, support: number}>, two: object|null, sec: number}|null}
   */
  function bestOf(history, ref) {
    if (!history.length) return null;
    const all = new Map(); // i -> [{d, grade, sec, two}]
    history.forEach((h, n) => {
      h.tiles.forEach((i, k) => {
        const d = h.res.deltas[k];
        if (i === ref || d == null) return;
        if (!all.has(i)) all.set(i, []);
        all.get(i).push({ n, d, grade: h.grade.get(i) ?? 1, sec: h.sec, two: h.tiles.length === 2 ? h.res.two : null });
      });
    });
    const better = (x, y) => (y.grade !== x.grade ? y.grade > x.grade : y.support !== x.support ? y.support > x.support : y.sec >= x.sec);
    for (const list of all.values()) for (const e of list) e.support = list.filter((x) => Math.abs(x.d - e.d) <= STABLE_SEC).length;
    // 計算ごとの点数 (確かさの合計・同じ値の多さ)
    const scored = history.map((h, n) => {
      const es = [...all.values()].map((list) => list.find((e) => e.n === n)).filter(Boolean);
      return { n, sec: h.sec, grade: es.reduce((s, e) => s + e.grade, 0), support: es.reduce((s, e) => s + e.support, 0) };
    });
    const top = scored.reduce((x, y) => (better(x, y) ? y : x));
    const pick = new Map();
    let two = null;
    for (const [i, list] of all) {
      let best = list.find((e) => e.n === top.n) || list.reduce((x, y) => (better(x, y) ? y : x));
      // ◎ の値が 2 つに分かれて、どちらも何度も出ている (揺れている) なら ○ まで (実測: 0.14 秒離れた 2 つを行き来した)
      const wobble = list.some((e) => e.grade === 3 && e.support >= 2 && Math.abs(e.d - best.d) > MOVING_SEC && Math.abs(e.d - best.d) < 1);
      if (wobble) best = { ...best, grade: Math.min(best.grade, 2) };
      pick.set(i, best);
      two = best.two; // 2 枠のときだけ使う (相手の枠は 1 つ)
    }
    const tiles = [...new Set(history.flatMap((h) => h.tiles))];
    return { tiles, ref, pick, two: tiles.length === 2 ? two : null, sec: history.at(-1).sec };
  }

  /** 今の記録で計算して、計算ごとの結果に足す (計算できたら true) */
  async function measureOnce(r, isPrelim) {
    const out = await analyzeRun(r);
    if (!live(r) || !out.res?.ok) return false;
    const prev = r.history.at(-1);
    r.history.push(gradesOf({ ...out, ref: r.ref }, prev && prev.sec < out.sec ? prev : null, isPrelim));
    r.best = bestOf(r.history, r.ref);
    return true;
  }

  async function prelim(r) {
    r.busy = true;
    await measureOnce(r, true);
    r.busy = false;
    if (!live(r) || r.closed) return;
    // 切り上げの提案: 全部の枠が ◎ で、2 回以上同じ値が出た
    const b = r.best;
    const ready =
      !!b && b.sec >= SUGGEST_MIN && r.tiles.every((i) => i === r.ref || r.blocked.has(i) || (b.pick.get(i)?.grade === 3 && b.pick.get(i).support >= 2));
    if (ready && !r.suggested) {
      r.suggested = true;
      notify(tr('syncAudioSuggestNote', b.sec));
    }
    Sync.dockChanged();
  }

  /** 測るのを終えて、そこまでで一番よかった値を結果にする */
  async function finish(r) {
    if (!r || !live(r) || r.closed) return;
    clearInterval(r.timer);
    stopFrames(r.tiles);
    r.closed = true;
    Sync.dockChanged();
    await new Promise((res) => setTimeout(res, 1500)); // 止めたときに枠が送る最後の記録を待つ
    if (!live(r)) return;
    const okNow = await measureOnce(r, false);
    if (!live(r)) return;
    runs.delete(r.g);
    releaseWorker();
    const b = r.best;
    if (!b || !b.pick.size) {
      const failure = { g: r.g, ref: r.ref, ids: r.ids, reason: okNow || r.played >= PRELIM_FIRST ? 'weak' : 'short', n: ++seq };
      failures.set(r.g, failure);
      Sync.dockChanged();
      notify(tr(failure.reason === 'short' ? 'syncAudioShort' : 'syncAudioWeak'));
      return;
    }
    results.set(r.g, { g: r.g, tiles: b.tiles, ref: r.ref, offs: r.offs, ids: r.ids, pick: b.pick, two: b.two, choice: 'mid', tried: null, blocked: new Set(r.blocked), n: ++seq });
    notify(tr('syncAudioDone'));
    Sync.dockChanged();
  }

  /** 枠から届いた記録 (形を確かめてから貯める) */
  function chunk(i, d) {
    const run = runOfTile(i);
    if (!run) return;
    const sr = Number(d.sr);
    const per = Number(d.per);
    if (!(sr >= 8000 && sr <= 192000) || !Number.isInteger(per) || per < 1 || per > 1000) return;
    if (!(d.bins instanceof Float32Array) || !Array.isArray(d.marks) || d.bins.length > 200000 || d.marks.length > 20000) return;
    const marks = d.marks.filter((m) => Array.isArray(m) && m.slice(0, 3).every(Number.isFinite)).map((m) => [m[0], m[1], m[2] || 1]);
    let tk = run.tracks.get(i);
    if (!tk || tk.sr !== sr || tk.per !== per) run.tracks.set(i, (tk = { sr, per, bins: [], marks: [] }));
    if (tk.bins.length > 600000) return; // 長くなりすぎない (10 分)
    for (const v of d.bins) tk.bins.push(v);
    tk.marks.push(...marks);
  }

  /** 枠の中で音を処理できなかった (AudioContext が動かない) */
  function blocked(i) {
    const run = runOfTile(i);
    if (!run) return;
    run.blocked.add(i);
    showToast(i, tr('mixBlocked'));
    if (i === run.ref || run.tiles.length - run.blocked.size < 2) cancel(run, tr('syncAudioBlocked'));
  }

  // ---- 結果の候補
  /** 結果・知らせ (o) がまだ使えるか (グループの基準・枠の動画が測ったときのまま。同期をやめて別のセットで始め直したら使えない) */
  function stillSame(o) {
    if (!o) return false;
    const info = Sync.groupInfo(o.g);
    return !!info && !info.movie && info.ref === o.ref && [...o.ids].every(([i, id]) => !info.tiles.includes(i) || state.tiles[i].videoId === id);
  }
  /** グループ g の結果 (まだ使えるものだけ) */
  function resultOf(g) {
    const result = results.get(g);
    return stillSame(result) && result.tiles.every((i) => state.tiles[i].videoId === result.ids.get(i)) ? result : null;
  }
  const failureFor = (g) => (stillSame(failures.get(g)) ? failures.get(g) : null);
  /** 枠 i に出している候補: そのグループの結果か、測っている途中の結果。{src, prelim} / null */
  function shown(i) {
    for (const g of results.keys()) {
      const result = resultOf(g);
      if (result?.tiles.includes(i)) return { src: result, prelim: false };
    }
    const run = runOfTile(i);
    if (run?.best && !run.closed) return { src: { ...run.best, offs: run.offs, choice: 'mid' }, prelim: true };
    return null;
  }
  /** 枠 i に入れる新しいずれ (秒)。決められなければ null */
  function proposedIn(src, i) {
    const { tiles, ref, offs, pick, two, choice } = src;
    if (!tiles.includes(i) || i === ref) return null;
    const d = two && choice !== 'mid' ? two[choice] : pick.get(i)?.d;
    return d == null ? null : Math.round((offs.get(i) + d) * 100) / 100;
  }
  /**
   * 同じコラボではないかもしれない枠 (結果が出ていて、3 枠以上で測り、ほかの枠は ○ 以上で合ったのに、音が合わなかった枠)。
   * 音を処理できなかった枠と、同期から外した枠は入れない。2 枠のときは、どちらが違うのか分からないので出さない
   */
  function suspects(g) {
    const result = resultOf(g);
    if (!result || result.tiles.length < 3) return [];
    const info = Sync.groupInfo(result.g);
    const others = result.tiles.filter((i) => i !== result.ref && info?.tiles.includes(i) && !result.blocked.has(i));
    if (!others.some((i) => (result.pick.get(i)?.grade ?? 0) >= 2)) return [];
    return others.filter((i) => !result.pick.has(i));
  }
  const isSuspect = (i) => [...results.keys()].some((g) => suspects(g).includes(i));

  /** パネルの行・図と帯の波に出す ✨ の候補: {v: 新しいずれ, grade: 1〜3, prelim} / false (決められなかった) / null (候補なし) */
  function candidateFor(i) {
    const s = shown(i);
    if (!s || !s.src.tiles.includes(i) || i === s.src.ref) return null;
    const v = proposedIn(s.src, i);
    return v == null ? false : { v, grade: s.src.pick.get(i)?.grade ?? 1, prelim: s.prelim };
  }
  /** パネル・帯の形が変わる目印 (結果が出た・消えた・選び方を変えた・試し始めた・測り始めた・終えた・決められなかった) */
  const resultKey = () => [
    [...results.keys()]
      .sort()
      .map((g) => resultOf(g))
      .filter(Boolean)
      .map((r) => [r.g, r.n, r.choice, !!r.tried]),
    [...runs.values()].map((r) => [r.g, r.n]).sort(),
    [...failures.keys()]
      .sort()
      .map((g) => failureFor(g))
      .filter(Boolean)
      .map((f) => [f.g, f.n]),
  ];

  /**
   * パネル・帯のグループに出す箱: 測っている間 (途中の結果)・結果 (試す・決める・試す前に戻す・測り直す・閉じる。2 枠なら合わせ方)・
   * 決められなかった (測り直す・閉じる)。出すものが無ければ null。{el, paint}: paint で数字を書き換える (更新のたび)。
   * 文は帯で見えるもの (波形の ✨ と点線) を指す
   */
  function resultEl(g) {
    if (runs.has(g)) return measuringEl(runs.get(g));
    if (resultOf(g)) return { el: doneEl(g), paint() {} };
    const failure = failureFor(g);
    if (failure) {
      const el = mk(
        'div',
        { class: 'dg-audio-result is-fail' },
        mk('div', { class: 'dga-title' }, tr(failure.reason === 'short' ? 'syncAudioShort' : 'syncAudioWeak')),
        // 3 枠以上でどれも合わなかった: 基準の枠だけが別の配信かもしれない (ずれは基準との差で測るため)
        failure.reason === 'weak' && failure.ids.size >= 3 ? mk('div', { class: 'dga-suspect' }, tr('syncAudioRefSuspect')) : null,
        slots(null, retryButton(g), closeButton(g)),
      );
      return { el, paint() {} };
    }
    return null;
  }

  const retryButton = (g) => mk('button', { type: 'button', textContent: tr('syncAudioRetry'), title: tr('syncAudioRetryTitle'), onclick: () => retry(g) });
  const closeButton = (g) => mk('button', { type: 'button', textContent: tr('syncAudioClose'), title: tr('syncAudioCloseTitle'), onclick: () => dismiss(g) });
  /**
   * 箱のボタンは決まった 3 つの置き場所に入れる (状態が変わっても、同じ役目のボタンが同じ場所に出るように。空いた場所も幅を取る):
   * a = 決める側 (ここで決める・試す・決める)、b = 測り直す・試す前に戻す、c = やめる・閉じる
   */
  const slots = (a, b, c) =>
    mk('div', { class: 'dga-buttons' }, mk('span', { class: 'dga-slot a' }, a), mk('span', { class: 'dga-slot b' }, b), mk('span', { class: 'dga-slot c' }, c));

  function measuringEl(run) {
    const title = mk('div', { class: 'dga-title' });
    const sub = mk('div', { class: 'dga-legend' });
    const now = mk('button', { type: 'button', class: 'primary-action', textContent: tr('syncAudioFinishNow'), title: tr('syncAudioFinishNowTitle'), onclick: () => finish(run) });
    const stop = mk('button', { type: 'button', textContent: tr('syncAudioStop'), onclick: () => cancel(run) });
    const el = mk('div', { class: 'dg-audio-result is-measuring' }, title, sub, slots(now, null, stop));
    return {
      el,
      paint() {
        if (!live(run)) return;
        const p = run.best;
        const suggest = run.suggested && !run.closed;
        el.classList.toggle('is-suggest', suggest);
        title.textContent = run.closed
          ? tr('syncAudioAnalyzing')
          : suggest
            ? tr('syncAudioSuggest', p.sec)
            : p
              ? tr('syncAudioPrelimTitle', p.sec)
              : tr('syncAudioListening');
        sub.textContent = run.closed ? '' : p ? tr('stripAudioLegend') : tr('stripAudioListeningSub', PRELIM_FIRST);
        now.disabled = run.closed || !p;
        stop.disabled = run.closed;
      },
    };
  }

  const sec = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  function doneEl(g) {
    const result = resultOf(g);
    const { tiles, ref, two, tried } = result;
    const kids = [
      mk('div', { class: 'dga-title' }, tr(tried ? 'syncAudioTrying' : 'stripAudioResultTitle')),
      mk('div', { class: 'dga-legend' }, tr('stripAudioLegend')),
    ];
    // 音が合わなかった枠: 同じコラボではないかもしれない。外すかは使う人が決める (勝手に外さない)
    for (const i of suspects(g)) {
      kids.push(
        mk(
          'div',
          { class: 'dga-suspect' },
          tr('syncAudioSuspect', `${visibleIndexes().indexOf(i) + 1}: ${tileName(i) || state.tiles[i].videoId}`) + ' ',
          mk('button', { type: 'button', class: 'fav-restore', textContent: tr('syncAudioExclude'), title: tr('syncAudioExcludeTitle'), onclick: () => Sync.excludeTile(i) }),
        ),
      );
    }
    // 試す: 押すとその値をすぐ入れる (再生しながら聞き比べられる)。2 枠なら合わせ方ごとに押せる。「決める」で終える・「試す前に戻す」で ✨ の前の補正へ
    const tryBtn = (key, label) =>
      mk('button', {
        type: 'button',
        class: 'dga-try' + (tried && result.choice === key ? ' on' : ''),
        'aria-pressed': String(!!tried && result.choice === key),
        textContent: label,
        title: tr('syncAudioTryTitle'),
        onclick: () => tryResult(g, key),
      });
    if (two) {
      // 3 択: 真ん中が中間 (映像がそろう)。両側は、それぞれ片方の人の声がそろう値 (誰の声かは出さず、補正の値の小さい順に並べる)
      const other = tiles.find((i) => i !== ref);
      const valueOf = (key) => proposedIn({ ...result, choice: key }, other) ?? 0; // 押したときに入る値と同じ
      const [lo, hi] = ['refVoice', 'otherVoice'].sort((a, b) => two[a] - two[b]);
      kids.push(
        mk(
          'div',
          { class: 'dga-choice' },
          tryBtn(lo, sec(valueOf(lo))),
          tryBtn('mid', `${tr('syncAudioMidBtn')} ${sec(valueOf('mid'))}`),
          tryBtn(hi, sec(valueOf(hi))),
        ),
      );
    }
    kids.push(
      tried
        ? slots(
            mk('button', { type: 'button', class: 'primary-action', textContent: tr('syncAudioDecide'), title: tr('syncAudioDecideTitle'), onclick: () => decide(g) }),
            mk('button', { type: 'button', textContent: tr('syncAudioUntry'), title: tr('syncAudioUntryTitle'), onclick: () => untry(g) }),
            null,
          )
        : slots(two ? null : tryBtn('mid', tr('syncAudioTry')), retryButton(g), closeButton(g)),
    );
    return mk('div', { class: 'dg-audio-result' + (tried ? ' is-trying' : '') }, kids);
  }

  function dismiss(g) {
    results.delete(g);
    failures.delete(g);
    Sync.dockChanged();
  }

  /** 測り直す (今の位置から。前の結果・知らせは消す。試していれば、試す前の補正に戻してから) */
  function retry(g) {
    if (runs.has(g)) return;
    if (resultOf(g)?.tried) untry(g);
    results.delete(g);
    failures.delete(g);
    start(g);
    Sync.dockChanged();
  }

  /** 結果のうち、入れる値 ([枠, 補正]。測ったあとで別の動画にした枠は直さない) */
  const pairsOf = (result) => result.tiles.map((i) => [i, proposedIn(result, i)]).filter(([i, v]) => v != null && state.tiles[i].videoId === result.ids.get(i));

  /** 試す: 合わせ方 key の値をすぐ入れる (結果は出したまま。初めて試すときに、試す前の補正を覚えておく) */
  function tryResult(g, key) {
    const result = resultOf(g);
    if (!result) return dismiss(g);
    if (!result.tried) result.tried = new Map(result.tiles.map((i) => [i, Sync.offOf(i)]));
    result.choice = key;
    Sync.applyOffsets(pairsOf(result));
    Sync.dockChanged();
  }
  /** 決める: 試している値のまま終える */
  function decide(g) {
    const result = resultOf(g);
    if (!result) return dismiss(g);
    const n = pairsOf(result).length;
    results.delete(g);
    Sync.dockChanged();
    notify(tr('syncAudioApplied', n));
  }
  /** 試す前に戻す: ✨ の前の補正に戻す (結果は出したまま。もう一度試せる) */
  function untry(g) {
    const result = resultOf(g);
    if (!result?.tried) return;
    const back = [...result.tried].filter(([i]) => state.tiles[i].videoId === result.ids.get(i));
    result.tried = null;
    result.choice = 'mid';
    Sync.applyOffsets(back);
    Sync.dockChanged();
  }

  /** グループ g の見出しの ✨ に出す進み具合 (測っていなければ '') */
  function progressText(g) {
    const run = runs.get(g);
    if (!run) return '';
    return run.closed ? tr('syncAudioAnalyzing') : tr('syncAudioMeasuring', Math.floor(run.played), MEASURE_SEC);
  }

  return {
    toggle,
    /** 枠の中から届いた音の大きさの記録 (envChunk): ✨ 自動補正と、その動画の全編の波形 (〰。HAKO-39) に足す */
    chunk: (i, d) => {
      chunk(i, d);
      if (views[i]?.archive && /^[\w-]{11}$/.test(state.tiles[i].videoId || '')) Waves.feed(state.tiles[i].videoId, d).catch(() => {});
    },
    blocked,
    /** これまでに測り始めた回数 (⏱ 開いて同期で、使う人が自分で押したかを見る) */
    runCount: () => starts,
    /** このグループの結果・途中の結果・知らせを出している */
    hasOutput: (g) => runs.has(g) || !!resultOf(g) || !!failureFor(g),
    /** このグループで、途中の結果か結果が出ている目印 (帯が測るたびに一度だけ拡大するのに使う)。無ければ null */
    candidateKey: (g) => {
      const run = runs.get(g);
      if (run) return run.best ? 'run' + run.n : null;
      const result = resultOf(g);
      return result ? 'run' + result.n : null;
    },
    progressText,
    isSuspect,
    candidateFor,
    resultKey,
    resultEl,
  };
})();
