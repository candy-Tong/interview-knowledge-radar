# Realtime 语音开发指南

## 协议职责

`translation-proxy.ts` 在浏览器二进制 PCM 与阿里云实时翻译/ASR 事件之间做适配，并把两种上游归一化为前端可消费的小协议。

- `mode=translation` 连接 `DASHSCOPE_TRANSLATION_MODEL`，会话包含英文 ASR 和中文翻译配置。
- `mode=transcription` 连接 `DASHSCOPE_ASR_MODEL`，会话只包含 PCM、服务端 VAD 和原始识别，禁止出现 `translation` 配置。
- 缺省模式为 translation 以兼容旧客户端；未知 mode 在 Upgrade 阶段拒绝。

浏览器事件包括：

- `session.ready`、`session.finished`、`session.error`、`session.disconnected`
- `speech.started`、`speech.stopped`
- `source.partial`、`source.final`
- `translation.partial`、`translation.final`
- `questions.updated`：同一 turn 内的问题列表，每项带稳定 `questionId` 和 `isFinal`
- `question.knowledge.results`、`question.knowledge.error`：问题级召回结果
- `knowledge.results`、`knowledge.error`：暂保留的兼容事件，新前端不依赖

## Turn 合并规则

- 同一轮中的多个 ASR item 合并到一个 `turn_*` itemId。
- 每次新语音开始都取消待执行的 flush；静音持续超过默认 5 秒才 `flushTurn()`。
- 一轮只发布一次 `source.final`；`source.partial` 达到可检索长度后，最多每 800ms 通过本地模型刷新拆题。
- 草稿拆题中，已稳定的前缀问题不随后续 ASR 反复改写，只允许最后一题增长；最终 turn 可做完整校正。
- 说话中每个问题只调用本地 BM25；5 秒 flush 后每个最终问题调用混合检索。不等待翻译事件。
- 拆题和问题检索各自使用版本号抑制过期响应；相同问题在同一检索阶段必须去重。
- 翻译 item 通过 `previous_item_id` 映射回 source item，再映射到逻辑 turn。
- 会话结束时先 flush 当前轮，等待所有拆题和检索 settled，再通知前端结束。
- 每个会话生成独立 `sessionId`；partial、完整 ASR 片段、翻译片段、最终 turn、检索 query、命中知识与错误都写入运行日志。
- 检索完成日志包含 rank、知识 id/sourceName/heading、BM25/vector/hybrid 分数、相关句偏移和相关文本，不重复写入完整知识正文。

修改上述状态机时必须保留这些性质，避免一个问题产生多行、重复查询或无节制搜索。

## 资源与安全

- 上游未 ready 前最多缓存 250 个音频块，超过上限丢弃最旧数据，禁止无限增长。
- 浏览器断开时取消 timer 并关闭上游；上游异常要向浏览器发送明确错误。
- 正常结束时等待当前检索和日志写入完成；日志失败只能输出不含敏感值的错误摘要，不能打断实时会话。
- API Key 只放在上游 WebSocket Authorization header。
- Upgrade 只允许 `/api/realtime` 和本地可信 Origin；无 Origin 用于本地非浏览器测试。
- 两种会话配置集中在 `createSessionUpdate(mode)`；新增术语时保持英文原词和中文业务叫法准确，且不要把翻译配置带入普通模式。

## 测试

- 测试使用本地 mock WebSocket 上游以及注入的 splitter/draftSearch/search，不调用真实阿里云或本地模型。
- 缩短 `turnGapMs` 或 `progressiveSearchIntervalMs` 只用于测试；生产默认分别为 5 秒和 800ms。
- 至少断言模式对应的会话配置、复合 turn 拆成多问题、每题独立召回、草稿 BM25/最终 hybrid 分层、过期结果被抑制、limit 为 2、结束前等待拆题/检索/日志完成以及 Origin 拒绝逻辑。

```bash
npm test -- server/realtime/translation-proxy.test.ts
```
