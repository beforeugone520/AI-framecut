// 从大模型返回文本中稳健地提取 JSON 对象。
// 模型有时会在 JSON 前后包裹 ```json 代码块或解释性文字，这里做容错解析。

export function extractJson(text) {
  if (text == null) throw new Error('模型返回为空');
  if (typeof text === 'object') return text;

  let s = String(text).trim();

  // 去掉 ```json ... ``` 或 ``` ... ``` 代码围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 直接尝试
  try {
    return JSON.parse(s);
  } catch {
    // 退而求其次：截取第一个 { 到最后一个 } 之间的内容
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const slice = s.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // 再尝试修复常见尾逗号
        const repaired = slice.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(repaired);
      }
    }
    throw new Error('无法从模型输出中解析出 JSON');
  }
}

// 规整模型返回的结构，补齐字段、统一类型，保证前端渲染稳定。
export function normalizeResult(raw, meta = {}) {
  const data = typeof raw === 'object' && raw !== null ? raw : {};
  const styleIn = data.style || data.画面风格 || {};

  const shotsIn = Array.isArray(data.shots)
    ? data.shots
    : Array.isArray(data.分镜)
      ? data.分镜
      : [];

  const shots = shotsIn.map((s, i) => {
    const start = pickStr(s, ['start', '起始', '开始', 'start_time']);
    const end = pickStr(s, ['end', '结束', 'end_time']);
    let duration = pickNum(s, ['duration_sec', 'duration', '时长', '时长(秒)', 'seconds']);
    if (!Number.isFinite(duration)) {
      const ds = toSeconds(start);
      const de = toSeconds(end);
      if (Number.isFinite(ds) && Number.isFinite(de) && de > ds) duration = round1(de - ds);
    }
    return {
      shot_number: pickNum(s, ['shot_number', '镜号', 'no', 'index']) || i + 1,
      start: start || '',
      end: end || '',
      duration_sec: Number.isFinite(duration) ? round1(duration) : null,
      shot_size: pickStr(s, ['shot_size', '景别', '景别/角度', '景别角度', 'shot']) || '',
      movement: pickStr(s, ['movement', '运动', '镜头运动', 'camera_movement']) || '',
      visual: pickStr(s, ['visual', '画面内容', '画面', 'description', 'content']) || '',
      audio: pickStr(s, ['audio', '音频', 'sound']) || ''
    };
  });

  const style = {
    overall: pickStr(styleIn, ['overall', '整体', '整体风格', '定位']) || '',
    color_grading: pickStr(styleIn, ['color_grading', 'color', '色调', '调色', '色彩']) || '',
    lighting: pickStr(styleIn, ['lighting', '光线', '布光', '灯光']) || '',
    composition: pickStr(styleIn, ['composition', '构图']) || '',
    camera_language: pickStr(styleIn, ['camera_language', '镜头语言', '运镜', 'camera']) || '',
    editing: pickStr(styleIn, ['editing', '剪辑', '剪辑节奏', '转场']) || '',
    mood: pickStr(styleIn, ['mood', '氛围', '情绪', 'tone']) || '',
    audio_design: pickStr(styleIn, ['audio_design', '音频设计', '音乐', '声音设计', 'sound_design']) || '',
    pacing: pickStr(styleIn, ['pacing', '节奏']) || '',
    replication_tips: pickStr(styleIn, ['replication_tips', '复刻要点', '复刻', 'tips', '建议']) || ''
  };

  return {
    video_summary: pickStr(data, ['video_summary', '视频概述', '概述', 'summary', '主题']) || '',
    style,
    shots,
    meta
  };
}

function pickStr(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v) && v.length) return v.join('；');
  }
  return '';
}

function pickNum(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

function toSeconds(ts) {
  if (!ts) return NaN;
  const parts = String(ts).split(':').map((p) => parseFloat(p));
  if (parts.some((p) => !Number.isFinite(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
