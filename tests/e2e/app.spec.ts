import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('示例流：定位最早冲突，删除矛盾约束后恢复 safe', () => {
  test('按原序展示 safe / conflict 并突出最早冲突', async ({ page }) => {
    const items = page.getByTestId('check-item');
    await expect(items).toHaveCount(3);

    // 第 1 个检查点：两条 same 自洽
    await expect(items.nth(0)).toHaveAttribute('data-safe', 'true');
    await expect(items.nth(0)).toContainText('safe');

    // 第 2 个检查点：加入 opposite 闭合边形成奇环，且为最早冲突
    await expect(items.nth(1)).toHaveAttribute('data-safe', 'false');
    await expect(items.nth(1)).toHaveAttribute('data-first-conflict', 'true');
    await expect(items.nth(1)).toContainText('conflict');
    await expect(items.nth(1)).toContainText('最早冲突');
    // 展示矛盾回路证据
    await expect(items.nth(1)).toContainText('奇环');

    // 第 3 个检查点：remove 致矛盾约束后必须恢复 safe，且不再标记为最早冲突
    await expect(items.nth(2)).toHaveAttribute('data-safe', 'true');
    await expect(items.nth(2)).toHaveAttribute('data-first-conflict', 'false');
    await expect(items.nth(2)).toContainText('safe');

    // 最早冲突只有一个
    await expect(page.locator('[data-first-conflict="true"]')).toHaveCount(1);
  });

  test('连续冲突时仅最早冲突自动展开，其余证据点击后才计算展示', async ({ page }) => {
    await page.getByTestId('json-input').fill(
      JSON.stringify({
        operations: [
          { type: 'add', id: '1', a: 'A', b: 'B', relation: 'same' },
          { type: 'add', id: '2', a: 'B', b: 'C', relation: 'same' },
          { type: 'add', id: '3', a: 'A', b: 'C', relation: 'opposite' },
          { type: 'check' },
          { type: 'check' },
          { type: 'check' },
        ],
      }),
    );
    const items = page.getByTestId('check-item');
    await expect(items).toHaveCount(3);

    // 第二个冲突默认不展开证据，只提供展开按钮
    const second = items.nth(1);
    await expect(second).toContainText('查看矛盾回路');
    await expect(second).not.toContainText('奇环');

    // 点击后才计算并展示；再点收起
    await second.getByTestId('toggle-witness').click();
    await expect(second).toContainText('奇环');
    await second.getByTestId('toggle-witness').click();
    await expect(second).not.toContainText('奇环');
  });
});

test.describe('手工录入到展示', () => {
  test('清空后粘贴新操作流，实时给出判定', async ({ page }) => {
    const input = page.getByTestId('json-input');
    await input.fill('');
    await expect(page.getByTestId('empty-hint')).toBeVisible();

    await input.fill(
      JSON.stringify({
        operations: [
          { type: 'add', id: 'x1', a: 'L1', b: 'L2', relation: 'opposite' },
          { type: 'add', id: 'x2', a: 'L2', b: 'L3', relation: 'opposite' },
          { type: 'check' },
        ],
      }),
    );
    const items = page.getByTestId('check-item');
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toContainText('safe');

    // 追加第三条 odd 约束制造矛盾
    await input.fill(
      JSON.stringify({
        operations: [
          { type: 'add', id: 'x1', a: 'L1', b: 'L2', relation: 'opposite' },
          { type: 'add', id: 'x2', a: 'L2', b: 'L3', relation: 'opposite' },
          { type: 'add', id: 'x3', a: 'L3', b: 'L1', relation: 'opposite' },
          { type: 'check' },
        ],
      }),
    );
    await expect(items.nth(0)).toContainText('conflict');
    await expect(items.nth(0)).toHaveAttribute('data-first-conflict', 'true');
  });

  test('载入示例按钮可随时恢复', async ({ page }) => {
    await page.getByTestId('json-input').fill('garbage');
    await page.getByRole('button', { name: '载入示例' }).click();
    await expect(page.getByTestId('check-item')).toHaveCount(3);
  });
});

