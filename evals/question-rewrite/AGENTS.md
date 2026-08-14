# 问题改写评测

- `cases.json` 只放固定、无隐私的上下文改写案例；`run.ts` 必须真实调用本地问题模型和独立 OpenAI-compatible 裁判。
- 预期描述语义，不要求逐字匹配；fallback 案例即使裁判认为可接受也不得通过。
- 编排的确定性测试放在根目录 `tests/`，不得在 `evals/` 中新增 `*.test.ts`。
