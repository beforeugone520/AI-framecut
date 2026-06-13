import { esc, fmtTime } from './util.js';

const STYLE_FIELDS = [
  ['overall', '整体风格'],
  ['color_grading', '色调 / 调色'],
  ['lighting', '光线 / 布光'],
  ['composition', '构图'],
  ['camera_language', '镜头语言'],
  ['editing', '剪辑 / 转场'],
  ['mood', '氛围 / 情绪'],
  ['audio_design', '音频设计'],
  ['pacing', '整体节奏']
];

export function renderResult(result, container) {
  const { video_summary, style = {}, shots = [] } = result;

  let html = '';

  if (video_summary) {
    html += `<div class="summary-line">📌 ${esc(video_summary)}</div>`;
  }

  // 画面风格
  const cards = STYLE_FIELDS.filter(([k]) => style[k])
    .map(([k, label]) => `
      <div class="style-card">
        <h4>${label}</h4>
        <p>${esc(style[k])}</p>
      </div>`).join('');

  const tips = style.replication_tips
    ? `<div class="style-card full">
         <h4>🎯 复刻要点</h4>
         <p>${esc(style.replication_tips)}</p>
       </div>`
    : '';

  if (cards || tips) {
    html += `<div class="section-label">画面风格总结</div>
             <div class="style-grid">${cards}${tips}</div>`;
  }

  // 分镜表
  html += `<div class="section-label">分镜镜头脚本 · 共 ${shots.length} 个镜头</div>`;
  html += `<div class="table-wrap"><table class="shots">
    <thead><tr>
      <th class="col-no">镜号</th>
      <th>景别/角度</th>
      <th>运动</th>
      <th>画面内容</th>
      <th>音频</th>
      <th class="col-dur">时长(秒)</th>
    </tr></thead><tbody>`;

  for (const s of shots) {
    const ts = (s.start || s.end) ? `<span class="ts">${esc(s.start || '')}${s.end ? ' → ' + esc(s.end) : ''}</span>` : '';
    html += `<tr>
      <td class="col-no">${esc(s.shot_number)}</td>
      <td class="col-size">${esc(s.shot_size) || '—'}</td>
      <td class="col-move">${esc(s.movement) || '—'}</td>
      <td class="col-visual">${esc(s.visual) || '—'}</td>
      <td class="col-audio">${esc(s.audio) || '—'}</td>
      <td class="col-dur">${s.duration_sec != null ? esc(s.duration_sec) : '—'}${ts}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;

  container.innerHTML = html;
}
