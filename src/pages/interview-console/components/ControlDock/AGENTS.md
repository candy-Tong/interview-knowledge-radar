# ControlDock 开发指南

## 职责

本组件只呈现模式选择、会话状态和开始监听、结束、清空动作。音频权限、WebSocket 和清理逻辑属于 `useInterviewSession()`。

## 约束

- `SessionPhase` 到文案的映射集中在 `phaseLabelMap`，新增 phase 时必须补齐映射。
- Idle/Error 状态显示开始按钮；其他状态视为 active 并显示结束按钮。
- `canStart=false` 时开始按钮禁用，且页面提供具体 readiness 原因。
- 开始和结束回调返回 Promise，点击时使用 `void` 明确忽略 JSX handler 返回值。
- 不在组件中请求系统音频权限，不自行创建 timer 或 WebSocket。
- 控制区通过 `display: contents` 参与 `TranscriptDeck` 标题网格：模式切换位于标题右侧，下一行状态靠左、清空与监听动作靠右；不渲染独立悬浮外壳。
- 可见文案保持短小，使用“翻译/普通”“监听/结束”等；完整调用语义保留在 `title` 和 `aria-label`。
- 窄卡片使用容器查询收起按钮文字，但必须保留明确的 `aria-label`。
- “翻译/普通”按钮必须通过 tooltip 和无障碍名称表达真实调用语义；活跃会话期间禁用，不能在组件内伪切换上游。

## 验证

覆盖 Idle、Connecting、Listening、HearingSpeech、Finishing、Error 六种视觉状态，以及禁用、开始、结束和清空动作。
