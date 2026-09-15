/** 内置示例：中途出现奇环矛盾，拆除致矛盾约束后下一检查点恢复 safe */
export const EXAMPLE_JSON = JSON.stringify(
  {
    operations: [
      { type: 'add', id: 'c-main-a', a: '总配电箱', b: '分配电箱A', relation: 'same' },
      { type: 'add', id: 'c-a-b', a: '分配电箱A', b: '开关箱B', relation: 'same' },
      { type: 'check' },
      { type: 'add', id: 'c-b-main', a: '开关箱B', b: '总配电箱', relation: 'opposite' },
      { type: 'check' },
      { type: 'remove', id: 'c-b-main' },
      { type: 'check' },
    ],
  },
  null,
  2,
);
