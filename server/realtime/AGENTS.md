# Realtime 同传开发指南

## 协议职责

`translation-proxy.ts` 在浏览器二进制 PCM 与阿里云实时事件之间做适配，并把上游事件归一化为前端可消费的小协议。

浏览器事件包括：

- `session.ready`、`session.finished`、`session.error`、`session.disconnected`
- `speech.started`、`speech.stopped`
- `source.partial`、`source.final`
- `translation.partial`、`translation.final`
- `knowledge.results`、`knowledge.error`

## Turn 合并规则

- 同一轮中的多个 ASR item 合并到一个 `turn_*` itemId。
- 每次新语音开始都取消待执行的 flush；静音持续超过默认 5 秒才 `flushTurn()`。
- 一轮只发布一次 `source.final`，并只用合并后的完整英文触发一次检索。
- 翻译 item 通过 `previous_item_id` 映射回 source item，再映射到逻辑 turn。
- 会话结束时先 flush 当前轮并等待所有 `pendingRetrievals` settled，再通知前端结束。

修改上述状态机时必须保留这些性质，避免一个问题产生多行或多次搜索。

## 资源与安全

- 上游未 ready 前最多缓存 250 个音频块，超过上限丢弃最旧数据，禁止无限增长。
- 浏览器断开时取消 timer 并关闭上游；上游异常要向浏览器发送明确错误。
- API Key 只放在上游 WebSocket Authorization header。
- Upgrade 只允许 `/api/realtime` 和本地可信 Origin；无 Origin 用于本地非浏览器测试。
- 术语翻译短语集中在 `createSessionUpdate()`，新增术语时保持英文原词和中文业务叫法准确。

## 测试

- 测试使用本地 mock WebSocket 上游和注入的 search，不调用真实阿里云。
- 缩短 `turnGapMs` 只用于测试；生产默认仍为 5 秒。
- 至少断言相邻 ASR 片段合并、检索只调用一次、limit 为 2、结束前等待检索完成以及 Origin 拒绝逻辑。

```bash
npm test -- server/realtime/translation-proxy.test.ts
```

