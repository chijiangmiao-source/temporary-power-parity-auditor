import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { analyze } from './analyzer';
import { EXAMPLE_JSON } from './example';
import type {
  AnalyzeResult,
  CheckOutcome,
  ConflictWitness,
  Constraint,
  RefinedCycle,
} from './types';

const ROW_GAP = 10;
const DEFAULT_ROW_H = 58;
const OVERSCAN = 6;
const VIEWPORT_H = 520;

const relationText = (c: Constraint) => (c.relation === 'same' ? '同相' : '反相');

function WitnessView({ witness }: { witness: ConflictWitness }) {
  const chain = witness.path;
  return (
    <div className="witness">
      <div className="witness-title">矛盾回路（奇环）：</div>
      {chain.length === 0 ? (
        <div className="witness-line">
          自相矛盾：节点<code>{witness.closing.a}</code>与<code>{witness.closing.b}</code>
          {witness.closing.a === witness.closing.b
            ? '是同一节点，不可能与自身反相。'
            : `已被既有约束链确定为${witness.closing.relation === 'same' ? '反相' : '同相'}，与该闭合约束要求的${relationText(witness.closing)}冲突。`}
        </div>
      ) : (
        <ol className="witness-chain">
          {chain.map((c, i) => (
            <li key={i}>
              <code>{c.a}</code>
              <span className={`rel rel-${c.relation}`}>{relationText(c)}</span>
              <code>{c.b}</code>
              <span className="edge-id">（约束 {c.id}）</span>
            </li>
          ))}
          <li className="closing">
            闭合边：
            <code>{witness.closing.a}</code>
            <span className={`rel rel-${witness.closing.relation}`}>
              {relationText(witness.closing)}
            </span>
            <code>{witness.closing.b}</code>
            <span className="edge-id">（约束 {witness.closing.id}）</span>
            ——路径位权异或为 {chain.reduce((a, e) => a ^ e.parity, 0)}，
            与闭合边要求 {witness.closing.parity} 不相容。
          </li>
        </ol>
      )}
    </div>
  );
}

/**
 * 精炼最短回路：约束条数最少的相位矛盾闭环，与约束加入顺序无关。
 * 节点序列一律按环的遍历朝向呈现（约束对象自身的 a/b 朝向可能相反）。
 */
function RefinedCycleView({ cycle }: { cycle: RefinedCycle }) {
  const chainXor = cycle.chain.reduce((a, e) => a ^ e.parity, 0);
  return (
    <div className="witness witness-refined" data-testid="refined-panel">
      <div className="witness-title">
        精炼最短回路：共 {cycle.length} 条约束
        （同长度候选按环上约束 id 的规范化循环序列决胜）
      </div>
      {cycle.length === 1 ? (
        <div className="witness-line" data-testid="refined-selfloop">
          反相自环：节点<code>{cycle.nodes[0]}</code>通过约束
          <code>{cycle.closing.id}</code>与自身反相，位权异或为 1，不可能满足。
        </div>
      ) : (
        <ol className="witness-chain">
          {cycle.chain.map((c, i) => (
            <li key={i} data-testid="refined-step">
              <code>{cycle.nodes[i]}</code>
              <span className={`rel rel-${c.relation}`}>{relationText(c)}</span>
              <code>{cycle.nodes[i + 1]}</code>
              <span className="edge-id">（约束 {c.id}）</span>
            </li>
          ))}
          <li className="closing" data-testid="refined-closing">
            闭合边：
            <code>{cycle.nodes[cycle.length - 1]}</code>
            <span className={`rel rel-${cycle.closing.relation}`}>
              {relationText(cycle.closing)}
            </span>
            <code>{cycle.nodes[0]}</code>
            <span className="edge-id">（约束 {cycle.closing.id}）</span>
            ——链上位权异或 {chainXor} ⊕ 闭合边 {cycle.closing.parity} = {cycle.xor}，为矛盾环。
          </li>
        </ol>
      )}
      <div className="canonical-line" data-testid="refined-canonical">
        规范化 id 序列：{cycle.canonicalIds.map((id) => `约束 ${id}`).join(' → ')}
      </div>
    </div>
  );
}

