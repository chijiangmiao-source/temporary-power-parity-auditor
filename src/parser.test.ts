import { describe, expect, it } from 'vitest';
import { parseOperations } from './parser';

const parse = (s: string) => parseOperations(s);

describe('parseOperations', () => {
  it('接受合法操作流并标注活动区间', () => {
    const r = parse(JSON.stringify({
      operations: [
        { type: 'add', id: 'c1', a: '总箱', b: '分箱1', relation: 'same' },
        { type: 'check' },
        { type: 'remove', id: 'c1' },
        { type: 'check' },
      ],
    }));
    expect(r.issues).toEqual([]);
    expect(r.checkIndices).toEqual([1, 3]);
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints[0]).toMatchObject({ start: 0, end: 2, parity: 0 });
  });

  it('opposite 归一化为 parity 1', () => {
    const r = parse(JSON.stringify({
      operations: [{ type: 'add', id: 'x', a: 'A', b: 'B', relation: 'opposite' }],
    }));
    expect(r.issues).toEqual([]);
    expect(r.constraints[0].parity).toBe(1);
  });

  it('重复 id 报错', () => {
    const r = parse(JSON.stringify({
      operations: [
        { type: 'add', id: 'x', a: 'A', b: 'B', relation: 'same' },
        { type: 'remove', id: 'x' },
        { type: 'add', id: 'x', a: 'A', b: 'C', relation: 'same' },
      ],
    }));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].index).toBe(2);
    expect(r.issues[0].message).toContain('重复 id');
  });

  it('悬空 remove 报错', () => {
    const r = parse(JSON.stringify({
      operations: [{ type: 'remove', id: 'ghost' }],
    }));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].message).toContain('悬空 remove');
  });

  it('重复 remove 报错', () => {
    const r = parse(JSON.stringify({
      operations: [
        { type: 'add', id: 'x', a: 'A', b: 'B', relation: 'same' },
        { type: 'remove', id: 'x' },
        { type: 'remove', id: 'x' },
      ],
    }));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].index).toBe(2);
    expect(r.issues[0].message).toContain('重复 remove');
  });

  it('未知操作类型报错', () => {
    const r = parse(JSON.stringify({
      operations: [{ type: 'toggle', id: 'x' }],
    }));
    expect(r.issues[0].message).toContain('未知操作类型');
  });

  it('缺失必填字段逐项报错并保留序位', () => {
    const r = parse(JSON.stringify({
      operations: [
        { type: 'add', id: 'x', a: 'A' }, // 缺 b、relation
        { type: 'remove' }, // 缺 id
        { type: 'check' },
      ],
    }));
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
    expect(r.issues.map((i) => i.index)).toContain(0);
    expect(r.issues.map((i) => i.index)).toContain(1);
  });

  it('空节点名与纯空白节点名报错', () => {
    const r = parse(JSON.stringify({
      operations: [{ type: 'add', id: 'x', a: '   ', b: 'B', relation: 'same' }],
    }));
    expect(r.issues.some((i) => i.message.includes('a'))).toBe(true);
  });

  it('JSON 语法错误与顶层结构错误', () => {
    expect(parse('{').issues[0].index).toBe(-1);
    expect(parse('[]').issues[0].message).toContain('顶层');
    expect(parse('{}').issues[0].message).toContain('operations');
  });

  it('一次收集多个错误', () => {
    const r = parse(JSON.stringify({
      operations: [
        { type: 'add', id: 'x', a: 'A', b: 'B', relation: 'weird' },
        42,
        null,
      ],
    }));
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
});
