# Database 开发指南

## 数据模型

- `knowledge_documents`：知识源文件的名称、标题、原文 hash 和更新时间。
- `knowledge_chunks`：可检索的完整知识正文、token 数和 1024 维向量。
- `knowledge_chunk_terms`：BM25 使用的标准化词项及词频。
- 当前业务固定为一个 document 对应一个 `chunk_index = 0` 的 chunk；禁止因为表名而恢复正文切分。

## Schema 规范

- `schema.sql` 必须可重复执行；新增对象使用 `IF NOT EXISTS` 或提供明确的兼容迁移策略。
- 不在常规功能开发中删除表、数据卷或用户知识。需要破坏性迁移时先说明备份和恢复路径。
- pgvector 维度固定为 1024，必须与 `text-embedding-v4` 请求的 `dimensions` 一致。
- 保留 term 普通索引和 embedding HNSW 索引；调整索引前用真实数据验证查询计划与写入成本。
- 外键删除使用 `ON DELETE CASCADE`，导入脚本依赖它清理旧索引。

## 查询与连接

- 复用 `databasePool`，不要为每个请求新建 Pool。
- 多步写入使用事务；只读 API 使用直接参数化查询。
- 测试或脚本结束时关闭 Pool，长驻服务只在 shutdown 时关闭。

## 验证

- 在测试数据库至少连续运行两次 `npm run db:init`。
- 导入后确认 documents、chunks 和 vectors 的数量关系；正常模式应满足 `vectors === chunks`。
- 结构变更后运行检索和知识总览接口，避免只验证建表成功。