interface RowContentProps {
  check: CheckOutcome;
  isFirstConflict: boolean;
  expanded: boolean;
  refinedOpen: boolean;
  result: AnalyzeResult;
  rowIndex: number;
  onToggle: (rowIndex: number) => void;
  onRefine: (rowIndex: number) => void;
}

const CheckRowContent = memo(function CheckRowContent({
  check,
  isFirstConflict,
  expanded,
  refinedOpen,
  result,
  rowIndex,
  onToggle,
  onRefine,
}: RowContentProps) {
  return (
    <div
      data-testid="check-item"
      data-seq={check.seq}
      data-safe={check.safe ? 'true' : 'false'}
      data-first-conflict={isFirstConflict ? 'true' : 'false'}
      className={[
        'check-item',
        check.safe ? 'check-safe' : 'check-conflict',
        isFirstConflict ? 'check-first-conflict' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="check-head">
        <span className="check-seq">#{check.seq}</span>
        <span className="check-pos">第 {check.index + 1} 步（check）</span>
        <span className={`badge ${check.safe ? 'badge-safe' : 'badge-conflict'}`}>
          {check.safe ? 'safe' : 'conflict'}
        </span>
        {isFirstConflict && <span className="first-tag">▲ 最早冲突</span>}
        {!check.safe && !isFirstConflict && (
          <button
            type="button"
            className="btn-link"
            data-testid="toggle-witness"
            onClick={() => onToggle(rowIndex)}
          >
            {expanded ? '收起矛盾回路' : '查看矛盾回路'}
          </button>
        )}
        {!check.safe && (
          <button
            type="button"
            className="btn-link btn-refine"
            data-testid="refine-cycle"
            onClick={() => onRefine(rowIndex)}
          >
            {refinedOpen ? '收起精炼回路' : '精炼最短回路'}
          </button>
        )}
      </div>
      {expanded && <WitnessView witness={result.getWitness(rowIndex)!} />}
      {refinedOpen && <RefinedCycleView cycle={result.refineCycle(rowIndex)!} />}
    </div>
  );
});

/**
 * 检查点虚拟列表：检查点成千上万时只渲染滚动窗口内的行。
 * 行高全部由一个 ResizeObserver 经 data-row-idx 关联实测回写，
 * state 更新保持纯净，不会产生测量-定位反馈振荡。
 */
function VirtualCheckList({
  result,
  expandedExtra,
  refinedOpen,
  onToggle,
  onRefine,
  jumpNonce,
  registerViewport,
}: {
  result: AnalyzeResult;
  expandedExtra: Set<number>;
  refinedOpen: Set<number>;
  onToggle: (i: number) => void;
  onRefine: (i: number) => void;
  jumpNonce: number;
  registerViewport: (el: HTMLDivElement | null) => void;
}) {
  const count = result.checks.length;
  const [heights, setHeights] = useState<number[]>(() =>
    new Array(count).fill(DEFAULT_ROW_H),
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(VIEWPORT_H);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const slotEls = useRef(new Map<number, HTMLElement>());

  // 新分析结果（identity 变化）时复位高度与滚动位置，并立即实测当前挂载行
  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    const measures = new Map<number, number>();
    slotEls.current.forEach((el, i) => {
      const h = el.offsetHeight;
      if (h > 0) measures.set(i, h);
    });
    setHeights(() => {
      const arr = new Array<number>(result.checks.length).fill(DEFAULT_ROW_H);
      measures.forEach((h, i) => {
        if (i < arr.length) arr[i] = h;
      });
      return arr;
    });
  }, [result]);

  // 唯一的尺寸观测器：视口自身 + 所有已挂载行槽位
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    setViewportH(vp.clientHeight || VIEWPORT_H);

    const ro = new ResizeObserver((entries) => {
      if (vp.clientHeight > 0) setViewportH(vp.clientHeight);
      const updates = new Map<number, number>();
      for (const entry of entries) {
        if (entry.target === vp) continue;
        const el = entry.target as HTMLElement;
        const idx = Number(el.dataset.rowIdx);
        const h = el.offsetHeight;
        if (Number.isInteger(idx) && h > 0) updates.set(idx, h);
      }
      if (updates.size === 0) return;
      setHeights((prev) => {
        let changed = false;
        const next = prev.slice();
        updates.forEach((h, i) => {
          if (next[i] !== h) {
            next[i] = h;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });
    roRef.current = ro;
    ro.observe(vp);
    // 挂载期间已注册的行槽位（ref 回调早于本 effect）补观测，
    // RO 规范会对新观测元素立即投递一次尺寸回调。
    slotEls.current.forEach((el) => ro.observe(el));
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, []);

  const registerSlot = useCallback((i: number, el: HTMLElement | null) => {
    const ro = roRef.current;
    if (el) {
      slotEls.current.set(i, el);
      ro?.observe(el);
    } else {
      const old = slotEls.current.get(i);
      if (old) ro?.unobserve(old);
      slotEls.current.delete(i);
    }
  }, []);

  const offsets = useMemo(() => {
    const arr = new Array<number>(count + 1);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      arr[i] = acc;
      acc += heights[i] + ROW_GAP;
    }
    arr[count] = Math.max(0, acc - ROW_GAP);
    return arr;
  }, [heights, count]);

  const totalH = offsets[count] + ROW_GAP;

  // 二分定位可见区间 [start, end)
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] + heights[mid] >= scrollTop) hi = mid;
    else lo = mid + 1;
  }
  const start = Math.max(0, lo - OVERSCAN);

  lo = 0;
  hi = count;
  const bottom = scrollTop + viewportH;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] > bottom) hi = mid;
    else lo = mid + 1;
  }
  const end = Math.min(count, lo + OVERSCAN);

  // 跳转最早冲突：仅在点击动作触发时执行；行未挂载时先按估算偏移滚，
  // 两帧后实测高度已回写，再 scrollIntoView 精确定位一次。
  useEffect(() => {
    if (jumpNonce === 0 || result.firstConflict < 0) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const targetNow = vp.querySelector('[data-first-conflict="true"]') as HTMLElement | null;
    if (targetNow) {
      targetNow.scrollIntoView({ block: 'center' });
      return;
    }
    vp.scrollTop = offsets[result.firstConflict];
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const t = vp.querySelector('[data-first-conflict="true"]') as HTMLElement | null;
        t?.scrollIntoView({ block: 'center' });
      }),
    );
    return () => cancelAnimationFrame(raf2);
    // 只响应跳转动作；读取的是当次渲染的最新 offsets
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce]);

  const slots = [];
  for (let i = start; i < end; i++) {
    const check = result.checks[i];
    const isFirst = i === result.firstConflict;
    const expanded = !check.safe && (isFirst || expandedExtra.has(i));
    slots.push(
      <div
        key={check.index}
        ref={(el) => registerSlot(i, el)}
        className="check-slot"
        data-row-idx={i}
        style={{ transform: `translateY(${offsets[i]}px)` }}
      >
        <CheckRowContent
          check={check}
          isFirstConflict={isFirst}
          expanded={expanded}
          refinedOpen={!check.safe && refinedOpen.has(i)}
          result={result}
          rowIndex={i}
          onToggle={onToggle}
          onRefine={onRefine}
        />
      </div>,
    );
  }

  return (
    <div
      className="check-viewport"
      data-testid="check-list"
      ref={(el) => {
        viewportRef.current = el;
        registerViewport(el);
      }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <ol className="check-scroller" style={{ height: totalH }}>
        {slots}
      </ol>
    </div>
  );
}

