# Interview Knowledge Radar 本地部署指南

## 部署目标

该部署流程在一台电脑上运行完整的 Interview Knowledge Radar：

- Chrome 负责系统音频共享和界面展示。
- Node.js 在 `127.0.0.1:8787` 提供静态页面、REST API 和 WebSocket 代理。
- Docker 中的 PostgreSQL + pgvector 在 `localhost:54329` 保存完整知识、BM25 词项和向量。
- Node.js 使用服务端 `.env` 中的凭据访问阿里云实时同传和 embedding 接口。

部署完成后，用户访问 `http://127.0.0.1:8787`。所有命令均从项目根目录执行。

## 支持边界

当前版本支持同机 localhost 部署，不支持直接部署到 Vercel、普通静态托管或公网服务器。

远程部署需要先完成额外工程改造：HTTPS/WSS、身份认证、服务端密钥管理、远程 PostgreSQL、CORS/Origin 策略和非 loopback 监听。现有 WebSocket 只接受本地 HTTP Origin，服务默认只监听 `127.0.0.1`。不要通过修改 `HOST=0.0.0.0` 绕过这些边界。

## 交给 AI 执行

可以把下面的指令连同项目目录交给编码 Agent：

```text
请先读取 AGENTS.md、README.md 和 DEPLOYMENT.md，然后严格按照 DEPLOYMENT.md
执行本地生产部署。逐项完成前置检查、数据库启动、依赖安装、schema 初始化、
知识导入、测试、构建、服务启动和验收。不要输出 .env 内容，不要覆盖已有 .env，
不要删除 Docker volume，不要终止无法确认归属的进程，不要改成公网监听。
遇到文档中标注的人工步骤或停止条件时暂停并向我说明。
```

### AI 可直接执行的操作

- 检查 Node.js、npm、Docker、端口和项目文件。
- 在 `.env` 不存在时复制 `.env.example`，随后暂停等待用户填写密钥。
- 运行 `npm ci`、Docker Compose、数据库初始化、知识导入、测试和构建命令。
- 启动本地 Node.js 服务并调用 localhost API 验收。
- 打开本地页面并检查布局；系统音频授权仍必须由用户亲自确认。

### 必须暂停并询问用户的情况

- 需要安装或升级 Node.js、Docker Desktop 或 Chrome。
- `.env` 已存在但配置未通过；禁止覆盖或输出文件内容。
- `54329` 或 `8787` 被无法确认归属的进程占用。
- 需要删除数据库 volume、清空表、恢复备份或执行其他破坏性操作。
- 用户要求远程访问、公网部署、HTTPS、域名或多用户使用。
- 浏览器弹出屏幕与系统音频共享授权。

## 前置要求

| 项目 | 要求 | 用途 |
| --- | --- | --- |
| Node.js | `22.12.0` 或更高的 22.x/更新版本 | Vite 构建和 Node 服务 |
| npm | 随 Node.js 安装 | 按 lockfile 安装依赖 |
| Docker | Docker Desktop 或 Docker Engine | 运行 PostgreSQL + pgvector |
| Docker Compose | v2，使用 `docker compose` | 管理数据库容器和数据卷 |
| Chrome | 最新稳定版 | 系统音频共享与页面运行 |
| 阿里云百炼 | API Key、Workspace ID | 实时同传和 1024 维 embedding |

阿里云 Workspace 与 `DASHSCOPE_REGION` 必须属于同一地域。当前配置只接受：

- `cn-beijing`
- `ap-southeast-1`

本机端口要求：

- `54329`：PostgreSQL
- `8787`：生产页面、API 和 WebSocket
- `5173`：仅开发模式使用

## 部署流程

### 1. 确认项目和运行环境

```bash
pwd
test -f package.json
test -f package-lock.json
test -f docker-compose.yml
node --version
npm --version
docker --version
docker compose version
```

