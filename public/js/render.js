import { esc, fmtTime, parseTimecode } from './util.js';

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

export function renderResult(result, container) {
  const { video_summary, style = {}, shots = [], meta = {} } = result;
  const times = computeShotTimes(shots, meta.duration);

  let html = '';

  if (video_summary) {
    html += `<div class="summary-line">📌 ${esc(video_summary)}</div>`;
  }

  // 拉片节奏统计
  html += renderStats(shots, meta);

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
    html += `<div class="section-label">画面风格总结
               <button class="chip mini" data-action="copy-recreate">📋 复制复刻提示词</button>
             </div>
             <div class="style-grid">${cards}${tips}</div>`;
  }

  // 分镜表
  const maxDur = shots.reduce((m, s) => Math.max(m, s.duration_sec || 0), 0) || 1;
  html += `<div class="section-label">分镜镜头脚本 · 共 ${shots.length} 个镜头<span class="hint-inline">（点击任一镜头跳转视频对应时刻）</span></div>`;
  html += `<div class="table-wrap"><table class="shots">
    <thead><tr>
      <th class="col-thumb">画面</th>
      <th class="col-no">镜号</th>
      <th>景别/角度</th>
      <th>运动</th>
      <th>画面内容</th>
      <th>音频</th>
      <th class="col-dur">时长(秒)</th>
    </tr></thead><tbody>`;

  shots.forEach((s, i) => {
    const tsLabel = (s.start || s.end) ? `${esc(s.start || '')}${s.end ? ' → ' + esc(s.end) : ''}` : fmtTime(times[i]);
    const barPct = Math.round(((s.duration_sec || 0) / maxDur) * 100);
    html += `<tr class="shot-row" data-start="${times[i] ?? 0}" tabindex="0" title="点击跳转到 ${fmtTime(times[i])}">
      <td class="col-thumb"><div class="thumb" data-thumb="${i}"><span class="thumb-no">${esc(s.shot_number)}</span><span class="thumb-play">▶</span></div></td>
      <td class="col-no">${esc(s.shot_number)}</td>
      <td class="col-size">${esc(s.shot_size) || '—'}</td>
      <td class="col-move">${esc(s.movement) || '—'}</td>
      <td class="col-visual">${esc(s.visual) || '—'}</td>
      <td class="col-audio">${esc(s.audio) || '—'}</td>
      <td class="col-dur">
        <span class="dur-num">${s.duration_sec != null ? esc(s.duration_sec) : '—'}</span>
        <span class="dur-bar"><i style="width:${barPct}%"></i></span>
        <span class="ts">${tsLabel}</span>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  if (result.transcript) {
    html += `<details class="transcript">
      <summary>🎙️ 音频转写全文（真实语音识别）</summary>
      <pre>${esc(result.transcript)}</pre>
    </details>`;
  }

  container.innerHTML = html;
}

function renderStats(shots, meta) {
  if (!shots.length) return '';
  const durs = shots.map((s) => s.duration_sec).filter((d) => Number.isFinite(d) && d > 0);
  const sum = durs.reduce((a, b) => a + b, 0);
  const total = Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : sum;
  const avg = durs.length ? sum / durs.length : 0;
  const min = durs.length ? Math.min(...durs) : 0;
  const max = durs.length ? Math.max(...durs) : 0;

  const chip = (label, val) => `<div class="stat"><span class="stat-val">${val}</span><span class="stat-label">${label}</span></div>`;
  return `<div class="stats">
    ${chip('镜头数', shots.length)}
    ${chip('总时长', fmtTime(total))}
    ${chip('平均镜头', avg ? avg.toFixed(1) + 's' : '—')}
    ${chip('最短 / 最长', durs.length ? `${min.toFixed(1)} / ${max.toFixed(1)}s` : '—')}
  </div>`;
}
