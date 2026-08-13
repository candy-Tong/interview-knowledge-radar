# Interview Knowledge Radar 开发指南

## 适用范围与继承

- 本文件适用于整个仓库；进入子目录后，继续遵守该目录更具体的 `AGENTS.md`。
- `node_modules/`、`dist/`、数据库卷和其他生成产物不接受手工修改，也不需要补充 `AGENTS.md`。
- 修改架构、数据契约、部署方式或关键产品约束时，同步更新最接近该实现的 `AGENTS.md`、`README.md` 和 `DEPLOYMENT.md`。

## 产品目标

这是一个本地优先的实时面试辅助工具：浏览器采集用户主动共享的系统音频，Node 服务代理阿里云实时英文识别/中文翻译，并用 PostgreSQL 中的 BM25 与 pgvector 混合检索本地面试知识。

必须保持以下产品约束：

- 只使用 `getDisplayMedia` 获取用户明确共享的电脑音频，不请求麦克风，也不在失败时回退到麦克风。
- 阿里云 API Key 和 Workspace ID 只留在服务端，不进入前端包、浏览器日志或接口响应。
- `knowledge-base/` 是递归扫描的知识根目录；一份知识源 Markdown 对应一条完整知识，各层 `AGENTS.md` 不参与入库。
- 一次检索最多返回两条知识；中栏和右栏各展示一条完整知识。
- 连续语音只有静音超过 5 秒才形成新的面试官行，并且每行只触发一次知识检索。
- 面试页保持单屏三栏；页面本身不横向或纵向滚动，转写区和知识正文区可独立纵向滚动。
- 点击历史面试官语句时，切换到该行绑定的两条知识。
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
- 音频会发送给阿里云同传；完整知识和查询会用于阿里云向量生成。变更数据流时同步更新隐私说明。

## 验证要求

提交改动前至少执行：

```bash
npm test
npm run build
```

按改动范围增加验证：

- 数据库/schema：`npm run db:init`，必要时在测试库重复执行确认幂等。
- 知识导入/检索：`npm run db:ingest`，再检查 `/api/knowledge/stats`、`/api/knowledge` 和 `/api/search`。
- 实时协议：运行 `server/realtime/translation-proxy.test.ts`，确认相邻 ASR 片段只产生一行和一次检索。
- 前端布局：在 Chrome 中确认页面 `scrollWidth/scrollHeight` 不超过视口，内部滚动区仍可滚动。
- 音频链路：必须由真实用户手势触发共享权限；不要用自动化绕过浏览器授权。
