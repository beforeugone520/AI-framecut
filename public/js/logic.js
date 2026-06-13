// 纯领域逻辑：不依赖 DOM / 状态，便于直接单元测试。

// 转写 Key 解析：显式填写 > 与分析引擎同源复用 > 该引擎已存的 Key
export function resolveTranscribeKey({ explicitKey, engineProvider, analysisProvider, analysisKey, storedKey }) {
  let key = (explicitKey || '').trim();
  if (!key && engineProvider === analysisProvider) key = analysisKey || '';
  if (!key) key = storedKey || '';
  return key;
}

// 单个镜头是否命中关键词 + 景别筛选（keyword 已小写）
export function shotMatches(shot, keyword, sizes) {
  const hay = `${shot.shot_number} ${shot.shot_size} ${shot.movement} ${shot.visual} ${shot.on_screen_text} ${shot.audio}`.toLowerCase();
  const kwOk = !keyword || hay.includes(keyword);
  const sizeOk = !sizes.length || sizes.includes(shot.shot_size);
  return kwOk && sizeOk;
}

// 历史列表用的简短日期 月-日 时:分
export function fmtDate(ts) {
  try {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return '';
  }
}
