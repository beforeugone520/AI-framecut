// OpenAI（GPT-4o 等）抽帧分析：把按时间戳采样的关键帧序列交给视觉模型做拉片分析。
// 兼容任意 OpenAI 风格 /chat/completions 接口（可自定义 baseUrl）。

import { buildAnalysisPrompt } from '../prompt.js';
import { extractJson, normalizeResult } from '../json.js';

export async function analyzeWithOpenAI({ apiKey, model, frames, focus, meta, baseUrl, transcript }) {
  if (!apiKey) throw new Error('缺少 OpenAI API Key');
  const mdl = model || 'gpt-4o';
  const endpoint = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';

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

  const body = {
    model: mdl,
    temperature: 0.4,
    max_tokens: 16000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是专业视频拉片分析专家，只输出严格的 JSON。' },
      { role: 'user', content: userContent }
    ]
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`OpenAI 分析失败 (${res.status}): ${json?.error?.message || JSON.stringify(json || {}).slice(0, 300)}`);
  }

  const text = json?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(text);
  return normalizeResult(parsed, meta);
}

function fmt(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const frac = Math.round((sec - s) * 10);
  return `${m}:${String(r).padStart(2, '0')}${frac ? '.' + frac : ''}`;
}
