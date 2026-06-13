# CLAUDE.md — AI-Framecut 项目约定

面向「下次在本项目工作的 AI」。用户文档见 `README.md`，这里只记约定、红线与命令。

## 是什么

网页端 AI 视频「拉片」分析工具：上传视频 → 调用大模型 → 输出分镜脚本（镜号/景别·角度/运动/画面内容/画面文字/音频/时长）+ 画面风格总结 + 复刻提示词，导出 MD/CSV/JSON/SRT。
架构：**零依赖** Node `node:http` 服务（静态托管 `public/` + 作为 Gemini/Claude/OpenAI/Whisper 的 API 代理，规避浏览器 CORS）+ **纯前端 ES Module，无构建步骤**。

## 运行 / 测试

```bash
node server.js          # → http://localhost:5179（PORT=xxxx 可改）
npm test                # = node --test，零依赖单测
node --check <file>     # 改完前端文件至少过语法检查（无构建）
```

## 红线（曾经踩过的坑，别再犯）

1. **零依赖**：不引入任何第三方 npm 包，前端不引入构建工具。这是项目立身之本。
2. **API Key 只走 header**：`x-api-key` / `Authorization` / `x-goog-api-key`，**绝不**进 URL query string、请求 body 或日志（Gemini key 曾进 `?key=` 被审为 critical）。
3. **上游错误收口**：provider 出错用 `lib/http.js` 的 `upstreamError()`——完整响应只 `console.error` 到服务端，返回客户端的消息只含状态码+上游简短 message，**不要** `JSON.stringify(整个响应)`。
4. **所有外部 fetch 用 `fetchWithTimeout`**（后端）/ `send()` 带超时（前端 `api.js`）；长任务要能被 `AbortController` 取消。
5. **HTML 转义分上下文**：属性插值用 `util.js` 的 `escAttr`（含引号转义），文本用 `esc`。
6. **自定义 baseUrl 经 `resolveEndpoint`** 校验（只允许 http/https）。

## 模块边界

- `public/js/ui-state.js`：共享状态中枢（`els` / `settings` / `state`），各 UI 模块读写**同一引用**；运行时可变状态一律 `state.X`。
- `public/js/logic.js`：**纯领域逻辑，DOM 无关**——新写的可测纯逻辑放这里，并在 `test/` 加用例。不要把纯逻辑埋进 DOM 模块。
- `analysis.js` 分析编排 / `results.js` 结果展示与交互 / `history-ui.js`·`settings-ui.js`·`status.js` UI / `main.js` 仅入口装配。
- 依赖图须**无环**（results 不反向 import analysis/history-ui/settings-ui/status）。
- `lib/`：`prompt.js` 提示词、`json.js` 解析归一化、`providers/*` 各家、`http.js` 网络与错误、`static.js` 静态服务。

## 不变量 / 易错点

- `computeShotTimes`（util.js）保证**单调不减**且缺时长也前进——seek/SRT/时长都依赖它，改动后跑 `test/core.test.mjs`。
- 缩略图渐进填充带 `viewGen` + `currentFile` 双重 stale 守卫，换视频/重分析时作废在途填充——别破坏。
- 真机端到端（实调模型、浏览器解码具体视频）无 Key/无 DOM 环境测不了；可测的用 `npm test`（32 用例）守护，改完务必跑。

## 提交规范

- 用户要求时才提交/推送；GitHub 用 SSH（`git@github.com:beforeugone520/AI-framecut.git`，本机已配 key，`gh` 未装）。
- commit message 结尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 工作风格

用户偏好**持续迭代、但每步保持简单低风险**：增量小步、范围克制、优先低风险高价值，复杂/重构类先讲权衡；验证手段与改动规模匹配，别动辄上重型流程。
