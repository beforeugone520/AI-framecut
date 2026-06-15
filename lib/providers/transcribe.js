// 音频转写：把一段 16kHz 单声道 WAV 转写为带时间戳的分段文本。
// 支持 OpenAI Whisper（verbose_json，时间戳最准）与 Gemini（原生听音频）。
// 返回 { segments: [{ start, end, text }], text }，时间均为该段内的相对秒数（全局偏移由前端拼接）。

import { extractJson } from '../json.js';
import { normalizeGeminiModel, resolveGeminiBase, uploadFile, waitActive } from './gemini.js';
import { fetchWithTimeout, upstreamError, resolveEndpoint } from '../http.js';

export async function transcribe({ engine, apiKey, model, baseUrl, wavBuffer }) {
  if (!apiKey) throw new Error('缺少音频转写所需的 API Key');
  if (engine === 'gemini') {
    return transcribeGemini({ apiKey, model, baseUrl, wavBuffer });
  }
  return transcribeOpenAI({ apiKey, model, baseUrl, wavBuffer });
}

async function transcribeOpenAI({ apiKey, model, baseUrl, wavBuffer }) {
  const endpoint = resolveEndpoint(baseUrl, 'https://api.openai.com/v1', '/audio/transcriptions');
  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', model || 'whisper-1');
  form.append('response_format', 'verbose_json'); // 含 segments 时间戳

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form
  }, 120000);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw upstreamError('Whisper 转写失败', res.status, json);
  }

  const segments = Array.isArray(json?.segments)
    ? json.segments.map((s) => ({ start: num(s.start), end: num(s.end), text: String(s.text || '').trim() }))
    : [];
  if (!segments.length && json?.text) segments.push({ start: 0, end: 0, text: String(json.text).trim() });
  return { segments: segments.filter((s) => s.text), text: json?.text || '' };
}

async function transcribeGemini({ apiKey, model, baseUrl, wavBuffer }) {
  const mdl = normalizeGeminiModel(model || 'gemini-2.5-flash');

  const file = await uploadFile({ apiKey, baseUrl, videoBuffer: wavBuffer, mimeType: 'audio/wav', filename: 'audio.wav' });
  await waitActive({ apiKey, baseUrl, fileName: file.name, timeoutMs: 90000 });

  const prompt = `请把这段音频逐句转写为文字，并给出每句的起止时间（单位：秒，相对音频开头）。
只输出 JSON：{"segments":[{"start":0,"end":2.4,"text":"……"}]}。无人声/纯音乐则返回 {"segments":[]}。`;

  const body = {
    contents: [{ role: 'user', parts: [{ file_data: { mime_type: 'audio/wav', file_uri: file.uri } }, { text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 }
  };

  const base = resolveGeminiBase(baseUrl);
  const url = `${base}/v1beta/models/${encodeURIComponent(mdl)}:generateContent`;
  const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) }, 120000);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw upstreamError('Gemini 转写失败', res.status, json);
  }
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n');
  if (!text) return { segments: [], text: '' };

  let parsed;
  try {
    parsed = extractJson(text);
  } catch {
    return { segments: [], text: '' };
  }
  const segs = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const segments = segs
    .map((s) => ({ start: num(s.start), end: num(s.end), text: String(s.text || '').trim() }))
    .filter((s) => s.text);
  return { segments, text: segments.map((s) => s.text).join(' ') };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
