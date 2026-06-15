// 后端：HTTP 工具（错误收口 / 端点校验 / 超时）+ 提示词构建。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { upstreamError, resolveEndpoint, fetchWithTimeout } from '../lib/http.js';
import { buildAnalysisPrompt } from '../lib/prompt.js';
import { analyzeWithGemini, normalizeGeminiModel } from '../lib/providers/gemini.js';
import { analyzeWithClaude } from '../lib/providers/claude.js';
import { analyzeWithOpenAI } from '../lib/providers/openai.js';

// 静音服务端诊断日志
const origErr = console.error;
function quiet(fn) {
  console.error = () => {};
  try { return fn(); } finally { console.error = origErr; }
}

test('upstreamError: 保留状态码+上游简短 message，不泄露响应体其它字段', () => {
  const e = quiet(() => upstreamError('Gemini 分析失败', 429, { error: { message: 'Rate limit exceeded' }, account_id: 'SECRET', quota: { plan: 'enterprise' } }));
  assert.match(e.message, /429/);
  assert.match(e.message, /Rate limit exceeded/);
  assert.doesNotMatch(e.message, /SECRET|enterprise/);
});

test('upstreamError: 无 error.message 时用 rawText 兜底（压平截断）', () => {
  const e = quiet(() => upstreamError('X 失败', 400, null, '  invalid request:\n  bad model  '));
  assert.match(e.message, /invalid request: bad model/);
});

test('resolveEndpoint: 默认 + 去尾斜杠 + 协议校验', () => {
  assert.equal(resolveEndpoint('', 'https://api.openai.com/v1', '/chat/completions'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(resolveEndpoint('https://gw.example.com/v1/', 'https://api.openai.com/v1', '/chat/completions'), 'https://gw.example.com/v1/chat/completions');
  assert.throws(() => resolveEndpoint('file:///etc/passwd', 'https://api.openai.com/v1', '/x'), /http\/https/);
  assert.throws(() => resolveEndpoint('not a url', 'https://api.openai.com/v1', '/x'), /不合法/);
});

test('normalizeGeminiModel: 兼容 Gemini 3.1 常见写法', () => {
  assert.equal(normalizeGeminiModel('gemini3.1'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModel('gemini-3.1'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModel('gemini-3.1-pro'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModel('gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('fetchWithTimeout: 超时抛“请求超时”，正常透传', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => new Promise((_, rej) => {
    opts.signal.addEventListener('abort', () => { const a = new Error('aborted'); a.name = 'AbortError'; rej(a); });
  });
  await assert.rejects(() => fetchWithTimeout('http://x', {}, 100), /超时/);
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  const r = await fetchWithTimeout('http://x', {}, 5000);
  assert.equal(r.ok, true);
  globalThis.fetch = origFetch;
});

test('buildAnalysisPrompt: 含必需结构 + 画面文字 + 术语引导', () => {
  const p = buildAnalysisPrompt({ mode: 'video', meta: { duration: 30 } });
  assert.match(p, /"shots"/);
  assert.match(p, /on_screen_text/);
  assert.match(p, /焦段倾向/);
  assert.match(p, /包含画面与声音/);
});

test('buildAnalysisPrompt: frames 模式注入真实转写，video 模式不注入', () => {
  const f = buildAnalysisPrompt({ mode: 'frames', meta: {}, transcript: '[0:00–0:03] 你好' });
  assert.match(f, /真实音频转写/);
  assert.match(f, /\[0:00–0:03\] 你好/);
  const v = buildAnalysisPrompt({ mode: 'video', meta: {}, transcript: '忽略' });
  assert.doesNotMatch(v, /【音频转写】/);
});

test('analyzeWithGemini: 支持自定义 Gemini Base URL', async () => {
  const origFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    if (String(url).endsWith('/upload/v1beta/files')) {
      return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://gemini-compatible.example/upload-session' } });
    }
    if (String(url) === 'https://gemini-compatible.example/upload-session') {
      return Response.json({ file: { name: 'files/test-video', uri: 'gemini://test-video', state: 'PROCESSING' } });
    }
    if (String(url).endsWith('/v1beta/files/test-video')) {
      return Response.json({ state: 'ACTIVE' });
    }
    if (String(url).endsWith('/v1beta/models/gemini-2.5-flash:generateContent')) {
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ shots: [{ shot_number: 1, duration_sec: 1 }], style: { overall: 'ok' } }) }] } }]
      });
    }
    return Response.json({ error: { message: 'unexpected url' } }, { status: 500 });
  };

  const result = await analyzeWithGemini({
    apiKey: 'key',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://gemini-compatible.example',
    videoBuffer: new Uint8Array([1, 2, 3]),
    mimeType: 'video/mp4',
    filename: 'test.mp4',
    meta: { duration: 1 }
  });

  assert.deepEqual(calledUrls, [
    'https://gemini-compatible.example/upload/v1beta/files',
    'https://gemini-compatible.example/upload-session',
    'https://gemini-compatible.example/v1beta/files/test-video',
    'https://gemini-compatible.example/v1beta/models/gemini-2.5-flash:generateContent'
  ]);
  assert.equal(result.shots.length, 1);
  globalThis.fetch = origFetch;
});

