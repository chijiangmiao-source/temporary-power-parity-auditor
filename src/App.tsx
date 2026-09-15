import { useMemo, useRef, useState } from 'react';
import { analyze } from './analyzer';
import { EXAMPLE_JSON } from './example';
import type { ConflictWitness, Constraint } from './types';

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

export function App() {
  const [text, setText] = useState(EXAMPLE_JSON);
  const fileRef = useRef<HTMLInputElement>(null);

  // 纯前端实时分析：输入始终保留，错误反馈附序位便于就地修正
  const result = useMemo(() => analyze(text), [text]);

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
  const isEmpty = text.trim() === '';

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
              </div>
            )}
          </div>

          {result.checks.length === 0 ? (
            <p className="empty-hint" data-testid="empty-hint">
              {isEmpty
                ? '在上方粘贴或导入按序 JSON 操作流后即可复核。'
                : '操作流中没有 check 操作，加入一个检查点后即可判定。'}
            </p>
          ) : (
            <ol className="check-list" data-testid="check-list">
              {result.checks.map((c, i) => {
                const isFirst = i === result.firstConflict;
                return (
                  <li
                    key={c.index}
                    data-testid="check-item"
                    data-seq={c.seq}
                    data-safe={c.safe ? 'true' : 'false'}
                    data-first-conflict={isFirst ? 'true' : 'false'}
                    className={[
                      'check-item',
                      c.safe ? 'check-safe' : 'check-conflict',
                      isFirst ? 'check-first-conflict' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="check-head">
                      <span className="check-seq">#{c.seq}</span>
                      <span className="check-pos">第 {c.index + 1} 步（check）</span>
                      <span className={`badge ${c.safe ? 'badge-safe' : 'badge-conflict'}`}>
                        {c.safe ? 'safe' : 'conflict'}
                      </span>
                      {isFirst && <span className="first-tag">▲ 最早冲突</span>}
                    </div>
                    {!c.safe && c.witness && <WitnessView witness={c.witness} />}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}
