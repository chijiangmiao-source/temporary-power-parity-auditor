/**
 * 分析引擎：解析 -> 时间分段树 + 可回滚奇偶并查集 -> 按序检查结果。
 *
 * 主判定路径只做一次线段树 DFS，边在 O(log M) 个节点间共享，
 * 绝不在每个 check 重建整图。
 *
 * 矛盾时（仅冲突检查点，通常很少）另外用带边标记的并查集
 * 复算一次该时刻的活动约束，提取构成奇环的约束链作为证据。
 */
import { RollbackParityDSU } from './dsu';
import { parseOperations } from './parser';
import { SegmentTreeSolver, type SegmentEdge } from './segmentTree';
import type {
  AnalyzeResult,
  CheckOutcome,
  ConflictWitness,
  Constraint,
  Operation,
  RefinedCycle,
} from './types';

/** 节点名压缩 */
function internNodes(constraints: Constraint[]): { nodes: string[]; index: Map<string, number> } {
  const index = new Map<string, number>();
  const nodes: string[] = [];
  for (const c of constraints) {
    for (const name of [c.a, c.b]) {
      if (!index.has(name)) {
        index.set(name, nodes.length);
        nodes.push(name);
      }
    }
  }
  return { nodes, index };
}

/* ------------------------------------------------------------------ */
/* 主路径：时间分段树 + 可回滚奇偶并查集                                */
/* ------------------------------------------------------------------ */

export function solveOperations(
  operations: Operation[],
  constraints: Constraint[],
  checkIndices: number[],
): boolean[] {
  const m = operations.length;
  const { index } = internNodes(constraints);
  const dsu = new RollbackParityDSU();
  dsu.reset(Math.max(1, index.size));

  const solver = new SegmentTreeSolver<Constraint>(m, checkIndices);
  for (const c of constraints) {
    const edge: SegmentEdge<Constraint> = {
      a: index.get(c.a)!,
      b: index.get(c.b)!,
      parity: c.parity,
      ref: c,
    };
    solver.addInterval(c.start, c.end, edge);
  }

  return solver.run(
    (edge) => dsu.union(edge.a, edge.b, edge.parity).consistent,
    () => dsu.snapshot(),
    (s) => dsu.rollback(s),
    () => dsu.isConsistent(),
  );
}

/* ------------------------------------------------------------------ */
/* 矛盾证据：合并森林 + BFS 真实图路径                                  */
/* ------------------------------------------------------------------ */

interface AdjEdge {
  to: number;
  c: Constraint;
}

/**
 * 在给定时间点（应用第 time 步操作后）复算活动约束，返回首个奇环。
 * 合并两个连通分量时，把约束按其原始端点加入邻接表：
 * 每次合并的端点必分属不同分量，因此这些边构成一片森林。
 * 触发矛盾时，森林中两端点之间已有唯一路径，加上闭合约束即奇环。
 * 约束按 add 序位加入，证据具有确定性。
 */
export function findConflictWitness(constraints: Constraint[], time: number): ConflictWitness | null {
  return findConflictWitnessWith(internNodes(constraints), constraints, time);
}

