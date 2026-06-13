// 分析结果的本地历史（localStorage）。分析一次可能耗时耗费，刷新即丢是最痛的体验缺陷。
// 只存结果 JSON（不含缩略图 dataURL，避免超配额），最多保留最近 N 条。

const KEY = 'framecut.history.v1';
const MAX = 10;

export function listHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr.sort((a, b) => b.ts - a.ts) : [];
  } catch {
    return [];
  }
}

export function saveResult(result, meta = {}) {
  // 历史快照剔除可能很大的转写全文（仅导出时用），控制单条体积，降低超配额概率
  const { transcript, ...lean } = result || {};
  const entry = {
    id: makeId(),
    ts: Date.now(),
    filename: meta.filename || '未命名',
    engine: meta.engine || '',
    shotCount: Array.isArray(lean.shots) ? lean.shots.length : 0,
    result: lean
  };
  let list = listHistory().filter((e) => e && e.id);
  list.unshift(entry);
  if (list.length > MAX) list = list.slice(0, MAX);
  persist(list);
  const saved = listHistory().some((e) => e.id === entry.id); // 配额不足时可能未写入
  return { id: entry.id, saved };
}

export function loadResult(id) {
  const e = listHistory().find((x) => x.id === id);
  return e ? e.result : null;
}

export function deleteResult(id) {
  persist(listHistory().filter((e) => e.id !== id));
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// 写入；若超配额则逐条丢弃最旧后重试
function persist(list) {
  let arr = list.slice();
  while (arr.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
      return;
    } catch {
      arr = arr.slice(0, -1); // 丢掉最旧一条再试
    }
  }
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function makeId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* ignore */ }
  return 'h_' + Math.abs(hashStr(String(performance.now()) + Math.floor(performance.now()))) + '_' + Date.now();
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
