/**
 * 精炼最短矛盾回路测试：
 *  - 在小图上枚举全部简单环（含反相自环、平行边、多连通分量），
 *    逐环校验异或，核对双层状态图最短路给出的最短长度与规范化胜者；
 *  - 随机大量多重图做穷举式差分；
 *  - 校验首尾连续性、闭合边、异或校验与同输入稳定性；
 *  - 校验“仅用户触发时运行、按检查点缓存、输入变化即失效”的入口语义。
 */
import { describe, expect, it } from 'vitest';
import { analyze } from './analyzer';
import { canonicalCycleIds, findShortestContradictionCycle } from './analyzer';
import type { Constraint, Relation, RefinedCycle } from './types';

/* ------------------------------------------------------------------ */
/* 工具                                                                  */
/* ------------------------------------------------------------------ */

function c(id: string, a: string, b: string, relation: Relation): Constraint {
  return {
    id,
    a,
    b,
    relation,
    parity: relation === 'opposite' ? 1 : 0,
    start: 0,
    end: 1,
  };
}

/** mulberry32 —— 可复现的伪随机数 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 校验返回回路自身的结构不变量 */
function expectValidCycle(cy: RefinedCycle | null): asserts cy is RefinedCycle {
  expect(cy).not.toBeNull();
  if (!cy) return;
  const k = cy.length;
  expect(k).toBeGreaterThanOrEqual(1);
  expect(cy.chain).toHaveLength(k - 1);
  expect(cy.nodes).toHaveLength(k);
  // 简单环：节点互不相同（长度 1 的自环只有一个节点）
  expect(new Set(cy.nodes).size).toBe(k);

  // 链首尾连续：chain[i] 连接 nodes[i] 与 nodes[i+1]
  for (let i = 0; i < cy.chain.length; i++) {
    expect([cy.chain[i].a, cy.chain[i].b].sort()).toEqual(
      [cy.nodes[i], cy.nodes[i + 1]].sort(),
    );
  }
  // 闭合边连接末位与首位
  expect([cy.closing.a, cy.closing.b].sort()).toEqual(
    [cy.nodes[k - 1], cy.nodes[0]].sort(),
  );

  // 异或校验：全环位权异或恒为 1
  const xor = [...cy.chain, cy.closing].reduce((acc, e) => acc ^ e.parity, 0);
  expect(xor).toBe(1);
  expect(cy.xor).toBe(1);

  // 规范化序列确为两个朝向、全部轮转中的字典序最小者
  const ids = [...cy.chain.map((e) => e.id), cy.closing.id];
  expect(cy.canonicalIds).toEqual(canonicalCycleIds(ids));
  expect(cy.canonicalIds).toHaveLength(k);
}

/* ------------------------------------------------------------------ */
/* 穷举预言机：枚举多重图的全部简单环                                    */
/* ------------------------------------------------------------------ */

interface OracleEdge {
  u: number;
  v: number;
  w: 0 | 1;
  id: string;
}

/**
 * 枚举无向多重图中的全部简单环：
 * 以“环上最小顶点”为锚做 DFS（路径只允许经过 > s 的顶点），
 * 每个环会在两个朝向上各出现一次，用规范化 id 序列去重。
 * 自环（长度 1）、平行边对（长度 2）天然覆盖。
 */
function enumerateSimpleCycles(edges: OracleEdge[], n: number): Map<string, string[]> {
  const adj: { to: number; ei: number }[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, ei) => {
    adj[e.u].push({ to: e.v, ei });
    if (e.u !== e.v) adj[e.v].push({ to: e.u, ei });
  });

  const cycles = new Map<string, string[]>();
  const onPath = new Uint8Array(n);

  const record = (edgePath: number[]) => {
    const ids = edgePath.map((ei) => edges[ei].id);
    const xor = edgePath.reduce((acc, ei) => acc ^ edges[ei].w, 0);
    if (xor !== 1) return; // 只保留矛盾环
    const sig = canonicalCycleIds(ids).join('');
    if (!cycles.has(sig)) cycles.set(sig, canonicalCycleIds(ids));
  };

  // 自环：长度 1 的环在 DFS 闭合时路径为空，需单独登记
  edges.forEach((e, ei) => {
    if (e.u === e.v && e.w === 1) record([ei]);
  });

  const dfs = (s: number, u: number, edgePath: number[], lastEdge: number) => {
    for (const { to: v, ei } of adj[u]) {
      if (ei === lastEdge) continue; // 不沿同一条边原路返回（平行边是不同边，允许）
      if (v === s) {
        if (edgePath.length >= 1) record([...edgePath, ei]);
        continue;
      }
      // s 必须保持为环上唯一最小顶点；已在路径上的顶点（含 u 的自环）跳过
      if (v > s && !onPath[v]) {
        onPath[v] = 1;
        dfs(s, v, [...edgePath, ei], ei);
        onPath[v] = 0;
      }
    }
  };

  for (let s = 0; s < n; s++) {
    onPath[s] = 1;
    dfs(s, s, [], -1);
    onPath[s] = 0;
  }
  return cycles;
}

