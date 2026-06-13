// 后端共享 HTTP 工具：带超时的 fetch + 上游错误收口（详情只记服务端日志，客户端收简短安全消息）。

export async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请重试或换用更短的视频`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 构造上游 API 错误：完整响应只写服务端日志用于诊断；返回给客户端的仅含状态码 + 上游的简短 message
// （error.message 本身是面向开发者的简短描述，不含密钥/账号机密，且 friendlyError 需要它来分类）。
export function upstreamError(label, status, json, rawText) {
  const detail = json ? safeStringify(json) : String(rawText || '');
  console.error(`[${label}] HTTP ${status}: ${detail.slice(0, 1000)}`);
  const upstreamMsg = typeof json?.error?.message === 'string' ? json.error.message
    : typeof json?.error === 'string' ? json.error
      : (rawText ? String(rawText).replace(/\s+/g, ' ').trim().slice(0, 160) : '');
  const tail = upstreamMsg ? upstreamMsg.slice(0, 200) : '请检查 API Key / 模型 / 网络';
  return new Error(`${label} (${status})：${tail}`);
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}