使用以下命令验证 Node.js 版本下限：

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js 需要 >= 22.12.0"); process.exit(1); } console.log("Node.js version is supported")'
```

检查端口。命令无输出表示当前没有监听进程：

```bash
lsof -nP -iTCP:54329 -sTCP:LISTEN || true
lsof -nP -iTCP:8787 -sTCP:LISTEN || true
```

如果端口已被本项目现有 PostgreSQL 或 Interview Knowledge Radar 占用，可以复用或先正常停止；无法确认进程归属时暂停，不要直接 `kill`。

### 2. 准备服务端配置

仅在 `.env` 不存在时创建：

```bash
test -f .env || cp .env.example .env
```

`.env` 至少需要正确设置：

```dotenv
DATABASE_URL=postgresql://interview:interview@localhost:54329/interview_rag
DASHSCOPE_API_KEY=由用户填写
DASHSCOPE_WORKSPACE_ID=由用户填写
DASHSCOPE_REGION=cn-beijing
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v4
DASHSCOPE_TRANSLATION_MODEL=qwen3.5-livetranslate-flash-realtime
HOST=127.0.0.1
PORT=8787
```

不要把真实值粘贴到聊天、日志、README 或部署报告。Agent 可以运行下面的检查；该命令只输出缺失的变量名，不输出变量值：

```bash
node --input-type=module -e 'import "dotenv/config"; const required = ["DASHSCOPE_API_KEY", "DASHSCOPE_WORKSPACE_ID"]; const missing = required.filter((name) => !process.env[name] || process.env[name].includes("your-")); console.log(missing.length ? `Missing configuration: ${missing.join(", ")}` : "DashScope configuration is present"); process.exitCode = missing.length ? 1 : 0'
```

检查未通过时暂停，让用户在本机编辑 `.env`。

### 3. 安装 Node.js 依赖

生产部署使用 lockfile：

```bash
npm ci
```

不要手工修改 `node_modules/`。`npm ci` 失败时保留完整错误信息，但不要在报告中包含任何环境变量值。

### 4. 启动 PostgreSQL

```bash
docker compose up -d postgres
docker compose ps
docker compose exec -T postgres pg_isready -U interview -d interview_rag
```

最后一条命令必须返回 `accepting connections`。如果数据库未就绪，读取有限日志定位原因：

```bash
docker compose logs --tail=100 postgres
```

不要运行 `docker compose down -v`，该命令会删除知识库数据卷。

### 5. 初始化 schema 并导入知识

```bash
npm run db:init
npm run db:ingest
```

导入规则：

- `knowledge-base/` 是递归扫描的根目录；除各层 `AGENTS.md` 外，每份 Markdown 生成一条完整知识。
- 正文不切分，每条知识生成一个 BM25 索引和一个 1024 维向量。
- 只有新增、内容变化或向量不完整的知识会发送给阿里云生成 embedding。
- 重复导入是基于内容哈希的幂等增量更新，无变化文档直接跳过。

删除或重命名知识文件会在下次更新时同步删除数据库中的旧 sourceName。

### 6. 运行测试并构建生产页面

```bash
npm test
npm run build
```

两个命令都必须以退出码 0 完成。构建产物位于 `dist/`，不要手工编辑。

### 7. 启动生产服务

```bash
npm start
```

服务应输出：

```text
Interview Knowledge Radar server listening on http://127.0.0.1:8787
```

保持该进程运行。Agent 使用长驻终端会话启动服务时，应记录会话状态；不要用无法追踪的后台命令启动多个副本。

## 自动验收

在另一个终端运行以下脚本。它会检查健康状态、源文件/数据库数量、完整向量、知识总览和最多两条检索结果：

```bash
node --input-type=module <<'NODE'
import { readdir } from "node:fs/promises";
import { basename } from "node:path";

const baseUrl = "http://127.0.0.1:8787";
const sourceNames = (await readdir("knowledge-base", { recursive: true }))
  .filter((name) => name.endsWith(".md") && basename(name) !== "AGENTS.md");

const healthResponse = await fetch(`${baseUrl}/api/health`);
const health = await healthResponse.json();
if (!healthResponse.ok || !health.databaseReady || !health.dashScopeReady) {
  throw new Error(`Health check failed: ${JSON.stringify(health)}`);
}

const statsResponse = await fetch(`${baseUrl}/api/knowledge/stats`);
const stats = await statsResponse.json();
if (!statsResponse.ok || stats.documents <= 0) {
  throw new Error(`Knowledge stats failed: ${JSON.stringify(stats)}`);
}
if (stats.documents !== stats.chunks || stats.chunks !== stats.vectors) {
  throw new Error(`Incomplete knowledge index: ${JSON.stringify(stats)}`);
}
if (stats.documents !== sourceNames.length) {
  throw new Error(`Source/database count mismatch: sources=${sourceNames.length}, database=${stats.documents}`);
}

const catalogResponse = await fetch(`${baseUrl}/api/knowledge`);
const catalog = await catalogResponse.json();
if (!catalogResponse.ok || catalog.results?.length !== stats.documents) {
  throw new Error("Knowledge overview is incomplete");
}

