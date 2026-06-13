// Gemini 原生视频分析：把整段视频上传到 Files API，再让模型对视频（含音频）做拉片分析。
// 依赖 Node 18+ 内置 fetch。

import { buildAnalysisPrompt } from '../prompt.js';
import { extractJson, normalizeResult } from '../json.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const BASE = GEMINI_BASE;

// videoBuffer: Buffer/Uint8Array 原始视频字节
export async function analyzeWithGemini({ apiKey, model, videoBuffer, mimeType, filename, focus, meta }) {
  if (!apiKey) throw new Error('缺少 Gemini API Key');
  const mdl = model || 'gemini-2.5-flash';

  // 1) 上传文件（可续传协议）
  const fileUri = await uploadFile({ apiKey, videoBuffer, mimeType, filename });

  // 2) 轮询直到文件状态 ACTIVE
  await waitActive({ apiKey, fileName: fileUri.name });

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

  const url = `${BASE}/v1beta/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Gemini 分析失败 (${res.status}): ${msgFrom(json)}`);
  }

  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n');
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason;
    throw new Error(`Gemini 未返回有效内容${reason ? `（${reason}）` : ''}`);
  }

  const parsed = extractJson(text);
  return normalizeResult(parsed, meta);
}

export async function uploadFile({ apiKey, videoBuffer, mimeType, filename }) {
  const numBytes = videoBuffer.byteLength ?? videoBuffer.length;

  // start：发起可续传上传，拿到上传地址
  const startRes = await fetch(`${BASE}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(numBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: filename || 'upload' } })
  });
  if (!startRes.ok) {
    const t = await startRes.text().catch(() => '');
    throw new Error(`Gemini 文件上传初始化失败 (${startRes.status}): ${t.slice(0, 300)}`);
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini 未返回上传地址');

  // upload + finalize：上传字节
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(numBytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: videoBuffer
  });
  const upJson = await upRes.json().catch(() => null);
  if (!upRes.ok || !upJson?.file) {
    throw new Error(`Gemini 文件上传失败 (${upRes.status}): ${msgFrom(upJson)}`);
  }
  return upJson.file; // { name, uri, state, ... }
}

export async function waitActive({ apiKey, fileName, timeoutMs = 120000 }) {
  const deadline = Date.now() + timeoutMs;
  let state = 'PROCESSING';
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`);
    const json = await res.json().catch(() => null);
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

function msgFrom(json) {
  return json?.error?.message || JSON.stringify(json || {}).slice(0, 300);
}
