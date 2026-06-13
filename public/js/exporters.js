// 把分析结果导出为 Markdown / CSV / JSON / SRT。

import { computeShotTimes } from './util.js';

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
  lines.push(`| 镜号 | 景别/角度 | 运动 | 画面内容 | 画面文字 | 音频 | 时长(秒) |`);
  lines.push(`| :---: | --- | --- | --- | --- | --- | :---: |`);
  for (const s of shots) {
    lines.push(
      `| ${s.shot_number} | ${cell(s.shot_size)} | ${cell(s.movement)} | ${cell(s.visual)} | ${cell(s.on_screen_text)} | ${cell(s.audio)} | ${s.duration_sec ?? ''} |`
    );
  }
  lines.push('');

  if (result.transcript) {
    lines.push('', `## 音频转写全文`, '', '```', result.transcript, '```', '');
  }
  return lines.join('\n');
}

export function toCSV(result) {
  const { shots = [] } = result;
  const head = ['镜号', '景别/角度', '运动', '画面内容', '画面文字', '音频', '时长(秒)', '起始', '结束'];
  const rows = shots.map((s) => [
    s.shot_number, s.shot_size, s.movement, s.visual, s.on_screen_text, s.audio, s.duration_sec ?? '', s.start ?? '', s.end ?? ''
  ]);
  const all = [head, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');
  return '﻿' + all; // BOM 便于 Excel 正确识别 UTF-8
}

export function toJSON(result) {
  return JSON.stringify(result, null, 2);
}

// 导出 SRT 字幕：用每镜头的起止时间生成可导入剪辑软件的字幕轨。
// 字幕正文 = #镜号 · 景别 · 运动 | 画面内容（有画面文字则附「字: …」）
export function toSRT(result) {
  const { shots = [], meta = {} } = result;
  if (!shots.length) return '';
  const starts = computeShotTimes(shots, meta.duration);

  const blocks = [];
  shots.forEach((s, i) => {
    const start = starts[i] ?? 0;
    // 结束时间：优先下一镜头起点；末镜头用 start + duration 或视频总时长
    let end;
    if (i + 1 < shots.length && Number.isFinite(starts[i + 1]) && starts[i + 1] > start) {
      end = starts[i + 1];
    } else if (Number.isFinite(s.duration_sec) && s.duration_sec > 0) {
      end = start + s.duration_sec;
    } else if (Number.isFinite(meta.duration) && meta.duration > start) {
      end = meta.duration;
    } else {
      end = start + 2;
    }
    if (end <= start) end = start + 0.5; // 保证时长为正

    const head = [`#${s.shot_number}`, s.shot_size, s.movement].filter(Boolean).join(' · ');
    let body = [head, oneLine(s.visual)].filter(Boolean).join(' | ');
    if (s.on_screen_text && oneLine(s.on_screen_text)) body += `\n字：${oneLine(s.on_screen_text)}`;

    blocks.push(`${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${body || '镜头'}`);
  });
  return blocks.join('\n\n') + '\n';
}

function srtTime(sec) {
  // 先在毫秒级取整，再分解，避免 0.9995s 进位成 ",1000" 的非法时间码
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const sc = totalS % 60;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(sc)},${p(ms, 3)}`;
}

// 把风格总结 + 分镜节奏拼成一段可直接喂给 AI 视频生成 / 拍摄团队的「复刻提示词」
export function buildReplicationPrompt(result) {
  const { style = {}, shots = [], video_summary } = result;
  const lines = ['【视频复刻提示词】'];
  if (video_summary) lines.push(`主题：${oneLine(video_summary)}`);
  lines.push('');
  for (const [k, label] of STYLE_ROWS) {
    if (style[k]) lines.push(`${label}：${oneLine(style[k])}`);
  }
  if (style.replication_tips) {
    lines.push('', `复刻要点：${oneLine(style.replication_tips)}`);
  }
  if (shots.length) {
    const totalSec = shots.reduce((a, s) => a + (Number(s.duration_sec) || 0), 0);
    lines.push('', `分镜节奏（共 ${shots.length} 镜，约 ${Math.round(totalSec)} 秒）：`);
    shots.forEach((s) => {
      const tag = [s.shot_size, s.movement].filter(Boolean).join('·');
      const dur = s.duration_sec != null ? ` (${s.duration_sec}s)` : '';
      const txt = s.on_screen_text && oneLine(s.on_screen_text) ? `（画面文字：${oneLine(s.on_screen_text)}）` : '';
      lines.push(`${s.shot_number}. [${tag || '镜头'}] ${oneLine(s.visual)}${txt}${dur}`);
    });
  }
  return lines.join('\n');
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
