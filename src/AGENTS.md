# Frontend 开发指南

## 目录职责

`src/` 是 React 19 浏览器应用。`main.tsx` 只负责挂载根页面；页面实现和私有能力归入 `pages/`。

## 前端规范

- 使用函数组件、React hooks、strict TypeScript 和具名导出。
- 组件名和导出类型用 `PascalCase`，state、变量和事件处理函数用 `camelCase`/`handleXxx`。
- 有限稳定状态优先使用 enum；跨文件公共契约放在最近页面的 `types.ts`。
- 页面负责组装，组件负责自身展示闭环，hooks 负责浏览器资源与状态生命周期。
- 不引入全局 store 处理单页局部状态；先使用 props 和局部 state。
- 不把服务端密钥、数据库连接或云端 URL 暴露到前端环境变量。
- fetch/WebSocket 统一使用同源 `/api`，开发期由 Vite 代理到 `8787`。

## 布局与可访问性

- 根节点保持 `100vw × 100dvh` 且 `overflow: hidden`；需要滚动的内容必须有明确的内部滚动容器。
- 延续浅色马卡龙色板、紧凑顶部和三栏内容优先策略，不引入黑色背景。
- 中英知识正文使用相同字号和字重；当前标准为 `14px/500`，窄屏 `13px`。
- 可点击的历史转写使用 button；Tab 使用 `role=tablist/tab/tabpanel` 与 `aria-selected`。
- 异步状态提供加载、空、错误状态，实时文本区使用适当的 `aria-live`。

## 验证

```bash
npm run build
```

视觉变更还要在 Chrome 中验证页面无全局滚动、内部滚动可用、Tab 可切换、不同窗口宽度不遮挡控制区。

