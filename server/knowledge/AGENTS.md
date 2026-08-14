# Knowledge 检索开发指南

## 模块知识

- `text.ts`：Markdown 规范化、英文分词、小型词干处理、词频统计和相关句定位。
- `embedding.ts`：调用阿里云兼容接口生成 1024 维向量，并严格校验返回维度。
- `search.ts`：BM25 候选与 pgvector 余弦候选通过加权 RRF 排序，再交给重排序；无向量配置时退化为 BM25 候选。
- `rerank.ts`：调用百炼 `qwen3-rerank`，全局节流、合并草稿并优先最终问题；失败时保留基础候选顺序。

## 不可破坏的检索语义

- 一份源文件是一条完整知识，禁止在这里新增段落切块或把同一正文返回成多条结果。
- `maximumKnowledgeResults = 2` 是产品上限；HTTP 和实时检索都应复用该常量。
- BM25 与查询使用同一套 `tokenizeEnglish()` 规范化，否则词项表无法命中。
- 当前 RRF 权重为 BM25 `0.45`、向量 `0.55`，常数为 `60`；修改权重需要用真实问题对比结果。
- 基础召回候选数默认 5，最终仍只能返回 2；重排序不得改变返回知识的完整正文。
- `locateRelevantPassage()` 只计算完整正文中的滚动焦点，不改变存储或返回正文。
- `focusStart`/`focusEnd` 是 JavaScript 字符串索引，前端直接对原始 `content` 调用 `slice()`；任何正文清洗必须在计算偏移前完成。
- 无可靠词法落点时返回 `{ focusStart: 0, focusEnd: 0 }`，前端从文首展示。

## 实现规范

- 云端错误要保留可操作的服务端信息，但不得记录 Authorization 内容。
- rerank 请求全局启动间隔不得小于 `RERANK_MIN_INTERVAL_MS`，且配置值不得低于 1000ms；最终问题优先于排队草稿，同一问题的新草稿可替换旧草稿。
- SQL 结果类型与前端 `KnowledgeResult` 契约同步；数据库行类型不包含派生的 focus 字段。
- 不把混合分数描述成概率；UI 只显示原始相关性信号。
- 文本规则变化必须补充 `text.test.ts`；云端 embedding 使用 mock 测试，单元测试不依赖真实密钥。
- 重排序测试使用 mock fetch 和 fake timer；真实检索质量由 `evals/retrieval/` 的 LLM 评测负责。

## 验证

```bash
npm test -- server/knowledge
npm run build
```

真实检索至少覆盖：词法明显的问题、语义改写问题、无有效英文词项的问题，以及相关句位于长知识中后部的问题。
