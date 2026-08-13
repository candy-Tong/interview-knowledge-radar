# Interview Console 组件指南

## 组件边界

- `ControlDock`：嵌入转写卡片标题区，显示模式、会话状态并发出 start/stop/clear 用户动作。
- `TranscriptDeck`：拥有转写卡片布局和控制区 slot，展示可选择的逻辑 turn 列表。
- `KnowledgeRadar`：展示所选 turn 的最多两条检索知识并自动定位相关句。
- `KnowledgeOverview`：自行读取并展示全部完整知识。

## 开发规范

- 组件 Props 保持最小，只传父组件真正拥有的状态或 UI 控制动作。
- 能在内容组件内部完成的数据加载、空态和错误态不要提升到页面。
- 组件私有 helper 留在组件目录；出现真正的子组件时创建本组件的 `components/` 子目录。
- 每个组件的视觉细节留在同目录样式文件；页面样式只管理整体网格和共享 token。
- 所有交互元素使用语义化 button/nav/section，并保留键盘和 ARIA 状态。
- 长正文不得通过截断替代滚动；标题允许单行省略，正文必须完整保留。

## CSS 约束

- 所有 grid/flex 子项显式考虑 `min-width: 0` 和 `min-height: 0`，否则内部滚动会撑破单屏。
- 滚动区使用 `overscroll-behavior: contain`，避免滚动传递到页面。
- 复用根级 `--paper`、`--ink`、`--acid`、`--amber`、`--lavender`、`--rule` 等变量。
