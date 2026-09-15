import { describe, expect, it } from 'vitest';
import { RollbackParityDSU } from './dsu';

describe('RollbackParityDSU', () => {
  it('同相 / 反相约束可联立传播', () => {
    const dsu = new RollbackParityDSU();
    dsu.reset(4);
    expect(dsu.union(0, 1, 0).consistent).toBe(true); // 0 = 1
    expect(dsu.union(1, 2, 1).consistent).toBe(true); // 1 != 2
    expect(dsu.union(0, 2, 1).consistent).toBe(true); // 0 != 2 ✓
    expect(dsu.isConsistent()).toBe(true);
  });

  it('检测奇环矛盾（同相与反相互相打架）', () => {
    const dsu = new RollbackParityDSU();
    dsu.reset(3);
    dsu.union(0, 1, 0); // 0 = 1
    dsu.union(1, 2, 0); // 1 = 2 => 0 = 2
    expect(dsu.union(0, 2, 1).consistent).toBe(false); // 0 != 2 矛盾
    expect(dsu.isConsistent()).toBe(false);
  });

  it('回滚后矛盾与结构改动一并撤销', () => {
    const dsu = new RollbackParityDSU();
    dsu.reset(3);
    dsu.union(0, 1, 0);
    const snap = dsu.snapshot();
    dsu.union(1, 2, 0);
    expect(dsu.union(0, 2, 1).consistent).toBe(false);
    expect(dsu.isConsistent()).toBe(false);
    dsu.rollback(snap);
    expect(dsu.isConsistent()).toBe(true);
    // 2 已与 0,1 断开：重新声明 0 != 2 合法
    expect(dsu.union(0, 2, 1).consistent).toBe(true);
    expect(dsu.isConsistent()).toBe(true);
  });

  it('连续回滚恢复嵌套快照', () => {
    const dsu = new RollbackParityDSU();
    dsu.reset(4);
    const s0 = dsu.snapshot();
    dsu.union(0, 1, 1);
    const s1 = dsu.snapshot();
    dsu.union(1, 2, 1);
    const s2 = dsu.snapshot();
    dsu.union(2, 3, 1);
    dsu.rollback(s2);
    dsu.rollback(s1);
    dsu.rollback(s0);
    expect(dsu.union(0, 1, 0).consistent).toBe(true); // 撤销 0!=1 后可重新声明同相
  });
});