/** 预言机给出的全局最短矛盾环：长度、规范化胜者、同长度候选数 */
function oracleBest(edges: OracleEdge[], n: number) {
  const cycles = enumerateSimpleCycles(edges, n);
  let minLen = Infinity;
  for (const ids of cycles.values()) minLen = Math.min(minLen, ids.length);
  if (!isFinite(minLen)) return null;
  const winners = [...cycles.values()].filter((ids) => ids.length === minLen);
  winners.sort((a, b) => (a.join('') < b.join('') ? -1 : 1));
  return { minLen: minLen as number, winner: winners[0], tied: winners.length };
}

function toConstraints(edges: OracleEdge[]): Constraint[] {
  return edges.map((e) => c(e.id, `V${e.u}`, `V${e.v}`, e.w === 1 ? 'opposite' : 'same'));
}

/* ------------------------------------------------------------------ */
/* 单元：规范化                                                          */
/* ------------------------------------------------------------------ */

describe('canonicalCycleIds 规范化循环序列', () => {
  it('对轮转与反向不变', () => {
    const base = ['a', 'b', 'c', 'd'];
    const ref = canonicalCycleIds(base);
    for (let r = 0; r < 4; r++) {
      const rot = base.map((_, i) => base[(i + r) % 4]);
      expect(canonicalCycleIds(rot)).toEqual(ref);
    }
    expect(canonicalCycleIds([...base].reverse())).toEqual(ref);
  });

  it('自环长度 1 与平行边长度 2', () => {
    expect(canonicalCycleIds(['x'])).toEqual(['x']);
    expect(canonicalCycleIds(['p2', 'p1'])).toEqual(['p1', 'p2']);
  });
});

/* ------------------------------------------------------------------ */
/* 穷举小图族                                                            */
/* ------------------------------------------------------------------ */

