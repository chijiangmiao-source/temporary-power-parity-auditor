import { describe, expect, it } from 'vitest';
import { analyze } from './analyzer';

const run = (ops: unknown[]) => analyze(JSON.stringify({ operations: ops }));

describe('analyze 端到端行为', () => {
  it('无约束与单约束恒为 safe', () => {
    const r = run([{ type: 'check' }]);
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0].safe).toBe(true);
    expect(r.firstConflict).toBe(-1);
  });

  it('同相矛盾三角在首个检查点暴露，最早冲突被标出', () => {
    const r = run([
      { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
      { type: 'add', id: '2', a: 'B', b: 'C', relation: 'same' },
      { type: 'add', id: '3', a: 'A', b: 'C', relation: 'opposite' },
      { type: 'check' },
    ]);
    expect(r.checks[0].safe).toBe(false);
    expect(r.firstConflict).toBe(0);
    expect(r.checks[0].witness?.closing.id).toBe('3');
  });

  it('终局接线看不出矛盾，但中途检查点能定位（remove 之后恢复 safe）', () => {
    const r = run([
      { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
      { type: 'add', id: '2', a: 'B', b: 'C', relation: 'same' },
      { type: 'add', id: '3', a: 'A', b: 'C', relation: 'opposite' },
      { type: 'check' }, // 矛盾！最早冲突
      { type: 'remove', id: '3' }, // 拆除致矛盾约束
      { type: 'check' }, // 必须恢复 safe
    ]);
    expect(r.checks.map((c) => c.safe)).toEqual([false, true]);
    expect(r.firstConflict).toBe(0);
  });

  it('检查后才出现的矛盾不回溯影响早先检查点', () => {
    const r = run([
      { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
      { type: 'check' }, // safe
      { type: 'add', id: '2', a: 'A', b: 'B', relation: 'opposite' },
      { type: 'check' }, // conflict
      { type: 'remove', id: '2' },
      { type: 'check' }, // safe
    ]);
    expect(r.checks.map((c) => c.safe)).toEqual([true, false, true]);
    expect(r.firstConflict).toBe(1);
  });

  it('错误输入返回 ok=false 且保留全部问题序位', () => {
    const r = run([
      { type: 'add', id: 'x', a: 'A', b: 'B', relation: 'same' },
      { type: 'add', id: 'x', a: 'A', b: 'C', relation: 'same' },
      { type: 'remove', id: 'nope' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.index)).toEqual([1, 2]);
  });

  it('反相偶数条自洽、奇数条矛盾', () => {
    const odd = run([
      { type: 'add', id: '1', a: 'A', b: 'B', relation: 'opposite' },
      { type: 'add', id: '2', a: 'B', b: 'C', relation: 'opposite' },
      { type: 'add', id: '3', a: 'C', b: 'A', relation: 'opposite' },
      { type: 'check' },
    ]);
    expect(odd.checks[0].safe).toBe(false);

    const even = run([
      { type: 'add', id: '1', a: 'A', b: 'B', relation: 'opposite' },
      { type: 'add', id: '2', a: 'B', b: 'C', relation: 'opposite' },
      { type: 'add', id: '3', a: 'C', b: 'A', relation: 'same' },
      { type: 'check' },
    ]);
    expect(even.checks[0].safe).toBe(true);
  });
});
