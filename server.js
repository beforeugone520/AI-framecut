// AI-Framecut 本地服务：静态托管前端 + 作为大模型 API 的代理（规避浏览器 CORS、不在服务端存密钥）。
// 运行：node server.js  然后浏览器打开 http://localhost:5179
// 零第三方依赖，依赖 Node 18+ 内置 fetch。

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { serveStatic } from './lib/static.js';
import { analyzeWithGemini } from './lib/providers/gemini.js';
import { analyzeWithClaude } from './lib/providers/claude.js';
import { analyzeWithOpenAI } from './lib/providers/openai.js';
import { transcribe } from './lib/providers/transcribe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 5179;

const MAX_VIDEO_BYTES = 600 * 1024 * 1024; // 600MB（Gemini 原生视频上传）
const MAX_JSON_BYTES = 200 * 1024 * 1024; // 200MB（抽帧 base64）

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'POST' && pathname === '/api/gemini/analyze') {
      return await handleGemini(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/frames/analyze') {
      return await handleFrames(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/transcribe') {
      return await handleTranscribe(req, res);
    }
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      const served = await serveStatic(req, res, PUBLIC_DIR);
      if (served) return;
    }

    sendJson(res, 404, { error: '未找到资源' });
  } catch (err) {
    console.error('[error]', err);
    if (!res.headersSent) sendJson(res, 500, { error: String(err?.message || err) });
    else res.end();
  }
});

async function handleGemini(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const apiKey = req.headers['x-api-key'];
  const model = q.get('model') || 'gemini-2.5-flash';
  const mimeType = q.get('mime') || 'video/mp4';
  const filename = q.get('filename') || 'upload.mp4';
  const focus = q.get('focus') || '';
  const meta = {
    duration: numOrUndef(q.get('duration')),
    width: numOrUndef(q.get('width')),
    height: numOrUndef(q.get('height')),
    filename
  };

  const videoBuffer = await readRawBody(req, MAX_VIDEO_BYTES);
  if (!videoBuffer.length) return sendJson(res, 400, { error: '未收到视频数据' });

  const result = await analyzeWithGemini({ apiKey, model, videoBuffer, mimeType, filename, focus, meta });
  sendJson(res, 200, result);
}

async function handleFrames(req, res) {
  const raw = await readRawBody(req, MAX_JSON_BYTES);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendJson(res, 400, { error: '请求体不是合法 JSON' });
  }

  const apiKey = req.headers['x-api-key']; // Key 只走 header，不入 body
  const { provider, model, baseUrl, frames, focus, meta, transcript } = payload;
  if (!Array.isArray(frames) || frames.length === 0) {
    return sendJson(res, 400, { error: '缺少抽帧数据' });
  }

  let result;
  if (provider === 'claude') {
    result = await analyzeWithClaude({ apiKey, model, frames, focus, meta, transcript });
  } else if (provider === 'openai') {
    result = await analyzeWithOpenAI({ apiKey, model, frames, focus, meta, baseUrl, transcript });
  } else {
    return sendJson(res, 400, { error: `不支持的 provider: ${provider}` });
  }
  sendJson(res, 200, result);
}

// 音频转写：raw WAV body + query(engine/model/baseUrl) + header x-api-key
async function handleTranscribe(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const apiKey = req.headers['x-api-key'];
  const engine = q.get('engine') || 'openai';
  const model = q.get('model') || '';
  const baseUrl = q.get('baseUrl') || '';

  const wavBuffer = await readRawBody(req, MAX_VIDEO_BYTES);
  if (!wavBuffer.length) return sendJson(res, 400, { error: '未收到音频数据' });

  const result = await transcribe({ engine, apiKey, model, baseUrl, wavBuffer });
  sendJson(res, 200, result);
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error(`请求体过大（超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制）`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function numOrUndef(v) {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// 慢速客户端保护：请求头 60s，整体请求 15 分钟（容纳大视频本地上传），keep-alive 65s
server.headersTimeout = 60 * 1000;
server.requestTimeout = 15 * 60 * 1000;
server.keepAliveTimeout = 65 * 1000;

server.listen(PORT, () => {
  console.log(`\n  🎬 AI-Framecut 已启动`);
  console.log(`  ➜  本地访问: http://localhost:${PORT}\n`);
});
