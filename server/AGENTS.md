# Server 开发指南

## 目录职责

Node 服务同时提供 REST API、生产静态文件和 `/api/realtime` WebSocket 升级入口。配置、数据库、检索和实时代理分别下沉到相邻模块。

## API 契约

- `GET /api/health`：数据库和阿里云配置就绪状态，不返回密钥。
- `GET /api/knowledge/stats`：文档、完整条目和向量数量。
- `GET /api/knowledge`：总览使用的全部完整知识。
- `POST /api/knowledge/refresh`：递归扫描知识根目录，按内容哈希增量更新并返回统计。
- `POST /api/search`：接收英文 `query`，`limit` 必须在 1 到 2 之间。
- `WS /api/realtime?mode=translation|transcription`：模式在握手时确定，二进制消息为 PCM；文本控制消息当前只有 `session.finish`。

新增或修改接口时，同步更新前端 `types.ts`、调用方、错误状态和根目录开发文档。

## 服务端规范

- 使用 strict TypeScript、ESM 和带 `.js` 后缀的相对导入。
- 环境变量统一由 `config.ts` 的 Zod schema 解析；不要在业务模块重复读取和拼装敏感配置。
- HTTP 输入先校验再进入数据库或云端调用；客户端错误返回 4xx，依赖不可用返回 503。
- 对外错误信息要可操作，但不得包含 API Key、Authorization header 或数据库凭据。
- API Key 只用于服务端到阿里云的请求；禁止加入 REST 响应和浏览器事件。
- 保留 SIGINT/SIGTERM 的资源关闭流程，新增长连接或资源池时纳入 `shutdown()`。
- 生产静态服务只读取 `dist/`；不要手工编辑构建产物。

## 安全边界

- 默认 `HOST` 是 `127.0.0.1`。
- WebSocket 只接受 `/api/realtime`，并校验 `localhost`、`127.0.0.1`、`[::1]` 以及已知端口。
- SQL 使用参数化值；不要把查询文本、文件名或用户输入直接拼入 SQL。

## 验证

```bash
npm test
npm run build
curl http://localhost:8787/api/health
curl http://localhost:8787/api/knowledge/stats
```

接口变更还应验证成功、输入错误和依赖失败三条路径。
