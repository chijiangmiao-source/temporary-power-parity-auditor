# 施工临电相位约束按序复核

施工临时用电回路在一天内会被反复接入、拆除。只看**最终接线**无法发现中途曾经出现的
相位矛盾（例如一度与总箱声明为反相、随后又被拆除的分箱线）。本工具让复核电工把现场记录
整理成**按序 JSON 操作流**，粘贴或导入浏览器后，按原序给出每个检查点的 `safe` /
`conflict`，并突出**最早冲突**、展示构成矛盾的奇环约束链。

纯前端实现（TypeScript + React + Vite），不调用任何业务后端或在线服务，刷新即离线可用。

## 操作流规则

顶层为一个对象，含 `operations` 数组，操作仅允许三种类型：

| 操作 | 字段 | 含义 |
| --- | --- | --- |
| `add` | `id`、`a`、`b`、`relation` | 接入一条约束。`id` 为**全局唯一**非空字符串；`a`、`b` 为两个非空节点名（总箱/分箱/开关箱等）；`relation` 为 `same`（同相）或 `opposite`（反相） |
| `remove` | `id` | 拆除一条约束，**只能指向当前活动的 id** |
| `check` | 无 | 检查点：在应用本序位操作后，判定全部活动约束能否同时满足 |

**活动区间**：约束从其 `add` 所在序位起生效，到同一 `id` 的 `remove` 所在序位前失效
（半开区间 `[add, remove)`）。未拆除的约束一直活动到流末尾。每个 `check` 只回答当时的
活动约束集是否可二着色；早先的矛盾不会因后续拆除而改写早先检查点的记录。

判定规则：把 `same` 视作两端相位异或为 0、`opposite` 为 1。任意环路上异或之和必须为 0
（偶数条反相），出现奇环即 `conflict`。拆除致矛盾的约束后，下一检查点恢复 `safe`。

### 错误输入（不给出判定，原文保留，逐条列出序位以便修正）

- 顶层不是对象 / 缺少 `operations` 数组 / JSON 语法错误；
- 未知操作类型，或任何必填字段缺失、为空；
- 重复 `id`（id 全局唯一，删除后也不允许再次使用）；
- 悬空 `remove`（从未 add）或重复 `remove`（当前不活动）。

出错时文本框内容不会被清空或替换，可直接就地修改。

### 示例

```json
{
  "operations": [
    { "type": "add", "id": "c-main-a", "a": "总配电箱", "b": "分配电箱A", "relation": "same" },
    { "type": "add", "id": "c-a-b", "a": "分配电箱A", "b": "开关箱B", "relation": "same" },
    { "type": "check" },
    { "type": "add", "id": "c-b-main", "a": "开关箱B", "b": "总配电箱", "relation": "opposite" },
    { "type": "check" },
    { "type": "remove", "id": "c-b-main" },
    { "type": "check" }
  ]
}
```

三个检查点依次为 `safe` → **`conflict`（最早冲突）** → `safe`：
`same(总箱,A) + same(A,B)` 已推出总箱与 B 同相，再声明二者反相构成奇环；
`remove c-b-main` 后矛盾消失。界面还会列出该奇环的完整约束链（闭合边即 `c-b-main`）。

## 本地开发

```bash
npm install
npm run dev        # 本地开发服务器
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
```

## Docker Compose

```bash
# 启动页面（默认宿主端口 8080）
docker compose up web
# 用 WEB_PORT 覆盖宿主端口
WEB_PORT=9090 docker compose up web
```

### 一次性验收服务 verify

```bash
docker compose run --rm verify
```

该服务执行完整验收：Vitest 单元与差分测试 → 类型检查 + 生产构建 → 对 `web` 容器运行
Playwright 端到端测试，全部通过后退出（退出码 0）。

宿主机上等价命令：

```bash
npm run verify     # test:unit + build + playwright test
```

## 测试

- **Vitest**（`src/**/*.test.ts`）
  - 并查集合并/回滚、解析校验、端到端行为；
  - `differential.test.ts` 随机生成 400 组小规模操作流，以**暴力 2 染色枚举**
    （2^k 种相位赋值）为差分判据，逐检查点比对主算法；
  - 同时校验所有冲突证据（闭合边 + 路径）确为奇环。
- **Playwright**（`tests/e2e/app.spec.ts`）覆盖：示例流从录入到 safe/conflict
  按序展示与最早冲突高亮、删除矛盾约束后恢复 safe、手工录入、文件导入、
  错误反馈保留原文并可修正、非最早冲突证据按需展开，以及 4000 检查点规模下
  2 秒内出结果且 DOM 仅挂载可见窗口行。

## 算法

设操作流长度为 M、活动约束数为 K、节点数为 N。

1. **区间化**：解析后每条约束得到活动区间 `[start, end)`。
2. **时间分段树（区间线段树）**：每条区间拆成 O(log M) 个树节点存放；对线段树做一次
   DFS，进入节点时应用约束、离开时回滚。叶子 t 上的活动边恰为时间 t（应用第 t 步后）
   的全部活动约束，检查点直接在叶子上取值。每条边只处理 O(log M) 次，
   **绝不在每个 check 重建整图**。
3. **可回滚带奇偶并查集**：`xor[v] = parity(v) xor parity(parent[v])`，
   仅按大小合并不做路径压缩（树高 O(log N)），每次合并压栈，按快照回滚；
   矛盾是布尔状态，回滚自动撤销。
4. **证据按需计算**：主判定只产出 safe/conflict；奇环证据（闭合边 + 约束链）仅在
   最早冲突默认展开、或用户点击某冲突检查点时才计算并缓存。连续冲突且检查点成千上万时，
   不会为每个检查点重复复算活动约束集。
5. **结果虚拟滚动**：检查点列表只挂载滚动窗口内的行（行高经 ResizeObserver 实测回写），
   4000 个检查点的 DOM 节点也只有十几个；分析经 `useDeferredValue` 延迟到输入空闲，
   粘贴大操作流时录入与首屏结果都不卡顿。

## 目录结构

```
src/
  types.ts            类型定义
  parser.ts           JSON 解析与全部规则校验（错误附序位）
  dsu.ts              可回滚带奇偶并查集
  segmentTree.ts      时间分段树（区间下放 + DFS 回滚）
  analyzer.ts         分析引擎与奇环证据提取
  bruteForce.ts       暴力 2 染色（测试差分判据）
  App.tsx / styles.css 界面：录入、导入、按序结果、最早冲突高亮、证据展示
tests/e2e/            Playwright 端到端测试
Dockerfile            web（nginx 静态页）与 verify（一次性验收）两个目标
docker-compose.yml    web + verify 服务
```