function findConflictWitnessWith(
  interned: { index: Map<string, number>; nodes: string[] },
  constraints: Constraint[],
  time: number,
): ConflictWitness | null {
  const { index } = interned;
  const n = Math.max(1, interned.nodes.length);
  const dsu = new RollbackParityDSU();
  dsu.reset(n);
  const adj: AdjEdge[][] = Array.from({ length: n }, () => []);

  const active = constraints.filter((c) => c.start <= time && time < c.end);
  for (const c of active) {
    const a = index.get(c.a)!;
    const b = index.get(c.b)!;
    const result = dsu.union(a, b, c.parity);

    if (!result.consistent) {
      // BFS 求森林中 a -> b 的唯一路径
      const prev = new Array<number>(n).fill(-1);
      const prevEdge = new Array<Constraint | null>(n).fill(null);
      const seen = new Uint8Array(n);
      seen[a] = 1;
      const queue = [a];
      let head = 0;
      while (head < queue.length) {
        const u = queue[head++];
        if (u === b) break;
        for (const e of adj[u]) {
          if (!seen[e.to]) {
            seen[e.to] = 1;
            prev[e.to] = u;
            prevEdge[e.to] = e.c;
            queue.push(e.to);
          }
        }
      }
      const path: Constraint[] = [];
      let v = b;
      while (v !== a) {
        path.push(prevEdge[v]!);
        v = prev[v];
      }
      path.reverse();
      return { path, closing: c };
    }

    if (result.merged) {
      adj[a].push({ to: b, c });
      adj[b].push({ to: a, c });
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 精炼最短矛盾回路：双层状态图 + 逐源最短路                             */
/* ------------------------------------------------------------------ */

interface ActiveEdge {
  u: number;
  v: number;
  c: Constraint;
}

interface AdjEntry {
  to: number;
  edge: number;
}

/**
 * 环上约束 id 序列的规范化形式：
 * 在两个遍历朝向、全部 k 个轮转中取字典序最小者。
 * 相同的环无论从哪个节点、哪个方向复现，规范化序列都一致，
 * 用于同长度候选的稳定决胜。
 */
export function canonicalCycleIds(ids: string[]): string[] {
  const k = ids.length;
  if (k <= 1) return ids.slice();
  let best = ids.slice();
  for (let rev = 0; rev < 2; rev++) {
    const base = rev === 0 ? ids : [...ids].reverse();
    for (let r = 0; r < k; r++) {
      let less = false;
      for (let i = 0; i < k; i++) {
        const a = base[(i + r) % k];
        if (a < best[i]) {
          less = true;
          break;
        }
        if (a > best[i]) break;
      }
      if (less) {
        const next = new Array<string>(k);
        for (let i = 0; i < k; i++) next[i] = base[(i + r) % k];
        best = next;
      }
    }
  }
  return best;
}

/** 双层状态图 BFS 的父指针信息（状态编号 2*vertex + layer） */
interface BfsInfo {
  dist: Int32Array;
  parentState: Int32Array;
  parentEdge: Int32Array;
}

/**
 * 从指定双层状态出发做有序 BFS：邻接边按约束 id 升序探索，
 * 配合 FIFO 队列，每个状态记录字典序最小的首达最短路父指针。
 */
function layeredBfs(
  adj: AdjEntry[][],
  edges: ActiveEdge[],
  n: number,
  rootState: number,
  maxDepth: number,
): BfsInfo {
  const dist = new Int32Array(2 * n).fill(-1);
  const parentState = new Int32Array(2 * n).fill(-2);
  const parentEdge = new Int32Array(2 * n).fill(-1);
  dist[rootState] = 0;
  const queue: number[] = [rootState];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const u = cur >> 1;
    const pu = cur & 1;
    const d = dist[cur];
    if (d >= maxDepth) continue;

    for (const { to: v, edge: ei } of adj[u]) {
      const target = 2 * v + (pu ^ edges[ei].c.parity);
      if (dist[target] === -1) {
        dist[target] = d + 1;
        parentState[target] = cur;
        parentEdge[target] = ei;
        queue.push(target);
      }
    }
  }
  return { dist, parentState, parentEdge };
}

/**
 * 在某检查点的活动约束多重图上，求约束条数最少的相位矛盾闭环。
 *
 * 双层状态图：每个节点 v 展开为 (v,0)/(v,1) 两个状态，
 * 位权 w 的约束把 (u,p) 连到 (v,p xor w)。奇环等价于
 * 存在从 (s,0) 到 (s,1) 的闭路：
 *  - 第一遍对每个源点 BFS，取各源点最短闭路长度的全局最小值 g；
 *  - 第二遍按 id 升序固定首边，从“走过首边后的状态”再做有序 BFS，
 *    取长度恰为 g-1 的字典序最小闭合路径。首边升序 + 有序最短路
 *    直接给出规范化胜者，既不枚举简单环，也不逐条删除约束重算。
 *
 * 反相自环（长度 1）、两条平行边（长度 2）、多个连通分量均自然处理；
 * 同长度候选按环上约束 id 的规范化循环序列决胜，结果只取决于输入。
 */
export function findShortestContradictionCycle(active: Constraint[]): RefinedCycle | null {
  // 仅对活动约束做局部节点压缩
  const nodeIndex = new Map<string, number>();
  const nodeNames: string[] = [];
  const vertexOf = (name: string): number => {
    const existing = nodeIndex.get(name);
    if (existing !== undefined) return existing;
    const v = nodeNames.length;
    nodeIndex.set(name, v);
    nodeNames.push(name);
    return v;
  };

  const edges: ActiveEdge[] = active.map((c) => ({
    u: vertexOf(c.a),
    v: vertexOf(c.b),
    c,
  }));
  const n = nodeNames.length;
  const adj: AdjEntry[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    // 自环只登记一次；普通边登记两个方向
    adj[e.u].push({ to: e.v, edge: i });
    if (e.u !== e.v) adj[e.v].push({ to: e.u, edge: i });
  });
  // 有序 BFS 的确定性来自邻接边 id 升序（id 已由解析层保证全局唯一）
  for (const list of adj) {
    list.sort((x, y) => (edges[x.edge].c.id < edges[y.edge].c.id ? -1 : 1));
  }
  const edgesById = edges
    .map((_, i) => i)
    .sort((i, j) => (edges[i].c.id < edges[j].c.id ? -1 : 1));

  // 第一遍：逐源 BFS 求全局最短矛盾闭路长度 g
  let g = Infinity;
  for (let s = 0; s < n; s++) {
    const { dist } = layeredBfs(adj, edges, n, 2 * s, Infinity);
    const gs = dist[2 * s + 1];
    if (gs !== -1 && gs < g) g = gs;
  }
  if (!isFinite(g)) return null;
  const girth = g;

  if (girth === 1) {
    // 长度 1 的矛盾环只能是反相自环；取 id 最小者为规范化胜者
    for (const ei of edgesById) {
      if (edges[ei].u === edges[ei].v && edges[ei].c.parity === 1) {
        return buildResult(edges, nodeNames, [ei], [edges[ei].u]);
      }
    }
    return null; // 理论上不可达
  }

  // 第二遍：按 id 升序固定首边，求以其为规范化首位的长度 g 闭路
  let winner: { edgeSeq: number[]; verts: number[] } | null = null;
  for (const firstEdge of edgesById) {
    const e0 = edges[firstEdge];
    // 首边的两个遍历方向：s 为闭合顶点，走过首边到达 (t,w)
    const orientations: { s: number; t: number }[] = [{ s: e0.u, t: e0.v }];
    if (e0.u !== e0.v) orientations.push({ s: e0.v, t: e0.u });

    for (const { s, t } of orientations) {
      const w = e0.c.parity;
      const { dist, parentState, parentEdge } = layeredBfs(adj, edges, n, 2 * t + w, girth - 1);
      const target = 2 * s + 1; // 经 g-1 条边回到 s 的异相层
      if (dist[target] !== girth - 1) continue;

      // 沿父指针还原尾路径（首边之外的 g-1 条边，末条为闭合边）
      const tail: number[] = [];
      let st = target;
      let ok = true;
      let guard = 0;
      while (st !== 2 * t + w) {
        const pe = parentEdge[st];
        if (pe < 0 || guard++ > 4 * n) {
          ok = false;
          break;
        }
        tail.push(pe);
        st = parentState[st];
      }
      if (!ok) continue;
      tail.reverse();

      // 尾路径不得复用首边；同一条边也不应出现两次（有序 BFS 的简单性兜底）
      if (tail.includes(firstEdge) || new Set(tail).size !== tail.length) continue;

      const edgeSeq = [firstEdge, ...tail];
      const verts = traceVertices(edges, s, edgeSeq);
      if (!verts) continue;
      // 最优长度下闭路必为原图层简单环；防御性地复核顶点互异
      if (new Set(verts).size !== girth) continue;

      // 同一首边的两个方向取字典序较小者；不同首边按外层升序首个命中即胜
      if (winner === null || lexicographicEdgeSeq(edges, edgeSeq, winner.edgeSeq) < 0) {
        winner = { edgeSeq, verts };
      }
    }
    if (winner) return buildResult(edges, nodeNames, winner.edgeSeq, winner.verts);
  }

  return null; // 理论上不可达：第一遍已确认存在长度 g 的闭路
}

/** 从 (s,0) 起按边序列回放，逐边确定下一顶点与层；端点不衔接时返回 null */
function traceVertices(edges: ActiveEdge[], s: number, edgeSeq: number[]): number[] | null {
  const k = edgeSeq.length;
  const verts = new Array<number>(k);
  let state = 2 * s;
  for (let i = 0; i < k; i++) {
    verts[i] = state >> 1;
    const e = edges[edgeSeq[i]];
    const from = state >> 1;
    const to = e.u === from ? e.v : e.v === from ? e.u : -1;
    if (to < 0) return null;
    state = 2 * to + ((state & 1) ^ e.c.parity);
  }
  return verts;
}

/** 按下标对应约束的 id 做字典序比较 */
function lexicographicEdgeSeq(edges: ActiveEdge[], a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = edges[a[i]].c.id;
    const y = edges[b[i]].c.id;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

/** 异或校验后按规范化朝向构造返回值 */
function buildResult(
  edges: ActiveEdge[],
  nodeNames: string[],
  edgeSeq: number[],
  verts: number[],
): RefinedCycle | null {
  const k = edgeSeq.length;
  const rawConstraints = edgeSeq.map((ei) => edges[ei].c);
  let xor = 0;
  for (const cc of rawConstraints) xor ^= cc.parity;
  if (xor !== 1) return null; // 防御性校验：宁可不展示也不展示错证

  const ids = rawConstraints.map((cc) => cc.id);
  const canonical = canonicalCycleIds(ids);
  const { rev, rot } = canonicalOrientation(ids, canonical);
  const baseEdges = rev ? [...edgeSeq].reverse() : edgeSeq;
  const baseVerts = rev ? [verts[0], ...verts.slice(1).reverse()] : verts;
  const ordEdges = new Array<number>(k);
  const ordVerts = new Array<number>(k);
  for (let i = 0; i < k; i++) {
    ordEdges[i] = baseEdges[(i + rot) % k];
    ordVerts[i] = baseVerts[(i + rot) % k];
  }
  const ordered = ordEdges.map((ei) => edges[ei].c);

  return {
    chain: ordered.slice(0, -1),
    closing: ordered[k - 1],
    nodes: ordVerts.map((vv) => nodeNames[vv]),
    length: k,
    xor: 1,
    canonicalIds: canonical,
  };
}

/** 给定 id 序列与其规范化结果，反解所用的（反向 rev、轮转 rot）取向 */
function canonicalOrientation(
  ids: string[],
  target: string[],
): { rev: boolean; rot: number } {
  const k = ids.length;
  for (let r = 0; r < 2; r++) {
    const base = r === 0 ? ids : [...ids].reverse();
    for (let shift = 0; shift < k; shift++) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (base[(i + shift) % k] !== target[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { rev: r === 1, rot: shift };
    }
  }
  return { rev: false, rot: 0 };
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

export function analyze(jsonText: string): AnalyzeResult {
  const { operations, constraints, issues, checkIndices } = parseOperations(jsonText);
  if (issues.length > 0) {
    return {
      ok: false,
      issues,
      checks: [],
      firstConflict: -1,
      getWitness: () => null,
      isRefined: () => false,
      refineCycle: () => null,
    };
  }

  // 主判定：一次时间分段树 DFS 出全部检查点的 safe/conflict。
  const verdicts = solveOperations(operations, constraints, checkIndices);

  const checks: CheckOutcome[] = checkIndices.map((opIndex, i) => ({
    index: opIndex,
    seq: i + 1,
    safe: verdicts[i],
  }));

  const firstConflict = checks.findIndex((c) => !c.safe);

  // 证据按需计算并缓存：冲突连续、检查点很多时，不展开的检查点零成本。
  const interned = internNodes(constraints);
  const witnessCache = new Map<number, ConflictWitness | null>();
  const getWitness = (i: number): ConflictWitness | null => {
    if (checks[i]?.safe) return null;
    if (!witnessCache.has(i)) {
      witnessCache.set(i, findConflictWitnessWith(interned, constraints, checks[i].index));
    }
    return witnessCache.get(i) ?? null;
  };

  // 精炼最短回路同样只在用户触发时运行，按检查点独立缓存。
  const refinedCache = new Map<number, RefinedCycle | null>();
  const isRefined = (i: number): boolean => refinedCache.has(i);
  const refineCycle = (i: number): RefinedCycle | null => {
    if (checks[i]?.safe) return null;
    if (!refinedCache.has(i)) {
      const time = checks[i].index;
      const active = constraints.filter((c) => c.start <= time && time < c.end);
      refinedCache.set(i, findShortestContradictionCycle(active));
    }
    return refinedCache.get(i) ?? null;
  };

  return {
    ok: true,
    issues: [],
    checks,
    firstConflict,
    getWitness,
    isRefined,
    refineCycle,
  };
}
