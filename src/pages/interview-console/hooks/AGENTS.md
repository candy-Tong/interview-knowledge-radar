# Interview Console Hooks 开发指南

## `system-audio.ts`

- 只调用 `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`；video 是浏览器共享授权的一部分，但业务只消费音轨。
- 没有音轨时立即停止所有 track 并报错，绝不回退到 `getUserMedia` 或麦克风。
- AudioContext 固定请求 16 kHz，Worklet 名称必须与 public 资源一致。
- 静音 gain 只用于保持音频图运行，不能把共享声音再次播放到扬声器。
- `stop()` 必须移除监听、断开节点、停止所有 track 并关闭 AudioContext。

## `use-interview-session.ts`

- 该 hook 是浏览器会话状态的唯一所有者：phase、segments、音频资源、WebSocket 和发送前音频队列。
- mode 只在 Idle/Error 切换，并通过 `/api/realtime?mode=...` 固定服务端上游；普通模式不能连接翻译模型。
- 新建 segment 时保存当前 mode，保证混合历史中普通行不出现翻译占位。
- `updateSegment()` 按 itemId 原位更新或追加，保持 turn 到达顺序。
- WebSocket 打开前最多缓存 100 个 PCM 块；连接后按序发送并清空。
- 服务端负责 5 秒 turn 合并，前端不要再按 partial/final 创建额外搜索行。
- 同一 `itemId` 会在说话过程中收到多次 `knowledge.results`；始终原位覆盖当前行结果，成功刷新时清除旧检索错误。
- stop 先停止本地采集，再发送 `session.finish` 给服务端等待最后一轮；5 秒后仅作为关闭兜底。
- component unmount 时关闭 socket 和 capture，避免屏幕共享指示器残留。
- `stopRef` 用于让 track ended 回调获得最新 stop 实现；修改时注意闭包陈旧问题。

## 验证

- 单元层验证事件到 segment 的归并；浏览器层验证授权取消、无音轨、主动结束、用户停止共享、连接断开和组件卸载。
- 真实权限必须由用户点击触发，不要在 effect 中自动请求共享。
