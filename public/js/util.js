export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 用于 HTML 属性值：在 esc 基础上再转义引号，防止属性截断 / 注入
export function escAttr(str) {
  return esc(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 给常见的大模型 API 错误附上可操作的中文建议
export function friendlyError(msg) {
  const m = String(msg ?? '');
  const low = m.toLowerCase();
  let hint = '';
  if (low.includes('model') && (/\b404\b/.test(m) || low.includes('not found') || low.includes('does not exist') || low.includes('not_found'))) {
    hint = '模型 ID 可能不可用，请在「模型」里改成你账号支持的 ID。';
  } else if (/\b401\b/.test(m) || low.includes('unauthorized') || low.includes('invalid api key') || low.includes('invalid x-api-key') || low.includes('incorrect api key') || low.includes('api key not valid')) {
    hint = '请检查 API Key 是否正确、未过期。';
  } else if (/\b403\b/.test(m) || low.includes('forbidden') || low.includes('permission')) {
    hint = '该 Key 无权限或所在地区不可用，请检查 Key 权限 / 区域。';
  } else if (/\b429\b/.test(m) || low.includes('rate limit') || low.includes('quota') || low.includes('exhausted') || low.includes('insufficient')) {
    hint = '触发限流或额度不足，请稍后重试或检查账户额度。';
  } else if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('econnrefused') || low.includes('network error')) {
    hint = '网络请求失败，请确认本地服务在运行、网络可访问对应 API。';
  }
  return hint ? `${m}\n💡 ${hint}` : m;
}

// 安全的文件名（去掉扩展名与非法字符）
export function baseName(filename = 'video') {
  return String(filename).replace(/\.[^.]+$/, '').replace(/[^\w一-龥-]+/g, '_').slice(0, 60) || 'video';
}

// 解析 "m:ss" / "mm:ss" / "h:mm:ss" / "12.5" 形式的时间码为秒；解析失败返回 null
export function parseTimecode(tc) {
  if (tc == null || tc === '') return null;
  if (typeof tc === 'number') return Number.isFinite(tc) ? tc : null;
  const str = String(tc).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const parts = str.split(':').map((p) => parseFloat(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// 计算每个镜头的起始秒：优先用模型给的 start，缺失则按累计时长推算
export function computeShotTimes(shots, totalDuration) {
  const times = [];
  let cursor = 0;
  for (const s of shots) {
    const startSec = parseTimecode(s.start);
    const start = Number.isFinite(startSec) ? startSec : cursor;
    times.push(start);
    const endSec = parseTimecode(s.end);
    if (Number.isFinite(endSec) && endSec > start) cursor = endSec;
    else if (Number.isFinite(s.duration_sec)) cursor = start + s.duration_sec;
    else cursor = start;
  }
  if (Number.isFinite(totalDuration)) {
    return times.map((t) => Math.max(0, Math.min(totalDuration, t)));
  }
  return times;
}

// 有限并发地映射异步任务，保持结果顺序
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