export function App() {
  const [text, setText] = useState(EXAMPLE_JSON);
  // 大输入时延迟分析结果，保证 textarea 录入始终跟手
  const deferredText = useDeferredValue(text);
  // 用户手动展开/收起的非最早冲突检查点
  const [expandedExtra, setExpandedExtra] = useState<Set<number>>(new Set());
  // 用户手动触发精炼最短回路的冲突检查点
  const [refinedOpen, setRefinedOpen] = useState<Set<number>>(new Set());
  // 本次会话是否曾触发过精炼；一旦触发过，后续每次输入变化都提示重新触发
  const [everRefined, setEverRefined] = useState(false);
  // 输入变化致旧精炼结果失效时，提示用户重新触发
  const [refineHint, setRefineHint] = useState(false);
  const [jumpNonce, setJumpNonce] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // 纯前端实时分析：输入始终保留，错误反馈附序位便于就地修正
  const result = useMemo(() => analyze(deferredText), [deferredText]);
  // 输入变化后收起手动展开项并复位跳转状态；
  // analyze 结果随输入整体重建，精炼缓存随之失效；曾触发过精炼则提示重新触发。
  // 仅在文本真正变化时复位，避免 refine 点击改变 everRefined 时误收起。
  const prevTextRef = useRef(deferredText);
  useEffect(() => {
    if (prevTextRef.current === deferredText) return;
    prevTextRef.current = deferredText;
    setExpandedExtra(new Set());
    setJumpNonce(0);
    if (everRefined) {
      setRefinedOpen(new Set());
      setRefineHint(true);
    }
  }, [deferredText, everRefined]);

  const onRefine = (i: number) => {
    setEverRefined(true);
    setRefineHint(false);
    setRefinedOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
    } catch {
      // 读取失败时不清空既有合法输入
      alert(`文件读取失败：${file.name}`);
    }
  };

  const conflictCount = result.checks.filter((c) => !c.safe).length;
  const isEmpty = deferredText.trim() === '';
  const isStale = text !== deferredText;

  return (
    <main className="page">
      <header className="page-header">
        <h1>施工临电相位约束按序复核</h1>
        <p className="subtitle">
          粘贴或导入按序 JSON 操作流（add / remove / check），定位首个不安全检查点。
          约束自 add 序位起生效，至同 id 的 remove 序位前失效；判定基于时间分段树与可回滚奇偶并查集，全程离线运行。
        </p>
      </header>

      <section className="panel" aria-label="操作流输入">
        <div className="panel-toolbar">
          <h2>操作流 JSON</h2>
          <div className="toolbar-actions">
            <button type="button" onClick={() => setText(EXAMPLE_JSON)}>
              载入示例
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              导入文件
            </button>
            <button type="button" className="btn-ghost" onClick={() => setText('')}>
              清空
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json,.txt"
              hidden
              onChange={(e) => {
                void onImportFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <textarea
          className="json-input"
          data-testid="json-input"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"operations":[{"type":"add","id":"c1","a":"总箱","b":"分箱","relation":"same"},{"type":"check"}]}'
        />
        {isStale && <div className="stale-hint">正在分析新输入……</div>}
      </section>

      {!result.ok && !isEmpty && (
        <section className="panel panel-error" role="alert" aria-label="校验错误" data-testid="error-panel">
          <h2>输入有误（{result.issues.length} 项）——原文已保留，请就地修正</h2>
          <ul className="issue-list">
            {result.issues.map((iss, i) => (
              <li key={i}>
                <span className="issue-pos">
                  {iss.index === -1 ? '顶层' : `第 ${iss.index + 1} 步操作`}
                </span>
                <span className="issue-msg">{iss.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(result.ok || isEmpty) && (
        <section className="panel" aria-label="检查结果">
          <div className="panel-toolbar">
            <h2>检查点结果（按原序）</h2>
            {!isEmpty && (
              <div className="summary">
                共 {result.checks.length} 个检查点 ·{' '}
                {conflictCount === 0 ? (
                  <span className="summary-safe">全部 safe</span>
                ) : (
                  <span className="summary-conflict">{conflictCount} 个 conflict</span>
                )}
                {result.firstConflict >= 0 && (
                  <button
                    type="button"
                    className="btn-link"
                    data-testid="jump-first"
                    onClick={() => setJumpNonce((n) => n + 1)}
                  >
                    跳转到最早冲突（#{result.checks[result.firstConflict].seq}）
                  </button>
                )}
              </div>
            )}
          </div>

          {refineHint && conflictCount > 0 && (
            <div className="refine-hint" data-testid="refine-hint">
              输入已变化：此前精炼的最短回路结果已随旧检查点清除，请在需要的 conflict 行重新点击“精炼最短回路”。
            </div>
          )}

          {result.checks.length === 0 ? (
            <p className="empty-hint" data-testid="empty-hint">
              {isEmpty
                ? '在上方粘贴或导入按序 JSON 操作流后即可复核。'
                : '操作流中没有 check 操作，加入一个检查点后即可判定。'}
            </p>
          ) : (
            <VirtualCheckList
              result={result}
              expandedExtra={expandedExtra}
              refinedOpen={refinedOpen}
              onRefine={onRefine}
              onToggle={(i) =>
                setExpandedExtra((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
              jumpNonce={jumpNonce}
              registerViewport={(el) => {
                viewportRef.current = el;
              }}
            />
          )}
        </section>
      )}
    </main>
  );
}
