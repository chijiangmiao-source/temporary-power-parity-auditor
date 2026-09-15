/**
 * 输入解析与校验。
 *
 * 规则：
 *  - 顶层必须是对象，含 operations 数组；
 *  - 操作仅允许 add / remove / check；
 *  - add：id 为全局唯一的非空字符串；a、b 为非空节点名；
 *    relation 仅可为 same / opposite；
 *  - remove：只能指向当前活动（已 add 且未 remove）的 id；
 *  - check：无附加字段；
 *  - 未知操作类型或缺失必填字段一律报错。
 *
 * 校验尽量一次性收集全部问题并附带序位，便于复核电工就地修正；
 * 合法输入不会被丢弃（界面层负责保留原文）。
 */
import type { AddOperation, Constraint, Operation, ParseIssue } from './types';

interface ParseResult {
  operations: Operation[];
  constraints: Constraint[];
  issues: ParseIssue[];
  checkIndices: number[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function parseOperations(jsonText: string): ParseResult {
  const issues: ParseIssue[] = [];
  const operations: Operation[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      operations: [],
      constraints: [],
      checkIndices: [],
      issues: [{ index: -1, message: `JSON 语法错误：${msg}` }],
    };
  }

  if (!isObject(raw)) {
    issues.push({ index: -1, message: '顶层必须是对象，形如 { "operations": [...] }' });
    return { operations: [], constraints: [], checkIndices: [], issues };
  }
  if (!Array.isArray(raw.operations)) {
    issues.push({ index: -1, message: '顶层缺少 operations 数组' });
    return { operations: [], constraints: [], checkIndices: [], issues };
  }
  const opsList: unknown[] = raw.operations;

  // id -> 是否曾经 add 过（全局唯一）
  const everAdded = new Set<string>();
  // id -> 当前活动约束下标（同一时刻每个 id 至多一条）
  const activeById = new Map<string, number>();
  const constraints: Constraint[] = [];
  const checkIndices: number[] = [];

  opsList.forEach((item, index) => {
    const fail = (message: string) => issues.push({ index, message });

    if (!isObject(item)) {
      fail(`第 ${index + 1} 项必须是对象`);
      return;
    }

    const type = item.type;
    if (typeof type !== 'string') {
      fail('缺少必填字段 type（取值 add / remove / check）');
      return;
    }

    if (type === 'add') {
      let ok = true;
      if (!isNonEmptyString(item.id)) {
        fail('add 缺少非空字符串字段 id');
        ok = false;
      }
      if (!isNonEmptyString(item.a)) {
        fail('add 缺少非空节点名 a');
        ok = false;
      }
      if (!isNonEmptyString(item.b)) {
        fail('add 缺少非空节点名 b');
        ok = false;
      }
      if (item.relation !== 'same' && item.relation !== 'opposite') {
        fail("add 的 relation 必须是 'same' 或 'opposite'");
        ok = false;
      }
      if (!ok) return;

      const id = item.id as string;
      if (everAdded.has(id)) {
        fail(`重复 id：'${id}' 已被 add 过，id 必须全局唯一`);
        return;
      }
      const op: AddOperation = {
        type: 'add',
        id,
        a: item.a as string,
        b: item.b as string,
        relation: item.relation as AddOperation['relation'],
      };
      everAdded.add(id);
      const c: Constraint = {
        id,
        a: op.a,
        b: op.b,
        parity: op.relation === 'opposite' ? 1 : 0,
        relation: op.relation,
        start: index,
        end: opsList.length,
      };
      activeById.set(id, constraints.length);
      constraints.push(c);
      operations.push(op);
      return;
    }

    if (type === 'remove') {
      if (!isNonEmptyString(item.id)) {
        fail('remove 缺少非空字符串字段 id');
        return;
      }
      const id = item.id as string;
      if (!activeById.has(id)) {
        fail(
          everAdded.has(id)
            ? `重复 remove：id '${id}' 当前已不在活动状态`
            : `悬空 remove：id '${id}' 此前没有对应的活动 add`,
        );
        return;
      }
      const ci = activeById.get(id)!;
      constraints[ci].end = index; // [add, remove) 半开区间
      activeById.delete(id);
      operations.push({ type: 'remove', id });
      return;
    }

    if (type === 'check') {
      checkIndices.push(index);
      operations.push({ type: 'check' });
      return;
    }

    fail(`未知操作类型 '${String(type)}'，仅允许 add / remove / check`);
  });

  return { operations, constraints, issues, checkIndices };
}
