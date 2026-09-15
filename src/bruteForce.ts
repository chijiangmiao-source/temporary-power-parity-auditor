/**
 * 小规模暴力染色判据：
 * 对每个时间点的活动约束图，枚举所有节点的 2 着色，
 * 检查是否存在满足全部 same/opposite 的赋值。
 * 与线段树+可回滚并查集结果做差分（differential testing）。
 */
import type { Constraint, Operation } from './types';

export function bruteForceSolve(
  _operations: Operation[],
  constraints: Constraint[],
  checkIndices: number[],
): boolean[] {
  const names: string[] = [];
  const id = new Map<string, number>();
  for (const c of constraints) {
    for (const n of [c.a, c.b]) {
      if (!id.has(n)) {
        id.set(n, names.length);
        names.push(n);
      }
    }
  }
  const k = names.length;

  return checkIndices.map((t) => {
    const active = constraints.filter((c) => c.start <= t && t < c.end);
    // 枚举 2^k 种相位赋值
    for (let mask = 0; mask < 1 << k; mask++) {
      const color = (v: string) => (mask >> id.get(v)!) & 1;
      if (active.every((c) => (color(c.a) ^ color(c.b)) === c.parity)) {
        return true;
      }
    }
    return false;
  });
}
