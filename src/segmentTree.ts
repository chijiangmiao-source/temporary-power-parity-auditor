/**
 * 时间分段树（区间线段树 + DFS 增量应用）。
 *
 * 每条约束的活动区间为 [start, end)：从 add 序位起生效，
 * 到同 id 的 remove 序位前失效。将其拆成 O(log M) 个线段树
 * 节点覆盖；随后按线段树做一次 DFS：
 *   - 进入节点：用可回滚并查集应用节点上的全部约束并记录快照；
 *   - 叶子位置 t：并查集状态恰为时间 t（应用第 t 步操作后）的
 *     全部活动约束，可直接判定一致性；
 *   - 离开节点：回滚到进入前快照。
 *
 * 总复杂度 O((M + K) log M · α 的替代项——这里是 O(log N) 树高)，
 * 不会在任何检查点重建整图。
 */

export interface SegmentEdge<E> {
  a: number;
  b: number;
  parity: number;
  ref: E;
}

interface QueryPoint {
  time: number;
  queryIndex: number;
}

export class SegmentTreeSolver<E> {
  private readonly n: number;
  private readonly nodes: SegmentEdge<E>[][];
  private readonly points = new Map<number, QueryPoint[]>();

  /**
   * @param timeCount 时间位置数（叶子数，等于操作流长度）
   * @param queries 需要取值的时间位置；同一位置可注册多个查询
   */
  constructor(timeCount: number, queryTimes: number[]) {
    this.n = Math.max(1, timeCount);
    // 线段树用 4n 容量的一维数组存储，节点 u 覆盖 [l, r)
    this.nodes = Array.from({ length: 4 * this.n }, () => []);
    queryTimes.forEach((time, i) => {
      const list = this.points.get(time) ?? [];
      list.push({ time, queryIndex: i });
      this.points.set(time, list);
    });
  }

  /** 添加一条在 [l, r) 时间内活动的边 */
  addInterval(l: number, r: number, edge: SegmentEdge<E>): void {
    if (l >= r) return;
    this.insert(1, 0, this.n, l, r, edge);
  }

  private insert(u: number, nl: number, nr: number, l: number, r: number, edge: SegmentEdge<E>): void {
    if (l <= nl && nr <= r) {
      this.nodes[u].push(edge);
      return;
    }
    const mid = (nl + nr) >> 1;
    if (l < mid) this.insert(u << 1, nl, mid, l, r, edge);
    if (r > mid) this.insert(u << 1 | 1, mid, nr, l, r, edge);
  }

  /**
   * 执行一次 DFS。
   * @param apply 应用一条边；返回 false 表示该边与当前状态矛盾
   * @param rollback 回滚到给定快照
   * @param snapshot 取当前快照
   * @param consistent 查询当前整体是否一致
   * @returns 与构造时 queryTimes 同序的结果（true = 可满足）
   */
  run(
    apply: (edge: SegmentEdge<E>) => boolean,
    snapshot: () => number,
    rollback: (s: number) => void,
    consistent: () => boolean,
  ): boolean[] {
    const results = new Array<boolean>(this.totalQueries()).fill(false);
    this.dfs(1, 0, this.n, apply, snapshot, rollback, consistent, results);
    return results;
  }

  private totalQueries(): number {
    let total = 0;
    for (const list of this.points.values()) total += list.length;
    return total;
  }

  private dfs(
    u: number,
    l: number,
    r: number,
    apply: (edge: SegmentEdge<E>) => boolean,
    snapshot: () => number,
    rollback: (s: number) => void,
    consistent: () => boolean,
    results: boolean[],
  ): void {
    const snap = snapshot();
    for (const edge of this.nodes[u]) apply(edge);

    if (r - l === 1) {
      const list = this.points.get(l);
      if (list) for (const q of list) results[q.queryIndex] = consistent();
    } else {
      const mid = (l + r) >> 1;
      this.dfs(u << 1, l, mid, apply, snapshot, rollback, consistent, results);
      this.dfs(u << 1 | 1, mid, r, apply, snapshot, rollback, consistent, results);
    }

    rollback(snap);
  }
}
