# TranscriptDeck 开发指南

## 职责

展示服务端已按 5 秒静音规则合并的面试官 turns，并允许用户选择历史 turn。组件不参与 ASR fragment 合并，也不触发检索。

组件同时拥有卡片标题区网格；页面通过 `controls` slot 注入模式和监听控制，控件以 `display: contents` 分别进入标题右侧和第二行，避免转写组件接管会话状态。

## 展示规则

- 输入数组保持时间正序，展示时复制并 reverse，使最新问题位于顶部；不要原地修改 props。
- 行号仍按原始时间顺序计算。
- 每行使用可聚焦的 `role="button"` 容器，`aria-pressed` 与 `selectedSegmentId` 同步；使用 Enter/Space 时调用 `onSelect`。
- 翻译模式的英文原文和中文翻译在同一行内展示；普通模式只显示原始 ASR 文本，不渲染翻译占位。
- 原文和中文翻译必须允许鼠标选择，用户可直接使用系统快捷键复制；不要改回阻止文本选择的原生 button，也不需要增加复制按钮。
- 历史行按 `segment.mode` 决定展示结构；面板空态按当前 mode 提示即将调用的能力。
- 转写列表可独立纵向滚动，不能撑高页面。
- 点击只调用 `onSelect(itemId)`；对应知识切换由页面派生状态处理。

## 验证

覆盖空态、partial、final、多行滚动、最新行自动选中后的样式、鼠标选择翻译文本，以及点击或按 Enter/Space 选择旧行时正确的 `aria-pressed` 状态。
