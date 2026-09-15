/**
 * 共享类型定义。
 *
 * 输入 JSON 顶层形如 { "operations": Operation[] }，
 * 操作仅允许 add / remove / check 三种。
 */

export type Relation = 'same' | 'opposite';
export type OpType = 'add' | 'remove' | 'check';

export interface AddOperation {
  type: 'add';
  /** 全局唯一约束 id */
  id: string;
  /** 非空节点名（相位承载点，如总箱 / 分配箱 / 开关箱出线） */
  a: string;
  b: string;
  /** same = 同相（奇偶位差 0），opposite = 反相（奇偶位差 1） */
  relation: Relation;
}

export interface RemoveOperation {
  type: 'remove';
  /** 只能指向当前活动的 add id */
  id: string;
}

export interface CheckOperation {
  type: 'check';
}

export type Operation = AddOperation | RemoveOperation | CheckOperation;

/** 校验错误；index 为操作序位（0 基），-1 表示顶层 / JSON 语法错误 */
export interface ParseIssue {
  index: number;
  message: string;
}

/** 内部使用的归一化约束：parity 为两端节点相位的异或值 */
export interface Constraint {
  id: string;
  a: string;
  b: string;
  parity: 0 | 1;
  relation: Relation;
  /** add 所在序位（含） */
  start: number;
  /** remove 所在序位（不含）；未被删除时为操作流长度 */
  end: number;
}

/** 构成矛盾的奇环：path 为树上路径，closing 为闭合边（与路径异或矛盾） */
export interface ConflictWitness {
  path: Constraint[];
  closing: Constraint;
}

export interface CheckOutcome {
  /** check 操作在流中的序位（0 基） */
  index: number;
  /** 第几个检查点（1 基，按原序） */
  seq: number;
  safe: boolean;
}

export interface AnalyzeResult {
  ok: boolean;
  issues: ParseIssue[];
  checks: CheckOutcome[];
  /** 最早冲突在 checks 中的下标 */
  firstConflict: number;
  /**
   * 按需计算某检查点的奇环证据（结果缓存）。
   * 连续冲突且检查点很多时，不预计算全部证据，避免界面卡顿；
   * safe 检查点恒返回 null。
   */
  getWitness: (checkIndex: number) => ConflictWitness | null;
}
