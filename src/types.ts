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

/**
 * 精炼最短矛盾回路：活动约束图中约束条数最少的相位矛盾闭环。
 * 与 ConflictWitness（受 add 顺序影响的首个奇环）不同，
 * 它由双层状态图逐源最短路求得全局最短环，不受约束加入顺序影响。
 */
export interface RefinedCycle {
  /**
   * 首尾连续的约束链（不含闭合边）；chain[i] 连接 nodes[i] 与 nodes[i+1]。
   * 反相自环时为空：矛盾仅来自闭合边自身。
   */
  chain: Constraint[];
  /** 闭合约束：连接 nodes 末位与 nodes 首位，与链异或不相容 */
  closing: Constraint;
  /**
   * 环上节点的规范化朝向（长度 = 约束条数）：
   * nodes[i] —chain[i]→ nodes[i+1]，nodes 末位 —closing→ nodes[0]。
   * 约束对象自身的 a/b 朝向不一定与遍历方向一致，展示一律以此为准。
   */
  nodes: string[];
  /** 环上约束总数（含闭合边） */
  length: number;
  /** 环上所有约束 parity 依次异或；矛盾环恒为 1 */
  xor: 0 | 1;
  /** 规范化胜者序列：环上约束 id 在两个朝向、全部轮转中的字典序最小者 */
  canonicalIds: string[];
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
   *
   * 该证据是受 add 顺序影响的“首个奇环”，保持原有行为不变；
   * 与加入顺序无关的全局最短矛盾环见 refineCycle。
   */
  getWitness: (checkIndex: number) => ConflictWitness | null;
  /** 某检查点是否已有精炼结果（成功或失败均算已触发） */
  isRefined: (checkIndex: number) => boolean;
  /**
   * 精炼最短矛盾回路：仅在用户触发时运行，并按检查点缓存。
   * safe 检查点恒返回 null；冲突检查点首次调用做逐源最短路，
   * 之后返回同一结果。分析输入变化会产生全新的 AnalyzeResult，
   * 旧缓存自然失效（界面层负责提示用户重新触发）。
   */
  refineCycle: (checkIndex: number) => RefinedCycle | null;
}