test('analyzeWithGemini: 自定义 Base URL 会归一化常见 /v1 后缀', async () => {
  const origFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async (url) => {
    calledUrls.push(String(url));
    if (String(url).endsWith('/upload/v1beta/files')) {
      return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://gemini-compatible.example/upload-session' } });
    }
    if (String(url) === 'https://gemini-compatible.example/upload-session') {
      return Response.json({ file: { name: 'files/test-video', uri: 'gemini://test-video', state: 'PROCESSING' } });
    }
    if (String(url).endsWith('/v1beta/files/test-video')) {
      return Response.json({ state: 'ACTIVE' });
    }
    if (String(url).endsWith('/v1beta/models/gemini-2.5-flash:generateContent')) {
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ shots: [{ shot_number: 1, duration_sec: 1 }], style: { overall: 'ok' } }) }] } }]
      });
    }
    return Response.json({ error: { message: 'unexpected url' } }, { status: 500 });
  };

  await analyzeWithGemini({
    apiKey: 'key',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://gemini-compatible.example/v1',
    videoBuffer: new Uint8Array([1, 2, 3]),
    mimeType: 'video/mp4',
    filename: 'test.mp4',
    meta: { duration: 1 }
  });

  assert.equal(calledUrls[0], 'https://gemini-compatible.example/upload/v1beta/files');
  assert.equal(calledUrls[2], 'https://gemini-compatible.example/v1beta/files/test-video');
  assert.equal(calledUrls[3], 'https://gemini-compatible.example/v1beta/models/gemini-2.5-flash:generateContent');
  globalThis.fetch = origFetch;
});

test('analyzeWithClaude: 支持自定义 Anthropic Base URL', async () => {
  const origFetch = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return Response.json({ content: [{ type: 'text', text: '"shots":[{"shot_number":1,"duration_sec":1}],"style":{"overall":"ok"}}' }] });
  };

  const result = await analyzeWithClaude({
    apiKey: 'key',
    model: 'claude-compatible-vision',
    baseUrl: 'https://anthropic-compatible.example/v1',
    frames: [{ time: 0, dataUrl: 'data:image/png;base64,abc' }],
    meta: { duration: 1 }
  });

  assert.equal(calledUrl, 'https://anthropic-compatible.example/v1/messages');
  assert.equal(result.shots.length, 1);
  globalThis.fetch = origFetch;
});

test('analyzeWithOpenAI: responses 模式调用 /responses 并解析 SSE 输出', async () => {
  const origFetch = globalThis.fetch;
  let calledUrl = '';
  let calledBody = null;
  globalThis.fetch = async (url, opts) => {
    calledUrl = String(url);
    calledBody = JSON.parse(opts.body);
    const payload = {
      type: 'response.output_text.done',
      text: JSON.stringify({ shots: [{ shot_number: 1, duration_sec: 1, visual: 'red frame' }], style: { overall: 'clean' } })
    };
    return new Response(`event: response.output_text.done\ndata: ${JSON.stringify(payload)}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  const result = await analyzeWithOpenAI({
    apiKey: 'key',
    model: 'gpt-5.5',
    apiMode: 'responses',
    baseUrl: 'https://openai-compatible.example/v1',
    frames: [{ time: 0, dataUrl: 'data:image/png;base64,abc' }],
    meta: { duration: 1 }
  });

  assert.equal(calledUrl, 'https://openai-compatible.example/v1/responses');
  assert.equal(calledBody.store, false);
  assert.equal('temperature' in calledBody, false);
  assert.ok(calledBody.input[0].content.some((part) => part.type === 'input_image'));
  assert.equal(result.shots[0].visual, 'red frame');
  globalThis.fetch = origFetch;
});
