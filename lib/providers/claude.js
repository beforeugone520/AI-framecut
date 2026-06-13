// Claude（Anthropic）抽帧分析：把按时间戳采样的关键帧序列交给 Claude 做视觉拉片分析。
// Claude 不能直接听音频，音频列由画面线索（字幕/口型/场景）推断。

import { buildAnalysisPrompt } from '../prompt.js';
import { extractJson, normalizeResult } from '../json.js';

const URL = 'https://api.anthropic.com/v1/messages';

export async function analyzeWithClaude({ apiKey, model, frames, focus, meta, transcript }) {
  if (!apiKey) throw new Error('缺少 Claude API Key');
  const mdl = model || 'claude-sonnet-4-6';

  const prompt = buildAnalysisPrompt({ mode: 'frames', meta, focus, transcript });

  // 预先过滤出可解析的帧，使提示中声明的帧数与实际发送的一致
  const validFrames = frames
    .map((f) => ({ time: f.time, img: parseDataUrl(f.dataUrl) }))
    .filter((f) => f.img);
  if (!validFrames.length) throw new Error('没有可用的关键帧（抽帧数据无效）');

  const content = [{ type: 'text', text: prompt }];
  content.push({ type: 'text', text: `\n以下是按时间顺序采样的 ${validFrames.length} 个关键帧（每帧标注其时间戳）：` });
  for (const f of validFrames) {
    content.push({ type: 'text', text: `时间戳 ${fmt(f.time)}：` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: f.img.mediaType, data: f.img.data }
    });
  }
  content.push({ type: 'text', text: '\n现在请输出完整的 JSON 分析结果（只输出 JSON）。' });

  const body = {
    model: mdl,
    max_tokens: 16000,
    temperature: 0.4,
    messages: [
      { role: 'user', content },
      { role: 'assistant', content: '{' } // prefill 强制 JSON 起始
    ]
  };

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Claude 分析失败 (${res.status}): ${json?.error?.message || JSON.stringify(json || {}).slice(0, 300)}`);
  }

  const text = json?.content?.map((b) => b.text).filter(Boolean).join('\n') || '';
  const parsed = extractJson('{' + text); // 补回 prefill 的 {
  return normalizeResult(parsed, meta);
}

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

function fmt(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const frac = Math.round((sec - s) * 10);
  return `${m}:${String(r).padStart(2, '0')}${frac ? '.' + frac : ''}`;
}
