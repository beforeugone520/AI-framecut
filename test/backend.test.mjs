// 后端：HTTP 工具（错误收口 / 端点校验 / 超时）+ 提示词构建。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { upstreamError, resolveEndpoint, fetchWithTimeout } from '../lib/http.js';
import { buildAnalysisPrompt } from '../lib/prompt.js';

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