describe('小图族穷举：每个简单环都被预言机核对', () => {
  /** n=2 的固定边池：2 个 A 自环、2 个 B 自环、3 条 A-B 平行边，枚举全部子集 */
  it('2 节点多重图（自环 + 平行边）全部 2^7 个子集', () => {
    const pool: OracleEdge[] = [
      { u: 0, v: 0, w: 0, id: 'sa0' },
      { u: 0, v: 0, w: 1, id: 'sa1' },
      { u: 1, v: 1, w: 0, id: 'sb0' },
      { u: 1, v: 1, w: 1, id: 'sb1' },
      { u: 0, v: 1, w: 0, id: 'p0' },
      { u: 0, v: 1, w: 1, id: 'p1' },
      { u: 0, v: 1, w: 0, id: 'p2' },
    ];
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const edges = pool.filter((_, i) => (mask >> i) & 1);
      const got = findShortestContradictionCycle(toConstraints(edges));
      const exp = oracleBest(edges, 2);
      if (exp === null) {
        expect(got).toBeNull();
      } else {
        expectValidCycle(got);
        expect(got.length).toBe(exp.minLen);
        expect(got.canonicalIds).toEqual(exp.winner);
      }
    }
  });

  /** n=3 边池子集：自环、三角形边均有双份平行边，512 个子集 × 随机化核验 */
  it('3 节点多重图边池子集', () => {
    const pool: OracleEdge[] = [
      { u: 0, v: 0, w: 1, id: 'eA' },
      { u: 1, v: 1, w: 1, id: 'eB' },
      { u: 2, v: 2, w: 1, id: 'eC' },
      { u: 0, v: 1, w: 0, id: 'ab0' },
      { u: 0, v: 1, w: 1, id: 'ab1' },
      { u: 1, v: 2, w: 0, id: 'bc0' },
      { u: 1, v: 2, w: 1, id: 'bc1' },
      { u: 0, v: 2, w: 1, id: 'ac0' },
      { u: 0, v: 2, w: 0, id: 'ac1' },
    ];
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const edges = pool.filter((_, i) => (mask >> i) & 1);
      const got = findShortestContradictionCycle(toConstraints(edges));
      const exp = oracleBest(edges, 3);
      if (exp === null) {
        expect(got).toBeNull();
      } else {
        expectValidCycle(got);
        expect(got.length).toBe(exp.minLen);
        expect(got.canonicalIds).toEqual(exp.winner);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 随机小图：穷举简单环的预言机差分                                       */
/* ------------------------------------------------------------------ */

describe('随机小多重图：双层图最短路 vs 简单环穷举', () => {
  const seeds = Array.from({ length: 600 }, (_, i) => 7000 + i);

  it.each(seeds)('随机多重图 seed=%i 最短长度与规范化胜者一致', (seed) => {
    const rand = rng(seed);
    const n = 2 + Math.floor(rand() * 4); // 2..5 个节点
    const m = 1 + Math.floor(rand() * 9); // 1..9 条边
    const edges: OracleEdge[] = [];
    for (let i = 0; i < m; i++) {
      // 约 15% 自环；平行边由独立取端点自然产生
      const u = Math.floor(rand() * n);
      const v = rand() < 0.15 ? u : Math.floor(rand() * n);
      edges.push({ u, v, w: rand() < 0.5 ? 1 : 0, id: `id${String(i).padStart(2, '0')}` });
    }

    const got = findShortestContradictionCycle(toConstraints(edges));
    const exp = oracleBest(edges, n);
    if (exp === null) {
      expect(got).toBeNull();
    } else {
      expectValidCycle(got);
      expect(got.length).toBe(exp.minLen);
      expect(got.canonicalIds).toEqual(exp.winner);
    }
  });

  // 约束 id 与加入顺序解耦：用独立洗牌后的 id 再次大规模差分，
  // 确保规范化决胜只依赖 id，不依赖数组下标或邻接表构造顺序。
  const shuffledSeeds = Array.from({ length: 300 }, (_, i) => 9000 + i);
  it.each(shuffledSeeds)('随机多重图（乱序 id）seed=%i 胜者一致', (seed) => {
    const rand = rng(seed);
    const n = 2 + Math.floor(rand() * 4);
    const m = 3 + Math.floor(rand() * 7);
    const edges: OracleEdge[] = [];
    const namePool = Array.from({ length: m }, (_, i) => `e-${String(i).padStart(2, '0')}`);
    const names = namePool
      .map((id) => ({ id, k: rand() }))
      .sort((a, b) => a.k - b.k)
      .map((t) => t.id);
    for (let i = 0; i < m; i++) {
      const u = Math.floor(rand() * n);
      const v = rand() < 0.15 ? u : Math.floor(rand() * n);
      edges.push({ u, v, w: rand() < 0.5 ? 1 : 0, id: names[i] });
    }

    const got = findShortestContradictionCycle(toConstraints(edges));
    const exp = oracleBest(edges, n);
    if (exp === null) {
      expect(got).toBeNull();
    } else {
      expectValidCycle(got);
      expect(got.length).toBe(exp.minLen);
      expect(got.canonicalIds).toEqual(exp.winner);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 稳定性：不受约束加入顺序影响                                           */
/* ------------------------------------------------------------------ */

describe('相同图不同加入顺序结果稳定', () => {
  const seeds = [42, 99, 7, 2024, 31337];

  it.each(seeds)('打乱约束数组顺序不改变规范化胜者 seed=%i', (seed) => {
    const rand = rng(seed);
    const n = 3 + Math.floor(rand() * 3);
    const m = 5 + Math.floor(rand() * 6);
    const base: Constraint[] = [];
    for (let i = 0; i < m; i++) {
      const u = Math.floor(rand() * n);
      const v = rand() < 0.12 ? u : Math.floor(rand() * n);
      base.push(c(`C${String(i).padStart(2, '0')}`, `V${u}`, `V${v}`, rand() < 0.5 ? 'opposite' : 'same'));
    }

    const first = findShortestContradictionCycle(base);
    if (!first) return; // 一致图跳过

    for (const permSeed of [1, 2, 3]) {
      const prand = rng(permSeed * 1009 + seed);
      const shuffled = base
        .map((x) => ({ x, k: prand() }))
        .sort((a, b) => a.k - b.k)
        .map((t) => t.x);
      const other = findShortestContradictionCycle(shuffled);
      expectValidCycle(other);
      expect(other.length).toBe(first.length);
      expect(other.canonicalIds).toEqual(first.canonicalIds);
      // 规范化朝向唯一：节点序列也应一致
      expect(other.nodes).toEqual(first.nodes);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 典型情形                                                              */
/* ------------------------------------------------------------------ */

describe('典型矛盾形态', () => {
  it('反相自环：长度 1 且为闭合边自身', () => {
    const cy = findShortestContradictionCycle([c('z', 'A', 'A', 'opposite')]);
    expectValidCycle(cy);
    expect(cy.length).toBe(1);
    expect(cy.chain).toEqual([]);
    expect(cy.closing.id).toBe('z');
    expect(cy.nodes).toEqual(['A']);
  });

  it('同相自环不矛盾', () => {
    expect(findShortestContradictionCycle([c('z', 'A', 'A', 'same')])).toBeNull();
  });

  it('两条平行边（一同相一反相）：长度 2', () => {
    const cy = findShortestContradictionCycle([
      c('p-same', 'A', 'B', 'same'),
      c('p-opp', 'A', 'B', 'opposite'),
    ]);
    expectValidCycle(cy);
    expect(cy.length).toBe(2);
    expect(cy.canonicalIds).toEqual(['p-opp', 'p-same']);
  });

  it('两条反相平行边异或为 0，不构成矛盾环', () => {
    expect(
      findShortestContradictionCycle([
        c('p1', 'A', 'B', 'opposite'),
        c('p2', 'B', 'A', 'opposite'),
      ]),
    ).toBeNull();
  });

  it('首个奇环夹带绕行支路时，精炼结果截到真正的最短环', () => {
    // add 序使默认首个奇环走长绕行 A-D-E-C；三角形 A-B-C 只有 3 条
    const constraints = [
      c('detour1', 'A', 'D', 'same'),
      c('detour2', 'D', 'E', 'same'),
      c('detour3', 'E', 'C', 'opposite'), // A→C 长路径异或 1
      c('short1', 'A', 'B', 'same'),
      c('short2', 'B', 'C', 'same'), // A→C 短路径异或 0
      c('close', 'A', 'C', 'opposite'), // 与短路径矛盾：3 环；与长路径自洽
    ];
    const cy = findShortestContradictionCycle(constraints);
    expectValidCycle(cy);
    expect(cy.length).toBe(3);
    expect(cy.canonicalIds).toEqual(['close', 'short1', 'short2']);
    expect(cy.nodes.join('-')).toContain('A');
    expect(cy.nodes).not.toContain('D');
    expect(cy.nodes).not.toContain('E');
  });

  it('多个连通分量：只在矛盾分量中找环，不受其他分量干扰', () => {
    const cy = findShortestContradictionCycle([
      c('ok1', 'L1', 'L2', 'opposite'),
      c('ok2', 'L2', 'L3', 'opposite'),
      c('ok3', 'L3', 'L1', 'same'), // 自洽分量
      c('x1', 'X', 'Y', 'same'),
      c('x2', 'Y', 'Z', 'same'),
      c('x3', 'X', 'Z', 'opposite'), // 矛盾三角形
    ]);
    expectValidCycle(cy);
    expect(cy.length).toBe(3);
    expect(cy.canonicalIds).toEqual(['x1', 'x2', 'x3']);
    for (const node of cy.nodes) expect(node).toMatch(/^[XYZ]$/);
  });
});

/* ------------------------------------------------------------------ */
/* analyze 入口：触发、缓存、失效                                        */
/* ------------------------------------------------------------------ */

const ops = (list: unknown[]) => ({ operations: list });

describe('analyze().refineCycle 触发与缓存语义', () => {
  it('未触发前 isRefined 为 false；触发后按检查点缓存同一结果', () => {
    const r = analyze(
      JSON.stringify(
        ops([
          { type: 'add', id: 'd1', a: 'A', b: 'D', relation: 'same' },
          { type: 'add', id: 'd2', a: 'D', b: 'C', relation: 'opposite' },
          { type: 'add', id: 's1', a: 'A', b: 'B', relation: 'same' },
          { type: 'add', id: 's2', a: 'B', b: 'C', relation: 'same' },
          { type: 'add', id: 'cc', a: 'A', b: 'C', relation: 'opposite' },
          { type: 'check' },
        ]),
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.checks[0].safe).toBe(false);
    expect(r.isRefined(0)).toBe(false);

    const first = r.refineCycle(0);
    expectValidCycle(first);
    expect(first.length).toBe(3);
    expect(r.isRefined(0)).toBe(true);
    // 再次触发返回缓存的同一对象，不重算
    expect(r.refineCycle(0)).toBe(first);

    // 默认奇环证据保持原有行为不变（受 add 顺序影响的长路径）
    const witness = r.getWitness(0)!;
    const witnessEdges = [...witness.path, witness.closing];
    expect(witnessEdges.reduce((a, e) => a ^ e.parity, 0)).toBe(1);
    expect(witnessEdges.length).toBeGreaterThanOrEqual(first.length);
  });

  it('safe 检查点恒返回 null 且不缓存；不同冲突检查点独立缓存', () => {
    const r = analyze(
      JSON.stringify(
        ops([
          { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
          { type: 'check' },
          { type: 'add', id: '2', a: 'A', b: 'B', relation: 'opposite' },
          { type: 'check' },
        ]),
      ),
    );
    expect(r.checks.map((c) => c.safe)).toEqual([true, false]);
    expect(r.refineCycle(0)).toBeNull();
    expect(r.isRefined(0)).toBe(false);

    expect(r.isRefined(1)).toBe(false);
    const cy = r.refineCycle(1);
    expectValidCycle(cy);
    expect(cy.length).toBe(2); // 平行边对
    expect(r.isRefined(1)).toBe(true);
  });

  it('remove 改变活动区间后精炼结果随检查点而不同', () => {
    const r = analyze(
      JSON.stringify(
        ops([
          { type: 'add', id: 'loop', a: 'A', b: 'A', relation: 'opposite' },
          { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
          { type: 'add', id: '2', a: 'B', b: 'C', relation: 'same' },
          { type: 'add', id: '3', a: 'A', b: 'C', relation: 'opposite' },
          { type: 'check' }, // 自环存在：最短为 1
          { type: 'remove', id: 'loop' },
          { type: 'check' }, // 自环拆除：最短为 3
        ]),
      ),
    );
    expect(r.refineCycle(0)?.length).toBe(1);
    expect(r.refineCycle(0)?.closing.id).toBe('loop');
    expect(r.refineCycle(1)?.length).toBe(3);
  });

  it('输入变化产生全新结果：旧精炼缓存随之清除，需要重新触发', () => {
    const json1 = JSON.stringify(
      ops([
        { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
        { type: 'add', id: '2', a: 'B', b: 'C', relation: 'same' },
        { type: 'add', id: '3', a: 'A', b: 'C', relation: 'opposite' },
        { type: 'check' },
      ]),
    );
    const r1 = analyze(json1);
    expectValidCycle(r1.refineCycle(0));
    expect(r1.isRefined(0)).toBe(true);

    // 相同输入重算：相互独立的新结果，不沿用旧缓存
    const r2 = analyze(json1);
    expect(r2.isRefined(0)).toBe(false);
    expectValidCycle(r2.refineCycle(0));

    // 改为无矛盾输入：旧检查点不再是 conflict，精炼不可用
    const r3 = analyze(
      JSON.stringify(
        ops([
          { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
          { type: 'check' },
        ]),
      ),
    );
    expect(r3.checks[0].safe).toBe(true);
    expect(r3.refineCycle(0)).toBeNull();
    expect(r3.isRefined(0)).toBe(false);
  });

  it('解析失败仍返回原文友好的失败结果，精炼接口安全降级', () => {
    const r = analyze('{ not json');
    expect(r.ok).toBe(false);
    expect(r.refineCycle(0)).toBeNull();
    expect(r.isRefined(0)).toBe(false);
    expect(r.getWitness(0)).toBeNull();
  });

  it('同长度多个候选：规范化胜者取 id 最小的环', () => {
    const r = analyze(
      JSON.stringify(
        ops([
          { type: 'add', id: 'a1', a: 'A', b: 'B', relation: 'same' },
          { type: 'add', id: 'a2', a: 'B', b: 'C', relation: 'same' },
          { type: 'add', id: 'a3', a: 'C', b: 'A', relation: 'opposite' },
          { type: 'add', id: 'b1', a: 'X', b: 'Y', relation: 'same' },
          { type: 'add', id: 'b2', a: 'Y', b: 'Z', relation: 'same' },
          { type: 'add', id: 'b3', a: 'Z', b: 'X', relation: 'opposite' },
          { type: 'check' },
        ]),
      ),
    );
    const cy = r.refineCycle(0);
    expectValidCycle(cy);
    expect(cy.length).toBe(3);
    expect(cy.canonicalIds).toEqual(['a1', 'a2', 'a3']);
  });
});
