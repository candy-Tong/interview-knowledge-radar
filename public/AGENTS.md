# Public 资源开发指南

## 目录职责

本目录存放 Vite 原样提供给浏览器的静态资源。当前核心文件 `pcm-capture.worklet.js` 在 AudioWorklet 音频线程中运行，不经过 TypeScript 编译。

## PCM Worklet 知识

- 输入采样率使用浏览器提供的全局 `sampleRate`，输出固定为 16 kHz、单声道、16-bit signed PCM。
- `outputChunkSize = 640`，即每块 40 ms 音频；服务端按会话模式把这些二进制块直接转发给实时翻译或 ASR。
- 浮点采样必须限制在 `[-1, 1]` 后再转换为 `Int16Array`。
- 通过 transferable `ArrayBuffer` 发送，避免在音频线程复制大块数据。
- `process()` 必须快速、同步并持续返回 `true`；不要访问 DOM、执行网络请求、记录高频日志或引入依赖。

## 修改约束与验证

- Worklet 注册名 `pcm-capture` 必须与 `new AudioWorkletNode(..., "pcm-capture")` 保持一致。
- 改变采样率、块大小或编码格式时，必须同步修改服务端两种实时语音会话配置并进行真实 Chrome 系统音频验证。
- 至少执行 `npm run build`；音频算法变化还要验证长时间播放时无明显堆积、爆音或内存持续增长。
