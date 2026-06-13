// 调用本地服务的分析接口。

// Gemini：直接把原始视频文件 POST 给本地服务，由服务端转发上传到 Gemini。
export async function analyzeVideo({ file, model, apiKey, focus, meta }) {
  const params = new URLSearchParams({
    model: model || '',
    mime: file.type || 'video/mp4',
    filename: file.name || 'upload.mp4',
    focus: focus || '',
    duration: meta.duration ? String(Math.round(meta.duration)) : '',
    width: meta.width ? String(meta.width) : '',
    height: meta.height ? String(meta.height) : ''
  });

  const res = await fetch(`/api/gemini/analyze?${params.toString()}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': file.type || 'application/octet-stream' },
    body: file
  });
  return handle(res);
}

// Claude / OpenAI：抽帧后把帧序列 POST 给本地服务。API Key 走 header，不进 body。
export async function analyzeFrames({ provider, model, apiKey, baseUrl, frames, focus, meta, transcript }) {
  const res = await fetch('/api/frames/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ provider, model, baseUrl, frames, focus, meta, transcript })
  });
  return handle(res);
}

// 转写单段 WAV：把音频字节 POST 给本地服务，由服务端转发给转写引擎。
export async function transcribeAudio({ engine, model, apiKey, baseUrl, blob }) {
  const params = new URLSearchParams({ engine, model: model || '', baseUrl: baseUrl || '' });
  const res = await fetch(`/api/transcribe?${params.toString()}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'audio/wav' },
    body: blob
  });
  return handle(res); // { segments:[{start,end,text}], text }
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
