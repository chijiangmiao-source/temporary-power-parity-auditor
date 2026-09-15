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