const searchResponse = await fetch(`${baseUrl}/api/search`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: "How did you reduce false positive alerts in the customer complaint agent?",
    limit: 2,
  }),
});
const search = await searchResponse.json();
if (!searchResponse.ok || !Array.isArray(search.results) || search.results.length > 2) {
  throw new Error(`Knowledge search failed: ${JSON.stringify(search)}`);
}
for (const result of search.results) {
  if (!result.content || result.focusStart < 0 || result.focusEnd > result.content.length) {
    throw new Error(`Invalid complete knowledge result: ${result.sourceName}`);
  }
}

console.log(JSON.stringify({
  status: "PASS",
  health,
  stats,
  catalogCount: catalog.results.length,
  searchResults: search.results.map((result) => result.sourceName),
}, null, 2));
NODE
```

验收脚本输出 `"status": "PASS"` 才算通过。

## 浏览器验收

1. 使用最新版 Chrome 打开 `http://127.0.0.1:8787`。
2. 确认顶部“面试辅助”和“知识库总览”可以往返切换。
3. 确认知识库总览的数量与 `/api/knowledge/stats` 中 `documents` 一致。
4. 确认页面本身没有横向或纵向滚动，长知识只在各自卡片内滚动。
5. 点击右上角“监听系统音频”。
6. 用户在 Chrome 弹窗中选择屏幕、窗口或标签页，并开启“同时分享系统音频”。
7. 播放一段英文问题，确认出现英文原文、中文同传和最多两条完整知识。
8. 确认静音超过 5 秒才生成下一行，相关知识自动滚动到高亮句。

第 5～6 步需要真实用户手势和系统权限，Agent 不得绕过授权。页面不会请求麦克风。

## 开发模式

需要热更新时使用：

```bash
npm run dev
```

- 页面：`http://localhost:5173`
- API/WebSocket：Vite 代理到 `http://localhost:8787`
- 开发模式不能替代生产构建验收；交付前仍要运行 `npm run build`。

## 更新部署

1. 使用 `Ctrl+C` 正常停止现有 Node.js 服务，不停止 PostgreSQL。
2. 确认代码来源和工作区状态，避免覆盖未提交修改。
3. 依次执行：

```bash
npm ci
docker compose up -d postgres
npm run db:init
npm run db:ingest
npm test
npm run build
npm start
```

4. 重新运行自动验收和浏览器验收。

数据库 schema 和知识导入设计为幂等操作。更新过程中不要删除 named volume。

## 停止服务

- Node.js：在运行 `npm start` 的终端按 `Ctrl+C`。
- 暂停数据库但保留数据：

```bash
docker compose stop postgres
```

- 删除容器和网络但保留 named volume：

```bash
docker compose down
```

除非用户明确要求永久删除所有本地知识数据，否则禁止添加 `-v`。

## 常见故障

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| Docker 连接失败 | `docker version` | 启动 Docker Desktop 后重试 |
| PostgreSQL 未就绪 | `docker compose ps`、有限数据库日志 | 等待 healthcheck；确认 `54329` 未被其他实例占用 |
| `databaseReady=false` | `DATABASE_URL`、容器 health | 不输出连接串中的敏感改动；修正后重启服务 |
| `dashScopeReady=false` | 配置存在性检查 | 用户填写正确 Key、Workspace ID 和 region |
| `vectors < chunks` | 最近一次导入日志 | 配置阿里云后重新运行 `npm run db:ingest` |
| 源文件数与 documents 不一致 | 最近一次增量更新结果 | 在页面点击“更新知识”或运行 `npm run db:ingest` |
| `8787` 被占用 | `lsof -nP -iTCP:8787 -sTCP:LISTEN` | 复用已确认的实例或正常停止；不杀未知进程 |
| WebSocket 返回 403 | 页面 URL 和 Origin | 只从 `localhost:5173` 或 `127.0.0.1:8787` 使用 |
| 没有系统音轨 | Chrome 共享弹窗和 macOS 权限 | 勾选分享音频，允许“屏幕与系统音频录制” |
| 同传连接中断 | 阿里云地域、Workspace、网络 | 修正配置后重新开始会话 |

## 部署报告模板

Agent 完成后按以下格式交付，不包含密钥和 `.env` 内容：

```text
部署结果：成功 / 失败 / 等待用户操作
访问地址：http://127.0.0.1:8787
Node.js：版本号
Docker/PostgreSQL：运行状态
知识索引：documents/chunks/vectors
测试：通过数
生产构建：通过 / 失败
API 验收：PASS / 失败项
浏览器验收：已完成 / 等待用户授权系统音频
遗留问题：无 / 具体说明
```
