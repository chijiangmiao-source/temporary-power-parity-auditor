/**
 * 差分测试（differential testing）：
 * 随机生成小规模操作流（含 add / remove / check、same / opposite），
 * 以暴力 2 染色枚举为判据，逐检查点对比时间分段树 + 可回滚
 * 奇偶并查集的判定。大量随机用例下两者必须完全一致。
 */
import { describe, expect, it } from 'vitest';
import { analyze } from './analyzer';
import { bruteForceSolve } from './bruteForce';
import { parseOperations } from './parser';
import type { AddOperation, CheckOperation, Operation, RemoveOperation } from './types';

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

function generate(seed: number): Operation[] {
  const rand = rng(seed);
  const ops: Operation[] = [];
  const pool: string[] = [];
  const nodeCount = 2 + Math.floor(rand() * 5); // 2..6 个节点
  for (let i = 0; i < nodeCount; i++) pool.push(`N${i}`);

  const length = 6 + Math.floor(rand() * 20);
  let nextId = 0;
  const active: string[] = [];

  for (let t = 0; t < length; t++) {
    const roll = rand();
    if (active.length > 0 && roll < 0.3) {
      const k = Math.floor(rand() * active.length);
      const id = active.splice(k, 1)[0];
      const op: RemoveOperation = { type: 'remove', id };
      ops.push(op);
    } else if (roll < 0.75 || active.length === 0) {
      const a = pool[Math.floor(rand() * pool.length)];
      let b = pool[Math.floor(rand() * pool.length)];
      const id = `c${nextId++}`;
      const op: AddOperation = {
        type: 'add',
        id,
        a,
        b,
        relation: rand() < 0.5 ? 'same' : 'opposite',
      };
      ops.push(op);
      active.push(id);
    } else {
      const op: CheckOperation = { type: 'check' };
      ops.push(op);
    }
  }
  // 保证至少有一个检查点
  if (!ops.some((o) => o.type === 'check')) ops.push({ type: 'check' });
  return ops;
}

describe('差分测试：线段树+可回滚并查集 vs 暴力染色', () => {
  const seeds = Array.from({ length: 400 }, (_, i) => 1000 + i);

  it.each(seeds)('随机操作流 seed=%i 判定一致', (seed) => {
    const ops = generate(seed);
    const json = JSON.stringify({ operations: ops });

    const parsed = parseOperations(json);
    expect(parsed.issues).toEqual([]);

    const expected = bruteForceSolve(
      parsed.operations,
      parsed.constraints,
      parsed.checkIndices,
    );
    const result = analyze(json);

    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.safe)).toEqual(expected);
  });

  it('冲突证据确为奇环：闭合边与路径的 parity 异或为 1', () => {
    for (const seed of seeds) {
      const json = JSON.stringify({ operations: generate(seed) });
      const result = analyze(json);
      for (let i = 0; i < result.checks.length; i++) {
        const c = result.checks[i];
        if (!c.safe) {
          const witness = result.getWitness(i);
          if (witness) {
            const xor =
              witness.path.reduce((acc, e) => acc ^ e.parity, 0) ^ witness.closing.parity;
            expect(xor).toBe(1);
          }
        }
      }
    }
  });
});
