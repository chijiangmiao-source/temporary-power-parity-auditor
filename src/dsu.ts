/**
 * 可回滚的带奇偶（位权）并查集。
 *
 * 除常规 rank/size 并查集外，xor[v] 记录 parity(v) XOR parity(parent[v])，
 * find 返回节点到根的累计异或，从而支持 same / opposite 两类约束：
 *   union(a, b, 0) 表示 parity(a) = parity(b)（同相）
 *   union(a, b, 1) 表示 parity(a) != parity(b)（反相）
 *
 * 关键约束：
 *  - 不做路径压缩（压缩会制造无法按栈回滚的父指针改写），
 *    仅按大小合并保证树高 O(log n)；
 *  - 每次 union（包括未合并与产生矛盾的情形）都压入一条历史记录，
 *    rollback 到快照即可逐弹恢复，供时间分段树 DFS 离开节点时使用；
 *  - 矛盾（奇环）是布尔状态：任意一次不一致合并置位，回滚到该状态
 *    出现之前的快照即自动清除。
 */

interface HistoryEntry {
  /** 被挂接的根；-1 表示本次 union 两端已在同一集合（无结构改动） */
  child: number;
  /** child 被挂接到的根；child === -1 时无意义 */
  root: number;
  oldXor: number;
  oldSize: number;
  /** 本次 union 之前的矛盾标志，用于逐弹恢复 */
  prevConflict: boolean;
}

export interface UnionResult {
  /** true 表示约束与既有约束相容 */
  consistent: boolean;
  /** true 表示本次确实合并了两棵树（新增了一条边） */
  merged: boolean;
}

export class RollbackParityDSU {
  private parent: number[] = [];
  private xorToParent: number[] = [];
  private size: number[] = [];
  private history: HistoryEntry[] = [];
  private conflict = false;

  /** 初始化 n 个互不连通的节点 */
  reset(n: number): void {
    this.parent = new Array(n);
    this.xorToParent = new Array(n).fill(0);
    this.size = new Array(n).fill(1);
    this.history = [];
    this.conflict = false;
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  /** 不做路径压缩：沿父链累计异或，返回根与 parity(v) XOR parity(root) */
  find(v: number): { root: number; x: number } {
    let x = 0;
    while (this.parent[v] !== v) {
      x ^= this.xorToParent[v];
      v = this.parent[v];
    }
    return { root: v, x };
  }

  /**
   * 加入约束 parity(a) XOR parity(b) = p。
   * 同根时校验既有相对位权；不同根时按大小合并。
   */
  union(a: number, b: number, p: number): UnionResult {
    const fa = this.find(a);
    const fb = this.find(b);
    const prevConflict = this.conflict;

    if (fa.root === fb.root) {
      const consistent = (fa.x ^ fb.x) === p;
      if (!consistent) this.conflict = true;
      this.history.push({ child: -1, root: -1, oldXor: 0, oldSize: 0, prevConflict });
      return { consistent, merged: false };
    }

    let ra = fa.root;
    let rb = fb.root;
    let xa = fa.x;
    let xb = fb.x;
    // 保证 ra 为较大的根，把 rb 挂到 ra 下
    if (this.size[ra] < this.size[rb]) {
      [ra, rb] = [rb, ra];
      [xa, xb] = [xb, xa];
    }

    // parity(rb) XOR parity(ra) = p XOR xa XOR xb
    // （xa = parity(a) XOR parity(ra)，xb = parity(b) XOR parity(rb)）
    const edgeXor = p ^ xa ^ xb;
    this.history.push({
      child: rb,
      root: ra,
      oldXor: this.xorToParent[rb],
      oldSize: this.size[ra],
      prevConflict,
    });
    this.parent[rb] = ra;
    this.xorToParent[rb] = edgeXor;
    this.size[ra] += this.size[rb];
    return { consistent: true, merged: true };
  }

  isConsistent(): boolean {
    return !this.conflict;
  }

  snapshot(): number {
    return this.history.length;
  }

  rollback(snap: number): void {
    while (this.history.length > snap) {
      const e = this.history.pop()!;
      if (e.child !== -1) {
        this.parent[e.child] = e.child;
        this.xorToParent[e.child] = e.oldXor;
        this.size[e.root] = e.oldSize;
      }
      this.conflict = e.prevConflict;
    }
  }
}
