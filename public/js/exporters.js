// 把分析结果导出为 Markdown / CSV / JSON。

const STYLE_ROWS = [
  ['overall', '整体风格'],
  ['color_grading', '色调/调色'],
  ['lighting', '光线/布光'],
  ['composition', '构图'],
  ['camera_language', '镜头语言'],
  ['editing', '剪辑/转场'],
  ['mood', '氛围/情绪'],
  ['audio_design', '音频设计'],
  ['pacing', '整体节奏']
];

export function toMarkdown(result, meta = {}) {
  const { video_summary, style = {}, shots = [] } = result;
  const lines = [];

  lines.push(`# 视频拉片分析报告`);
  if (meta.filename) lines.push(`> 文件：${meta.filename}`);
  if (meta.engine) lines.push(`> 分析引擎：${meta.engine}`);
  lines.push('');

  if (video_summary) {
    lines.push(`## 视频概述`, '', video_summary, '');
  }

  lines.push(`## 画面风格总结`, '');
  for (const [k, label] of STYLE_ROWS) {
    if (style[k]) lines.push(`- **${label}**：${oneLine(style[k])}`);
  }
  if (style.replication_tips) {
    lines.push('', `### 🎯 复刻要点`, '', style.replication_tips, '');
  }

  lines.push('', `## 分镜镜头脚本`, '');
  lines.push(`| 镜号 | 景别/角度 | 运动 | 画面内容 | 音频 | 时长(秒) |`);
  lines.push(`| :---: | --- | --- | --- | --- | :---: |`);
  for (const s of shots) {
    lines.push(
      `| ${s.shot_number} | ${cell(s.shot_size)} | ${cell(s.movement)} | ${cell(s.visual)} | ${cell(s.audio)} | ${s.duration_sec ?? ''} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function toCSV(result) {
  const { shots = [] } = result;
  const head = ['镜号', '景别/角度', '运动', '画面内容', '音频', '时长(秒)', '起始', '结束'];
  const rows = shots.map((s) => [
    s.shot_number, s.shot_size, s.movement, s.visual, s.audio, s.duration_sec ?? '', s.start ?? '', s.end ?? ''
  ]);
  const all = [head, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');
  return '﻿' + all; // BOM 便于 Excel 正确识别 UTF-8
}

export function toJSON(result) {
  return JSON.stringify(result, null, 2);
}

function cell(v) {
  return oneLine(v).replace(/\|/g, '\\|') || '—';
}
function oneLine(v) {
  return String(v ?? '').replace(/\r?\n/g, ' ').trim();
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
