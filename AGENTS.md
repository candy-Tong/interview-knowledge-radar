# Interview Knowledge Radar 开发指南

## 适用范围与继承

- 本文件适用于整个仓库；进入子目录后，继续遵守该目录更具体的 `AGENTS.md`。
- `node_modules/`、`dist/`、数据库卷和其他生成产物不接受手工修改，也不需要补充 `AGENTS.md`。
- 修改架构、数据契约、部署方式或关键产品约束时，同步更新最接近该实现的 `AGENTS.md`、`README.md` 和 `DEPLOYMENT.md`。

## GitHub Issue 闭环

- 只读咨询不创建 GitHub Issue，包括结果是否正确、原因解释、方案讨论、代码阅读、状态确认和不伴随改动的诊断。
- 用户明确要求修改、修复或新增功能时，开始处理前创建 GitHub Issue，记录问题背景、期望结果和验收条件；仅当用户明确要求把调查本身留档时，才为纯调查创建 Issue。
- 一个独立问题只对应一个 GitHub Issue；同一条用户请求包含多个独立问题时，必须分别创建 Issue，并分别实现、验证、完整回写和关闭。一个问题内部的多个验收条件或实现步骤仍归入同一个 Issue，不得为了步骤数量机械拆分。
- 不追溯拆分已经完成或关闭的历史 Issue，除非用户明确要求整理历史记录。
- 实现过程中以该 Issue 作为交付记录；不要在问题尚未解决或验证尚未通过时提前关闭。
- 完成后先在 Issue 中回写完整解决方案，包括根因、实现思路、关键状态/数据流变化、主要文件、验证与审查结果、对应 commit 和剩余风险，再关闭 Issue；不得只写“已修复”或简略结论。
- 如果当前无法解决，保留 Issue 为打开状态，并在 Issue 和对用户的回复中写明阻塞原因与下一步，不得用关闭代替完成。

## Code Review 闭环

- 以 [`CodeReview.md`](./CodeReview.md) 作为代码审查规则和通过标准，使用项目内的 OpenCodeReview 命令统一选取变更文件和解析审查规则。
- 大改动完成实现并通过对应自动化验证后，必须按 `CodeReview.md` 固定审查目标，使用同一组范围参数执行 preview 和完整 code review；未审查或存在未处理的阻断问题时，不得宣布完成或关闭 Issue。
- OpenCodeReview 已配置 LLM 时，执行 `npm run review -- <targetArgs> --background "<需求与验收条件>"`；未配置时，使用 `npm run review:delegate -- <targetArgs>` 取得文件范围，再用 `npm run review:rules -- <file...>` 取得规则，由当前编码 Agent 完成审查。不得因缺少 LLM 凭据而跳过审查。
- 审查发现修复后，重新执行受影响的测试和 code review，直到没有未解决的阻断问题。
- 将审查命令、发现、处置结果和剩余风险回写到当前 GitHub Issue；不提交 OpenCodeReview 的用户级配置、LLM 凭据或本地会话记录。

## 产品目标

这是一个本地优先的实时面试辅助工具：浏览器采集用户主动共享的系统音频，Node 服务按模式代理阿里云实时翻译或独立实时 ASR，并用 PostgreSQL 中的 BM25 与 pgvector 混合检索本地面试知识。

必须保持以下产品约束：

- 只使用 `getDisplayMedia` 获取用户明确共享的电脑音频，不请求麦克风，也不在失败时回退到麦克风。
- 阿里云 API Key 和 Workspace ID 只留在服务端，不进入前端包、浏览器日志或接口响应。
- 翻译模式使用 LiveTranslate 输出英文原文与中文同传；普通模式必须连接独立 ASR 上游，不能只在前端隐藏翻译结果。
- 模式只允许在会话开始前切换；会话期间锁定，两个模式都保留 5 秒 turn 合并和知识检索。
- 模式切换位于左侧面试官卡片标题右侧，监听状态和动作位于下一行；全局顶栏只保留品牌、视图 Tab 和服务就绪状态。
- `knowledge-base/` 是递归扫描的知识根目录；一份知识源 Markdown 对应一条完整知识，各层 `AGENTS.md` 不参与入库。
- 一次检索最多返回两条知识；中栏和右栏各展示一条完整知识。
- 一个 5 秒 turn 可包含多个独立问题；本地 Qwen3.5-2B 通过 llama.cpp 拆题，并结合最近三轮面试官原文把省略项目/指代的追问改写成可独立检索的 query；每个问题独立绑定最多两条知识。
- UI 展示拆分后的当前问题原意，BM25 与 hybrid 检索使用补全上下文后的 `retrievalQuery`；历史轮次只能补全指代，不能替代当前问题或向独立问题注入项目。
- 连续语音只有静音超过 5 秒才形成新的面试官行；说话过程中用增量原文节流拆题和刷新同一行的 BM25 知识，ASR 完成后立即用完整原文校准草稿，不等待翻译。
- 说话中的问题草稿只做本地 BM25 召回；turn 最终确定后，每个问题再做一次 BM25 + pgvector 混合检索。
- 实时识别、翻译、合并后的问题和知识召回明细写入本地按日 JSONL 运行日志，使用 `sessionId`/`turnId` 关联以供复盘；日志目录不得提交 Git。
- 面试页保持单屏三栏；页面本身不横向或纵向滚动，转写区和知识正文区可独立纵向滚动。
- 点击历史面试官语句或其 Q1/Q2 问题时，切换到对应问题绑定的两条知识。
- 大知识自动滚动到相关句并轻量标记，但原始知识内容和存储粒度不变。
- “知识库总览”展示数据库中的全部完整知识；数量来自接口，不得硬编码。
- 知识库总览的模拟搜索必须复用 `POST /api/search`，回车和搜索按钮触发同一条混合检索链路，最多展示两条完整知识。