test.describe('错误反馈保留合法输入便于修正', () => {
  test('重复 id 与悬空 remove 报序位错误，原文保留；修正后恢复结果', async ({ page }) => {
    const input = page.getByTestId('json-input');
    const bad = JSON.stringify(
      {
        operations: [
          { type: 'add', id: 'dup', a: 'A', b: 'B', relation: 'same' },
          { type: 'add', id: 'dup', a: 'A', b: 'C', relation: 'same' },
          { type: 'remove', id: 'ghost' },
        ],
      },
      null,
      2,
    );
    await input.fill(bad);

    const panel = page.getByTestId('error-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('重复 id');
    await expect(panel).toContainText('悬空 remove');
    await expect(panel).toContainText('第 2 步操作');
    await expect(panel).toContainText('第 3 步操作');

    // 原文必须保留，便于复核电工就地修正
    expect(await input.inputValue()).toBe(bad);

    // 修正为合法流（保留第 1 步，改掉重复 id、悬空 remove）
    await input.fill(
      JSON.stringify({
        operations: [
          { type: 'add', id: 'dup', a: 'A', b: 'B', relation: 'same' },
          { type: 'check' },
        ],
      }),
    );
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('check-item')).toHaveCount(1);
    await expect(page.getByTestId('check-item').nth(0)).toContainText('safe');
  });

  test('未知操作与缺失字段给出错误且不清空输入', async ({ page }) => {
    const input = page.getByTestId('json-input');
    const bad = JSON.stringify({
      operations: [
        { type: 'add', id: 'y', a: 'A', b: 'B' }, // 缺 relation
        { type: 'frobnicate' }, // 未知操作
      ],
    });
    await input.fill(bad);
    const panel = page.getByTestId('error-panel');
    await expect(panel).toContainText('relation');
    await expect(panel).toContainText('未知操作类型');
    expect(await input.inputValue()).toBe(bad);
  });
});

test.describe('大规模输入性能', () => {
  test('数千连续冲突检查点粘贴后快速展示，且只渲染可见窗口行', async ({ page }) => {
    const ops: any[] = [
      { type: 'add', id: 't0', a: 'A', b: 'B', relation: 'same' },
      { type: 'add', id: 't1', a: 'B', b: 'C', relation: 'same' },
      { type: 'add', id: 't2', a: 'A', b: 'C', relation: 'opposite' },
    ];
    for (let i = 0; i < 6000; i++) {
      ops.push({
        type: 'add',
        id: `n${i}`,
        a: `N${i % 400}`,
        b: `N${(i + 1) % 400}`,
        relation: i % 2 ? 'same' : 'opposite',
      });
    }
    for (let i = 0; i < 4000; i++) ops.push({ type: 'check' });

    await page.getByTestId('json-input').fill(JSON.stringify({ operations: ops }));

    // 2 秒内必须完成分析并把最早冲突渲染出来
    await expect(page.locator('[data-first-conflict="true"]')).toBeVisible({ timeout: 2000 });
    // 4000 个检查点全部计入汇总……
    await expect(page.locator('.summary')).toContainText('共 4000 个检查点');
    await expect(page.locator('.summary')).toContainText('4000 个 conflict');
    // ……但 DOM 只挂载可见窗口内的少量行槽
    const slots = await page.locator('.check-slot').count();
    expect(slots).toBeLessThan(60);

    // 滚动到列表底部后窗口行随之更新，仍保持少量挂载
    await page.locator('[data-testid="check-list"]').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(async () =>
      page.locator('.check-slot').last().getAttribute('data-row-idx')
    ).toBe('3999');
    const slotsAfter = await page.locator('.check-slot').count();
    expect(slotsAfter).toBeLessThan(60);
  });
});

test.describe('导入文件', () => {
  test('通过文件选择器导入 JSON 并展示判定', async ({ page }) => {
    const buffer = Buffer.from(
      JSON.stringify({
        operations: [
          { type: 'add', id: 'f1', a: '总箱', b: '分箱1', relation: 'same' },
          { type: 'add', id: 'f2', a: '分箱1', b: '分箱2', relation: 'opposite' },
          { type: 'check' },
        ],
      }),
      'utf-8',
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: 'operations.json',
      mimeType: 'application/json',
      buffer,
    });
    const items = page.getByTestId('check-item');
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toContainText('safe');
    await expect(page.getByTestId('json-input')).toContainText('f1');
  });
});
