// OpenAI（GPT-4o 等）抽帧分析：把按时间戳采样的关键帧序列交给视觉模型做拉片分析。
// 兼容 OpenAI 风格 Chat Completions / Responses 接口（可自定义 baseUrl）。

import { buildAnalysisPrompt } from '../prompt.js';
import { extractJson, normalizeResult } from '../json.js';
import { fetchWithTimeout, upstreamError, resolveEndpoint } from '../http.js';

export async function analyzeWithOpenAI({ apiKey, model, apiMode, frames, focus, meta, baseUrl, transcript }) {
  if (!apiKey) throw new Error('缺少 OpenAI API Key');
  const mdl = model || 'gpt-4o';
  const mode = apiMode === 'responses' ? 'responses' : 'chat';
  const endpoint = resolveEndpoint(baseUrl, 'https://api.openai.com/v1', mode === 'responses' ? '/responses' : '/chat/completions');

  const prompt = buildAnalysisPrompt({ mode: 'frames', meta, focus, transcript });

  const validFrames = frames.filter((f) => f.dataUrl);
  if (!validFrames.length) throw new Error('没有可用的关键帧（抽帧数据无效）');

  const userContent = [{ type: 'text', text: prompt }];
  userContent.push({ type: 'text', text: `\n以下是按时间顺序采样的 ${validFrames.length} 个关键帧（每帧标注其在视频中的时间戳）：` });
  for (const f of validFrames) {
    userContent.push({ type: 'text', text: `时间戳 ${fmt(f.time)}：` });
    userContent.push({ type: 'image_url', image_url: { url: f.dataUrl, detail: 'low' } });
  }
  userContent.push({ type: 'text', text: '\n请只输出 JSON 分析结果。' });

  const body = mode === 'responses'
    ? buildResponsesBody(mdl, userContent)
    : buildChatBody(mdl, userContent);

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }, 180000);

  const rawText = await res.text().catch(() => '');
  const json = parseJson(rawText);
  if (!res.ok) {
    throw upstreamError('OpenAI 分析失败', res.status, json, rawText);
  }

  const text = mode === 'responses'
    ? extractResponsesText(rawText, json)
    : (json?.choices?.[0]?.message?.content || '');
  const parsed = extractJson(text);
  return normalizeResult(parsed, meta);
}

function buildChatBody(model, userContent) {
  return {
    model,
    temperature: 0.4,
    max_tokens: 16000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是专业视频拉片分析专家，只输出严格的 JSON。' },
      { role: 'user', content: userContent }
    ]
  };
}

function buildResponsesBody(model, userContent) {
  return {
    model,
    store: false,
    max_output_tokens: 16000,
    instructions: '你是专业视频拉片分析专家，只输出严格的 JSON。',
    text: { format: { type: 'json_object' } },
    input: [
      {
        role: 'user',
        content: userContent.map((part) => {
          if (part.type === 'image_url') {
            return { type: 'input_image', image_url: part.image_url.url };
          }
          return { type: 'input_text', text: part.text || '' };
        })
      }
    ]
  };
}

function extractResponsesText(rawText, json) {
  if (json) {
    if (typeof json.output_text === 'string') return json.output_text;
    const parts = Array.isArray(json.output) ? json.output.flatMap((item) => item.content || []) : [];
    const text = parts.map((part) => part.text).filter(Boolean).join('\n');
    if (text) return text;
  }

  let doneText = '';
  let deltaText = '';
  for (const line of String(rawText || '').split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const event = parseJson(line.slice(5).trim());
    if (event?.type === 'response.output_text.done' && typeof event.text === 'string') {
      doneText = event.text;
    } else if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      deltaText += event.delta;
    }
  }
  return doneText || deltaText;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function fmt(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const frac = Math.round((sec - s) * 10);
  return `${m}:${String(r).padStart(2, '0')}${frac ? '.' + frac : ''}`;
}
