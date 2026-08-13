# TranscriptDeck 开发指南

## 职责

展示服务端已按 5 秒静音规则合并的面试官 turns，并允许用户选择历史 turn。组件不参与 ASR fragment 合并，也不触发检索。

## 展示规则

- 输入数组保持时间正序，展示时复制并 reverse，使最新问题位于顶部；不要原地修改 props。
- 行号仍按原始时间顺序计算。
- 每行使用 button，`aria-pressed` 与 `selectedSegmentId` 同步。
- 英文原文和中文翻译在同一行内展示；partial 状态使用占位文案，final 状态显示完成图标。
- 转写列表可独立纵向滚动，不能撑高页面。
- 点击只调用 `onSelect(itemId)`；对应知识切换由页面派生状态处理。

## 验证

覆盖空态、partial、final、多行滚动、最新行自动选中后的样式，以及点击旧行时正确的 `aria-pressed` 状态。

