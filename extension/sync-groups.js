// hakomado: アーカイブの同期再生の「同期グループ」の分け方 (A・B と C・D を別々にそろえる)。画面には触らない計算だけ
// - 手で決めた枠 (manual): その番号のグループへ (0 = 同期しない)
// - それ以外のアーカイブ: 配信の時間帯が重なる枠どうしを、つながりで 1 つのグループにまとめる (A と B、B と C が重なれば A・B・C)
//   1 本だけで重なる相手が無い枠は、どのグループにも入らない
// - ライブ (と時間帯の分からない枠) は自動では入れない (🎬 本編モードのグループに手で入れたときだけ)
// - グループの番号は前回の分け方 (prev) をなるべく保つ (枠を足し引きしても、色や番号が入れ替わらないように)。最大 MAX 組
/* exported SyncGroups */
'use strict';

const SyncGroups = (() => {
  const MAX = 4;

  /**
   * @param {{i: number, range: [number, number]|null}[]} tiles 同期に加われる枠 (レイアウトの順。range = 配信の時間帯、ライブなどは null)
   * @param {Map<number, number>} manual 手で決めた枠 → グループの番号 (0 = 同期しない)
   * @param {Map<number, number>} prev 前回の分け方 (枠 → グループの番号)
   * @returns {{groups: Map<number, number[]>, excluded: Map<number, 'manual'|'alone'|'live'|'full'>}}
   *   groups = 番号 → 枠 (レイアウトの順)。excluded = どのグループにも入らない枠と、その理由
   */
  function assign(tiles, manual = new Map(), prev = new Map()) {
    const order = new Map(tiles.map((t, k) => [t.i, k]));
    const groups = new Map();
    const excluded = new Map();
    const add = (g, i) => {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    };
    const auto = [];
    for (const t of tiles) {
      const g = manual.get(t.i);
      if (g === 0) excluded.set(t.i, 'manual');
      else if (Number.isInteger(g) && g >= 1 && g <= MAX) add(g, t.i);
      else if (t.range) auto.push(t);
      else excluded.set(t.i, 'live');
    }

    // 時間帯の重なりでつなぐ (つながったものを 1 つに)
    const parent = auto.map((_, k) => k);
    const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    for (let a = 0; a < auto.length; a++) {
      for (let b = a + 1; b < auto.length; b++) {
        const [s1, e1] = auto[a].range;
        const [s2, e2] = auto[b].range;
        if (s1 < e2 && s2 < e1) parent[find(a)] = find(b);
      }
    }
    const byRoot = new Map();
    auto.forEach((t, k) => {
      const r = find(k);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(t.i);
    });
    const clusters = [];
    for (const list of byRoot.values()) {
      if (list.length < 2) excluded.set(list[0], 'alone');
      else clusters.push(list);
    }

    // 番号を決める: まず前回いちばん多くの枠が入っていた番号 (ほかのまとまりに取られていなければ)、無ければ空いている小さい番号
    const taken = new Set();
    const pick = new Map();
    const votes = clusters.map((list) => {
      const count = new Map();
      for (const i of list) {
        const g = prev.get(i);
        if (g >= 1 && g <= MAX) count.set(g, (count.get(g) || 0) + 1);
      }
      return [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    });
    // 票の多いまとまりから先に選ぶ (同じなら、レイアウトで前にあるまとまり)
    const byVotes = clusters.map((_, k) => k).sort((a, b) => (votes[b][0]?.[1] || 0) - (votes[a][0]?.[1] || 0) || a - b);
    for (const k of byVotes) {
      const best = votes[k].find(([g]) => !taken.has(g));
      if (best) {
        pick.set(k, best[0]);
        taken.add(best[0]);
      }
    }
    clusters.forEach((list, k) => {
      if (pick.has(k)) return;
      for (let g = 1; g <= MAX; g++) {
        if (!taken.has(g) && !groups.has(g)) {
          pick.set(k, g);
          taken.add(g);
          return;
        }
      }
    });
    clusters.forEach((list, k) => {
      const g = pick.get(k);
      for (const i of list) {
        if (g == null) excluded.set(i, 'full');
        else add(g, i);
      }
    });

    for (const list of groups.values()) list.sort((a, b) => order.get(a) - order.get(b));
    return { groups: new Map([...groups].sort((a, b) => a[0] - b[0])), excluded };
  }

  return { MAX, assign };
})();
