# Scripts 开发指南

## 目录职责

这里放置从仓库根目录显式运行的运维入口，包括一次性数据库脚本和本地模型启动器。

- `init-db.ts`：读取 `server/database/schema.sql` 并应用幂等数据库结构。
- `ingest-knowledge.ts`：调用服务端共享的增量更新逻辑，递归同步 `knowledge-base/` 中的知识文档。
- `start-question-model.sh`：以 loopback-only 方式启动 llama.cpp 和 Qwen3.5-2B Q4_K_M，首次运行自动下载模型。

## 开发规范

- 脚本必须可从仓库根目录通过 `npm run ...` 执行；路径基于 `process.cwd()` 或 `import.meta.url` 明确解析。
- 本地模型只监听 `127.0.0.1`，CORS 限制为 localhost，关闭 Web UI，并使用 `--no-mmproj` 避免为纯文本拆题下载不需要的视觉投影。
- 所有数据库客户端在成功和失败路径都要关闭；事务必须在 `catch` 中回滚并在 `finally` 中释放连接。
- 导入必须幂等且增量：内容哈希未变且索引完整时禁止调用 embedding；变更文档的旧索引必须在事务内重建。
- 嵌套文档的相对路径是稳定 `sourceName`；删除或重命名文件时同步删除已失效的数据库条目。
- 保持 `chunk_index = 0` 且每份文件只插入一个 `knowledge_chunks` 记录；“chunk”是遗留表名，不代表允许切分。
- `--bm25-only` 只用于未配置阿里云时的局部验证；正常导入必须生成 1024 维向量。
- 不打印密钥、连接串或整篇知识正文；日志只报告文件名、条目数和可操作错误。

## 修改后验证

```bash
npm run db:init
npm run db:ingest
curl http://localhost:8787/api/knowledge/stats
```

重复运行导入后，文档数和完整条目数应与有效 Markdown 文件数一致，不应持续增长。
