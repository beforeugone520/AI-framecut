# 🎬 AI Framecut · 网页端 AI 视频拉片分析

上传视频 → 调用大模型 API → 以**专业视频分析专家**视角做**深度拉片**，自动生成**分镜镜头脚本**并总结**画面风格**，让你能精准复刻同款视频。

分镜脚本固定包含以下列：

| 镜号 | 景别/角度 | 运动 | 画面内容 | 音频 | 时长(秒) |
| :---: | --- | --- | --- | --- | :---: |

并额外输出画面风格总结：整体风格、色调/调色、光线、构图、镜头语言、剪辑/转场、氛围、音频设计、整体节奏、以及**可执行的复刻要点**。

---

## 快速开始

无需安装任何依赖（零第三方库），只要有 **Node.js ≥ 18**：

```bash
node server.js
```

然后浏览器打开 **http://localhost:5179**

> 修改端口：`PORT=8080 node server.js`

## 使用步骤

1. **选择分析引擎并填入 API Key**（密钥仅存于本机浏览器 localStorage，请求经本地服务转发，服务端不落盘、不存储）。
2. **拖入或点击上传**一段视频。
3. 点击 **「开始拉片分析」**，等待结果。
4. 用右上角按钮**导出** Markdown / CSV / JSON。

## 三种分析引擎

| 引擎 | 模式 | 说明 | 拿 Key |
| --- | --- | --- | --- |
| **Google Gemini**（推荐） | 原生视频 | 整段视频上传，**同时分析画面与音频**，时间轴最准，最贴合「拉片」 | <https://aistudio.google.com/app/apikey> |
| **Anthropic Claude** | 抽帧 | 浏览器按时间戳抽取关键帧做视觉分析；音频由画面线索推断 | <https://console.anthropic.com/settings/keys> |
| **OpenAI GPT** | 抽帧 | 同上，支持自定义 Base URL（兼容第三方网关） | <https://platform.openai.com/api-keys> |

> 「音频」列：仅 **Gemini** 能真正听到声音；Claude / OpenAI 抽帧模式下音频由画面（字幕、口型、场景）推断。要最完整的音频拉片，优先用 Gemini。

默认模型可在界面里随时改成你账号可用的模型 ID：
`gemini-2.5-flash`（默认，可换 `gemini-2.5-pro` 获得更深入分析）、`claude-sonnet-4-6`、`gpt-4o`。

## 项目结构

```
ai-framecut/
├─ server.js              本地 HTTP 服务：静态托管 + 大模型 API 代理（规避 CORS）
├─ lib/
│  ├─ static.js           静态文件服务
│  ├─ prompt.js           专家级「拉片」提示词 + JSON 输出规范
│  ├─ json.js             模型输出的稳健 JSON 解析与字段归一化
│  └─ providers/
│     ├─ gemini.js        Gemini 原生视频分析（Files API 上传）
│     ├─ claude.js        Claude 抽帧分析
│     └─ openai.js        OpenAI 抽帧分析
└─ public/
   ├─ index.html
   ├─ css/style.css
   └─ js/                 main / store / extract / api / render / exporters / util
```

## 隐私与安全

- API Key 只保存在你浏览器的 localStorage，**不写入服务端**。
- 视频在本地浏览器读取；Gemini 模式下视频字节经本地服务转发上传到 Google（用于分析），其余模式仅上传抽取的关键帧。
- 本地服务不持久化任何视频或密钥。

## 常见问题

- **Gemini 一直「处理中」/ 超时**：超长或超大视频处理较慢，建议先用较短片段；或确认网络可访问 `generativelanguage.googleapis.com`。
- **模型报错 model not found**：把界面「模型」改成你账号实际可用的 ID。
- **抽帧模式时长不准**：抽帧只能估算镜头时长，要精确时间轴请用 Gemini 原生视频模式。
