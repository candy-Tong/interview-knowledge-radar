# ControlDock 开发指南

## 职责

本组件只呈现会话状态和三个显式动作：开始监听、结束、清空。音频权限、WebSocket 和清理逻辑属于 `useInterviewSession()`。

## 约束

- `SessionPhase` 到文案的映射集中在 `phaseLabelMap`，新增 phase 时必须补齐映射。
- Idle/Error 状态显示开始按钮；其他状态视为 active 并显示结束按钮。
- `canStart=false` 时开始按钮禁用，且页面提供具体 readiness 原因。
- 开始和结束回调返回 Promise，点击时使用 `void` 明确忽略 JSX handler 返回值。
- 不在组件中请求系统音频权限，不自行创建 timer 或 WebSocket。
- 控制区位于右上角，保持紧凑，不能挤压主要三栏内容。

## 验证

覆盖 Idle、Connecting、Listening、HearingSpeech、Finishing、Error 六种视觉状态，以及禁用、开始、结束和清空动作。

