import { esc, escAttr, fmtTime, computeShotTimes } from './util.js';

export { computeShotTimes }; // 兼容旧的从 render.js 导入路径

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
  html += `<div class="section-label">分镜镜头脚本 · <span id="shotCount">共 ${shots.length} 个镜头</span><span class="hint-inline">（点缩略图跳转视频 · 文字单元格可直接编辑，导出自动同步）</span></div>`;
  html += renderBoardTools(shots);
  html += `<div class="table-wrap" id="tableView"><table class="shots">
    <thead><tr>
      <th class="col-thumb">画面</th>
      <th class="col-no">镜号</th>
      <th>景别/角度</th>
      <th>运动</th>
      <th>画面内容</th>
      <th>画面文字</th>
      <th>音频</th>
      <th class="col-dur">时长(秒)</th>
    </tr></thead><tbody>`;

  shots.forEach((s, i) => {
    const tsLabel = (s.start || s.end) ? `${esc(s.start || '')}${s.end ? ' → ' + esc(s.end) : ''}` : fmtTime(times[i]);
    const barPct = Math.round(((s.duration_sec || 0) / maxDur) * 100);
    const ed = (field, cls, val) =>
      `<td class="${cls} editable" contenteditable="true" data-field="${field}" data-i="${i}">${esc(val)}</td>`;
    html += `<tr class="shot-row" data-row="${i}" data-start="${times[i] ?? 0}">
      <td class="col-thumb seek" tabindex="0" title="跳转到 ${fmtTime(times[i])}"><div class="thumb" data-thumb="${i}"><span class="thumb-no">${esc(s.shot_number)}</span><span class="thumb-play">▶</span></div></td>
      <td class="col-no seek" title="跳转到 ${fmtTime(times[i])}">${esc(s.shot_number)}</td>
      ${ed('shot_size', 'col-size', s.shot_size)}
      ${ed('movement', 'col-move', s.movement)}
      ${ed('visual', 'col-visual', s.visual)}
      ${ed('on_screen_text', 'col-text', s.on_screen_text)}
      ${ed('audio', 'col-audio', s.audio)}
      <td class="col-dur">
        <span class="dur-num">${s.duration_sec != null ? esc(s.duration_sec) : '—'}</span>
        <span class="dur-bar"><i style="width:${barPct}%"></i></span>
        <span class="ts">${tsLabel}</span>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  html += renderGallery(shots, times);

  if (result.transcript) {
    html += `<details class="transcript">
      <summary>🎙️ 音频转写全文（真实语音识别）</summary>
      <pre>${esc(result.transcript)}</pre>
    </details>`;
  }

  container.innerHTML = html;
}

// 浏览工具条：表格/画廊视图切换 + 关键词搜索 + 景别筛选 chip
function renderBoardTools(shots) {
  const sizes = [...new Set(shots.map((s) => s.shot_size).filter(Boolean))];
  const chips = sizes.map((sz) => `<button class="szchip" data-size="${escAttr(sz)}">${esc(sz)}</button>`).join('');
  return `<div class="board-tools">
    <div class="view-toggle">
      <button class="vt active" data-view="table" title="表格视图">▦ 表格</button>
      <button class="vt" data-view="gallery" title="画廊视图">▤ 画廊</button>
    </div>
    <input id="shotSearch" class="board-search" type="search" placeholder="搜索 画面 / 文字 / 音频 / 运动…" />
    ${chips ? `<div class="size-filters">${chips}</div>` : ''}
  </div>`;
}

// 画廊视图：缩略图网格，复用与表格相同的缩略图（由 main.js 填充 .gthumb）
function renderGallery(shots, times) {
  const cards = shots.map((s, i) => `
    <div class="gcard shot-card" data-card="${i}" data-start="${times[i] ?? 0}" tabindex="0" title="跳转到 ${fmtTime(times[i])}">
      <div class="gthumb" data-gthumb="${i}"><span class="gthumb-no">${esc(s.shot_number)}</span><span class="thumb-play">▶</span></div>
      <div class="gmeta">
        <div class="gmeta-top"><b>#${esc(s.shot_number)}</b><span>${esc(s.shot_size) || ''}</span><span class="gdur">${s.duration_sec != null ? esc(s.duration_sec) + 's' : ''}</span></div>
        <p>${esc(s.visual) || '—'}</p>
        ${s.on_screen_text ? `<p class="gtext">「${esc(s.on_screen_text)}」</p>` : ''}
      </div>
    </div>`).join('');
  return `<div class="gallery" id="galleryView" hidden>${cards}</div>`;
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
