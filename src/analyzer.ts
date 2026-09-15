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

  return { ok: true, issues: [], checks, firstConflict, getWitness };
}
