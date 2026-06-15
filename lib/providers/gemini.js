// Gemini 原生视频分析：把整段视频上传到 Files API，再让模型对视频（含音频）做拉片分析。
// 依赖 Node 18+ 内置 fetch。

import { buildAnalysisPrompt } from '../prompt.js';
import { extractJson, normalizeResult } from '../json.js';
import { fetchWithTimeout, upstreamError } from '../http.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

// videoBuffer: Buffer/Uint8Array 原始视频字节
export async function analyzeWithGemini({ apiKey, model, baseUrl, videoBuffer, mimeType, filename, focus, meta }) {
  if (!apiKey) throw new Error('缺少 Gemini API Key');
  const mdl = normalizeGeminiModel(model || 'gemini-2.5-flash');
  const base = resolveGeminiBase(baseUrl);

  // 1) 上传文件（可续传协议）
  const fileUri = await uploadFile({ apiKey, baseUrl: base, videoBuffer, mimeType, filename });

  // 2) 轮询直到文件状态 ACTIVE
  await waitActive({ apiKey, baseUrl: base, fileName: fileUri.name });

  // 3) 调用 generateContent
  const prompt = buildAnalysisPrompt({ mode: 'video', meta, focus });
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { file_data: { mime_type: mimeType, file_uri: fileUri.uri } },
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 32768,
      responseMimeType: 'application/json'
    }
  };

  const url = `${base}/v1beta/models/${encodeURIComponent(mdl)}:generateContent`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  }, 300000);

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw upstreamError('Gemini 分析失败', res.status, json);
  }

  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n');
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason;
    throw new Error(`Gemini 未返回有效内容${reason ? `（${reason}）` : ''}`);
  }

  const parsed = extractJson(text);
  return normalizeResult(parsed, meta);
}

export async function uploadFile({ apiKey, baseUrl, videoBuffer, mimeType, filename }) {
  const base = resolveGeminiBase(baseUrl);
  const numBytes = videoBuffer.byteLength ?? videoBuffer.length;

  // start：发起可续传上传，拿到上传地址
  const startRes = await fetchWithTimeout(`${base}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(numBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: filename || 'upload' } })
  }, 60000);
  if (!startRes.ok) {
    const t = await startRes.text().catch(() => '');
    throw upstreamError('Gemini 文件上传初始化失败', startRes.status, null, t);
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini 未返回上传地址');

  // upload + finalize：上传字节
  const upRes = await fetchWithTimeout(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(numBytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: videoBuffer
  }, 300000);
  const upJson = await upRes.json().catch(() => null);
  if (!upRes.ok || !upJson?.file) {
    throw upstreamError('Gemini 文件上传失败', upRes.status, upJson);
  }
  return upJson.file; // { name, uri, state, ... }
}

export async function waitActive({ apiKey, baseUrl, fileName, timeoutMs = 120000 }) {
  const base = resolveGeminiBase(baseUrl);
  const deadline = Date.now() + timeoutMs;
  let state = 'PROCESSING';
  while (Date.now() < deadline) {
    let json = null;
    try {
      const res = await fetchWithTimeout(`${base}/v1beta/${fileName}`, { headers: { 'x-goog-api-key': apiKey } }, 20000);
      json = await res.json().catch(() => null);
    } catch {
      // 单次轮询超时/网络抖动视为瞬时，继续轮询直到整体 deadline
    }
    state = json?.state || state;
    if (state === 'ACTIVE') return;
    if (state === 'FAILED') throw new Error('Gemini 视频处理失败（FAILED）');
    await sleep(2000);
  }
  throw new Error('Gemini 视频处理超时，请重试或换用更短的视频');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function normalizeGeminiModel(model) {
  const raw = String(model || '').trim();
  const compact = raw.toLowerCase().replace(/[\s_.]/g, '-');
  const aliases = {
    gemini31: 'gemini-3.1-pro-preview',
    'gemini3-1': 'gemini-3.1-pro-preview',
    'gemini-31': 'gemini-3.1-pro-preview',
    'gemini-3-1': 'gemini-3.1-pro-preview',
    'gemini-3.1': 'gemini-3.1-pro-preview',
    'gemini-3.1-pro': 'gemini-3.1-pro-preview',
    'gemini-3-1-pro': 'gemini-3.1-pro-preview',
    'gemini-3.1-preview': 'gemini-3.1-pro-preview',
    'gemini-3-1-preview': 'gemini-3.1-pro-preview'
  };
  return aliases[compact] || raw;
}

export function resolveGeminiBase(baseUrl) {
  const raw = String(baseUrl || GEMINI_BASE).trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('自定义 Gemini API Base URL 不合法');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Gemini API Base URL 仅支持 http/https 协议');
  }
  const normalized = raw
    .replace(/\/$/, '')
    .replace(/\/upload\/v1beta$/, '')
    .replace(/\/v1beta$/, '');
  return normalized;
}
