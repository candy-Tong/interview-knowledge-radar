# Contributing to Interview Knowledge Radar

## 开发环境

要求：

- Node.js 22.12.0 或更高版本
- npm（使用仓库中的 `package-lock.json`）
- Docker Compose v2
- Chrome 最新稳定版
- `llama-server`，macOS 可通过 `brew install llama.cpp` 安装
- 阿里云百炼 API Key 和 Workspace ID
- 运行问题改写语义测评时，需要可用的 OpenAI-compatible Chat Completions 服务

所有命令都从仓库根目录执行。先阅读根目录和目标目录下的 `AGENTS.md`。

## 安装与环境变量

```bash
npm ci
test -f .env || cp .env.example .env
```

在本机编辑 `.env`。不要把真实密钥提交到 Git、粘贴到 Issue 或写入日志。

应用必需配置：

```dotenv
DATABASE_URL=postgresql://interview:interview@localhost:54329/interview_rag
DASHSCOPE_API_KEY=由开发者填写
DASHSCOPE_WORKSPACE_ID=由开发者填写
DASHSCOPE_REGION=cn-beijing
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v4
DASHSCOPE_RERANK_MODEL=qwen3-rerank
RERANK_CANDIDATE_LIMIT=5
RERANK_MIN_INTERVAL_MS=2000
RERANK_TIMEOUT_MS=8000
DASHSCOPE_TRANSLATION_MODEL=qwen3.5-livetranslate-flash-realtime
DASHSCOPE_ASR_MODEL=qwen3-asr-flash-realtime

LOCAL_QUESTION_MODEL_URL=http://127.0.0.1:18080/v1
LOCAL_QUESTION_MODEL=qwen3.5-2b
LOCAL_QUESTION_MODEL_TIMEOUT_MS=6000

HOST=127.0.0.1
PORT=8787
RUNTIME_LOG_DIR=runtime-logs
```

`LOCAL_QUESTION_MODEL` 同时负责拆分一个 turn 中的多个问题。模型返回当前 turn 的原句定位文本、是否缺少上下文的语义判断，以及从最近面试官轮次逐字复制的最小上下文片段；服务端从源文本回取原句、验证全部历史片段，并且只在确实缺少上下文时组合出 `retrievalQuery`。任何片段无法定位都会回退当前 turn。页面只展示原句，BM25 和 hybrid 检索使用组合后的 query。实现不得依靠英语或其他特定语言的停用词枚举。

## 启动本地服务

启动 PostgreSQL 并建立索引：

```bash
docker compose up -d postgres
npm run db:init
npm run db:ingest
```

终端 A 启动本地问题模型：

```bash
npm run model:start
curl --fail http://127.0.0.1:18080/v1/models
```

终端 B 启动开发环境：

```bash
npm run dev
```

访问 `http://localhost:5173`。生产模式使用：

```bash
npm run build
npm start
```

生产页面为 `http://127.0.0.1:8787`。

## 测试与模型评测的边界

`npm test` 只运行确定性的 Vitest 测试，使用注入依赖或 mock 验证排序、失败回退、节流和编排，不访问真实 LLM。所有会访问真实本地模型、百炼或独立裁判的质量评测都放在 `evals/`，只通过显式 `npm run eval:*` 命令运行。

## 问题改写 LLM 评测

固定案例位于 `evals/question-rewrite/cases.json`。每个案例包含最近的面试官轮次、当前追问和语义预期。

测评采用两个模型角色：

1. `LOCAL_QUESTION_MODEL` 在本机生成真实改写结果。
2. `OPENAI_MODEL` 作为独立 LLM 裁判，判断是否补全正确上下文、保留当前意图且没有幻觉。

评测变量：

```dotenv
OPENAI_BASE_URL=https://your-openai-compatible-host/v1
OPENAI_API_KEY=sk-your-evaluation-key
OPENAI_MODEL=your-evaluation-model
QUESTION_REWRITE_EVAL_MIN_PASS_RATE=0.8
QUESTION_REWRITE_EVAL_TIMEOUT_MS=120000
```

评测服务地址、凭据和模型名必须显式放在本机 `.env`。脚本调用 `OPENAI_BASE_URL/chat/completions`，使用 Bearer API Key；不会读取任何工具专属配置，也不会打印凭据。

在本地问题模型已启动的情况下运行：

```bash
npm run eval:question-rewrite
```

命令逐条输出 `PASS`/`FAIL`、实际 `retrievalQuery`、三个语义分数和裁判理由，最后输出通过率。通过率低于 `QUESTION_REWRITE_EVAL_MIN_PASS_RATE`、改写模型不可用、LLM 裁判超时或裁判响应格式错误时，命令以非零状态退出。

新增或修复问题改写行为时，先在数据集中加入能复现问题的案例，再调整 prompt 或实现。预期描述语义，不要求某个唯一措辞。

## 检索质量 LLM 评测

固定问题位于 `evals/retrieval/cases.json`。`npm run eval:retrieval` 会真实执行 BM25、pgvector 和百炼重排序，再把 Top 2 的有界相关摘录交给 `OPENAI_MODEL` 独立判断意图覆盖度和相关性。

```dotenv
RETRIEVAL_EVAL_MIN_PASS_RATE=0.8
RETRIEVAL_EVAL_TIMEOUT_MS=120000
```

```bash
npm run eval:retrieval
```

该命令要求 PostgreSQL 索引、百炼配置和 OpenAI-compatible 裁判都可用；通过率不足、检索失败或裁判不可用都会返回非零退出码。

## 测试、构建与审查

提交前至少运行：

```bash
npm test
npm run build
npm run eval:question-rewrite
npm run eval:retrieval
```

单独验证实时链路：

```bash
npm test -- server/realtime/question-splitter.test.ts server/realtime/translation-proxy.test.ts
```

涉及数据库或检索时，再运行：

```bash
npm run db:init
npm run db:ingest
```

按照 `CodeReview.md` 对固定提交范围执行审查。一个独立改动使用一个 GitHub Issue；完成后把根因、实现、关键数据流、验证、审查、commit 和剩余风险完整回写后再关闭。

## 数据与隐私

- 不提交 `.env`、`runtime-logs/`、模型服务配置或任何密钥。
- 问题改写只向 `127.0.0.1` 的本地模型发送最近三轮面试官原文。
- LLM 评测会把固定案例、问题改写或 Top 2 有界摘录发送给 `OPENAI_BASE_URL`；不要在固定案例中放真实面试内容、候选人隐私或公司机密。
- 系统音频授权必须由用户在 Chrome 中确认，自动化测试不得绕过授权。
