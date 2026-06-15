// 调用本地服务的分析接口。所有请求支持外部 AbortSignal（取消）+ 超时兜底。

// Gemini：直接把原始视频文件 POST 给本地服务，由服务端转发上传到 Gemini。
export async function analyzeVideo({ file, model, apiKey, focus, meta, signal }) {
  const params = new URLSearchParams({
    model: model || '',
    mime: file.type || 'video/mp4',
    filename: file.name || 'upload.mp4',
    focus: focus || '',
    duration: meta.duration ? String(Math.round(meta.duration)) : '',
    width: meta.width ? String(meta.width) : '',
    height: meta.height ? String(meta.height) : ''
  });
  return send(`/api/gemini/analyze?${params.toString()}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': file.type || 'application/octet-stream' },
    body: file
  }, 360000, signal);
}

// Claude / OpenAI：抽帧后把帧序列 POST 给本地服务。API Key 走 header，不进 body。
export async function analyzeFrames({ provider, model, apiKey, baseUrl, apiMode, frames, focus, meta, transcript, signal }) {
  return send('/api/frames/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ provider, model, baseUrl, apiMode, frames, focus, meta, transcript })
  }, 180000, signal);
}

// 转写单段 WAV：把音频字节 POST 给本地服务，由服务端转发给转写引擎。
export async function transcribeAudio({ engine, model, apiKey, baseUrl, blob, signal }) {
  const params = new URLSearchParams({ engine, model: model || '', baseUrl: baseUrl || '' });
  return send(`/api/transcribe?${params.toString()}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'audio/wav' },
    body: blob
  }, 130000, signal);
}

// 统一发送：用内部 controller 聚合「外部取消」与「超时」（不依赖 AbortSignal.any，兼容性更好），
// 请求结束清理 timer/监听；外部未取消却中止 = 超时，翻译成明确的超时错误，其余原样抛出。
async function send(url, options, timeoutMs, signal) {
  const controller = new AbortController();
  if (signal?.aborted) controller.abort();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return await handle(res);
  } catch (e) {
    if (e?.name === 'AbortError' && !signal?.aborted) {
      throw new Error(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请重试或换用更短的视频`);
    }
    throw e; // 外部取消（AbortError 且 signal.aborted）或其它错误
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function handle(res) {
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    throw new Error(json?.error || `请求失败（HTTP ${res.status}）`);
  }
  if (json == null) {
    throw new Error('服务返回了无法解析的响应（非 JSON）');
  }
  return json;
}