## 架构地图

- `src/`：React 19 浏览器应用、系统音频采集和界面状态。
- `public/pcm-capture.worklet.js`：音频线程中的 16 kHz 单声道 PCM 转换。
- `server/`：Express API、WebSocket 代理、检索和配置。
- `server/database/`：PostgreSQL/pgvector 连接与幂等 schema。
- `server/knowledge/`：文本规范化、向量生成、BM25 + pgvector 混合检索和相关句定位。
- `server/realtime/`：浏览器与阿里云之间的实时协议适配、5 秒合并窗口和检索触发。
- `scripts/`：数据库初始化和知识导入的一次性命令。
- `knowledge-base/`：知识源 Markdown；文件数可能变化，不要依赖 README 中的历史数量。

## 本地开发

要求 Node.js 22+、Docker Desktop 和最新版 Chrome。

```bash
npm install
docker compose up -d postgres
npm run db:init
npm run db:ingest
npm run dev
```

- Vite 开发端口为 `5173`，Node API/WebSocket 默认端口为 `8787`。
- PostgreSQL 暴露在本机 `54329`，默认只供本项目使用。
- 生产模式先执行 `npm run build`，再执行 `npm start`。
- 修改 `knowledge-base/` 后通过页面“更新知识”或 `npm run db:ingest` 增量同步；只有词法验证时才使用 `npm run db:ingest:bm25`。

## 代码规范

- TypeScript 使用 strict ESM；服务端相对导入保留 `.js` 后缀以适配编译后的 ESM 解析。
- 局部变量、函数和 state 使用 `camelCase`；导出类型、组件和稳定枚举使用 `PascalCase`。
- 新增导出优先具名导出；具名函数优先用 `function` 声明，并在函数前写一句职责注释。
- 能稳定推导的局部类型不要重复声明；公共前端契约集中在页面最近的 `types.ts`。
- React 页面负责组装，页面私有组件、hooks 和工具就近放置；不要提前提升为全局抽象。
- Props 只暴露真实调用方需要的依赖；单页状态优先使用 props 和局部 state。
- CSS 延续浅色马卡龙配色与紧凑布局；知识正文默认 `14px/500`，窄屏可降为 `13px`，中英文字号一致。
- 不在实现中写死知识条数、端口以外的运行状态或检索结果。

## 安全与隐私

- 不提交、打印或在文档中复制 `.env` 的真实密钥。
- 新增 WebSocket 入口时保持路径白名单和 loopback Origin 校验。
- 所有 SQL 值使用参数化查询；结构性 SQL 必须可审查且避免拼接用户输入。
- 不扩大 `HOST=127.0.0.1` 的默认监听范围，除非用户明确要求并理解局域网暴露风险。
- 音频按当前模式发送给阿里云 LiveTranslate 或 Qwen3-ASR；问题拆分和上下文改写只访问 loopback 的 llama.cpp；完整知识和最终改写 query 会用于阿里云向量生成。固定问题改写测评及改写结果会发送给 `.env` 配置的 OpenAI-compatible LLM 进行判分，测评数据不得包含真实面试隐私。变更数据流时同步更新隐私说明。
- 运行日志含面试识别原文、翻译、查询和召回知识元数据，属于敏感本地数据；不得记录 API Key、Authorization、数据库凭据，也不得自动上传或提交。

## 验证要求

提交改动前至少执行：

```bash
npm test
npm run build
```

按改动范围增加验证：

- 数据库/schema：`npm run db:init`，必要时在测试库重复执行确认幂等。
- 知识导入/检索：`npm run db:ingest`，再检查 `/api/knowledge/stats`、`/api/knowledge` 和 `/api/search`。
- 实时协议：运行 `server/realtime/translation-proxy.test.ts`，确认两种模式选择正确上游、普通模式无翻译事件、复合 turn 拆为多问题且每题独立召回、跨 turn 追问使用上一轮项目补全后的 query、草稿 BM25 先于最终 hybrid、过期结果不会覆盖新结果，并且相邻 ASR 片段只产生一行。
- 问题改写：本地模型启动后运行 `npm run eval:question-rewrite`，由 `.env` 中 `OPENAI_*` 指定的 LLM 裁判验证上下文、意图保持和无幻觉，通过率不得低于配置阈值。
- 前端布局：在 Chrome 中确认页面 `scrollWidth/scrollHeight` 不超过视口，内部滚动区仍可滚动。
- 音频链路：必须由真实用户手势触发共享权限；不要用自动化绕过浏览器授权。
